import path from "node:path";
import { readFile } from "node:fs/promises";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { nanoid } from "nanoid";
import {
  agentRunClientMessageSchema,
  cliReportRequestSchema,
  cliReportsRequestSchema,
  cliResearchRequestSchema,
  cliSessionsRequestSchema,
  cliStatusRequestSchema,
  createSessionInputSchema,
  referenceListRequestSchema,
  referenceSearchRequestSchema,
  API_ROUTES,
  type AgentRunEvent,
} from "@product-competition/shared";

import { APP_ID, APP_NAME, APP_VERSION } from "./app-meta.js";
import { createRuntimeConfig } from "./config.js";
import { detectAgentCatalog, warmAgentCatalog } from "./domains/agent-service.js";
import {
  cliError,
  cliGetReport,
  cliListReports,
  cliListSessions,
  cliStartResearch,
  cliStatus,
} from "./domains/cli-service.js";
import { buildReferenceList, searchReferences } from "./domains/reference-service.js";
import { ResearchRunService } from "./domains/research-run-service.js";
import { SessionStore } from "./local/session-store.js";
import { LocalAgentResearchProvider } from "./runtimes/local-agent-provider.js";
import { tuttiCliCommand } from "./runtimes/tutti-cli.js";

const runtimeConfig = await createRuntimeConfig();
const app = Fastify({ logger: false });
const store = new SessionStore(runtimeConfig.paths);
const provider = new LocalAgentResearchProvider();
const researchRuns = new ResearchRunService(runtimeConfig, store, provider);

// Heal state left behind by a previous process before serving traffic: recover
// sessions missing from the index and demote runs stuck in "running".
await store.reconcileOnStartup().catch(() => undefined);

// Warm agent detection in the background (non-blocking) so the first
// app-to-app `status`/`research` precheck answers from cache rather than paying
// the multi-second detect cost that previously pushed `status` near its timeout.
warmAgentCatalog();

await app.register(fastifyWebsocket);

if (runtimeConfig.paths.webDistDir) {
  await app.register(fastifyStatic, {
    root: runtimeConfig.paths.webDistDir,
    prefix: "/",
    index: ["index.html"],
  });
}

app.get(API_ROUTES.health, async () => ({
  ok: true,
  name: APP_ID,
  displayName: APP_NAME,
  version: APP_VERSION,
  skillAvailable: Boolean(runtimeConfig.paths.skillDir),
  // Sync, no spawn: whether the Tutti CLI bridge is wired into this runtime.
  tuttiCli: tuttiCliCommand() !== null,
}));

app.get(API_ROUTES.bootstrap, async () => {
  // Continuously self-heal: surface any on-disk session that fell out of the
  // index (without touching active runs, which only this process knows about).
  await store.recoverOrphanSessions().catch(() => undefined);
  const [sessions, activeSessionId, agentCatalog] = await Promise.all([
    store.listSessions(),
    store.getActiveSessionId(),
    detectAgentCatalog(),
  ]);
  return {
    sessions,
    activeSessionId,
    agentTargets: agentCatalog.agents,
    defaultAgentTargetId: agentCatalog.defaultAgentTargetId,
  };
});

app.post(API_ROUTES.sessions, async (request, reply) => {
  const result = createSessionInputSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.status(400).send({ error: "invalid_session", details: result.error.flatten() });
  }
  return store.createSession(result.data);
});

app.patch("/api/sessions/:sessionId", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const body = (request.body ?? {}) as { active?: boolean; title?: string };
  const session = await store.getSession(sessionId);
  if (!session) {
    return reply.status(404).send({ error: "session_not_found" });
  }
  if (body.active) {
    await store.setActiveSessionId(sessionId);
  }
  if (typeof body.title === "string" && body.title.trim()) {
    await store.updateSession(sessionId, { title: body.title.trim() });
  }
  return (await store.getSession(sessionId)) ?? session;
});

app.delete("/api/sessions/:sessionId", async (request) => {
  const { sessionId } = request.params as { sessionId: string };
  // Stop any in-flight run first; otherwise an orphaned run keeps executing and
  // recreates the session's run directory after we remove it.
  await researchRuns.cancelSession(sessionId);
  await store.deleteSession(sessionId);
  const activeSessionId = await store.getActiveSessionId();
  return { ok: true, activeSessionId };
});

app.get("/api/sessions/:sessionId/messages", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const session = await store.getSession(sessionId);
  if (!session) {
    return reply.status(404).send({ error: "session_not_found" });
  }
  await store.setActiveSessionId(sessionId);
  const [messages, artifacts] = await Promise.all([
    store.getMessages(sessionId),
    store.getArtifacts(sessionId),
  ]);
  return { session, messages, artifacts };
});

app.get("/api/sessions/:sessionId/artifacts/:artifactId/content", async (request, reply) => {
  const { sessionId, artifactId } = request.params as { sessionId: string; artifactId: string };
  const result = await store.readArtifactContent(sessionId, artifactId);
  if (!result) {
    return reply.status(404).send({ error: "artifact_not_found" });
  }
  return result;
});

// Streaming research runs. One run per socket connection.
app.get(API_ROUTES.agentStream, { websocket: true }, (socket) => {
  // Track the run bound to this socket so we can cancel it if the client
  // disconnects (refresh/navigate). Partial output is already persisted, so the
  // cancelled run finalizes cleanly instead of leaking as an orphan.
  let activeRunId: string | null = null;
  let finished = false;

  const emit: (event: AgentRunEvent) => void = (event) => {
    if (event.type === "run_started") activeRunId = event.runId;
    if (event.type === "run_finished") {
      finished = true;
      activeRunId = null;
    }
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  };

  socket.on("message", (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const message = agentRunClientMessageSchema.safeParse(parsed);
    if (!message.success) {
      emit({ type: "run_failed", runId: "unknown", message: "Invalid agent run request" });
      return;
    }
    if (message.data.type === "cancel") {
      void researchRuns.cancel(message.data.runId);
      return;
    }
    const runId = nanoid();
    activeRunId = runId;
    void researchRuns.start(message.data, emit, runId);
  });

  socket.on("close", () => {
    if (!finished && activeRunId) {
      void researchRuns.cancel(activeRunId);
    }
  });
});

app.post(API_ROUTES.referencesList, async (request, reply) => {
  const result = referenceListRequestSchema.safeParse(request.body);
  if (!result.success) {
    return reply
      .status(400)
      .send({ error: "invalid_reference_request", details: result.error.flatten() });
  }
  return buildReferenceList(result.data, store);
});

app.post(API_ROUTES.referencesSearch, async (request, reply) => {
  const result = referenceSearchRequestSchema.safeParse(request.body);
  if (!result.success) {
    return reply
      .status(400)
      .send({ error: "invalid_search_request", details: result.error.flatten() });
  }
  return searchReferences(result.data, store);
});

// --- Tutti CLI capability surface (tutti.cli.json -> /tutti/cli/*) ----------
// These let other Tutti apps and agents read this app's research library and
// start runs. Handlers parse with the shared CLI schemas and return the
// CliCommandOutput envelope; business logic lives in cli-service.

app.post(API_ROUTES.cliStatus, async (request, reply) => {
  const result = cliStatusRequestSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.send(cliError("invalid_cli_request", { details: result.error.flatten() }));
  }
  return cliStatus(runtimeConfig, store);
});

app.post(API_ROUTES.cliSessions, async (request, reply) => {
  const result = cliSessionsRequestSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.send(cliError("invalid_cli_request", { details: result.error.flatten() }));
  }
  return cliListSessions(result.data, store);
});

app.post(API_ROUTES.cliReports, async (request, reply) => {
  const result = cliReportsRequestSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.send(cliError("invalid_cli_request", { details: result.error.flatten() }));
  }
  return cliListReports(result.data, store);
});

app.post(API_ROUTES.cliReport, async (request, reply) => {
  const result = cliReportRequestSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.send(cliError("invalid_cli_request", { details: result.error.flatten() }));
  }
  return cliGetReport(result.data, store);
});

app.post(API_ROUTES.cliResearch, async (request, reply) => {
  const result = cliResearchRequestSchema.safeParse(request.body ?? {});
  if (!result.success) {
    return reply.send(cliError("invalid_cli_request", { details: result.error.flatten() }));
  }
  return cliStartResearch(result.data, runtimeConfig, store, researchRuns);
});

if (runtimeConfig.paths.webDistDir) {
  app.get("/", async (_request, reply) => {
    const html = await readFile(
      path.join(runtimeConfig.paths.webDistDir as string, "index.html"),
      "utf8",
    );
    reply.type("text/html").send(html);
  });
}

await app.listen({
  host: runtimeConfig.host,
  port: runtimeConfig.port,
});
