export const DEFAULTS = {
  queryTimeout: parseInt(process.env.QUERY_TIMEOUT || "30000"),
  maxRows:      parseInt(process.env.MAX_ROWS || "1000"),
};
