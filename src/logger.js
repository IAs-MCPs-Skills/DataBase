// Logging utility — all output goes to stderr (MCP protocol requirement)
export const log = {
  info:  (msg)       => console.error(`[${new Date().toISOString()}] INFO:  ${msg}`),
  warn:  (msg)       => console.error(`[${new Date().toISOString()}] WARN:  ${msg}`),
  error: (msg, err)  => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, err?.message ?? ""),
  debug: (msg, data) => {
    if (process.env.DEBUG === "true")
      console.error(`[${new Date().toISOString()}] DEBUG: ${msg}`, data ?? "");
  },
};
