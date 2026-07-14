import type { SkillMaterializationRecord } from "./skill-loader.js";

export interface RuntimeHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Context for a single research turn. The agent drives the product-swipefile
 * skill from `cwd`, and any artifacts it writes there are captured afterwards.
 */
export interface ResearchRunContext {
  runId: string;
  sessionId: string;
  /** The user's chat message for this turn. */
  prompt: string;
  /** Prior turns in the conversation, oldest first. */
  history: RuntimeHistoryMessage[];
  /** Per-run working directory (durable, under the session's run store). */
  cwd: string;
  /** Directory where local-agent resume tokens are kept (keyed by session). */
  agentSessionsDir: string;
  /** The vendored skill, materialized into cwd by the kit before launch. */
  skill: SkillMaterializationRecord | null;
  /** Python interpreter the skill scripts should run with. */
  pythonBin: string;
  /** Exact Tutti agent target selected for this run. */
  agentTargetId?: string;
  /** Runtime metadata resolved from agentTargetId; never a selection identity. */
  providerId?: string;
  /** @deprecated Compatibility input, resolved only when unique in the catalog. */
  provider?: string;
  /** Requested model id. */
  model?: string;
  /**
   * True when `cwd` is the preserved working directory of a prior interrupted
   * run in this session. The agent should inspect it with `stage-status` and
   * continue from the next stage instead of starting a fresh run.
   */
  resuming?: boolean;
  signal?: AbortSignal;
}

export type RuntimeStreamEvent =
  | { type: "status"; message: string }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input?: unknown }
  | {
      type: "tool_result";
      id: string;
      name?: string;
      status?: "completed" | "failed";
      summary?: string;
      output?: unknown;
    }
  | { type: "file_write"; path: string }
  | { type: "stderr"; text: string };

export interface RuntimeRunDescriptor {
  agentTargetId: string;
  providerId: string;
  model: string;
}

export class RuntimeProviderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProviderUnsupportedError";
  }
}
