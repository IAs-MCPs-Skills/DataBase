import { createStrategy } from "./factory.js";

/**
 * Registry — manages database strategy instances as a Map<name, entry>.
 * Uses lazy loading: strategies are created at registration but only
 * connected on first use. Failed connections can be retried at any time.
 */
export class DatabaseRegistry {
  constructor(log) {
    this.log = log;
    /**
     * @type {Map<string, {config: object, strategy: import("./strategies/base-strategy.js").BaseDatabaseStrategy, status: "pending"|"connected"|"error", error: string|null}>}
     */
    this.entries = new Map();
  }

  register(config) {
    if (this.entries.has(config.name)) {
      throw new Error(`Database name "${config.name}" is already registered.`);
    }
    const strategy = createStrategy(config, this.log);
    this.entries.set(config.name, {
      config,
      strategy,
      status: "pending",
      error: null,
    });
  }

  async ensureConnected(entry) {
    if (entry.status === "connected") return;

    try {
      await entry.strategy.connect();
      entry.status = "connected";
      entry.error = null;
      this.log.info(`Connected to "${entry.config.name}" (${entry.config.type})`);
    } catch (err) {
      entry.status = "error";
      entry.error = err.message;
      // Recreate strategy so the next attempt starts fresh
      entry.strategy = createStrategy(entry.config, this.log);
      throw err;
    }
  }

  async get(name) {
    const entry = this.entries.get(name);
    if (!entry) {
      const available = this.listNames().join(", ");
      throw new Error(
        `Database "${name}" not found. Available databases: ${available}`
      );
    }

    if (entry.status !== "connected") {
      try {
        await this.ensureConnected(entry);
      } catch (err) {
        throw new Error(
          `Database "${name}" is unavailable — connection failed: ${err.message}. ` +
          `Use reconnect_database to retry.`
        );
      }
    }

    return entry.strategy;
  }

  async reconnect(name) {
    const entry = this.entries.get(name);
    if (!entry) {
      const available = this.listNames().join(", ");
      throw new Error(`Database "${name}" not found. Known databases: ${available}`);
    }

    if (entry.status === "connected") {
      return { success: true, message: `Database "${name}" is already connected.` };
    }

    try {
      await this.ensureConnected(entry);
      return { success: true, message: `Database "${name}" connected successfully.` };
    } catch (err) {
      throw new Error(`Connection to "${name}" failed: ${err.message}`);
    }
  }

  listNames() {
    return Array.from(this.entries.keys());
  }

  listAll() {
    return Array.from(this.entries.entries()).map(([name, entry]) => ({
      name,
      type: entry.config.type,
      status: entry.status,
      connected: entry.status === "connected",
      error: entry.error,
      capabilities: entry.strategy.getCapabilities(),
    }));
  }

  async disconnectAll() {
    for (const [name, entry] of this.entries) {
      if (entry.status === "connected") {
        try {
          await entry.strategy.disconnect();
          entry.status = "pending";
          this.log.info(`Disconnected: "${name}"`);
        } catch (e) {
          this.log.error(`Error disconnecting "${name}"`, e);
        }
      }
    }
  }
}
