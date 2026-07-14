import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";
import type {
  AgentRunEvent,
  AgentRunStartRequest,
  ChatMessage,
  ContentBlock,
} from "@product-competition/shared";

import type { AppRuntimeConfig } from "../config.js";
import type { SessionStore } from "../local/session-store.js";
import type { LocalAgentResearchProvider } from "../runtimes/local-agent-provider.js";
import type { ResearchRunContext, RuntimeHistoryMessage } from "../runtimes/runtime-provider.js";
import { loadProductSwipefileSkill } from "../runtimes/skill-loader.js";
import { scanRunArtifacts } from "./artifact-scanner.js";

export type EmitAgentRunEvent = (event: AgentRunEvent) => void;

/** Event sink for detached runs that have no connected client. */
const NOOP_EMIT: EmitAgentRunEvent = () => {};

const DEFAULT_TITLE = "New research";
const HISTORY_TURN_LIMIT = 12;

interface ActiveRun {
  sessionId: string;
  controller: AbortController;
  cancel: () => Promise<void> | void;
}

/** How often, at most, the in-progress assistant message is flushed to disk. */
const PERSIST_INTERVAL_MS = 600;

/**
 * Orchestrates one chat turn: persist the user message, drive the local agent
 * (which runs the product-swipefile skill), stream progress, capture artifacts,
 * and persist the assistant message — the chat-first analog of group-chat's
 * ChatService run loop.
 */
export class ResearchRunService {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly config: AppRuntimeConfig,
    private readonly store: SessionStore,
    private readonly provider: LocalAgentResearchProvider,
  ) {}

  /**
   * Start a run without a live event sink (used by the Tutti CLI `research`
   * command). The run still persists its user/assistant messages and artifacts
   * to disk exactly like a streamed turn, so callers poll `sessions`/`reports`
   * for completion. Returns immediately with the ids needed to track it.
   */
  startDetached(request: AgentRunStartRequest): { runId: string; sessionId: string } {
    const runId = nanoid();
    void this.start(request, NOOP_EMIT, runId).catch(() => undefined);
    return { runId, sessionId: request.sessionId };
  }

  start(request: AgentRunStartRequest, emit: EmitAgentRunEvent, runId = nanoid()): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(runId, {
      sessionId: request.sessionId,
      controller,
      cancel: async () => {
        await this.provider.cancel(runId);
      },
    });
    return this.execute(request, emit, runId, controller).finally(() => {
      this.activeRuns.delete(runId);
    });
  }

  private async execute(
    request: AgentRunStartRequest,
    emit: EmitAgentRunEvent,
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    const session = await this.store.getSession(request.sessionId);
    if (!session) {
      emit({ type: "run_failed", runId, message: `Session not found: ${request.sessionId}` });
      emit({ type: "run_finished", runId });
      return;
    }

    const prompt = request.prompt.trim();
    const priorMessages = await this.store.getMessages(session.id);

    const userMessage: ChatMessage = {
      id: nanoid(),
      role: "user",
      contentBlocks: [{ type: "text", text: prompt }],
      createdAt: new Date().toISOString(),
    };
    await this.store.upsertMessage(session.id, userMessage);
    await this.store.setSessionStatus(session.id, "running");

    // Resume support: if the previous turn in this session was interrupted
    // (timed out / failed / cancelled) and left a run directory with collected
    // evidence, reuse that working directory so the skill's stage-status can
    // continue from where it stopped instead of restarting from scratch.
    const resumeCwd = await this.findResumableRunCwd(session.id, priorMessages);
    const cwd = resumeCwd ?? this.store.runDir(session.id, runId);
    const resuming = resumeCwd !== null;
    await mkdir(cwd, { recursive: true });

    const skill = this.config.paths.skillDir
      ? await loadProductSwipefileSkill(this.config.paths.skillDir).catch(() => null)
      : null;

    const context: ResearchRunContext = {
      runId,
      sessionId: session.id,
      prompt,
      history: buildHistory(priorMessages),
      cwd,
      agentSessionsDir: this.config.paths.agentSessionsDir,
      skill,
      pythonBin: this.config.pythonBin,
      ...(request.agentTargetId ? { agentTargetId: request.agentTargetId } : {}),
      ...(!request.agentTargetId && request.provider ? { provider: request.provider } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(resuming ? { resuming: true } : {}),
      signal: controller.signal,
    };

    const assistantId = nanoid();
    const assistantCreatedAt = new Date().toISOString();
    const blocks = new BlockAccumulator();

    // Stream-as-you-go persistence: keep the assistant message on disk up to
    // date during the run so a refresh (or a crash) never loses what was
    // already generated. Writes are throttled to avoid hammering messages.json.
    let lastPersistAt = 0;
    let persistChain: Promise<void> = Promise.resolve();
    const persistAssistant = (runStatus: ChatMessage["runStatus"]) => {
      const message: ChatMessage = {
        id: assistantId,
        role: "assistant",
        contentBlocks: blocks.snapshot(),
        createdAt: assistantCreatedAt,
        runId,
        runStatus,
      };
      persistChain = persistChain
        .then(() => this.store.upsertMessage(session.id, message))
        .catch(() => undefined);
      return persistChain;
    };
    const maybePersist = () => {
      const now = Date.now();
      if (now - lastPersistAt < PERSIST_INTERVAL_MS) return;
      lastPersistAt = now;
      void persistAssistant("running");
    };

    try {
      controller.signal.throwIfAborted();
      const detection = await this.provider.detect(context);
      controller.signal.throwIfAborted();
      if (!detection.available) {
        throw new Error(detection.reason ?? "The selected agent runtime is not available.");
      }
      const resolvedContext = {
        ...context,
        agentTargetId: detection.agentTargetId,
        providerId: detection.providerId,
      };
      const descriptor = this.provider.describeRun(resolvedContext);

      await this.store.updateSession(session.id, {
        agentTargetId: descriptor.agentTargetId,
        providerId: descriptor.providerId,
        provider: descriptor.providerId,
      });

      emit({
        type: "run_started",
        runId,
        sessionId: session.id,
        agentTargetId: descriptor.agentTargetId,
        providerId: descriptor.providerId,
        provider: descriptor.providerId,
        model: descriptor.model,
      });

      // Persist an initial running placeholder so a reload mid-run shows the
      // assistant turn instead of just the user's message.
      await persistAssistant("running");

      for await (const event of this.provider.run(resolvedContext)) {
        switch (event.type) {
          case "status":
            blocks.flushThinking();
            emit({ type: "status", runId, message: event.message });
            maybePersist();
            break;
          case "thinking_delta":
            blocks.appendThinking(event.text);
            emit({ type: "thinking_delta", runId, text: event.text });
            maybePersist();
            break;
          case "text_delta":
            blocks.appendText(event.text);
            emit({ type: "text_delta", runId, text: event.text });
            maybePersist();
            break;
          case "tool_call":
            blocks.flushThinking();
            blocks.startTool(event.id, event.name, event.input);
            emit({ type: "tool_call", runId, id: event.id, name: event.name, input: event.input });
            maybePersist();
            break;
          case "tool_result":
            blocks.finishTool(event.id, event.name, event.status, event.summary, event.output);
            emit({
              type: "tool_result",
              runId,
              id: event.id,
              name: event.name,
              status: event.status,
              summary: event.summary,
              output: event.output,
            });
            maybePersist();
            break;
          case "file_write":
            emit({ type: "file_write", runId, path: event.path });
            break;
          case "stderr": {
            const clean = sanitizeRuntimeMessage(event.text);
            if (clean) emit({ type: "status", runId, message: clean });
            break;
          }
        }
      }

      emit({ type: "status", runId, message: "Capturing research artifacts." });
      const scan = await scanRunArtifacts(cwd, session.id, runId, this.store);
      if (scan.artifacts.length > 0) {
        await this.store.addArtifacts(session.id, scan.artifacts);
        emit({ type: "artifacts_ready", runId, sessionId: session.id, artifacts: scan.artifacts });
      }

      await persistChain;
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        contentBlocks: blocks.finalize(),
        createdAt: assistantCreatedAt,
        runId,
        runStatus: "done",
      };
      await this.store.upsertMessage(session.id, assistantMessage);

      const titlePatch =
        session.title === DEFAULT_TITLE ? { title: scan.productName ?? deriveTitle(prompt) } : {};
      const updatedSession =
        (await this.store.updateSession(session.id, {
          status: "done",
          lastRunId: runId,
          ...(scan.productName ? { productName: scan.productName } : {}),
          ...titlePatch,
        })) ?? session;

      emit({ type: "assistant_message", runId, sessionId: session.id, message: assistantMessage });
      emit({ type: "session_updated", runId, session: updatedSession });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Research run failed";
      const message = sanitizeRuntimeMessage(raw) || "Research run failed. Please try again.";
      const cancelled = controller.signal.aborted;
      await persistChain;
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        contentBlocks: blocks.finalizeWithError(cancelled ? "Run cancelled." : message),
        createdAt: assistantCreatedAt,
        runId,
        runStatus: cancelled ? "cancelled" : "failed",
      };
      await this.store.upsertMessage(session.id, assistantMessage);
      const updatedSession =
        (await this.store.updateSession(session.id, {
          status: cancelled ? "idle" : "failed",
          lastRunId: runId,
        })) ?? session;
      if (!cancelled) {
        emit({ type: "run_failed", runId, message });
      }
      emit({ type: "assistant_message", runId, sessionId: session.id, message: assistantMessage });
      emit({ type: "session_updated", runId, session: updatedSession });
    } finally {
      this.activeRuns.delete(runId);
      emit({ type: "run_finished", runId });
    }
  }

  /**
   * If the most recent assistant turn was interrupted and its run directory
   * still holds an in-progress research run (a new-run was created or evidence
   * was collected), return that directory so the next turn can resume it.
   * Returns null when there is nothing worth resuming (fresh run instead).
   */
  private async findResumableRunCwd(
    sessionId: string,
    priorMessages: ChatMessage[],
  ): Promise<string | null> {
    const lastAssistant = [...priorMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant?.runId) return null;
    // Only resume an interrupted run; a completed run starts fresh so a new
    // question doesn't get appended onto a finished report's directory.
    if (lastAssistant.runStatus !== "failed" && lastAssistant.runStatus !== "cancelled")
      return null;

    const priorCwd = this.store.runDir(sessionId, lastAssistant.runId);
    return (await hasResumableRun(priorCwd)) ? priorCwd : null;
  }

  async cancel(runId: string): Promise<{ cancelled: boolean }> {
    const active = this.activeRuns.get(runId);
    if (!active) return { cancelled: false };
    active.controller.abort();
    await active.cancel();
    return { cancelled: true };
  }

  /** Cancel every in-flight run for a session (used before deleting it). */
  async cancelSession(sessionId: string): Promise<number> {
    const runIds = [...this.activeRuns.entries()]
      .filter(([, run]) => run.sessionId === sessionId)
      .map(([runId]) => runId);
    for (const runId of runIds) {
      await this.cancel(runId);
    }
    return runIds.length;
  }
}

/** Files that mark a run directory as worth resuming (created by the skill). */
const RESUMABLE_RUN_MARKERS = new Set(["run.json", "meta.json", "inventory.md", "report.md"]);
const RESUMABLE_SKIP_DIRS = new Set([".local-agent", "__pycache__", ".git", "node_modules"]);
const RESUMABLE_MAX_DEPTH = 5;

/**
 * Walk a prior run's working directory looking for any sign that the skill's
 * `new-run` executed or evidence was collected. The skill materialization dir
 * (.local-agent) is ignored since it is recreated every run.
 */
async function hasResumableRun(cwd: string, depth = 0): Promise<boolean> {
  if (depth > RESUMABLE_MAX_DEPTH) return false;
  let entries;
  try {
    entries = await readdir(cwd, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && RESUMABLE_RUN_MARKERS.has(entry.name)) return true;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || RESUMABLE_SKIP_DIRS.has(entry.name)) continue;
    if (await hasResumableRun(path.join(cwd, entry.name), depth + 1)) return true;
  }
  return false;
}

function buildHistory(messages: ChatMessage[]): RuntimeHistoryMessage[] {
  return messages
    .slice(-HISTORY_TURN_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.contentBlocks
        .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim(),
    }))
    .filter((message) => message.content.length > 0);
}

/**
 * Strip environment/CLI noise that is meaningless to a research user before a
 * message is shown in the chat: provider lifecycle hooks
 * failures (e.g. an external "Flux Island" hook), bare "Hook cancelled" lines,
 * and resume-session diagnostics that the orchestrator already recovers from.
 */
function sanitizeRuntimeMessage(value: string): string {
  const NOISE_LINE = [
    /Session(?:Start|End) hook .*failed/i,
    /^\s*Hook (?:cancelled|canceled)\.?\s*$/i,
    /Flux Island/i,
    /No conversation found with session ID/i,
    /ELECTRON_RUN_AS_NODE/i,
  ];
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !NOISE_LINE.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}

function deriveTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_TITLE;
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}

/**
 * Server-side mirror of the web stream reducer: folds runtime events into the
 * assistant message's contentBlocks so reloads show the same thread.
 */
class BlockAccumulator {
  private readonly blocks: ContentBlock[] = [];
  private activeText: Extract<ContentBlock, { type: "text" }> | null = null;
  private activeThinking: Extract<ContentBlock, { type: "thinking" }> | null = null;

  appendText(text: string) {
    this.activeThinking = null;
    if (!this.activeText) {
      this.activeText = { type: "text", text: "" };
      this.blocks.push(this.activeText);
    }
    this.activeText.text += text;
  }

  appendThinking(text: string) {
    this.activeText = null;
    if (!this.activeThinking) {
      this.activeThinking = { type: "thinking", text: "" };
      this.blocks.push(this.activeThinking);
    }
    this.activeThinking.text += text;
  }

  flushThinking() {
    if (this.activeThinking) {
      this.activeThinking.done = true;
      this.activeThinking = null;
    }
  }

  startTool(toolCallId: string, name: string, input: unknown | undefined) {
    this.activeText = null;
    this.activeThinking = null;
    this.blocks.push({
      type: "tool",
      toolCallId,
      name,
      status: "running",
      ...(input !== undefined ? { input } : {}),
    });
  }

  finishTool(
    toolCallId: string,
    name: string | undefined,
    status: "completed" | "failed" | undefined,
    summary: string | undefined,
    output: unknown | undefined,
  ) {
    const block = [...this.blocks]
      .reverse()
      .find(
        (item): item is Extract<ContentBlock, { type: "tool" }> =>
          item.type === "tool" && item.toolCallId === toolCallId,
      );
    if (block) {
      block.status = status === "failed" ? "failed" : "completed";
      if (name) block.name = name;
      if (summary) block.summary = summary;
      if (output !== undefined) block.output = output;
    }
  }

  /** Deep copy of the current blocks for an intermediate, non-destructive write. */
  snapshot(): ContentBlock[] {
    return this.blocks.map((block) => ({ ...block }));
  }

  finalize(): ContentBlock[] {
    this.flushThinking();
    const cleaned = this.blocks.filter(
      (block) => block.type !== "text" || block.text.trim().length > 0,
    );
    if (cleaned.length === 0) {
      return [{ type: "text", text: "Done." }];
    }
    return cleaned;
  }

  finalizeWithError(message: string): ContentBlock[] {
    this.flushThinking();
    // Mark any still-running tool as failed.
    for (const block of this.blocks) {
      if (block.type === "tool" && block.status === "running") {
        block.status = "failed";
      }
    }
    const cleaned = this.blocks.filter(
      (block) => block.type !== "text" || block.text.trim().length > 0,
    );
    cleaned.push({ type: "text", text: message });
    return cleaned;
  }
}
