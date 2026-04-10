import sql from "mssql";
import { BaseDatabaseStrategy } from "./base-strategy.js";

export class SqlServerStrategy extends BaseDatabaseStrategy {
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

  async connect() {
    const mssqlConfig = {
      server:   this.config.server,
      port:     this.config.port || 1433,
      database: this.config.database,
      authentication: {
        type: "default",
        options: {
          userName: this.config.user,
          password: this.config.password,
        },
      },
      options: {
        encrypt:                this.config.encrypt !== false,
        trustServerCertificate: this.config.trustCert !== false,
        connectTimeout:         30000,
        requestTimeout:         this.config.queryTimeout || 30000,
        enableArithAbort:       true,
      },
      pool: { max: 10, min: 2, idleTimeoutMillis: 30000 },
    };

    this.log.info(`Connecting to SQL Server [${this.name}]: ${this.config.server}:${mssqlConfig.port}`);
    this.pool = await new sql.ConnectionPool(mssqlConfig).connect();
    this.pool.on("error", (err) => this.log.error(`Pool error [${this.name}]`, err));
    this.connected = true;
    this.log.info(`Connected [${this.name}]`);
  }

  async disconnect() {
    if (this.pool) await this.pool.close();
    this.connected = false;
  }

  async executeQuery(query, limit = 1000) {
    this.guardQuery(query);
    const t0 = Date.now();
    const req = this.pool.request();
    req.timeout = this.config.queryTimeout || 30000;

    const upper = query.toUpperCase();
    let finalQuery = query;
    if (!upper.includes("OFFSET") && !upper.includes(" TOP ")) {
      finalQuery = query.replace(/^(\s*SELECT\s)/i, `$1TOP (${limit}) `);
    }

    this.log.debug(`execute_query [${this.name}]`, finalQuery);
    const result = await req.query(finalQuery);
    const rows = this.filterRestrictedRows(result.recordset ?? []);
    return {
      success: true,
      database: this.name,
      rowCount: rows.length,
      executionTimeMs: Date.now() - t0,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      data: rows,
    };
  }

  async executeProcedure(procedureName, parameters = {}) {
    this.ensureNoRestrictedIdentifiers(procedureName, "Procedure");
    const t0 = Date.now();
    const req = this.pool.request();
    req.timeout = this.config.queryTimeout || 30000;
    for (const [k, v] of Object.entries(parameters)) req.input(k, v);

    this.log.debug(`execute_procedure [${this.name}]`, procedureName);
    const result = await req.execute(procedureName);
    const rows = result.recordset ?? [];
    return {
      success: true,
      database: this.name,
      rowCount: rows.length,
      executionTimeMs: Date.now() - t0,
      returnValue: result.returnValue,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      data: rows,
    };
  }

  async executeWrite(statement) {
    this.guardWrite(statement);
    const t0 = Date.now();
    const req = this.pool.request();
    req.timeout = this.config.queryTimeout || 30000;

    this.log.debug(`execute_write [${this.name}]`, statement);
    const result = await req.query(statement);
    return {
      success: true,
      database: this.name,
      rowsAffected: result.rowsAffected?.[0] ?? 0,
      executionTimeMs: Date.now() - t0,
    };
  }

  async getSchema(tableName) {
    this.ensureNoRestrictedIdentifiers(tableName, "Table name");
    const t0 = Date.now();
    const req = this.pool.request();
    let query =
      "SELECT t.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE," +
      " c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.COLUMN_DEFAULT, c.ORDINAL_POSITION" +
      " FROM INFORMATION_SCHEMA.TABLES t" +
      " JOIN INFORMATION_SCHEMA.COLUMNS c" +
      "   ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA" +
      " WHERE t.TABLE_SCHEMA = 'dbo' AND t.TABLE_TYPE = 'BASE TABLE'";
    if (tableName) {
      req.input("tbl", sql.NVarChar, tableName);
      query += " AND t.TABLE_NAME = @tbl";
    }
    query += " ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION";

    this.log.debug(`get_schema [${this.name}]`, tableName ?? "all");
    const result = await req.query(query);
    const schema = {};
    for (const row of (result.recordset ?? [])) {
      if (this.findRestrictedIdentifiers(row.TABLE_NAME).length > 0) continue;
      if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
      schema[row.TABLE_NAME].push({
        column:    row.COLUMN_NAME,
        type:      row.DATA_TYPE,
        nullable:  row.IS_NULLABLE === "YES",
        maxLength: row.CHARACTER_MAXIMUM_LENGTH,
        precision: row.NUMERIC_PRECISION,
        default:   row.COLUMN_DEFAULT,
        position:  row.ORDINAL_POSITION,
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
    const result = await this.pool.request().query(
      "SELECT ROUTINE_NAME AS name, CREATED AS createdAt, LAST_ALTERED AS modifiedAt" +
      " FROM INFORMATION_SCHEMA.ROUTINES" +
      " WHERE ROUTINE_SCHEMA = 'dbo' AND ROUTINE_TYPE = 'PROCEDURE'" +
      " ORDER BY ROUTINE_NAME"
    );
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      count: this.filterRestrictedNames(result.recordset.map((item) => item.name)).length,
      procedures: result.recordset.filter((item) => this.findRestrictedIdentifiers(item.name).length === 0),
    };
  }

  async getProcedureParams(procedureName) {
    this.ensureNoRestrictedIdentifiers(procedureName, "Procedure");
    const t0 = Date.now();
    const req = this.pool.request();
    req.input("proc", sql.NVarChar, procedureName);
    const result = await req.query(
      "SELECT PARAMETER_NAME AS name, PARAMETER_MODE AS mode, DATA_TYPE AS type," +
      " CHARACTER_MAXIMUM_LENGTH AS maxLength, NUMERIC_PRECISION AS precision," +
      " NUMERIC_SCALE AS scale, ORDINAL_POSITION AS position" +
      " FROM INFORMATION_SCHEMA.PARAMETERS" +
      " WHERE SPECIFIC_SCHEMA = 'dbo' AND SPECIFIC_NAME = @proc" +
      " ORDER BY ORDINAL_POSITION"
    );
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      procedure: procedureName,
      count: result.recordset.length,
      parameters: result.recordset,
    };
  }
}
