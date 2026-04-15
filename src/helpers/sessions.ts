import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
/**
 * Derive a session ID from the incoming request.
 * Claude Code sends a stable identifier in several possible places.
 * Fall back to generating one per-connection.
 */
export function extractSessionId(req: Request): string {
  // Claude Code may send its own trace/session identifiers
  return (
    (req.headers["x-session-id"] as string) ??
    (req.headers["x-request-id"] as string) ??
    // anthropic-beta sometimes includes a session prefix we can use
    // as a fallback we just generate a short stable-ish id
    uuidv4()
  );
}
