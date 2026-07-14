# Architecture

## Why this shape

This repo is a chat-first Tutti workspace app that follows the `group-chat`-style
layout described by the provided `SKILL.md`. A single chat turn drives a locally
available Agent Target from the Tutti catalog to run the `product-swipefile` research
skill and stream the result back into the conversation.

- `apps/web` — browser-first chat workspace (React + Vite)
- `apps/server` — Fastify runtime: persistence, run orchestration, artifact
  capture, and local-agent integration
- `packages/shared` — domain types and HTTP/WS contracts shared by web + server

## Request flow

1. The web app opens a WebSocket to `/api/agent/stream` and sends a `start`
   message (`sessionId`, `prompt`, exact `agentTargetId`, optional `model`).
2. `ResearchRunService` persists the user message, then drives the agent through
   `LocalAgentResearchProvider` (which wraps `@tutti-os/agent-acp-kit`).
3. Runtime events (`text_delta` / `thinking_delta` / `tool_call` / `tool_result`
   / `status` / `file_write`) stream back over the socket and are folded into the
   assistant message both client- and server-side so a live thread and a reloaded
   thread render identically.
4. On normal completion the run cwd is scanned for artifacts, which are indexed
   and surfaced in the artifact panel.

REST endpoints (`API_ROUTES` in `packages/shared`): `/api/health`,
`/api/bootstrap`, `/api/sessions` (+ `:id`, `/messages`, `/artifacts`,
`/artifacts/:id/content`), and `/tutti/references/list`. Default bind is
`127.0.0.1:4310`.

## Storage

File-based, local-first. No database. Managed by `SessionStore`.

- Data root (`dataDir`):
  - Dev default: `generated/data`
  - Packaged runtime: `TUTTI_APP_DATA_DIR`
- Layout:
  - `sessions/index.json` — session index (titles, status, counts, active id)
    plus the exact `agentTargetId` used by the latest resolved run and its
    runtime-only `providerId` metadata
  - `sessions/<sessionId>/messages.json` — full chat history (persisted
    incrementally during a run, so a refresh/crash never loses streamed output)
  - `sessions/<sessionId>/artifacts.json` — indexed artifacts for the session
  - `sessions/<sessionId>/runs/<runId>/` — per-run working dir the agent writes
    into (`report.md`, `inventory.md`, `meta.json`, `checkpoint_stage*.md`, plus a
    `raw/` evidence cache that is not surfaced as an artifact)
  - `agent-sessions/<sessionId>.json` — local-agent resume tokens keyed by session

## Run lifecycle & resilience

- **Streaming + incremental persistence**: the in-progress assistant message is
  flushed to disk on a throttle so reloads mid-run show the partial turn.
- **Cancellation**: a run stops on explicit cancel, on session delete, or when the
  WebSocket closes (refresh/navigate). Cancelled runs finalize as `cancelled`
  with partial output preserved.
- **Resume with fresh-retry fallback**: runs resume the prior agent session when a
  token exists for the same exact Agent Target and runtime provider; if the
  underlying CLI reports the session is gone (e.g. it was
  purged after a cancel), the orchestrator drops the stale token and transparently
  retries once with a fresh session.
- **Target identity**: `agentTargetId` is the selection, API, session, and resume
  identity. `providerId` is derived runtime metadata only. Deprecated provider
  inputs are accepted only when the full catalog proves a unique mapping.
- **Target-scoped context**: composer settings and dynamic skills are loaded for
  the selected Agent Target before each run, then merged with the bundled
  product-swipefile skill.
- **No nested provider launch**: the selected exact Agent Target executes every
  product-swipefile stage directly. The app excludes the vendored provider-specific
  root `run.py` launcher from materialization and exposes only the
  provider-agnostic `scripts/research_helper.py` deterministic helpers.
- **Artifact capture is success-only**: artifacts are scanned/indexed only when a
  run completes normally. Files written by a cancelled/failed run remain on disk
  under `runs/<runId>/` but are not added to the artifact panel.
- **Startup self-healing**: `reconcileOnStartup` recovers on-disk sessions missing
  from the index and demotes any run still marked `running` (a crash/restart
  remnant) to `failed`.

## Next steps

- Optionally keep a run alive across WebSocket disconnects (background + reattach)
  instead of cancelling on socket close
- Best-effort artifact capture on cancel/failure so partial outputs are still
  surfaced
- Richer artifact history exploration and grouped/evidence-snippet references
