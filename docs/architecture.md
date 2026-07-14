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

## Run lifecycle & resilience

- **Streaming + incremental persistence**: the in-progress assistant message is
  flushed to disk on a throttle so reloads mid-run show the partial turn.
- **Cancellation**: a run stops on explicit cancel, on session delete, or when the
  WebSocket closes (refresh/navigate). Cancelled runs finalize as `cancelled`
  with partial output preserved.
- **Artifact-based resume**: interrupted research reuses its preserved run
  directory and starts a fresh target invocation at the mechanically determined
  stage. Provider conversation tokens are intentionally not resumed across the
  Stage 1/Stage 2 isolation boundary.
- **Target identity**: `agentTargetId` is the selection, API, session, and resume
  identity. `providerId` is derived runtime metadata only. Deprecated provider
  inputs are accepted only when the full catalog proves a unique mapping.
- **Target-scoped context**: composer settings and dynamic skills are loaded for
  the selected Agent Target before each run, then merged with the bundled
  product-swipefile skill.
- **No nested provider launch**: the host invokes the selected exact Agent Target
  once for collection and again in a fresh context for writing. The app excludes the vendored provider-specific
  root `run.py` launcher from materialization while retaining provider-agnostic
  files under `scripts/` and `references/`, including the deterministic
  `scripts/research_helper.py` helpers. Collection and writing are isolated by
  a mechanically required frozen artifact checkpoint. Stage 2 starts only when
  `checkpoint_stage1.md` exists, receives no Stage 1 history or resume token, and
  may read only the recorded evidence/inventory/checkpoint rather than unrecorded
  collection reasoning.
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
