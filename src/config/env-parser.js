/**
 * Parses DB_{N}_* environment variables into database configuration objects.
 * Supports dynamic registration of multiple databases with custom names.
 * Backward compatible with legacy single-database format (DB_SERVER, DB_NAME, etc.).
 */
export function parseEnvDatabases(env) {
  const databases = [];
  const parseList = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  // Scan for DB_{N}_NAME entries
  const pattern = /^DB_(\d+)_NAME$/;
  const indices = new Set();

  for (const key of Object.keys(env)) {
    const match = key.match(pattern);
    if (match) indices.add(match[1]);
  }

  for (const idx of indices) {
    const p = `DB_${idx}_`;
    const name = env[`${p}NAME`];
    const type = (env[`${p}TYPE`] || "sqlserver").toLowerCase();

    if (!name) continue;

    databases.push({
      name,
      type,
      server:       env[`${p}SERVER`] || "localhost",
      port:         parseInt(env[`${p}PORT`] || "0") || undefined,
      database:     env[`${p}DATABASE`] || env[`${p}DB`],
      user:         env[`${p}USER`],
      password:     env[`${p}PASSWORD`],
      // SQL Server specific
      encrypt:      env[`${p}ENCRYPT`] !== "false",
      trustCert:    env[`${p}TRUST_CERT`] !== "false",
      // PostgreSQL specific
      ssl:          env[`${p}SSL`] === "true",
      // MongoDB specific
      authSource:   env[`${p}AUTH_SOURCE`],
      connectionString: env[`${p}CONNECTION_STRING`],
      // Supabase specific
      supabaseUrl:  env[`${p}SUPABASE_URL`],
      supabaseKey:  env[`${p}SUPABASE_KEY`],
      // Write access
      allowWrite:   env[`${p}ALLOW_WRITE`] === "true",
      blockedIdentifiers: [
        ...parseList(env.BLOCKED_IDENTIFIERS),
        ...parseList(env[`${p}BLOCKED_IDENTIFIERS`]),
      ],
      // Global overrides per-database
      queryTimeout: parseInt(env[`${p}QUERY_TIMEOUT`] || env.QUERY_TIMEOUT || "30000"),
      maxRows:      parseInt(env[`${p}MAX_ROWS`] || env.MAX_ROWS || "1000"),
    });
  }

  // Backward compatibility: legacy single-database format
  if (databases.length === 0 && env.DB_SERVER) {
    databases.push({
      name:         env.DB_CUSTOM_NAME || "default",
      type:         "sqlserver",
      server:       env.DB_SERVER,
      port:         parseInt(env.DB_PORT || "1433"),
      database:     env.DB_NAME || "master",
      user:         env.DB_USER || "sa",
      password:     env.DB_PASSWORD || "",
      encrypt:      true,
      trustCert:    true,
      blockedIdentifiers: parseList(env.BLOCKED_IDENTIFIERS),
      queryTimeout: parseInt(env.QUERY_TIMEOUT || "30000"),
      maxRows:      parseInt(env.MAX_ROWS || "1000"),
    });
  }

  if (databases.length === 0) {
    throw new Error(
      "No database configuration found. " +
      "Set DB_1_NAME, DB_1_TYPE, DB_1_SERVER, etc. in your .env file. " +
      "See .env.example for reference."
    );
  }

  // Validate unique names
  const names = databases.map((d) => d.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate database names found: ${[...new Set(duplicates)].join(", ")}`);
  }

  return databases;
}
