import type {
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
import { detectAgentProviders, pickDefaultProvider } from "./agent-service.js";
import type { ResearchRunService } from "./research-run-service.js";
import { probeTuttiCli } from "../runtimes/tutti-cli.js";

/**
 * Use-case helpers behind the Tutti CLI capability surface (`/tutti/cli/*`).
 * These are the composition entrypoint other Tutti apps and agents call to
 * read this app's research library and start runs. They reuse the same store
 * and domain services as the `/api/*` routes rather than duplicating logic.
 */

const json = (value: unknown): CliCommandOutput => ({ kind: "json", value });

/** Runtime + provider + ecosystem health, suitable for an app/agent precheck. */
export async function cliStatus(
  config: AppRuntimeConfig,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const [sessions, providers, tuttiCli] = await Promise.all([
    store.listSessions(),
    detectAgentProviders(),
    probeTuttiCli(),
  ]);
  const artifactCount = sessions.reduce((total, session) => total + session.artifactCount, 0);
  return json({
    ok: true,
    app: { id: APP_ID, name: APP_NAME, version: APP_VERSION },
    skillAvailable: Boolean(config.paths.skillDir),
    providers,
    defaultProvider: pickDefaultProvider(providers),
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
  const limited = sessions.slice(0, request.limit ?? 50);
  return json({
    ok: true,
    count: limited.length,
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

  let sessions: ResearchSession[];
  if (request.session) {
    const session = await store.getSession(request.session);
    if (!session) {
      return json({ ok: false, error: "session_not_found", session: request.session });
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
    (left, right) =>
      Date.parse(String(right.createdAt)) - Date.parse(String(left.createdAt)),
  );
  const limited = reports.slice(0, limit);
  return json({ ok: true, count: limited.length, reports: limited });
}

/** Return one artifact's content (e.g. report.md) by session + artifact id. */
export async function cliGetReport(
  request: CliReportRequest,
  store: SessionStore,
): Promise<CliCommandOutput> {
  const session = await store.getSession(request.session);
  if (!session) {
    return json({ ok: false, error: "session_not_found", session: request.session });
  }
  const result = await store.readArtifactContent(request.session, request.artifact);
  if (!result) {
    return json({
      ok: false,
      error: "artifact_not_found",
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

/** Kick off a detached research run; the caller polls sessions/reports later. */
export async function cliStartResearch(
  request: CliResearchRequest,
  store: SessionStore,
  researchRuns: ResearchRunService,
): Promise<CliCommandOutput> {
  const product = request.product.trim();
  if (!product) {
    return json({ ok: false, error: "empty_product" });
  }

  let sessionId = request.session;
  if (sessionId) {
    const existing = await store.getSession(sessionId);
    if (!existing) {
      return json({ ok: false, error: "session_not_found", session: sessionId });
    }
  } else {
    const created = await store.createSession({});
    sessionId = created.id;
  }

  const { runId } = researchRuns.startDetached({
    type: "start",
    sessionId,
    prompt: product,
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.model ? { model: request.model } : {}),
  });

  return json({
    ok: true,
    status: "running",
    sessionId,
    runId,
    message:
      "Research run started. Poll `competition sessions` or `competition reports` for results.",
  });
}
