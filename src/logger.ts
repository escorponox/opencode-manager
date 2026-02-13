import pino from "pino";

/**
 * Global structured logger using Pino
 *
 * Provides structured logging with:
 * - JSON output in production
 * - Pretty formatting in development
 * - Automatic timestamp and hostname
 * - Multiple log levels (trace, debug, info, warn, error, fatal)
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            singleLine: false,
          },
        },
});

/**
 * Create a child logger with additional context
 * @param bindings - Context to include in all log messages
 * @returns Child logger with bound context
 */
export function createLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
