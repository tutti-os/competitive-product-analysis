# Competitive Analysis

Competitive Analysis is a local-first Tutti workspace app for product
research. It is **chat-first**: you ask a local agent to research a product, and
it runs an evidence-backed teardown that stays attached to the workspace.

## What is included

- A monorepo aligned with the `group-chat`-style Tutti app architecture:
  - `apps/web`: React + Vite chat UI
  - `apps/server`: Fastify local runtime
  - `packages/shared`: shared domain contracts
- The vendored [`product-swipefile`](https://github.com/nothingbutcici/product-swipefile)
  research skill under `apps/server/skills/`, injected into every agent run.
- Tutti packaging metadata: `tutti.app.json`, `tutti.cli.json`, `bootstrap.sh`, `scripts/package-tutti-app.mjs`
- Local-first persistence and Tutti references:
  - sessions, messages, and artifacts stored under `TUTTI_APP_DATA_DIR/sessions`
  - captured research artifacts exposed through `/tutti/references/list` and searchable via `/tutti/references/search`
- Ecosystem integration so other Tutti apps and agents can drive it:
  - a `competition` CLI scope (`status`, `sessions`, `reports`, `report`, `research`) declared in `tutti.cli.json` — see [`COMMANDS.md`](COMMANDS.md)
  - graceful `TUTTI_CLI` consumption for calling sibling apps / the daemon
- Internationalization (English + 简体中文) with light/dark theming via `prefers-color-scheme`

## Tutti ecosystem

Other apps and agents call this app through the bundled Tutti CLI:

```bash
"$TUTTI_CLI" --json competition status
"$TUTTI_CLI" --json competition reports --query notion
"$TUTTI_CLI" --json competition research --product "Linear"
```

See [`COMMANDS.md`](COMMANDS.md) for the full command and HTTP surface.

## How it works

1. Pick a local agent (Claude by default — the skill is tuned for Claude — or Codex).
2. Type a research request, e.g. **`调研一下 Notion`** or **`research Cursor`**.
3. The agent runs the product-swipefile staged pipeline (evidence collection →
   inventory → gap checks → writing → validation) inside a per-run working
   directory, streaming its progress into the chat thread.
4. When it finishes, the produced `report.md` (plus `inventory.md`, `meta.json`,
   and the `raw/` evidence cache) is captured into the session's artifact list
   and the unified research library, and surfaced back into Tutti as references.

```text
ResearchRunService (orchestrator)
  -> LocalAgentResearchProvider  (@tutti-os/agent-acp-kit -> Claude/Codex CLI)
      -> skillManifest materializes product-swipefile into the run cwd
      -> scanRunArtifacts captures report.md / inventory.md / meta.json
```

A local agent (Claude or Codex, installed and signed in) is required; there is
no offline fallback.

## Development

```bash
pnpm install
pnpm dev
```

The web app runs on Vite and proxies API calls to the local Fastify server.

## Packaging

```bash
pnpm package:tutti
```

This writes a self-contained app package under `build/tutti-app/package`,
including the bundled server, web assets, and the vendored skill.
