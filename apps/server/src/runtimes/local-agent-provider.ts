import { constants } from "node:fs";
import { mkdir, open, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createDefaultLocalAgentRuntime, type AgentEvent } from "@tutti-os/agent-acp-kit";
import {
  loadTuttiAgentComposerOptions,
  loadTuttiAgentSkillContext,
} from "@tutti-os/agent-acp-kit/tutti";
import {
  agentSelectionErrorMessage,
  detectAgentCatalog,
  resolveAgentSelection,
} from "../domains/agent-service.js";

import {
  buildResearchSystemPrompt,
  buildStage1Prompt,
  buildStage2Prompt,
} from "./research-prompt.js";
import {
  RuntimeProviderUnsupportedError,
  type ResearchRunContext,
  type RuntimeRunDescriptor,
  type RuntimeStreamEvent,
} from "./runtime-provider.js";

// Aligned with the product-swipefile skill's 90-minute budget per stage. The
// host launches collection and writing as separate fresh agent invocations.
const DEFAULT_TIMEOUT_MS = 5_400_000;

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
      throw new RuntimeProviderUnsupportedError(
        "Agent target must be resolved before the run starts.",
      );
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
        reason: agentSelectionErrorMessage(selection),
      };
    }
    return {
      available: true,
      agentTargetId: selection.agent.agentTargetId,
      providerId: selection.agent.providerId,
    };
  }

  async *run(context: ResearchRunContext): AsyncIterable<RuntimeStreamEvent> {
    const detection =
      context.agentTargetId && context.providerId
        ? {
            available: true,
            agentTargetId: context.agentTargetId,
            providerId: context.providerId,
          }
        : await this.detect(context);
    if (!detection.available || !detection.agentTargetId || !detection.providerId) {
      throw new RuntimeProviderUnsupportedError(
        detection.reason ?? "No ready Tutti agent is available.",
      );
    }
    const agentTargetId = detection.agentTargetId;
    const providerId = detection.providerId;
    if (!context.skill) {
      throw new RuntimeProviderUnsupportedError(
        "The product-swipefile skill is missing, so research runs cannot be started.",
      );
    }

    await mkdir(context.cwd, { recursive: true });
    const controller = new AbortController();
    if (context.signal) {
      if (context.signal.aborted) controller.abort();
      else context.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let activeStageRunId: string | null = null;
    this.processes.set(context.runId, {
      cancel: async () => {
        controller.abort();
        if (activeStageRunId) {
          await this.localAgentRuntime.cancel(activeStageRunId);
        }
      },
    });
    let composer: Awaited<ReturnType<typeof loadTuttiAgentComposerOptions>>;
    let tuttiSkills: Awaited<ReturnType<typeof loadTuttiAgentSkillContext>>;
    try {
      [composer, tuttiSkills] = await Promise.all([
        loadTuttiAgentComposerOptions({
          runtime: this.localAgentRuntime,
          agentTargetId,
          cwd: context.cwd,
          signal: controller.signal,
          ...(context.model ? { model: context.model } : {}),
        }),
        loadTuttiAgentSkillContext({
          agentTargetId,
          agentSessionId: context.runId,
          cwd: context.cwd,
          signal: controller.signal,
        }),
      ]);
    } catch (error) {
      controller.abort();
      this.processes.delete(context.runId);
      throw error;
    }
    const model =
      context.model ??
      (composer.modelConfig.currentValue || composer.modelConfig.defaultValue || undefined);
    const permissionMode = composer.permissionConfig.modes.find(
      (mode) => mode.id === composer.permissionConfig.defaultValue,
    );
    const systemPrompt = [
      buildResearchSystemPrompt(context),
      tuttiSkills.recommendedSystemPrompt?.content,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const initialState = await inspectResearchStageState(context.cwd);
      let checkpointPath = initialState.checkpointPath;
      const retryingCollection = initialState.rollbackGapPath !== null;
      const stages =
        checkpointPath && !retryingCollection
          ? (["stage2"] as const)
          : (["stage1", "stage2"] as const);
      for (const stage of stages) {
        controller.signal.throwIfAborted();
        if (stage === "stage2") {
          checkpointPath = await requireUniqueStage1Checkpoint(context.cwd, true);
          if (!checkpointPath) {
            throw new Error(
              "Stage 1 did not produce checkpoint_stage1.md; Stage 2 was not started.",
            );
          }
          await clearStaleStage2Outputs(dirname(checkpointPath));
        }
        const stageRunId = `${context.runId}:${stage}`;
        activeStageRunId = stageRunId;
        let terminalStatus: string | undefined;
        for await (const event of this.localAgentRuntime.run({
          runId: stageRunId,
          conversationId: `${context.sessionId}:${stageRunId}`,
          sessionId: stageRunId,
          provider: providerId,
          runtimeKind: "local-agent",
          runtimeProvider: providerId,
          cwd: context.cwd,
          prompt:
            stage === "stage1"
              ? buildStage1Prompt(context, initialState.rollbackGapPath)
              : buildStage2Prompt(context, checkpointPath!),
          systemPrompt,
          model: model ? stripProviderPrefix(model, providerId) : undefined,
          reasoning:
            composer.reasoningConfig.currentValue ||
            composer.reasoningConfig.defaultValue ||
            undefined,
          permission: permissionMode
            ? { modeId: permissionMode.id, semantic: permissionMode.semantic }
            : undefined,
          ...(stage === "stage1" && context.history.length > 0 ? { history: context.history } : {}),
          skillManifest: [...tuttiSkills.skillManifest, context.skill],
          env: {
            PRODUCT_SWIPEFILE_PYTHON: context.pythonBin,
          },
          timeoutMs: Number(
            process.env.PRODUCT_COMPETITION_LOCAL_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
          ),
          extraAllowedDirs: [context.cwd],
          resume: { mode: "fresh" },
          signal: controller.signal,
        })) {
          const runtimeEvent = toRuntimeStreamEvent(event);
          if (runtimeEvent) {
            yield runtimeEvent;
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "done") {
            terminalStatus = event.status;
          }
        }
        if (terminalStatus !== "completed") {
          throw new Error(
            `local-agent ${agentTargetId} ended ${stage} with status ${terminalStatus ?? "unknown"}`,
          );
        }
        if (stage === "stage1") {
          checkpointPath = await requireUniqueStage1Checkpoint(context.cwd, false);
          if (!checkpointPath) {
            const state = await inspectResearchStageState(context.cwd);
            if (!state.hasResearchArtifacts) {
              // A conversational turn may correctly finish without starting a
              // research run. In that case there is no Stage 2 to launch.
              return;
            }
            throw new Error(
              "Stage 1 created research artifacts but did not produce checkpoint_stage1.md; Stage 2 was not started.",
            );
          }
        }
        if (stage === "stage2") {
          const artifactDir = dirname(checkpointPath!);
          const gapPath = join(artifactDir, "stage2_collection_gap.md");
          if (await isNonEmptyRegularFile(gapPath)) {
            throw new Error(
              "Stage 2 reported an essential evidence gap. The next retry will return to Stage 1 collection.",
            );
          }
          if (!(await hasCompleteStage2Outputs(artifactDir))) {
            throw new Error(
              "Stage 2 did not produce non-empty report.md and checkpoint_stage2.md files; the research run was not completed.",
            );
          }
        }
      }
    } finally {
      activeStageRunId = null;
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
    return {
      type: "tool_call",
      id: event.id,
      name: event.name || "unknown_tool",
      input: event.input,
    };
  }
  if (event.type === "tool_result") {
    const toolResult = event as AgentEvent & {
      output?: unknown;
      result?: unknown;
      content?: unknown;
    };
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

const STAGE_SCAN_SKIP_DIRS = new Set([".local-agent", "node_modules", ".git"]);
const RESEARCH_ARTIFACT_NAMES = new Set([
  "run.json",
  "meta.json",
  "inventory.md",
  "checkpoint_stage1.md",
  "stage2_collection_gap.md",
  "report.md",
]);

export interface ResearchStageState {
  checkpointPath: string | null;
  rollbackGapPath: string | null;
  hasResearchArtifacts: boolean;
}

/** Inspect host-visible stage markers without blocking the server event loop. */
export async function inspectResearchStageState(root: string): Promise<ResearchStageState> {
  const checkpoints: string[] = [];
  const rollbackGaps: string[] = [];
  let hasResearchArtifacts = false;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isFile()) {
        if (RESEARCH_ARTIFACT_NAMES.has(entry.name)) hasResearchArtifacts = true;
        if (entry.name === "checkpoint_stage1.md") checkpoints.push(absolutePath);
        if (entry.name === "stage2_collection_gap.md") rollbackGaps.push(absolutePath);
      } else if (entry.isDirectory() && !STAGE_SCAN_SKIP_DIRS.has(entry.name)) {
        if (entry.name === "raw") hasResearchArtifacts = true;
        await walk(absolutePath, depth + 1);
      }
    }
  }

  await walk(root, 0);
  if (checkpoints.length > 1) {
    throw new Error("Multiple Stage 1 checkpoints were found in the run directory.");
  }
  if (rollbackGaps.length > 1) {
    throw new Error("Multiple Stage 2 collection-gap markers were found in the run directory.");
  }
  return {
    checkpointPath: checkpoints[0] ?? null,
    rollbackGapPath: rollbackGaps[0] ?? null,
    hasResearchArtifacts,
  };
}

async function requireUniqueStage1Checkpoint(
  root: string,
  required: boolean,
): Promise<string | null> {
  const state = await inspectResearchStageState(root);
  if (required && !state.checkpointPath) {
    throw new Error("Stage 1 did not produce checkpoint_stage1.md; Stage 2 was not started.");
  }
  if (state.checkpointPath && !(await isNonEmptyRegularFile(state.checkpointPath))) {
    throw new Error("Stage 1 produced an empty checkpoint_stage1.md; Stage 2 was not started.");
  }
  return state.checkpointPath;
}

async function clearStaleStage2Outputs(artifactDir: string): Promise<void> {
  await Promise.all(
    ["report.md", "checkpoint_stage2.md", "stage2_collection_gap.md"].map((name) =>
      unlink(join(artifactDir, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
    ),
  );
}

export async function hasCompleteStage2Outputs(artifactDir: string): Promise<boolean> {
  return (
    (await isNonEmptyRegularFile(join(artifactDir, "report.md"))) &&
    (await isNonEmptyRegularFile(join(artifactDir, "checkpoint_stage2.md")))
  );
}

async function isNonEmptyRegularFile(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await file.stat();
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function stripProviderPrefix(model: string, provider: string) {
  const prefix = `${provider}:`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
