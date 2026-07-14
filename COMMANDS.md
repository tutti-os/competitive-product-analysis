# Commands

## Workspace

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm typecheck`
- `pnpm check:i18n` — locale parity + `t()` key coverage for the web UI
- `pnpm check` — typecheck + i18n check
- `pnpm package:tutti` — build the self-contained Tutti app package
- `pnpm serve:catalog` — serve a local App Center catalog for desktop install testing

## Tutti CLI (`competition` scope)

Other Tutti apps and agents call this app through the bundled Tutti CLI. Probe
before depending on a command, and prefer `--json` for app-to-app calls:

```bash
"$TUTTI_CLI" competition --help
"$TUTTI_CLI" --json competition status
```

- `competition status` — exact Agent Target health, library counts, and Tutti CLI reachability. Input: none.
- `competition sessions [--query <text>] [--limit <n>] [--offset <n>]` — list research sessions, newest first. The result includes `total`, `limit`, `offset`, and `hasMore` so callers can tell when results are truncated and page with `--offset`.
- `competition reports [--session <id>] [--query <text>] [--limit <n>] [--offset <n>]` — list captured artifacts (report/inventory/meta/raw) with ids. Same `total`/`limit`/`offset`/`hasMore` pagination fields as `sessions`.
- `competition report --session <id> --artifact <id>` — return one artifact's full content (Markdown or JSON).
- `competition research --product <name> [--session <id>] [--agent-id <target-id>] [--model <m>]` — start a detached research run. Discover exact target ids with `tutti agent list --json`. The skill, Agent Target, and model are validated **before** returning, so `ok: true` means the run actually started. The deprecated `--provider` input remains temporarily available only when the complete catalog maps that provider to exactly one Agent Target; ambiguous mappings fail closed. Returns a `sessionId`/`runId` immediately, then poll `sessions`/`reports` for results.

Agent-bearing outputs use `agentTargetId` as identity and `providerId` as runtime
metadata. A deprecated `provider` metadata alias is emitted during the
compatibility window; callers must not use it to select or resume an agent.

Each command maps to an HTTP handler at `/tutti/cli/<command>` declared in
[`tutti.cli.json`](tutti.cli.json). Handlers always return the `CliCommandOutput`
envelope (`{ "kind": "json", "value": … }`) — including request-validation and
business errors, which come back as `{ "kind": "json", "value": { "ok": false, "error": … } }`
so app-to-app `--json` callers get a stable shape.

## HTTP API

- `GET /api/health`: liveness probe (also reports app version, whether the skill is bundled, and whether `TUTTI_CLI` is wired)
- `GET /api/bootstrap`: list sessions, the active session, exact `agentTargets`, and `defaultAgentTargetId`
- `POST /api/sessions`: create a research conversation
- `PATCH /api/sessions/:id`: activate or rename a session
- `DELETE /api/sessions/:id`: delete a session and its artifacts
- `GET /api/sessions/:id/messages`: load a session's messages and artifacts
- `GET /api/sessions/:id/artifacts/:artifactId/content`: read a captured artifact (report.md etc.)
- `GET /api/agent/stream` (WebSocket): run a research turn; `{type:"start", sessionId, prompt, agentTargetId, model}` / `{type:"cancel", runId}`. Deprecated `provider` is accepted only for a unique catalog mapping.
- `POST /tutti/references/list`: list captured research artifacts as Tutti references (sessions as groups)
- `POST /tutti/references/search`: recursive search across every session's artifacts — matches the query against each file's own name (relevance-ranked), supports `filters` by global file-type category (`image`/`video`/`document`/`webpage`/`other`), and allows filter-only search (empty `query` + non-empty `filters`, ordered by recency) with `cursor`/`nextCursor` pagination
- `POST /tutti/cli/*`: Tutti CLI capability handlers (see the `competition` scope above)

## Package validation

After `pnpm package:tutti`, validate the generated package with the factory skill's validator:

```bash
python3 <tutti-workspace-app-factory>/scripts/validate_tutti_app_package.py build/tutti-app/package
```
