/**
 * Abstract base class defining the contract for all database strategies.
 * Each database type (sqlserver, postgresql, mongodb, supabase) must extend
 * this class and implement the required methods.
 */
export class BaseDatabaseStrategy {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.name = config.name;
    this.type = config.type;
    this.connected = false;
    this.blockedIdentifiers = (config.blockedIdentifiers || [])
      .map((value) => String(value).trim())
      .filter(Boolean);
  }

  /** Returns the capabilities of this database type. */
  getCapabilities() {
    return {
      supportsSQL: false,
      supportsProcedures: false,
      supportsCollections: false,
      supportsAggregation: false,
      supportsWrite: false,
    };
  }

  /** Connect to the database. Must set this.connected = true on success. */
  async connect() {
    throw new Error("connect() not implemented");
  }

  /** Disconnect and clean up resources. */
  async disconnect() {
    throw new Error("disconnect() not implemented");
  }

  /** Execute a read-only query. */
  async executeQuery(_query, _limit) {
    throw new Error(`${this.type} does not support SQL queries.`);
  }

  /** Get schema information (tables/columns or collections/fields). */
  async getSchema(_tableName) {
    throw new Error("getSchema() not implemented");
  }

  /** Execute a stored procedure. SQL-based databases only. */
  async executeProcedure(_procedureName, _parameters) {
    throw new Error(`${this.type} does not support stored procedures.`);
  }

  /** List stored procedures. SQL-based databases only. */
  async getProcedures() {
    throw new Error(`${this.type} does not support stored procedures.`);
  }

  /** Get procedure parameters. SQL-based databases only. */
  async getProcedureParams(_procedureName) {
    throw new Error(`${this.type} does not support stored procedures.`);
  }

  /** Find documents in a collection. MongoDB only. */
  async findDocuments(_collection, _filter, _options) {
    throw new Error(`${this.type} does not support document operations.`);
  }

  /** Run an aggregation pipeline. MongoDB only. */
  async aggregate(_collection, _pipeline) {
    throw new Error(`${this.type} does not support aggregation pipelines.`);
  }

  /** Execute a write statement (INSERT, UPDATE, CREATE TABLE, ALTER TABLE). Requires allowWrite. */
  async executeWrite(_statement) {
    throw new Error(`${this.type} does not support write operations.`);
  }

  /** Validate and guard a SQL query (shared by SQL-based strategies). */
  guardQuery(query) {
    const FORBIDDEN = /\b(DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE|SHUTDOWN|RECONFIGURE)\b/i;
    this.ensureNoRestrictedIdentifiers(query, "Query");
    if (!/^SELECT\b/i.test(query.trim())) {
      throw new Error("Only SELECT statements are allowed.");
    }
    if (FORBIDDEN.test(query)) {
      throw new Error("Query contains forbidden keywords.");
    }
  }

  /** Validate a write statement. Allows INSERT, UPDATE, CREATE, ALTER. Blocks destructive ops. */
  guardWrite(statement) {
    if (!this.config.allowWrite) {
      throw new Error(`Write operations are disabled for "${this.name}". Set DB_N_ALLOW_WRITE=true to enable.`);
    }
    this.ensureNoRestrictedIdentifiers(statement, "Statement");
    const BLOCKED = /\b(DROP|DELETE|TRUNCATE|SHUTDOWN|RECONFIGURE)\b/i;
    if (BLOCKED.test(statement)) {
      throw new Error("Statement contains blocked keywords (DROP, DELETE, TRUNCATE). Use INSERT, UPDATE, CREATE TABLE, or ALTER TABLE only.");
    }
    const ALLOWED = /^\s*(INSERT|UPDATE|CREATE|ALTER)\b/i;
    if (!ALLOWED.test(statement.trim())) {
      throw new Error("Only INSERT, UPDATE, CREATE TABLE, and ALTER TABLE statements are allowed.");
    }
  }

  ensureNoRestrictedIdentifiers(text, label = "Operation") {
    const restricted = this.findRestrictedIdentifiers(text);
    if (restricted.length > 0) {
      throw new Error(`${label} references a restricted database object.`);
    }
  }

  filterRestrictedNames(names = []) {
    return names.filter((name) => this.findRestrictedIdentifiers(name).length === 0);
  }

  findRestrictedIdentifiers(text) {
    if (!text || this.blockedIdentifiers.length === 0) return [];
    return this.blockedIdentifiers.filter((identifier) => {
      const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(String(text));
    });
  }

  /**
   * Filters result rows, removing any row where a column value contains a
   * restricted identifier. Prevents leaking production database names/data
   * via system views (e.g. sys.databases) or cross-database references.
   */
  filterRestrictedRows(rows = []) {
    if (this.blockedIdentifiers.length === 0) return rows;
    return rows.filter((row) =>
      !Object.values(row).some(
        (value) => value != null && this.findRestrictedIdentifiers(String(value)).length > 0
      )
    );
  }
}
