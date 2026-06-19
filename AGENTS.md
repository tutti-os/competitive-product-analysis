# Competitive Analysis Agent Guide

## Repo layout

- `apps/web`: chat-first browser UI (session sidebar, chat thread, agent selector, artifact rail, research library)
- `apps/server`: local runtime, session/artifact persistence, agent runtime, Tutti integration endpoints
- `apps/server/skills/product-swipefile`: the vendored research skill that drives every run
- `apps/server/src/runtimes`: local-agent provider, skill loader, prompt envelope, and `tutti-cli.ts` (TUTTI_CLI consumer)
- `apps/server/src/domains/cli-service.ts`: use-case helpers behind the `/tutti/cli/*` capability surface
- `apps/server/src/app-meta.ts`: single source of truth for app id/name/version
- `packages/shared`: shared types and schemas consumed by both sides (DTOs, CLI request shapes, route constants)
- `tutti.app.json` / `tutti.cli.json`: Tutti app manifest and CLI capability manifest
- `scripts/package-tutti-app.mjs`: creates the self-contained Tutti package
- `scripts/check-i18n.mjs`: locale parity + `t()` coverage check (`pnpm check:i18n`)

## Product shape

The app is a conversation. The user asks to research a product ("调研一下 Notion"),
and a local agent (Claude by default, Codex also supported) runs the bundled
product-swipefile skill to produce an evidence-backed teardown. Artifacts
(`report.md`, `inventory.md`, `meta.json`, `raw/`) are captured into a unified
per-session store and surfaced as Tutti references.

## Agent flow

- `ResearchRunService` (`apps/server/src/domains/research-run-service.ts`) orchestrates one chat turn: persist the user message, run the agent, stream events, capture artifacts, persist the assistant message.
- Real work runs through `LocalAgentResearchProvider`, which calls `@tutti-os/agent-acp-kit`'s `createLocalAgentRuntime().run()`. The product-swipefile skill is injected via `skillManifest`; the kit materializes it into the run cwd before launch.
- The run cwd is `dataDir/sessions/<sessionId>/runs/<runId>`. After the run, `scanRunArtifacts` indexes the Markdown/JSON artifacts the skill wrote there.
- Streaming events use the `AgentRunEvent` contract in `packages/shared` and flow over `/api/agent/stream`. The web client folds them into the assistant message's `contentBlocks`.
- There is no offline rule-engine fallback: a local Claude/Codex agent is required.

## Runtime notes

- Development server API defaults to `http://127.0.0.1:4310`
- Generated app packages must bind `TUTTI_APP_HOST:TUTTI_APP_PORT`
- Durable app data (sessions, messages, artifacts) belongs under `TUTTI_APP_DATA_DIR`
- The agent uses `TUTTI_APP_PYTHON` (falling back to `python3`) to run the skill helpers
- Captured artifacts are exposed through `/tutti/references/list` and searchable via `/tutti/references/search`

## Tutti ecosystem integration

This app both exposes and consumes Tutti capabilities.

- **Exposes** the `competition` CLI scope (`tutti.cli.json` → `/tutti/cli/*`): `status`, `sessions`, `reports`, `report`, `research`. See `COMMANDS.md`. To add a command: declare it in `tutti.cli.json` with an object `inputSchema` and an HTTP `POST` handler at `/tutti/cli/<path>`; add a matching zod request schema + route constant in `packages/shared`; implement a helper in `domains/cli-service.ts` that reuses the store/services (do not duplicate `/api/*` logic); register the route in `main.ts`. Command paths must be lowercase and must not repeat the scope.
- **Consumes** other installed apps and the daemon via `TUTTI_CLI` (`runtimes/tutti-cli.ts`). Always read the command path from `process.env.TUTTI_CLI`, call with `--json`, keep timeouts short, and degrade gracefully when it is missing or fails (the app never depends on it at startup). The `status` command and `/api/health` report whether the bridge is reachable.

## I18n

- Web copy lives in `apps/web/public/locales/<locale>.json` (flat dotted keys) and is read through `t("key")` / `translate("key", params)` from `apps/web/src/app/i18n`.
- To add or rename a key: edit **every** locale file (`en.json` and `zh-CN.json`) so the key sets stay identical, then update the `t(...)` call sites. Run `pnpm check:i18n` — it fails on locale-key drift or a `t("key")` missing from any locale, and warns on unused keys.
- Locale resolution reads the Tutti host context first, then browser locale APIs (`apps/web/src/app/i18n/locale.ts`); never read locale from launch URL query params.
- App package manifest metadata is localized separately via `tutti.app.json` `localizationInfo` + `locales/<locale>/manifest.json`.
- Theme follows `prefers-color-scheme` (`apps/web/src/app/styles.css` `color-scheme` + dark media query); never themed via URL params.

## Modification rules

- Keep domain contracts in `packages/shared`
- Keep UI orchestration in `apps/web`, not in server-only modules
- Keep the vendored skill intact; update it by re-vendoring from upstream rather than hand-editing
- Preserve Tutti manifest and `bootstrap.sh` compatibility when changing runtime behavior
- Keep `tutti.cli.json` command `inputSchema`s in sync with the zod CLI schemas in `packages/shared`
- Bump the version in lockstep across `package.json`, `tutti.app.json`, `app-meta.ts`, and the `scripts/*.mjs` `version` constants
