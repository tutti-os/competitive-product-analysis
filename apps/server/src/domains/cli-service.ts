import type {
  AgentTargetSummary,
  CliCommandOutput,
  CliReportRequest,
  CliReportsRequest,
  CliResearchRequest,
  CliSessionsRequest,
  ResearchSession,
} from "@product-competition/shared";

import type { AppRuntimeConfig } from "../config.js";
import type { SessionStore } from "../local/session-store.js";
import { APP_ID, APP_NAME, APP_VERSION } from "../app-meta.js";
import {
  agentSelectionErrorMessage,
  detectAgentCatalog,
  resolveAgentSelection,
} from "./agent-service.js";
import type { ResearchRunService } from "./research-run-service.js";
import { probeTuttiCli } from "../runtimes/tutti-cli.js";

/**
 * Use-case helpers behind the Tutti CLI capability surface (`/tutti/cli/*`).
 * These are the composition entrypoint other Tutti apps and agents call to
 * read this app's research library and start runs. They reuse the same store
 * and domain services as the `/api/*` routes rather than duplicating logic.
 */

const json = (value: unknown): CliCommandOutput => ({ kind: "json", value });

/**
 * Error envelope for the CLI surface. Business errors here and request
 * validation failures in `main.ts` both return this shape, so every
 * `/tutti/cli/*` response — success or failure — is a stable `CliCommandOutput`
 * (`{ kind: "json", value: { ok: false, error, ... } }`) for app-to-app `--json`
 * callers rather than a bare error body.
 */
export const cliError = (error: string, extra?: Record<string, unknown>): CliCommandOutput =>
  json({ ok: false, error, ...(extra ?? {}) });

/** Runtime + agent + ecosystem health, suitable for an app/agent precheck. */
export async function cliStatus(
  config: AppRuntimeConfig,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const [sessions, agentCatalog, tuttiCli] = await Promise.all([
    store.listSessions(),
    detectAgentCatalog(),
    probeTuttiCli(),
  ]);
  const artifactCount = sessions.reduce((total, session) => total + session.artifactCount, 0);
  return json({
    ok: true,
    app: { id: APP_ID, name: APP_NAME, version: APP_VERSION },
    skillAvailable: Boolean(config.paths.skillDir),
    agents: agentCatalog.agents,
    defaultAgentTargetId: agentCatalog.defaultAgentTargetId,
    sessionCount: sessions.length,
    artifactCount,
    tuttiCli: {
      configured: tuttiCli.configured,
      reachable: tuttiCli.reachable,
      ...(tuttiCli.error ? { error: tuttiCli.error } : {}),
    },
  });
}

/** List research sessions (optionally filtered by title/product). */
export async function cliListSessions(
  request: CliSessionsRequest,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const query = request.query?.trim().toLowerCase();
  let sessions = await store.listSessions();
  if (query) {
    sessions = sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(query) ||
        (session.productName?.toLowerCase().includes(query) ?? false),
    );
  }
  const limit = request.limit ?? 50;
  const offset = request.offset ?? 0;
  const total = sessions.length;
  const limited = sessions.slice(offset, offset + limit);
  return json({
    ok: true,
    count: limited.length,
    total,
    limit,
    offset,
    hasMore: offset + limited.length < total,
    sessions: limited.map((session) => ({
      id: session.id,
      title: session.title,
      productName: session.productName ?? null,
      status: session.status,
      messageCount: session.messageCount,
      artifactCount: session.artifactCount,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastRunId: session.lastRunId ?? null,
      agentTargetId: session.agentTargetId ?? null,
      providerId: session.providerId ?? session.provider ?? null,
      provider: session.providerId ?? session.provider ?? null,
    })),
  });
}

/** List captured report/inventory/meta artifacts across (or within) sessions. */
export async function cliListReports(
  request: CliReportsRequest,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const query = request.query?.trim().toLowerCase();
  const limit = request.limit ?? 50;
  const offset = request.offset ?? 0;

  let sessions: ResearchSession[];
  if (request.session) {
    const session = await store.getSession(request.session);
    if (!session) {
      return cliError("session_not_found", { session: request.session });
    }
    sessions = [session];
  } else {
    sessions = await store.listSessions();
  }

  const reports: Array<Record<string, unknown>> = [];
  for (const session of sessions) {
    const artifacts = await store.getArtifacts(session.id);
    for (const artifact of artifacts) {
      if (query) {
        const haystack =
          `${artifact.title} ${artifact.summary ?? ""} ${session.title} ${session.productName ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      reports.push({
        sessionId: session.id,
        sessionTitle: session.title,
        productName: session.productName ?? null,
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        relativePath: artifact.relativePath,
        sizeBytes: artifact.sizeBytes,
        isCanonical: artifact.isCanonical ?? false,
        createdAt: artifact.createdAt,
        ...(artifact.summary ? { summary: artifact.summary } : {}),
      });
    }
  }
  reports.sort(
    (left, right) => Date.parse(String(right.createdAt)) - Date.parse(String(left.createdAt)),
  );
  const total = reports.length;
  const limited = reports.slice(offset, offset + limit);
  return json({
    ok: true,
    count: limited.length,
    total,
    limit,
    offset,
    hasMore: offset + limited.length < total,
    reports: limited,
  });
}

/** Return one artifact's content (e.g. report.md) by session + artifact id. */
export async function cliGetReport(
  request: CliReportRequest,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const session = await store.getSession(request.session);
  if (!session) {
    return cliError("session_not_found", { session: request.session });
  }
  const result = await store.readArtifactContent(request.session, request.artifact);
  if (!result) {
    return cliError("artifact_not_found", {
      session: request.session,
      artifact: request.artifact,
    });
  }
  return json({
    ok: true,
    session: { id: session.id, title: session.title, productName: session.productName ?? null },
    artifact: {
      id: result.artifact.id,
      kind: result.artifact.kind,
      title: result.artifact.title,
      relativePath: result.artifact.relativePath,
      sizeBytes: result.artifact.sizeBytes,
      createdAt: result.artifact.createdAt,
    },
    mimeType: result.mimeType,
    content: result.content,
  });
}

/**
 * Kick off a detached research run; the caller polls sessions/reports later.
 *
 * The detached run validates the skill/agent asynchronously, so we preflight
 * those same checks here and only return `ok: true` once the run is actually
 * runnable. Otherwise an app/agent caller would receive a success envelope for a
 * run that then fails in the background (e.g. an unknown or unauthenticated
 * target) — a misleading signal we observed in review.
 */
export async function cliStartResearch(
  request: CliResearchRequest,
  config: AppRuntimeConfig,
  store: SessionStore,
  researchRuns: ResearchRunService,
): Promise<CliCommandOutput> {
  const product = request.product.trim();
  if (!product) {
    return cliError("empty_product", {
      message: "Provide a product name or research prompt via --product.",
    });
  }

  // Validate an explicit session before paying for provider detection.
  if (request.session) {
    const existing = await store.getSession(request.session);
    if (!existing) {
      return cliError("session_not_found", { session: request.session });
    }
  }

  if (!config.paths.skillDir) {
    return cliError("skill_unavailable", {
      message: "The product-swipefile research skill is not bundled in this runtime.",
    });
  }

  const agentCatalog = await detectAgentCatalog();
  const selection = resolveAgentSelection(agentCatalog, {
    agentTargetId: request.agentId,
    provider: request.provider,
  });
  if (!selection.ok) {
    const details = {
      requested: selection.requested,
      availableAgentIds: agentCatalog.agents.map((item) => item.agentTargetId),
      ...(selection.matches ? { matches: selection.matches } : {}),
      message: agentSelectionErrorMessage(selection),
    };
    return cliError(selection.code, details);
  }
  const agent = selection.agent;

  const model = request.model?.trim();
  if (model && agent.models.length > 0 && !agentHasModel(agent, model)) {
    return cliError("model_unavailable", {
      agentTargetId: agent.agentTargetId,
      providerId: agent.providerId,
      provider: agent.providerId,
      model,
      models: agent.models,
      message: `Model "${model}" is not available for ${agent.label}.`,
    });
  }

  let sessionId = request.session;
  if (!sessionId) {
    const created = await store.createSession({});
    sessionId = created.id;
  }

  const { runId } = researchRuns.startDetached({
    type: "start",
    sessionId,
    prompt: product,
    agentTargetId: agent.agentTargetId,
    ...(model ? { model } : {}),
  });

  return json({
    ok: true,
    status: "running",
    sessionId,
    runId,
    agentTargetId: agent.agentTargetId,
    providerId: agent.providerId,
    provider: agent.providerId,
    message:
      "Research run started. Poll `competition sessions` or `competition reports` for results.",
  });
}

/** Whether a model id matches one the agent runtime advertises (with/without its prefix). */
function agentHasModel(agent: AgentTargetSummary, model: string): boolean {
  const prefix = `${agent.providerId}:`;
  const strip = (value: string) => (value.startsWith(prefix) ? value.slice(prefix.length) : value);
  const target = strip(model);
  return agent.models.some((candidate) => candidate === model || strip(candidate) === target);
}
