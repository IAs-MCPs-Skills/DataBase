import { PostgreSQLStrategy } from "./postgresql-strategy.js";

/**
 * Supabase strategy — extends PostgreSQLStrategy since Supabase is PostgreSQL under the hood.
 * Optionally initializes the Supabase JS client if SUPABASE_URL and SUPABASE_KEY are provided.
 * All SQL operations (executeQuery, getSchema, etc.) are inherited from PostgreSQLStrategy.
 */
export class SupabaseStrategy extends PostgreSQLStrategy {
  constructor(config, log) {
    super(config, log);
    this.supabaseClient = null;
  }

  async connect() {
    // Connect via pg (inherited)
    await super.connect();

    // Optionally initialize Supabase JS client
    if (this.config.supabaseUrl && this.config.supabaseKey) {
      try {
        const { createClient } = await import("@supabase/supabase-js");
        this.supabaseClient = createClient(this.config.supabaseUrl, this.config.supabaseKey);
        this.log.info(`Supabase REST client initialized for [${this.name}]`);
      } catch {
        this.log.info(`@supabase/supabase-js not installed — using PostgreSQL driver only for [${this.name}]`);
      }
    }
  }

  async disconnect() {
    this.supabaseClient = null;
    await super.disconnect();
  }
}
