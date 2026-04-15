import { Request } from 'express';
/**
 * Pull all anthropic-* and x-* headers from the incoming request so we can
 * forward them to the upstream. This preserves things like:
 *   anthropic-version
 *   anthropic-beta  (critical — controls feature flags)
 *   x-api-key       (we replace with the real key, but keep header name)
 */
export function extractForwardHeaders(req: Request): Record<string, string> {
  const forward: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    const lower = key.toLowerCase();
    if (
      lower === "anthropic-version" ||
      lower === "anthropic-beta" ||
      lower.startsWith("x-")
    ) {
      forward[lower] = value;
    }
  }
  return forward;
}
