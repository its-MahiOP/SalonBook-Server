const QUIET_PATHS = new Set(["/api/health"]);

/**
 * Compact one-line request log so API traffic is visible while developing
 * and in production logs. Skips health checks to keep noise down.
 */
export function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    if (QUIET_PATHS.has(req.path)) return;

    const duration = Date.now() - startedAt;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "log";
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
    console[level](`[api] ${line}`);
  });

  next();
}
