// Winston-based logger.
// - A shared "proxy.log" captures everything at info+ level.
// - Each Claude Code session gets its own timestamped JSONL file under ./logs/sessions/
import winston from "winston";
import path from "node:path";
import fs from "node:fs";

const LOGS_DIR = process.env.PROXY_LOGS_DIR ?? path.join(process.cwd(), "logs");
const SESSION_LOGS_DIR = path.join(LOGS_DIR, "sessions");

// Ensure directories exist
fs.mkdirSync(SESSION_LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Shared proxy logger (console + rolling file)
// ---------------------------------------------------------------------------

const { combine, timestamp, printf, colorize, errors } = winston.format;

const prettyConsole = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `${timestamp} [${level}] ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(errors({ stack: true }), timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), prettyConsole),
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, "proxy.log"),
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, "proxy-errors.log"),
      level: "error",
    }),
  ],
});

// ---------------------------------------------------------------------------
// Per-session logger
// ---------------------------------------------------------------------------

// Sessions are identified by a session ID that Claude Code sends (or we generate one).
const sessionLoggers = new Map<string, winston.Logger>();

export function getSessionLogger(sessionId: string): winston.Logger {
  const existing = sessionLoggers.get(sessionId);
  if (existing) return existing;

  const sessionFile = path.join(SESSION_LOGS_DIR, `session-${sessionId}.jsonl`);

  const sessionLogger = winston.createLogger({
    level: "debug",
    format: combine(timestamp(), winston.format.json()),
    transports: [
      new winston.transports.File({
        filename: sessionFile,
        options: { flags: "a" }, // append — same session can reconnect
      }),
    ],
  });

  sessionLoggers.set(sessionId, sessionLogger);
  logger.info(`Session logger created`, { sessionId, file: sessionFile });
  return sessionLogger;
}

/**
 * Flush and remove a session logger once the session is done.
 * Call this when the SSE stream closes.
 */
export function closeSessionLogger(sessionId: string): void {
  const sl = sessionLoggers.get(sessionId);
  if (sl) {
    sl.end();
    sessionLoggers.delete(sessionId);
  }
}