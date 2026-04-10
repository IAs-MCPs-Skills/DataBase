import { MongoClient } from "mongodb";
import { BaseDatabaseStrategy } from "./base-strategy.js";

export class MongoDBStrategy extends BaseDatabaseStrategy {
  constructor(config, log) {
    super(config, log);
    this.client = null;
    this.db = null;
  }

  getCapabilities() {
    return {
      supportsSQL: false,
      supportsProcedures: false,
      supportsCollections: true,
      supportsAggregation: true,
    };
  }

  async connect() {
    let uri;
    if (this.config.connectionString) {
      uri = this.config.connectionString;
    } else {
      const authSource = this.config.authSource || "admin";
      const userPass = this.config.user
        ? `${encodeURIComponent(this.config.user)}:${encodeURIComponent(this.config.password)}@`
        : "";
      uri = `mongodb://${userPass}${this.config.server}:${this.config.port || 27017}/${this.config.database}?authSource=${authSource}`;
    }

    this.log.info(`Connecting to MongoDB [${this.name}]: ${this.config.server}:${this.config.port || 27017}/${this.config.database}`);
    this.client = new MongoClient(uri, {
      maxPoolSize: 10,
      connectTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000,
    });
    await this.client.connect();
    this.db = this.client.db(this.config.database);
    this.connected = true;
    this.log.info(`Connected [${this.name}]`);
  }

  async disconnect() {
    if (this.client) await this.client.close();
    this.connected = false;
  }

  async getSchema(collectionName) {
    const t0 = Date.now();

    if (collectionName) {
      const sample = await this.db.collection(collectionName).findOne();
      const schema = {};
      schema[collectionName] = sample
        ? Object.keys(sample).map((key, i) => ({
            column: key,
            type: Array.isArray(sample[key]) ? "array" : typeof sample[key],
            nullable: true,
            maxLength: null,
            precision: null,
            default: null,
            position: i + 1,
          }))
        : [];
      return {
        success: true,
        database: this.name,
        executionTimeMs: Date.now() - t0,
        tableCount: 1,
        schema,
      };
    }

    // List all collections with sampled fields
    const collections = await this.db.listCollections().toArray();
    const schema = {};
    for (const col of collections) {
      const sample = await this.db.collection(col.name).findOne();
      schema[col.name] = sample
        ? Object.keys(sample).map((key, i) => ({
            column: key,
            type: Array.isArray(sample[key]) ? "array" : typeof sample[key],
            nullable: true,
            maxLength: null,
            precision: null,
            default: null,
            position: i + 1,
          }))
        : [];
    }
    return {
      success: true,
      database: this.name,
      executionTimeMs: Date.now() - t0,
      tableCount: Object.keys(schema).length,
      schema,
    };
  }

  async findDocuments(collection, filter = {}, options = {}) {
    const t0 = Date.now();
    const limit = options.limit || 1000;
    const sort = options.sort || {};
    const projection = options.projection || {};

    if (typeof filter === "string") {
      try { filter = JSON.parse(filter); } catch { throw new Error("Invalid filter JSON."); }
    }

    this.log.debug(`find_documents [${this.name}]`, `${collection} filter=${JSON.stringify(filter)}`);
    const data = await this.db
      .collection(collection)
      .find(filter)
      .project(projection)
      .sort(sort)
      .limit(limit)
      .toArray();

    return {
      success: true,
      database: this.name,
      rowCount: data.length,
      executionTimeMs: Date.now() - t0,
      columns: data.length > 0 ? Object.keys(data[0]) : [],
      data,
    };
  }

  async aggregate(collection, pipeline) {
    const t0 = Date.now();

    if (typeof pipeline === "string") {
      try { pipeline = JSON.parse(pipeline); } catch { throw new Error("Invalid pipeline JSON."); }
    }

    // Security: block write stages
    for (const stage of pipeline) {
      const keys = Object.keys(stage);
      if (keys.includes("$out") || keys.includes("$merge")) {
        throw new Error("$out and $merge stages are forbidden (read-only mode).");
      }
    }

    this.log.debug(`aggregate [${this.name}]`, `${collection} stages=${pipeline.length}`);
    const data = await this.db.collection(collection).aggregate(pipeline).toArray();

    return {
      success: true,
      database: this.name,
      rowCount: data.length,
      executionTimeMs: Date.now() - t0,
      columns: data.length > 0 ? Object.keys(data[0]) : [],
      data,
    };
  }
}
