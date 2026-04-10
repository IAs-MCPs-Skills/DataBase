#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────────────────────
// DB MCP — Multi-Database MCP Server (SQL Server, PostgreSQL, MongoDB, Supabase)
// ─────────────────────────────────────────────────────────────────────────────

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

import { log } from "./src/logger.js";
import { parseEnvDatabases } from "./src/config/env-parser.js";
import { DatabaseRegistry } from "./src/registry.js";
import { buildTools } from "./src/tools/tool-builder.js";
import { handleToolCall } from "./src/tools/handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from cwd first (project-specific), fallback to server directory
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(__dirname, ".env") });

// ─── REGISTRY ───────────────────────────────────────────────────────────────
const registry = new DatabaseRegistry(log);

// ─── SHUTDOWN ───────────────────────────────────────────────────────────────
async function shutdown(sig) {
  log.info(`${sig} received — shutting down`);
  await registry.disconnectAll();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  log.info("Starting DB MCP Server");

  // Parse and register all databases (lazy — connections happen on first use)
  const configs = parseEnvDatabases(process.env);
  for (const config of configs) {
    registry.register(config);
  }

  log.info(`Registered ${configs.length} database(s): ${registry.listNames().join(", ")} (lazy connection)`);

  // Create MCP server
  const server = new Server(
    { name: "db-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  // Tools are rebuilt on every request so reconnected databases are reflected immediately
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildTools(registry),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};

    log.info(`tool_call: ${name}`);
    log.debug("args", JSON.stringify(args));

    try {
      const result = await handleToolCall(name, args, registry);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log.error(`tool_call failed: ${name}`, err);
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, tool: name, error: err.message }, null, 2) }],
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("MCP server ready — listening via stdio");
}

main().catch((err) => { log.error("Fatal error", err); process.exit(1); });
