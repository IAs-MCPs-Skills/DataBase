import pg from "pg";
import { BaseDatabaseStrategy } from "./base-strategy.js";

export class PostgreSQLStrategy extends BaseDatabaseStrategy {
  constructor(config, log) {
    super(config, log);
    this.pool = null;
  }

  getCapabilities() {
    return {
      supportsSQL: true,
      supportsProcedures: true,
      supportsCollections: false,
      supportsAggregation: false,
      supportsWrite: !!this.config.allowWrite,
    };
  }

  guardQuery(query) {
    const FORBIDDEN = /\b(DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE|COPY|GRANT|REVOKE)\b/i;
    this.ensureNoRestrictedIdentifiers(query, "Query");
    if (!/^SELECT\b/i.test(query.trim())) {
      throw new Error("Only SELECT statements are allowed.");
    }
    if (FORBIDDEN.test(query)) {
      throw new Error("Query contains forbidden keywords.");
    }
  }

  async connect() {
    this.pool = new pg.Pool({
      host:     this.config.server,
      port:     this.config.port || 5432,
      database: this.config.database,
      user:     this.config.user,
      password: this.config.password,
      ssl:      this.config.ssl ? { rejectUnauthorized: false } : false,
      max:                    10,
      idleTimeoutMillis:      30000,
      connectionTimeoutMillis: 30000,
    });

    this.log.info(`Connecting to PostgreSQL [${this.name}]: ${this.config.server}:${this.config.port || 5432}`);
    // Test connection
    const client = await this.pool.connect();
    client.release();
    this.connected = true;
    this.log.info(`Connected [${this.name}]`);
  }

  async disconnect() {
    if (this.pool) await this.pool.end();
    this.connected = false;
  }

  async executeQuery(query, limit = 1000) {
    this.guardQuery(query);
    const t0 = Date.now();

    let finalQuery = query;
    const upper = query.toUpperCase();
    if (!upper.includes("LIMIT") && !upper.includes("OFFSET")) {
      finalQuery = `${query} LIMIT ${limit}`;
    }

    this.log.debug(`execute_query [${this.name}]`, finalQuery);
    const result = await this.pool.query(finalQuery);
    const rows = this.filterRestrictedRows(result.rows);
    return {
      success: true,
      database: this.name,
      rowCount: rows.length,
      executionTimeMs: Date.now() - t0,
      columns: result.fields.map((f) => f.name),
      data: rows,
    };
  }

  guardWrite(statement) {
    if (!this.config.allowWrite) {
      throw new Error(`Write operations are disabled for "${this.name}". Set DB_N_ALLOW_WRITE=true to enable.`);
    }
    this.ensureNoRestrictedIdentifiers(statement, "Statement");
    const BLOCKED = /\b(DROP|DELETE|TRUNCATE|COPY|GRANT|REVOKE)\b/i;
    if (BLOCKED.test(statement)) {
      throw new Error("Statement contains blocked keywords (DROP, DELETE, TRUNCATE, COPY, GRANT, REVOKE). Use INSERT, UPDATE, CREATE TABLE, or ALTER TABLE only.");
    }
    const ALLOWED = /^\s*(INSERT|UPDATE|CREATE|ALTER)\b/i;
    if (!ALLOWED.test(statement.trim())) {
      throw new Error("Only INSERT, UPDATE, CREATE TABLE, and ALTER TABLE statements are allowed.");
    }
  }

  async executeWrite(statement) {
    this.guardWrite(statement);
    const t0 = Date.now();

    this.log.debug(`execute_write [${this.name}]`, statement);
    const result = await this.pool.query(statement);
    return {
      success: true,
      database: this.name,
      rowsAffected: result.rowCount ?? 0,
      executionTimeMs: Date.now() - t0,
    };
  }

  async getSchema(tableName) {
    this.ensureNoRestrictedIdentifiers(tableName, "Table name");
    const t0 = Date.now();
    let query =
      "SELECT t.table_name, c.column_name, c.data_type, c.is_nullable," +
      " c.character_maximum_length, c.numeric_precision, c.column_default, c.ordinal_position" +
      " FROM information_schema.tables t" +
      " JOIN information_schema.columns c" +
      "   ON c.table_name = t.table_name AND c.table_schema = t.table_schema" +
      " WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'";
    const params = [];
    if (tableName) {
      params.push(tableName);
      query += ` AND t.table_name = $1`;
    }
    query += " ORDER BY t.table_name, c.ordinal_position";

    this.log.debug(`get_schema [${this.name}]`, tableName ?? "all");
    const result = await this.pool.query(query, params);
    const schema = {};
    for (const row of result.rows) {
      if (this.findRestrictedIdentifiers(row.table_name).length > 0) continue;
      if (!schema[row.table_name]) schema[row.table_name] = [];
      schema[row.table_name].push({
        column:    row.column_name,
        type:      row.data_type,
        nullable:  row.is_nullable === "YES",
        maxLength: row.character_maximum_length,
        precision: row.numeric_precision,
        default:   row.column_default,
        position:  row.ordinal_position,
      });
    }
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      tableCount: Object.keys(schema).length,
      schema,
    };
  }

  async getProcedures() {
    const t0 = Date.now();
    const result = await this.pool.query(
      "SELECT routine_name AS name, created AS \"createdAt\", last_altered AS \"modifiedAt\"" +
      " FROM information_schema.routines" +
      " WHERE routine_schema = 'public'" +
      " ORDER BY routine_name"
    );
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      count: this.filterRestrictedNames(result.rows.map((item) => item.name)).length,
      procedures: result.rows.filter((item) => this.findRestrictedIdentifiers(item.name).length === 0),
    };
  }

  async executeProcedure(procedureName, parameters = {}) {
    this.ensureNoRestrictedIdentifiers(procedureName, "Procedure");
    const t0 = Date.now();
    const values = Object.values(parameters);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const query = `SELECT * FROM ${procedureName}(${placeholders})`;

    this.log.debug(`execute_procedure [${this.name}]`, procedureName);
    const result = await this.pool.query(query, values);
    return {
      success: true,
      database: this.name,
      rowCount: result.rows.length,
      executionTimeMs: Date.now() - t0,
      returnValue: null,
      columns: result.fields.map((f) => f.name),
      data: result.rows,
    };
  }

  async getProcedureParams(procedureName) {
    this.ensureNoRestrictedIdentifiers(procedureName, "Procedure");
    const t0 = Date.now();
    const result = await this.pool.query(
      "SELECT parameter_name AS name, parameter_mode AS mode, data_type AS type," +
      " character_maximum_length AS \"maxLength\", numeric_precision AS precision," +
      " numeric_scale AS scale, ordinal_position AS position" +
      " FROM information_schema.parameters" +
      " WHERE specific_schema = 'public' AND specific_name = $1" +
      " ORDER BY ordinal_position",
      [procedureName]
    );
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      procedure: procedureName,
      count: result.rows.length,
      parameters: result.rows,
    };
  }
}
