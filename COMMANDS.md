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

- `competition status` — runtime + provider health, library counts, and Tutti CLI reachability. Input: none.
- `competition sessions [--query <text>] [--limit <n>]` — list research sessions, newest first.
- `competition reports [--session <id>] [--query <text>] [--limit <n>]` — list captured artifacts (report/inventory/meta/raw) with ids.
- `competition report --session <id> --artifact <id>` — return one artifact's full content (Markdown or JSON).
- `competition research --product <name> [--session <id>] [--provider <p>] [--model <m>]` — start a detached research run; returns a `sessionId`/`runId` immediately, then poll `sessions`/`reports` for results.

Each command maps to an HTTP handler at `/tutti/cli/<command>` declared in
[`tutti.cli.json`](tutti.cli.json). Handlers return the `CliCommandOutput`
envelope (`{ "kind": "json", "value": … }`).

## HTTP API

- `GET /api/health`: liveness probe (also reports app version, whether the skill is bundled, and whether `TUTTI_CLI` is wired)
- `GET /api/bootstrap`: list sessions, the active session, and detected local agent providers
- `POST /api/sessions`: create a research conversation
- `PATCH /api/sessions/:id`: activate or rename a session
- `DELETE /api/sessions/:id`: delete a session and its artifacts
- `GET /api/sessions/:id/messages`: load a session's messages and artifacts
- `GET /api/sessions/:id/artifacts/:artifactId/content`: read a captured artifact (report.md etc.)
- `GET /api/agent/stream` (WebSocket): run a research turn; `{type:"start", sessionId, prompt, provider, model}` / `{type:"cancel", runId}`
- `POST /tutti/references/list`: list captured research artifacts as Tutti references (sessions as groups)
- `POST /tutti/references/search`: recursive, relevance-ranked search across every session's artifacts
- `POST /tutti/cli/*`: Tutti CLI capability handlers (see the `competition` scope above)

## Package validation

After `pnpm package:tutti`, validate the generated package with the factory skill's validator:

```bash
python3 <tutti-workspace-app-factory>/scripts/validate_tutti_app_package.py build/tutti-app/package
```
