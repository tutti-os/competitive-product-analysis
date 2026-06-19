import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createDefaultLocalAgentProviderPlugins,
  createLocalAgentRuntime,
  type AgentEvent,
} from "@tutti-os/agent-acp-kit";

import { buildResearchPrompt, buildResearchSystemPrompt } from "./research-prompt.js";
import {
  RuntimeProviderUnsupportedError,
  type ResearchRunContext,
  type RuntimeRunDescriptor,
  type RuntimeStreamEvent,
} from "./runtime-provider.js";

// Aligned with the product-swipefile skill's budget: run.py allows 5400s (90 min)
// PER STAGE across two stages (collection + writing). This single local-agent run
// covers the whole staged pipeline in one process, so it gets the full 2-stage
// budget. Override with PRODUCT_COMPETITION_LOCAL_AGENT_TIMEOUT_MS when needed.
const DEFAULT_TIMEOUT_MS = 10_800_000; // 180 min = 2 × 90 min/stage.
const DEFAULT_PROVIDER = "claude";

/**
 * Drives a locally installed Claude/Codex CLI through @tutti-os/agent-acp-kit
 * to run the product-swipefile research skill for a single chat turn. The skill
 * is materialized into the run cwd via skillManifest; artifacts it writes are
 * captured by the orchestrator afterwards.
 */
export class LocalAgentResearchProvider {
  private readonly processes = new Map<string, { cancel: () => Promise<void> | void }>();
  private readonly localAgentRuntime = createLocalAgentRuntime({
    providers: createDefaultLocalAgentProviderPlugins(),
  });

  describeRun(context: ResearchRunContext): RuntimeRunDescriptor {
    return {
      provider: context.provider ?? DEFAULT_PROVIDER,
      model: context.model ?? "default",
    };
  }

  async detect(context: ResearchRunContext) {
    const provider = context.provider ?? DEFAULT_PROVIDER;
    const registered = this.localAgentRuntime.listProviders().some((item) => item.id === provider);
    if (!registered) {
      return {
        available: false,
        reason: `Provider is not registered in @tutti-os/agent-acp-kit: ${provider}`,
      };
    }
    const detection = (await this.localAgentRuntime.detect()).find((item) => item.provider === provider);
    if (!detection || detection.result === null) {
      return { available: false, reason: `${provider} local agent is not installed or not discoverable.` };
    }
    if (detection.result?.supported === false) {
      return {
        available: false,
        reason: detection.result.unsupportedReason ?? `${provider} is not supported on this machine.`,
      };
    }
    if (detection.result?.authState === "missing") {
      return { available: false, reason: `${provider} is installed but authentication is missing.` };
    }
    return { available: true };
  }

  async *run(context: ResearchRunContext): AsyncIterable<RuntimeStreamEvent> {
    const provider = context.provider ?? DEFAULT_PROVIDER;
    if (!context.skill) {
      throw new RuntimeProviderUnsupportedError(
        "The product-swipefile skill is missing, so research runs cannot be started.",
      );
    }

    mkdirSync(context.cwd, { recursive: true });
    const controller = new AbortController();
    if (context.signal) {
      if (context.signal.aborted) controller.abort();
      else context.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    this.processes.set(context.runId, {
      cancel: async () => {
        controller.abort();
        await this.localAgentRuntime.cancel(context.runId);
      },
    });

    const sessionStore = new LocalAgentSessionStore(context.agentSessionsDir);
    const previousSession = sessionStore.read(context.sessionId);
    let resume =
      previousSession?.provider === provider && (previousSession.providerSessionId || previousSession.resumeToken)
        ? {
            mode: "provider" as const,
            ...(previousSession.providerSessionId ? { providerSessionId: previousSession.providerSessionId } : {}),
            ...(previousSession.resumeToken ? { resumeToken: previousSession.resumeToken } : {}),
          }
        : { mode: "fresh" as const };
    let canRetryFresh = resume.mode !== "fresh";
    let emittedNonRetryableEvent = false;

    try {
      while (true) {
        try {
          for await (const event of this.localAgentRuntime.run({
            runId: context.runId,
            conversationId: context.sessionId,
            sessionId: context.sessionId,
            provider,
            runtimeKind: "local-agent",
            runtimeProvider: provider,
            cwd: context.cwd,
            prompt: buildResearchPrompt(context),
            systemPrompt: buildResearchSystemPrompt(context),
            model: stripProviderPrefix(context.model ?? "default", provider),
            ...(context.history.length > 0 ? { history: context.history } : {}),
            skillManifest: [context.skill],
            env: {
              PRODUCT_SWIPEFILE_PYTHON: context.pythonBin,
            },
            timeoutMs: Number(process.env.PRODUCT_COMPETITION_LOCAL_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
            extraAllowedDirs: [context.cwd],
            resume,
            signal: controller.signal,
          })) {
            const runtimeEvent = toRuntimeStreamEvent(event);
            if (runtimeEvent) {
              if (runtimeEvent.type !== "status" && runtimeEvent.type !== "stderr") {
                emittedNonRetryableEvent = true;
              }
              yield runtimeEvent;
            } else if (event.type === "error") {
              throw new Error(event.message);
            } else if (event.type === "done") {
              if (event.sessionId || event.resumeToken) {
                sessionStore.write(context.sessionId, {
                  provider,
                  providerSessionId: event.sessionId,
                  resumeToken: event.resumeToken,
                });
              }
              if (event.status === "failed") {
                throw new Error(
                  `local-agent ${provider} failed${typeof event.exitCode === "number" ? ` with exit code ${event.exitCode}` : ""}`,
                );
              }
            }
          }
          break;
        } catch (error) {
          if (canRetryFresh && !emittedNonRetryableEvent && isRecoverableResumeError(error)) {
            sessionStore.remove(context.sessionId);
            resume = { mode: "fresh" as const };
            canRetryFresh = false;
            continue;
          }
          throw error;
        }
      }
    } finally {
      this.processes.delete(context.runId);
    }
  }

  async cancel(runId: string) {
    const process = this.processes.get(runId);
    if (!process) return { cancelled: false, reason: "local-agent run is not active" };
    await process.cancel();
    this.processes.delete(runId);
    return { cancelled: true };
  }
}

function toRuntimeStreamEvent(event: AgentEvent): RuntimeStreamEvent | null {
  if (event.type === "text_delta") return { type: "text_delta", text: event.text };
  if (event.type === "thinking" || event.type === "thinking_delta") {
    return { type: "thinking_delta", text: event.text };
  }
  if (event.type === "tool_call") {
    return { type: "tool_call", id: event.id, name: event.name || "unknown_tool", input: event.input };
  }
  if (event.type === "tool_result") {
    return {
      type: "tool_result",
      id: event.id,
      name: event.name || "unknown_tool",
      status: event.status,
      summary: event.summary,
    };
  }
  if (event.type === "status") {
    return { type: "status", message: event.message ?? event.status ?? event.stage ?? "working" };
  }
  if (event.type === "file_write") return { type: "file_write", path: event.path };
  if (event.type === "stderr") return { type: "stderr", text: event.text };
  return null;
}

interface StoredLocalAgentSession {
  provider: string;
  providerSessionId?: string;
  resumeToken?: string;
  updatedAt: string;
}

class LocalAgentSessionStore {
  constructor(private readonly sessionsDir: string) {}

  read(sessionId: string): StoredLocalAgentSession | null {
    try {
      const parsed = JSON.parse(readFileSync(this.pathFor(sessionId), "utf8")) as StoredLocalAgentSession;
      return typeof parsed.provider === "string" && parsed.provider ? parsed : null;
    } catch {
      return null;
    }
  }

  write(sessionId: string, session: Omit<StoredLocalAgentSession, "updatedAt">) {
    const filePath = this.pathFor(sessionId);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  }

  remove(sessionId: string) {
    try {
      unlinkSync(this.pathFor(sessionId));
    } catch {
      // A missing session file already behaves like a fresh run.
    }
  }

  private pathFor(sessionId: string) {
    return join(this.sessionsDir, `${safePathSegment(sessionId)}.json`);
  }
}

function isRecoverableResumeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    // Generic resume failures surfaced by the kit / different CLIs.
    /thread\/resume|resume failed|no rollout found/i.test(message) ||
    // Claude CLI emits "No conversation found with session ID: <id>" when the
    // stored session was purged (e.g. the previous run was cancelled). Match
    // both "no <thing> found" and "<thing> ... not found" phrasings.
    /no (?:session|conversation|thread|rollout) found/i.test(message) ||
    /(?:session|conversation|thread)\b[^\n]*\bnot found/i.test(message)
  );
}

function safePathSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
}

function stripProviderPrefix(model: string, provider: string) {
  const prefix = `${provider}:`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
