#!/usr/bin/env node

/**
 * Connection Test Script for DB MCP Server
 *
 * Tests connectivity to all databases configured in .env
 * Uses the same env-parser as the MCP server.
 *
 * Usage: node test-example.js
 */

import dotenv from "dotenv";
import sql from "mssql";
import pg from "pg";
import { MongoClient } from "mongodb";
import { parseEnvDatabases } from "./src/config/env-parser.js";

dotenv.config();

const databases = parseEnvDatabases(process.env);

console.log(`Found ${databases.length} database(s) configured.\n`);

for (const db of databases) {
  console.log(`--- [${db.name}] type=${db.type} server=${db.server}:${db.port || "default"} db=${db.database} ---`);

  try {
    switch (db.type) {
      case "sqlserver": {
        const pool = new sql.ConnectionPool({
          server: db.server,
          port: db.port || 1433,
          database: db.database,
          authentication: {
            type: "default",
            options: { userName: db.user, password: db.password },
          },
          options: {
            encrypt: db.encrypt,
            trustServerCertificate: db.trustCert,
            connectTimeout: 10000,
            requestTimeout: db.queryTimeout,
          },
        });
        await pool.connect();
        const result = await pool.request().query("SELECT @@VERSION AS version");
        const version = result.recordset[0].version.split("\n")[0];
        console.log(`  OK — ${version}\n`);
        await pool.close();
        break;
      }

      case "postgresql":
      case "supabase": {
        const client = new pg.Client({
          host: db.server,
          port: db.port || 5432,
          database: db.database,
          user: db.user,
          password: db.password,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 10000,
        });
        await client.connect();
        const result = await client.query("SELECT version()");
        console.log(`  OK — ${result.rows[0].version}\n`);
        await client.end();
        break;
      }

      case "mongodb": {
        const uri =
          db.connectionString ||
          `mongodb://${db.user}:${encodeURIComponent(db.password)}@${db.server}:${db.port || 27017}/${db.database}?authSource=${db.authSource || "admin"}`;
        const client = new MongoClient(uri, { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
        await client.connect();
        const admin = client.db(db.database).admin();
        const info = await admin.serverInfo();
        console.log(`  OK — MongoDB ${info.version}\n`);
        await client.close();
        break;
      }

      default:
        console.log(`  SKIP — unsupported type "${db.type}"\n`);
    }
  } catch (err) {
    console.log(`  FAIL — ${err.message}\n`);
  }
}

console.log("Done.");
