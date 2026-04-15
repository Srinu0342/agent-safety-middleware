import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { extractForwardHeaders, extractSessionId, getSessionLogger, logger, scrub } from "../helpers";
import { CLI, PROVIDERS } from "../types";
import { anthropicCallHandler } from "../handlers";
import { openaiCallHandler } from "../handlers/openai";

const router = express.Router();

router.post("/:provider/responses", async (req: Request, res: Response) => {
  const requestId = uuidv4();
  const sessionId = extractSessionId(req);
  const sessionLog = getSessionLogger(sessionId);

  // -- 1. Get the Provider --------------------------------------------------

  const provider = req.params.provider;

  // ── 2. Scrub the request body ────────────────────────────────────────────

  const rawBody = req.body as Record<string, unknown>;
  const { data: cleanedBody, findings, wasModified } = scrub(rawBody);

  if (wasModified) {
    logger.warn("Secrets scrubbed from request", {
      requestId,
      sessionId,
      findings,
    });
  }

  const body = cleanedBody as Record<string, unknown>;

  // ── 3. Log the request ───────────────────────────────────────────────────

  const requestLogEntry = {
    event: "request",
    requestId,
    sessionId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    model: body.model,
    stream: body.stream,
    maxTokens: body.max_tokens,
    messageCount: Array.isArray(body.messages) ? body.messages.length : null,
    systemProvided: Boolean(body.system),
    secretsFound: findings,
    bodyWasScrubbed: wasModified,
    // body: req.body,
    // headers: req.headers,
  };

  logger.info("Incoming request", requestLogEntry);
  sessionLog.info("request", requestLogEntry);

  // ── 4. Forward headers ───────────────────────────────────────────────────

  const forwardHeaders = extractForwardHeaders(req);

  switch (provider) {
    case PROVIDERS.ANTHROPIC:
      anthropicCallHandler(forwardHeaders, body, req, res, requestId, sessionId, sessionLog, CLI.CLAUDE_CODE);
      break;
    case PROVIDERS.OPENAI:
      openaiCallHandler(forwardHeaders, body, req, res, requestId, sessionId, sessionLog, CLI.CODEX);
      break;
    case PROVIDERS.GEMINI:
      console.log("Gemini provider selected. Forwarding not yet implemented.");
      res.status(501).json({ error: "Gemini provider not implemented yet" });
      break;
    case PROVIDERS.OLLAMA:
      console.log("Ollama provider selected. Forwarding not yet implemented.");
      res.status(501).json({ error: "Ollama provider not implemented yet" });
      break;
    case PROVIDERS.GROK:
      console.log("Grok provider selected. Forwarding not yet implemented.");
      res.status(501).json({ error: "Grok provider not implemented yet" });
      break;
    default:
      logger.warn("Unknown provider requested", { requestId, sessionId, provider });
      res.status(400).json({ error: "Unknown provider" });
      break;
  }
});

export default router;
