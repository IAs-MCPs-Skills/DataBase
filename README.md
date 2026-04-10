# DB MCP — Multi-Database MCP Server

MCP (Model Context Protocol) server that enables AI agents like Claude Code to query multiple databases simultaneously. Supports **SQL Server**, **PostgreSQL**, **MongoDB**, and **Supabase**.

## Features

- **Multi-database support** — SQL Server, PostgreSQL, MongoDB, Supabase
- **Dynamic registration** — add databases via environment variables with custom names
- **Parallel queries** — each database has its own connection pool for concurrent access
- **Strategy Pattern** — clean separation of database-specific logic
- **Factory Pattern** — automatic strategy instantiation based on database type
- **Read-only security** — SQL injection prevention, forbidden keyword blocking, write-stage blocking for MongoDB
- **Backward compatible** — existing single SQL Server `.env` files work without changes
- **AI-agent friendly** — tools include available database names in descriptions, `list_databases` for discovery

## Architecture

```
server.js                    <- Thin bootstrap (~80 lines)
src/
  config/
    env-parser.js            <- Parses DB_{N}_* environment variables
    defaults.js              <- Global defaults (MAX_ROWS, QUERY_TIMEOUT)
  logger.js                  <- Logger (stderr, MCP-compatible)
  registry.js                <- DatabaseRegistry: Map<name, strategy>
  factory.js                 <- Creates strategy instances by type
  strategies/
    base-strategy.js         <- Abstract base class with interface contract
    sqlserver-strategy.js    <- SQL Server (mssql)
    postgresql-strategy.js   <- PostgreSQL (pg)
    mongodb-strategy.js      <- MongoDB (mongodb driver)
    supabase-strategy.js     <- Supabase (extends PostgreSQL)
  tools/
    tool-builder.js          <- Dynamic MCP tool definition builder
    handlers.js              <- Tool call dispatcher
```

## Quick Start

### 1. Install

```bash
git clone <repo-url>
cd db-mcp
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your database credentials. See [Configuration](#configuration) below.

### 3. Run

```bash
# Production
npm start

# Debug mode
npm run dev
```

## Configuration

### Environment Variables Format

Each database is registered with a numbered prefix `DB_{N}_*`. The `DB_{N}_NAME` value is the **custom routing key** that agents use to target queries.

```env
# --- Global Settings ---
QUERY_TIMEOUT=30000
MAX_ROWS=1000
DEBUG=false

# --- Database 1: SQL Server ---
DB_1_NAME=erp_principal
DB_1_TYPE=sqlserver
DB_1_SERVER=192.168.1.10
DB_1_PORT=1433
DB_1_DATABASE=ERP_Production
DB_1_USER=reader
DB_1_PASSWORD=secret123
DB_1_ENCRYPT=true
DB_1_TRUST_CERT=true

# --- Database 2: PostgreSQL ---
DB_2_NAME=analytics_pg
DB_2_TYPE=postgresql
DB_2_SERVER=pg-host.example.com
DB_2_PORT=5432
DB_2_DATABASE=analytics
DB_2_USER=readonly
DB_2_PASSWORD=secret456
DB_2_SSL=true

# --- Database 3: MongoDB ---
DB_3_NAME=logs_mongo
DB_3_TYPE=mongodb
DB_3_SERVER=mongo-host.example.com
DB_3_PORT=27017
DB_3_DATABASE=app_logs
DB_3_USER=reader
DB_3_PASSWORD=secret789
DB_3_AUTH_SOURCE=admin

# --- Database 4: Supabase ---
DB_4_NAME=app_supabase
DB_4_TYPE=supabase
DB_4_SERVER=abc123.supabase.co
DB_4_PORT=5432
DB_4_DATABASE=postgres
DB_4_USER=postgres
DB_4_PASSWORD=secretABC
DB_4_SUPABASE_URL=https://abc123.supabase.co
DB_4_SUPABASE_KEY=eyJ...
```

**Notes:**
- Numbers don't need to be sequential (`DB_1`, `DB_5`, `DB_12` all work)
- `DB_{N}_NAME` is the routing key agents will use (e.g., `database: "erp_principal"`)
- `DB_{N}_TYPE` must be one of: `sqlserver`, `postgresql`, `mongodb`, `supabase`
- Each type supports type-specific options (see table below)

### Type-Specific Options

| Option | Types | Description |
|--------|-------|-------------|
| `DB_{N}_ENCRYPT` | sqlserver | Enable TLS encryption (default: true) |
| `DB_{N}_TRUST_CERT` | sqlserver | Trust self-signed certificates (default: true) |
| `DB_{N}_SSL` | postgresql, supabase | Enable SSL connection (default: false) |
| `DB_{N}_AUTH_SOURCE` | mongodb | Authentication database (default: admin) |
| `DB_{N}_CONNECTION_STRING` | mongodb | Full connection string (overrides individual fields) |
| `DB_{N}_SUPABASE_URL` | supabase | Supabase project URL (optional, for REST client) |
| `DB_{N}_SUPABASE_KEY` | supabase | Supabase anon/service key (optional, for REST client) |
| `DB_{N}_QUERY_TIMEOUT` | all | Per-database timeout override (ms) |
| `DB_{N}_MAX_ROWS` | all | Per-database row limit override |

### Backward Compatibility

If no `DB_1_*` variables are found, the server falls back to the legacy single-database format:

```env
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=master
DB_USER=sa
DB_PASSWORD=YourPassword
```

This automatically creates a database entry with `name: "default"` and `type: "sqlserver"`.

## MCP Tools

### Discovery

| Tool | Description |
|------|-------------|
| `list_databases` | Lists all registered databases with names, types, and capabilities. **Call this first.** |
| `get_schema` | Returns tables/collections, columns/fields, data types for any database. |

### SQL Tools (SQL Server, PostgreSQL, Supabase)

| Tool | Description |
|------|-------------|
| `execute_query` | Executes a read-only SELECT query. Auto-injects TOP (SQL Server) or LIMIT (PostgreSQL). |
| `execute_procedure` | Executes a stored procedure/function with named parameters. |
| `get_procedures` | Lists stored procedures/functions in the database. |
| `get_procedure_params` | Returns parameter details for a specific procedure. |

### MongoDB Tools

| Tool | Description |
|------|-------------|
| `find_documents` | Finds documents using a filter object (equivalent of SELECT). Supports projection, sort, limit. |
| `aggregate` | Runs an aggregation pipeline ($match, $group, $sort, etc.). $out/$merge are blocked. |

### Tool Parameters

Every tool (except `list_databases`) requires a `database` parameter -- the custom name you defined in `DB_{N}_NAME`.

```json
{
  "database": "erp_principal",
  "query": "SELECT TOP 10 * FROM Users"
}
```

The `database` parameter uses an `enum` constraint listing all available names, so AI agents can auto-complete and won't hallucinate invalid names.

## Integration with Claude Code

### Via `~/.claude/mcp.json`

```json
{
  "mcpServers": {
    "db": {
      "command": "node",
      "args": ["/path/to/db-mcp/server.js"],
      "env": {
        "DB_1_NAME": "erp_principal",
        "DB_1_TYPE": "sqlserver",
        "DB_1_SERVER": "192.168.1.10",
        "DB_1_PORT": "1433",
        "DB_1_DATABASE": "ERP_Production",
        "DB_1_USER": "reader",
        "DB_1_PASSWORD": "secret123",
        "DB_2_NAME": "logs_mongo",
        "DB_2_TYPE": "mongodb",
        "DB_2_SERVER": "mongo-host.example.com",
        "DB_2_PORT": "27017",
        "DB_2_DATABASE": "app_logs",
        "DB_2_USER": "reader",
        "DB_2_PASSWORD": "secret789"
      }
    }
  }
}
```

### Via Docker

```bash
docker compose up -d
```

## Security

### Per Database Type

| Database | Guard | Blocked |
|----------|-------|---------|
| SQL Server | Regex + must start with SELECT | DROP, DELETE, INSERT, UPDATE, TRUNCATE, ALTER, CREATE, SHUTDOWN, RECONFIGURE |
| PostgreSQL | Regex + must start with SELECT | Same as above + COPY, GRANT, REVOKE |
| MongoDB | Pipeline stage blocking | $out, $merge (write stages) |
| Supabase | Inherits PostgreSQL | Same as PostgreSQL |

### Best Practices

- Create **read-only database users** with minimal permissions
- Use environment variables for all credentials (never hardcode)
- Set `DEBUG=false` in production
- Use connection encryption (`DB_{N}_ENCRYPT=true`, `DB_{N}_SSL=true`)

## Parallel Queries

Each database has its own independent connection pool. The MCP SDK processes tool calls concurrently, so agents can query multiple databases simultaneously without blocking.

```
Agent -> execute_query(database: "erp_principal", query: "SELECT ...")  -+
Agent -> find_documents(database: "logs_mongo", collection: "events")   -+-- Run in parallel
Agent -> execute_query(database: "analytics_pg", query: "SELECT ...")   -+
```

## Docker

### Build

```bash
docker build -t tdbp .
```

### Run

```bash
docker run -it --env-file .env db-mcp
```

### Compose

```bash
docker compose up -d
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `No database configuration found` | Set at least one `DB_1_NAME`, `DB_1_TYPE`, `DB_1_SERVER` in `.env` |
| `Database "xyz" not found` | Check that the name matches exactly what's in `DB_{N}_NAME` |
| `does not support SQL queries` | You're using `execute_query` on a MongoDB database -- use `find_documents` instead |
| `does not support document operations` | You're using `find_documents` on a SQL database -- use `execute_query` instead |
| Connection timeout | Verify server address, port, firewall rules, and credentials |
| `@supabase/supabase-js not installed` | Install with `npm install @supabase/supabase-js` (optional, pg driver works without it) |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `dotenv` | Environment variable loading |
| `mssql` | SQL Server driver |
| `pg` | PostgreSQL driver |
| `mongodb` | MongoDB driver |
| `@supabase/supabase-js` | Supabase REST client (optional) |

## License

MIT
