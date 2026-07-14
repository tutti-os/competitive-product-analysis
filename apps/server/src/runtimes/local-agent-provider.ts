import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createDefaultLocalAgentRuntime,
  type AgentEvent,
} from "@tutti-os/agent-acp-kit";
import {
  loadTuttiAgentComposerOptions,
  loadTuttiAgentSkillContext,
} from "@tutti-os/agent-acp-kit/tutti";
import {
  detectAgentCatalog,
  resolveAgentSelection,
} from "../domains/agent-service.js";

import { buildResearchPrompt, buildResearchSystemPrompt } from "./research-prompt.js";
import {
  RuntimeProviderUnsupportedError,
  type ResearchRunContext,
  type RuntimeRunDescriptor,
  type RuntimeStreamEvent,
} from "./runtime-provider.js";

// Aligned with the product-swipefile skill's 90-minute budget per stage across
// collection and writing. The selected target executes both stages in this one
// process, so it gets the full 2-stage budget. Override when needed.
const DEFAULT_TIMEOUT_MS = 10_800_000; // 180 min = 2 × 90 min/stage.

/**
 * Drives a Tutti-visible local agent through @tutti-os/agent-acp-kit
 * to run the product-swipefile research skill for a single chat turn. The skill
 * is materialized into the run cwd via skillManifest; artifacts it writes are
 * captured by the orchestrator afterwards.
 */
export class LocalAgentResearchProvider {
  private readonly processes = new Map<string, { cancel: () => Promise<void> | void }>();
  private readonly localAgentRuntime = createDefaultLocalAgentRuntime();

  describeRun(context: ResearchRunContext): RuntimeRunDescriptor {
    if (!context.agentTargetId || !context.providerId) {
      throw new RuntimeProviderUnsupportedError("Agent target must be resolved before the run starts.");
    }
    return {
      agentTargetId: context.agentTargetId,
      providerId: context.providerId,
      model: context.model ?? "default",
    };
  }

  async detect(context: ResearchRunContext) {
    const catalog = await detectAgentCatalog();
    const selection = resolveAgentSelection(catalog, {
      agentTargetId: context.agentTargetId,
      provider: context.provider,
    });
    if (!selection.ok) {
      return {
        available: false,
        reason:
          selection.code === "provider_ambiguous"
            ? `Provider ${selection.requested} maps to multiple agents; select an exact agent id.`
            : selection.reason ?? "No ready Tutti agent is available.",
      };
    }
    return {
      available: true,
      agentTargetId: selection.agent.agentTargetId,
      providerId: selection.agent.providerId,
    };
  }

  async *run(context: ResearchRunContext): AsyncIterable<RuntimeStreamEvent> {
    const detection = await this.detect(context);
    if (!detection.available || !detection.agentTargetId || !detection.providerId) {
      throw new RuntimeProviderUnsupportedError(detection.reason ?? "No ready Tutti agent is available.");
    }
    const agentTargetId = detection.agentTargetId;
    const providerId = detection.providerId;
    if (!context.skill) {
      throw new RuntimeProviderUnsupportedError(
        "The product-swipefile skill is missing, so research runs cannot be started.",
      );
    }

    mkdirSync(context.cwd, { recursive: true });
    const [composer, tuttiSkills] = await Promise.all([
      loadTuttiAgentComposerOptions({
        runtime: this.localAgentRuntime,
        agentTargetId,
        cwd: context.cwd,
        ...(context.model ? { model: context.model } : {}),
      }),
      loadTuttiAgentSkillContext({
        agentTargetId,
        agentSessionId: context.runId,
        cwd: context.cwd,
      }),
    ]);
    const model = context.model ??
      (composer.modelConfig.currentValue || composer.modelConfig.defaultValue || "default");
    const permissionMode = composer.permissionConfig.modes.find(
      (mode) => mode.id === composer.permissionConfig.defaultValue,
    );
    const systemPrompt = [
      buildResearchSystemPrompt(context),
      tuttiSkills.recommendedSystemPrompt?.content,
    ].filter(Boolean).join("\n\n");

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
      previousSession?.agentTargetId === agentTargetId &&
      previousSession.providerId === providerId &&
      (previousSession.providerSessionId || previousSession.resumeToken)
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
            provider: providerId,
            runtimeKind: "local-agent",
            runtimeProvider: providerId,
            cwd: context.cwd,
            prompt: buildResearchPrompt(context),
            systemPrompt,
            model: stripProviderPrefix(model, providerId),
            reasoning:
              composer.reasoningConfig.currentValue ||
              composer.reasoningConfig.defaultValue ||
              undefined,
            permission: permissionMode
              ? { modeId: permissionMode.id, semantic: permissionMode.semantic }
              : undefined,
            ...(context.history.length > 0 ? { history: context.history } : {}),
            skillManifest: [...tuttiSkills.skillManifest, context.skill],
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
                  agentTargetId,
                  providerId,
                  providerSessionId: event.sessionId,
                  resumeToken: event.resumeToken,
                });
              }
              if (event.status === "failed") {
                throw new Error(
                  `local-agent ${agentTargetId} failed${typeof event.exitCode === "number" ? ` with exit code ${event.exitCode}` : ""}`,
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
    const toolResult = event as AgentEvent & { output?: unknown; result?: unknown; content?: unknown };
    const output = toolResult.output ?? toolResult.result ?? toolResult.content;
    return {
      type: "tool_result",
      id: event.id,
      name: event.name || "unknown_tool",
      status: event.status,
      summary: event.summary,
      ...(output !== undefined ? { output } : {}),
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
  agentTargetId: string;
  providerId: string;
  providerSessionId?: string;
  resumeToken?: string;
  updatedAt: string;
}

class LocalAgentSessionStore {
  constructor(private readonly sessionsDir: string) {}

  read(sessionId: string): StoredLocalAgentSession | null {
    try {
      const parsed = JSON.parse(readFileSync(this.pathFor(sessionId), "utf8")) as StoredLocalAgentSession;
      return typeof parsed.agentTargetId === "string" && parsed.agentTargetId &&
        typeof parsed.providerId === "string" && parsed.providerId
        ? parsed
        : null;
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
    // Some provider CLIs report "No conversation found with session ID: <id>"
    // after a stored session is purged. Match both "no <thing> found" and
    // "<thing> ... not found" phrasings.
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
