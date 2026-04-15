# Agent Safety Middleware

A local TypeScript proxy that sits between AI coding CLIs (Claude Code, Codex, others soon) and the upstream model APIs (Anthropic, OpenAI). It enforces data-loss prevention, per-session auditing, and transparent streaming so you can run AI tooling inside regulated environments.

---

## Feature highlights

1. **Deep secret scrubbing** – [`src/helpers/scrubbers.ts`](src/helpers/scrubbers.ts) recursively walks every field, redacting API keys, JWTs, PCI data, DB strings, and other high-entropy secrets before anything leaves your laptop.
2. **Per-session structured logging** – shared logs live in `logs/proxy.log`, while every CLI session gets its own JSONL transcript under `logs/sessions/session-<id>.jsonl` (see [`src/helpers/logger.ts`](src/helpers/logger.ts)).
3. **Event-stream passthrough** – both Anthropics's and OpenAI's SDKs stream server-sent events (SSE) directly back to the CLI with zero buffering.
4. **Header passthrough and tracing** – [`src/helpers/headers.ts`](src/helpers/headers.ts) preserves `anthropic-*`, `x-*`, and other tracing headers so feature flags and request IDs stay intact at the upstream provider.
5. **Multi-provider routing layer** – `/claude` endpoints accept Anthropic and OpenAI providers for Claude Code, while `/codex` routes serve Codex CLI traffic with optional Zstandard payload decompression via [`src/helpers/zstdHandler.ts`](src/helpers/zstdHandler.ts).
6. **Safety-focused middleware** – request lifecycles enforce UUID-based `requestId`/`sessionId` correlation, central error handling, and automatic session log teardown.

---

## Architecture overview

```
Claude Code CLI ─┐                     ┌─> Anthropic API
Codex CLI       ─┼─> Express router ───┤
(other CLIs TBA) ┘                     └─> OpenAI API
                     │
                     ├─ Scrubbing + audit logging
                     └─ SSE streaming back to CLI
```

Key modules:

| Layer | Responsibility | Location |
| --- | --- | --- |
| HTTP entrypoint | Boot Express, mount routers, error handling | [`src/main.ts`](src/main.ts) |
| Route multiplexer | `/health`, `/claude/:provider/v1/messages`, `/codex/:provider/responses` | [`src/routes`](src/routes) |
| Provider handlers | SDK calls + SSE piping for Anthropic / OpenAI | [`src/handlers`](src/handlers) |
| Helpers | Header extraction, scrubber, session logger, zstd middleware | [`src/helpers`](src/helpers) |

---

## Request lifecycle

1. **Ingress** – CLI hits `/claude/:provider/v1/messages` (Claude Code) or `/codex/:provider/responses` (Codex). Zstd bodies are decompressed when present.
2. **Session + request IDs** – UUID-backed identifiers are attached via [`extractSessionId`](src/helpers/sessions.ts) for downstream logging.
3. **Scrubbing** – The raw JSON body passes through the scrubber; findings are attached to the log payload, and the sanitized copy continues downstream.
4. **Structured logging** – Requests and responses are logged at both the shared logger and the per-session logger with timings, token counts, and scrub outcomes.
5. **Forwarding** – Provider-specific handler copies allowed headers, injects the real API key from the proxy, invokes the SDK, and pipes SSE chunks back to the CLI.
6. **Cleanup** – When the client disconnects, the session logger is flushed and removed to avoid file descriptor leaks.

---

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env   # (create one if it does not exist)
# Populate the values below

# 3. Start proxy (dev mode with ts-node)
npm run dev

# — or build and run —
npm run build
npm start
```

### Environment variables

Create `.env` with at least:

| Variable | Description |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required when forwarding Claude Code traffic to Anthropic |
| `OPENAI_API_KEY` | Required when forwarding Codex or Claude Code traffic to OpenAI |
| `PROXY_PORT` (default `50080`) | Port that Express listens on |
| `PROXY_LOGS_DIR` (default `./logs`) | Root folder for shared + per-session logs |
| `LOG_LEVEL` (default `info`) | Winston level for the shared logger |

> Keep your real provider keys only inside `.env`. CLIs talk to the proxy with placeholder keys.

---

## Pointing CLIs at the proxy

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:50080   # or your PROXY_PORT
export ANTHROPIC_API_KEY=any-placeholder           # proxy injects the real key
claude
```

Or persist values in `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:50080"
  }
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL=http://localhost:50080
export OPENAI_API_KEY=placeholder
codex
```

Codex payloads may be zstd-compressed; the middleware handles decompression transparently.

---

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/claude/:provider/v1/messages` | Main Claude Code ingress; supports `anthropic` and `openai` today |
| `POST` | `/codex/:provider/responses` | Codex ingress; currently `anthropic` + `openai` with zstd support |
| `POST` | `/v1/debug/echo` | Dev-only echo of headers/body for quick inspection |
| `GET` | `/health` | Liveness probe |

---

## Logging outputs

```
logs/
  proxy.log            # rolling shared log (info+)
  proxy-errors.log     # error-level events
  sessions/
    session-<uuid>.jsonl   # per-session structured events
```

A typical request/response pair:

```json
{"event":"request","requestId":"uuid","sessionId":"uuid","model":"claude-3.5-sonnet","messageCount":4,"secretsFound":[{"pattern":"aws_access_key","count":1}],"bodyWasScrubbed":true}
{"event":"response","requestId":"uuid","sessionId":"uuid","durationMs":2341,"inputTokens":1200,"outputTokens":480,"totalTokens":1680,"stopReason":"end_turn","status":"success"}
```

Use the shared `requestId` to correlate entries.

---

## Secret patterns (partial list)

| Pattern | Examples |
| --- | --- |
| Anthropic / OpenAI API keys | `sk-ant-...`, `sk-...` |
| AWS credentials | `AKIA...` and 40-char secret |
| GitHub tokens | `ghp_...`, `gho_...` |
| GCP private keys | PEM blocks |
| Bearer / Basic headers | `Authorization: Bearer ...` |
| JWTs | `eyJ...` |
| Credit cards / CVV / expiry | Visa, MC, Amex, `cvv=123`, `exp: 12/26` |
| DB connection strings | `postgres://user:pass@host` |
| DB password params | `password=secret` |
| Generic secret assignments | `api_key = "..."`, `token: "..."` |

See [`src/helpers/scrubbers.ts`](src/helpers/scrubbers.ts) for the full registry.

---

## Future work

- Implement provider handlers for `gemini`, `ollama`, and `grok` once their CLI contracts stabilize.
- Expand request metrics (token counts, latency percentiles) and surface them via `/metrics`.
- Ship automated tests around the scrubber and header-forwarding logic.
