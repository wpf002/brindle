import type { FastifyInstance } from "fastify";

// Error tracking + basic metrics. Same adapter pattern as the other externals:
// a real reporter when SENTRY_DSN is set, structured logging otherwise, so
// nothing silently swallows errors in environments without a tracker.
export interface ErrorReporter {
  capture(error: unknown, context?: Record<string, unknown>): void;
}

class LogReporter implements ErrorReporter {
  constructor(private readonly app: FastifyInstance) {}
  capture(error: unknown, context?: Record<string, unknown>): void {
    this.app.log.error({ err: error, ...context }, "captured error");
  }
}

// Sentry's store endpoint accepts a plain JSON envelope, so a real integration
// doesn't require pulling in their SDK for this volume. Swap for @sentry/node
// if you want breadcrumbs, tracing, and release tracking.
class SentryReporter implements ErrorReporter {
  constructor(private readonly dsn: string, private readonly fallback: ErrorReporter) {}
  capture(error: unknown, context?: Record<string, unknown>): void {
    this.fallback.capture(error, context); // always log locally too
    try {
      const match = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(this.dsn);
      if (!match) return;
      const [, key, host, projectId] = match;
      const err = error instanceof Error ? error : new Error(String(error));
      void fetch(`https://${host}/api/${projectId}/store/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}`,
        },
        body: JSON.stringify({
          message: err.message,
          level: "error",
          platform: "node",
          environment: process.env.NODE_ENV ?? "development",
          exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: [] } }] },
          extra: { stack: err.stack, ...context },
        }),
      }).catch(() => {});
    } catch {
      // Reporting must never throw into the request path.
    }
  }
}

let reporter: ErrorReporter | null = null;

export function initObservability(app: FastifyInstance): ErrorReporter {
  const base = new LogReporter(app);
  const dsn = process.env.SENTRY_DSN;
  reporter = dsn ? new SentryReporter(dsn, base) : base;

  // Every unhandled route error flows through here, so nothing 500s silently.
  app.setErrorHandler((error, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      reporter!.capture(error, { url: req.url, method: req.method, userId: req.session?.userId });
    }
    reply.code(status).send({
      // Never leak an internal message or stack to a client on a 5xx.
      error: status >= 500 ? "INTERNAL_ERROR" : (error.code ?? error.message),
    });
  });

  // Crashes that escape the request lifecycle entirely.
  process.on("unhandledRejection", (reason) => reporter!.capture(reason, { kind: "unhandledRejection" }));
  process.on("uncaughtException", (err) => reporter!.capture(err, { kind: "uncaughtException" }));

  return reporter;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  reporter?.capture(error, context);
}
