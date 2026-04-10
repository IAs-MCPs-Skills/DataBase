/**
 * Builds MCP tool definitions dynamically based on registered databases.
 * Tool descriptions include available database names so AI agents know what to query.
 */
export function buildTools(registry) {
  const dbList = registry.listAll();
  const dbDescription = dbList.map((d) => `"${d.name}" (${d.type})`).join(", ");

  const hasSql   = dbList.some((d) => d.capabilities?.supportsSQL);
  const hasMongo = dbList.some((d) => d.capabilities?.supportsCollections);
  const hasProcs = dbList.some((d) => d.capabilities?.supportsProcedures);
  const hasWrite = dbList.some((d) => d.capabilities?.supportsWrite);

  const allNames = registry.listNames();
  const databaseParam = {
    type: "string",
    description:
      `Target database name. You MUST specify which database to query. ` +
      `Available databases: ${dbDescription}.`,
    ...(allNames.length > 0 ? { enum: allNames } : {}),
  };

  const tools = [];

  // ── list_databases (always present) ──────────────────────────────────────
  tools.push({
    name: "list_databases",
    description:
      "Lists all registered databases with their names, types, connection status, and capabilities. " +
      "Call this FIRST to discover which databases are available before querying any data. " +
      `Currently registered: ${dbDescription}.`,
    inputSchema: { type: "object", properties: {} },
  });

  // ── reconnect_database (always present) ────────────────────────────────
  const failedList = dbList.filter((d) => d.status === "error");
  const statusDescription = failedList.length > 0
    ? `Currently failed: ${failedList.map((d) => `"${d.name}" (${d.type}: ${d.error})`).join(", ")}.`
    : "No failed databases.";
  tools.push({
    name: "reconnect_database",
    description:
      "Attempts to connect (or reconnect) to a database that failed a previous connection attempt. " +
      "Databases use lazy loading — they connect automatically on first use. " +
      "Use this tool to retry a failed connection without needing to query the database. " +
      statusDescription,
    inputSchema: {
      type: "object",
      required: ["database"],
      properties: {
        database: {
          type: "string",
          description: `Name of the database to reconnect. ${statusDescription}`,
        },
      },
    },
  });

  // ── get_schema (always present, works for all DB types) ──────────────────
  tools.push({
    name: "get_schema",
    description:
      "Returns the database schema (tables/collections, columns/fields, data types) for the specified database. " +
      "For SQL databases (sqlserver, postgresql, supabase): returns INFORMATION_SCHEMA data with tables and columns. " +
      "For MongoDB: samples documents to infer field names and types. " +
      "Call this BEFORE writing queries to understand what data is available. " +
      `Available databases: ${dbDescription}.`,
    inputSchema: {
      type: "object",
      required: ["database"],
      properties: {
        database: databaseParam,
        table_name: {
          type: "string",
          description:
            "Optional. Specific table or collection name to inspect. Omit to list ALL tables/collections.",
        },
      },
    },
  });

  // ── SQL-only tools ───────────────────────────────────────────────────────
  if (hasSql) {
    const sqlDbs = dbList
      .filter((d) => d.capabilities?.supportsSQL)
      .map((d) => `"${d.name}" (${d.type})`)
      .join(", ");

    tools.push({
      name: "execute_query",
      description:
        "Executes a read-only SELECT query against a SQL database. " +
        "ONLY SELECT statements are allowed — dangerous keywords (DROP, DELETE, INSERT, UPDATE, TRUNCATE, ALTER, CREATE) are blocked. " +
        "For SQL Server: automatically injects TOP(limit) when no OFFSET/TOP clause is present. " +
        "For PostgreSQL/Supabase: automatically appends LIMIT when no LIMIT/OFFSET clause is present. " +
        `SQL-capable databases: ${sqlDbs}. ` +
        "DO NOT use this tool for MongoDB databases — use find_documents or aggregate instead. " +
        "Returns: rows (data), column names, rowCount, executionTimeMs.",
      inputSchema: {
        type: "object",
        required: ["database", "query"],
        properties: {
          database: databaseParam,
          query: {
            type: "string",
            description: "Valid SELECT statement. Must start with SELECT.",
          },
          limit: {
            type: "number",
            description: "Maximum rows to return. Default: 1000. Range: 1-10000.",
            default: 1000,
            minimum: 1,
            maximum: 10000,
          },
        },
      },
    });
  }

  // ── Write tool (if any database has allowWrite) ─────────────────────────
  if (hasWrite) {
    const writeDbs = dbList
      .filter((d) => d.capabilities?.supportsWrite)
      .map((d) => `"${d.name}" (${d.type})`)
      .join(", ");

    tools.push({
      name: "execute_write",
      description:
        "Executes a write SQL statement (INSERT, UPDATE, CREATE TABLE, ALTER TABLE) against a database with write access enabled. " +
        "BLOCKED operations: DROP, DELETE, TRUNCATE — these are never allowed. " +
        "This tool is only available for databases with ALLOW_WRITE=true. " +
        `Write-enabled databases: ${writeDbs}. ` +
        "Returns: rowsAffected, executionTimeMs.",
      inputSchema: {
        type: "object",
        required: ["database", "statement"],
        properties: {
          database: databaseParam,
          statement: {
            type: "string",
            description: "SQL write statement. Must start with INSERT, UPDATE, CREATE, or ALTER.",
          },
        },
      },
    });
  }

  // ── Procedure tools ──────────────────────────────────────────────────────
  if (hasProcs) {
    const procDbs = dbList
      .filter((d) => d.capabilities?.supportsProcedures)
      .map((d) => `"${d.name}" (${d.type})`)
      .join(", ");

    tools.push({
      name: "execute_procedure",
      description:
        "Executes a stored procedure or function by name and returns its result set. " +
        "Supports named input parameters as a key/value object. " +
        `Databases with procedure support: ${procDbs}. ` +
        "Returns: rows (data), column names, rowCount, returnValue, executionTimeMs.",
      inputSchema: {
        type: "object",
        required: ["database", "procedure_name"],
        properties: {
          database: databaseParam,
          procedure_name: {
            type: "string",
            description: "Exact stored procedure or function name.",
          },
          parameters: {
            type: "object",
            description:
              'Named input parameters as key/value. E.g.: { "StartDate": "2025-01-01", "DepartmentId": 5 }',
            additionalProperties: true,
          },
        },
      },
    });

    tools.push({
      name: "get_procedures",
      description:
        "Lists all stored procedures/functions in the database with creation and modification dates. " +
        "Call this before execute_procedure to discover what procedures are available. " +
        `Databases with procedure support: ${procDbs}.`,
      inputSchema: {
        type: "object",
        required: ["database"],
        properties: { database: databaseParam },
      },
    });

    tools.push({
      name: "get_procedure_params",
      description:
        "Returns the parameter list for a specific stored procedure: name, mode (IN/OUT), data type, maxLength, precision and scale. " +
        "Call this before execute_procedure to know which parameters are required. " +
        `Databases with procedure support: ${procDbs}.`,
      inputSchema: {
        type: "object",
        required: ["database", "procedure_name"],
        properties: {
          database: databaseParam,
          procedure_name: {
            type: "string",
            description: "Exact stored procedure name to inspect.",
          },
        },
      },
    });
  }

  // ── MongoDB-only tools ───────────────────────────────────────────────────
  if (hasMongo) {
    const mongoDbs = dbList
      .filter((d) => d.capabilities?.supportsCollections)
      .map((d) => `"${d.name}"`)
      .join(", ");

    tools.push({
      name: "find_documents",
      description:
        "Finds documents in a MongoDB collection using a filter object (equivalent of SELECT for MongoDB). " +
        "Supports filtering, projection (field selection), sorting, and limiting results. " +
        "This is a read-only operation. " +
        `MongoDB databases: ${mongoDbs}. ` +
        "DO NOT use this for SQL databases — use execute_query instead. " +
        "Returns: matching documents, rowCount, executionTimeMs.",
      inputSchema: {
        type: "object",
        required: ["database", "collection"],
        properties: {
          database: databaseParam,
          collection: {
            type: "string",
            description: "MongoDB collection name.",
          },
          filter: {
            type: "object",
            description:
              'MongoDB filter object. Default: {} (all documents). E.g.: { "status": "active", "age": { "$gte": 18 } }',
            default: {},
          },
          projection: {
            type: "object",
            description:
              'Fields to include/exclude. E.g.: { "name": 1, "email": 1, "_id": 0 }',
            default: {},
          },
          sort: {
            type: "object",
            description:
              'Sort order. E.g.: { "createdAt": -1 } for descending.',
            default: {},
          },
          limit: {
            type: "number",
            description: "Maximum documents to return. Default: 1000.",
            default: 1000,
            minimum: 1,
            maximum: 10000,
          },
        },
      },
    });

    tools.push({
      name: "aggregate",
      description:
        "Runs a MongoDB aggregation pipeline on a collection. " +
        "Supports stages: $match, $group, $sort, $project, $lookup, $unwind, $limit, $skip, $count, etc. " +
        "$out and $merge stages are BLOCKED (read-only mode). " +
        `MongoDB databases: ${mongoDbs}. ` +
        "DO NOT use this for SQL databases — use execute_query instead. " +
        "Returns: pipeline results, rowCount, executionTimeMs.",
      inputSchema: {
        type: "object",
        required: ["database", "collection", "pipeline"],
        properties: {
          database: databaseParam,
          collection: {
            type: "string",
            description: "MongoDB collection name.",
          },
          pipeline: {
            type: "array",
            description:
              'Aggregation pipeline stages array. E.g.: [{ "$match": { "status": "active" } }, { "$group": { "_id": "$category", "total": { "$sum": 1 } } }]',
            items: { type: "object" },
          },
        },
      },
    });
  }

  return tools;
}
