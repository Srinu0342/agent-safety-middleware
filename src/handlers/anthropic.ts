import Anthropic from "@anthropic-ai/sdk";
import { Request, Response } from "express";
import { Logger } from "winston";

import { closeSessionLogger, logger } from "../helpers";
import { CLI } from "../types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  logger.error(
    "ANTHROPIC_API_KEY is not set. The proxy cannot forward requests.",
  );
  process.exit(1);
}
logger.info("Forwarding to https://api.anthropic.com");
logger.info("To use:", {
  step1: "export ANTHROPIC_BASE_URL=http://localhost:${PORT}",
  step2: "export ANTHROPIC_API_KEY=<your-real-key>",
  step3: "claude",
});

// The Anthropic client used to forward requests. baseURL intentionally omitted
// so it always hits api.anthropic.com regardless of the env var Claude Code set.
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
  // Explicitly target production so our own ANTHROPIC_BASE_URL env var (if set
  // to point at this proxy) doesn't create an infinite loop.
  baseURL: "https://api.anthropic.com",
  defaultHeaders: {
    // We will override per-request below, but set a sane default
    "anthropic-version": "2023-06-01",
  },
});

export const anthropicCallHandler = async (
  forwardHeaders: Record<string, string>,
  body: Record<string, unknown>,
  req: Request,
  res: Response,
  requestId: string,
  sessionId: string,
  sessionLog: Logger,
  cli: CLI
) => {
  const startTime = Date.now();
  // Anthropic version — use what Claude Code sent, fall back to stable default
  const anthropicVersion = forwardHeaders["anthropic-version"] ?? "2023-06-01";
  // Beta features — forward exactly what Claude Code requested
  const anthropicBeta = forwardHeaders["anthropic-beta"];

  // Build the extra headers object for the SDK call
  const extraHeaders: Record<string, string> = {
    "anthropic-version": anthropicVersion,
  };
  if (anthropicBeta) {
    extraHeaders["anthropic-beta"] = anthropicBeta;
  }
  // Forward any other x-* headers (Claude Code tracing etc.)
  for (const [k, v] of Object.entries(forwardHeaders)) {
    if (k !== "anthropic-version" && k !== "anthropic-beta") {
      extraHeaders[k] = v;
    }
  }

  // ── Build the messages API params ────────────────────────────────────
  //
  // We pass the body through as-is (post-scrub) rather than re-constructing
  // it field by field. This means any new fields Claude Code adds in future
  // versions will be forwarded automatically.

  const messagesParams = body as unknown as Anthropic.Messages.MessageCreateParamsStreaming;

  // Force stream — Claude Code always expects SSE
  messagesParams.stream = true;

  // ── Open SSE channel to the client (Claude Code) ─────────────────────

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if present
  res.flushHeaders();

  // Helper to write a raw SSE event exactly as Anthropic sends it
  function writeSSEEvent(eventType: string, data: unknown): void {
    const json = JSON.stringify(data);
    res.write(`event: ${eventType}\ndata: ${json}\n\n`);
  }

  // ── Stream from Anthropic SDK and pipe back ───────────────────────────

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;

  try {
    const stream = anthropic.messages.stream(messagesParams, {
      headers: extraHeaders,
    });

    // Forward every raw SSE event back to Claude Code as it arrives
    stream.on(
      "streamEvent",
      (event: Anthropic.Messages.MessageStreamEvent) => {
        writeSSEEvent(event.type, event);

        // Capture usage when it arrives
        if (event.type === "message_start" && event.message.usage) {
          inputTokens = event.message.usage.input_tokens;
        }
        if (event.type === "message_delta") {
          if (event.usage) outputTokens = event.usage.output_tokens;
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        }
      },
    );

    // Wait for the stream to complete
    await stream.finalMessage();

    // Signal end of stream (Anthropic SDKs close cleanly; Claude Code reads EOF)
    res.end();

    const durationMs = Date.now() - startTime;

    const responseLogEntry = {
      event: "response",
      requestId,
      sessionId,
      timestamp: new Date().toISOString(),
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      stopReason,
      status: "success",
    };

    logger.info("Request completed", responseLogEntry);
    sessionLog.info("response", responseLogEntry);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err as Error & { status?: number; error?: unknown };

    logger.error("Upstream error", {
      requestId,
      sessionId,
      durationMs,
      message: error.message,
      status: error.status,
    });

    sessionLog.error("error", {
      event: "error",
      requestId,
      sessionId,
      timestamp: new Date().toISOString(),
      durationMs,
      error: error.message,
      upstreamStatus: error.status,
    });

    // If headers have already been sent (SSE started), send an error event
    // and close. Otherwise send a normal JSON error response.
    if (res.headersSent) {
      writeSSEEvent("error", {
        type: "error",
        error: { type: "proxy_error", message: error.message },
      });
      res.end();
    } else {
      res.status(error.status ?? 502).json({
        type: "error",
        error: {
          type: "proxy_error",
          message: error.message,
        },
      });
    }
  } finally {
    // Clean up session logger once the connection closes
    req.on("close", () => closeSessionLogger(sessionId));
  }
};
