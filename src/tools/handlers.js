import { DEFAULTS } from "../config/defaults.js";

/**
 * Dispatches MCP tool calls to the correct database strategy method.
 */
export async function handleToolCall(name, args, registry) {
  // list_databases does not require a database parameter
  if (name === "list_databases") {
    return { success: true, databases: registry.listAll() };
  }

  // reconnect_database — retry connection for a failed database
  if (name === "reconnect_database") {
    return registry.reconnect(args.database);
  }

  // All other tools require a database parameter
  if (!args.database) {
    const available = registry.listNames().join(", ");
    throw new Error(
      `Missing required parameter "database". Available databases: ${available}. ` +
      `Please specify which database to query.`
    );
  }

  const db = await registry.get(args.database);

  switch (name) {
    case "execute_query":
      return db.executeQuery(args.query, args.limit || DEFAULTS.maxRows);

    case "execute_write":
      return db.executeWrite(args.statement);

    case "execute_procedure":
      return db.executeProcedure(args.procedure_name, args.parameters || {});

    case "get_schema":
      return db.getSchema(args.table_name);

    case "get_procedures":
      return db.getProcedures();

    case "get_procedure_params":
      return db.getProcedureParams(args.procedure_name);

    case "find_documents":
      return db.findDocuments(args.collection, args.filter || {}, {
        projection: args.projection,
        sort: args.sort,
        limit: args.limit || DEFAULTS.maxRows,
      });

    case "aggregate":
      return db.aggregate(args.collection, args.pipeline);

    default:
      throw new Error(`Unknown tool: "${name}".`);
  }
}
