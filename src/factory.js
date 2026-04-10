import { SqlServerStrategy }  from "./strategies/sqlserver-strategy.js";
import { PostgreSQLStrategy } from "./strategies/postgresql-strategy.js";
import { MongoDBStrategy }    from "./strategies/mongodb-strategy.js";
import { SupabaseStrategy }   from "./strategies/supabase-strategy.js";

const STRATEGY_MAP = {
  sqlserver:  SqlServerStrategy,
  postgresql: PostgreSQLStrategy,
  mongodb:    MongoDBStrategy,
  supabase:   SupabaseStrategy,
};

/**
 * Factory — creates the correct database strategy based on config.type.
 */
export function createStrategy(config, log) {
  const StrategyClass = STRATEGY_MAP[config.type];
  if (!StrategyClass) {
    throw new Error(
      `Unknown database type: "${config.type}". Supported: ${Object.keys(STRATEGY_MAP).join(", ")}`
    );
  }
  return new StrategyClass(config, log);
}

export function getSupportedTypes() {
  return Object.keys(STRATEGY_MAP);
}
