import { createDefaultLocalAgentRuntime } from "@tutti-os/agent-acp-kit";
import {
  loadTuttiAgentCatalog,
  loadTuttiAgentComposerOptions,
} from "@tutti-os/agent-acp-kit/tutti";
import type { AgentTargetSummary } from "@product-competition/shared";

export type AgentCatalog = {
  defaultAgentTargetId: string | null;
  agents: AgentTargetSummary[];
};

export type AgentSelectionResolution =
  | { ok: true; agent: AgentTargetSummary }
  | {
      ok: false;
      code: "agent_unknown" | "provider_unknown" | "provider_ambiguous" | "agent_unavailable";
      requested: string | null;
      matches?: string[];
      reason?: string;
    };

const runtime = createDefaultLocalAgentRuntime();
const DETECTION_TTL_MS = 30_000;
let detectionCache: { at: number; value: AgentCatalog } | null = null;
let detectionInFlight: Promise<AgentCatalog> | null = null;

export async function detectAgentCatalog(
  options: { maxAgeMs?: number } = {},
): Promise<AgentCatalog> {
  const maxAgeMs = options.maxAgeMs ?? DETECTION_TTL_MS;
  if (detectionCache && Date.now() - detectionCache.at <= maxAgeMs) {
    return detectionCache.value;
  }
  if (!detectionInFlight) {
    detectionInFlight = runDetection()
      .then((value) => {
        detectionCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        detectionInFlight = null;
      });
  }
  return detectionInFlight;
}

export function warmAgentCatalog(): void {
  void detectAgentCatalog({ maxAgeMs: 0 }).catch(() => undefined);
}

/**
 * Resolve the canonical target first. The deprecated provider path is allowed
 * only when the complete catalog proves that exactly one target uses it.
 */
export function resolveAgentSelection(
  catalog: AgentCatalog,
  input: { agentTargetId?: string | null; provider?: string | null; requireReady?: boolean },
): AgentSelectionResolution {
  const requestedTarget = input.agentTargetId?.trim();
  const requestedProvider = input.provider?.trim();
  let agent: AgentTargetSummary | undefined;

  if (requestedTarget) {
    agent = catalog.agents.find((item) => item.agentTargetId === requestedTarget);
    if (!agent) return { ok: false, code: "agent_unknown", requested: requestedTarget };
  } else if (requestedProvider) {
    const matches = catalog.agents.filter((item) => item.providerId === requestedProvider);
    if (matches.length === 0) {
      return { ok: false, code: "provider_unknown", requested: requestedProvider };
    }
    if (matches.length !== 1) {
      return {
        ok: false,
        code: "provider_ambiguous",
        requested: requestedProvider,
        matches: matches.map((item) => item.agentTargetId),
      };
    }
    agent = matches[0];
  } else {
    agent = catalog.agents.find((item) => item.agentTargetId === catalog.defaultAgentTargetId);
  }

  if (!agent) return { ok: false, code: "agent_unknown", requested: null };
  if (input.requireReady !== false && agent.status !== "ready") {
    return {
      ok: false,
      code: "agent_unavailable",
      requested: agent.agentTargetId,
      reason: agent.reason,
    };
  }
  return { ok: true, agent };
}

export function agentSelectionErrorMessage(
  selection: Exclude<AgentSelectionResolution, { ok: true }>,
): string {
  if (selection.code === "agent_unknown" && selection.requested) {
    return `Agent target "${selection.requested}" was not found. Refresh the Agent list and retry.`;
  }
  if (selection.code === "provider_unknown" && selection.requested) {
    return `Provider "${selection.requested}" does not map to a current Agent Target.`;
  }
  if (selection.code === "provider_ambiguous") {
    return `Provider "${selection.requested}" maps to multiple agents. Select an exact Agent Target.`;
  }
  return (
    selection.reason ?? "No ready Tutti agent is available. Check the agent manager and retry."
  );
}

async function runDetection(): Promise<AgentCatalog> {
  try {
    const detectionsPromise = runtime.detect();
    const catalogRuntime = {
      listProviders: () => runtime.listProviders(),
      detect: () => detectionsPromise,
    } as typeof runtime;
    const [catalog, detections] = await Promise.all([
      loadTuttiAgentCatalog({ runtime: catalogRuntime }),
      detectionsPromise,
    ]);
    const detectionByProvider = new Map(
      detections.map((detection) => [detection.provider, detection]),
    );
    const agents = await Promise.all(
      catalog.agents.map(async (agent) => {
        const detection = detectionByProvider.get(agent.providerId);
        const detected = runtimeWasDetected(
          agent.availability.reasonCode,
          detection?.reason,
          Boolean(detection),
        );
        const supported = agent.runtimeSupported && detection?.supported !== false;
        const authenticated =
          detection?.authState !== "missing" && detection?.authState !== "expired";
        const ready =
          detected && supported && authenticated && agent.availability.status === "available";
        let models: string[] = [];
        let composerError: string | undefined;
        if (ready) {
          try {
            const composer = await loadTuttiAgentComposerOptions({
              runtime,
              agentTargetId: agent.agentTargetId,
            });
            models = [
              ...new Set(
                [
                  ...composer.modelConfig.options.map((model) => model.value),
                  composer.modelConfig.currentValue,
                  composer.modelConfig.defaultValue,
                ].filter(Boolean),
              ),
            ];
          } catch (error) {
            composerError =
              error instanceof Error ? error.message : "Target composer options are unavailable.";
          }
        }
        const targetReady = ready && !composerError;
        return {
          agentTargetId: agent.agentTargetId,
          providerId: agent.providerId,
          provider: agent.providerId,
          label: agent.displayName,
          detected,
          supported: supported && !composerError,
          status: targetReady
            ? "ready"
            : agent.runtimeSupported && !detected
              ? "not-installed"
              : "unsupported",
          models,
          reason:
            composerError ||
            agent.availability.detail ||
            detection?.reason ||
            (detection?.authState === "missing"
              ? "Agent runtime detected but authentication is missing."
              : undefined),
        } satisfies AgentTargetSummary;
      }),
    );
    const preferred = agents.find(
      (agent) => agent.agentTargetId === catalog.defaultAgentTargetId && agent.status === "ready",
    );
    return {
      defaultAgentTargetId:
        preferred?.agentTargetId ??
        agents.find((agent) => agent.status === "ready")?.agentTargetId ??
        null,
      agents,
    };
  } catch {
    return { defaultAgentTargetId: null, agents: [] };
  }
}

export function runtimeWasDetected(
  availabilityReasonCode: string | undefined,
  detectionReason: string | undefined,
  hasDetection: boolean,
): boolean {
  if (!hasDetection) return false;
  const code = availabilityReasonCode?.trim().toLowerCase() ?? "";
  if (
    code === "runtime_not_detected" ||
    code === "cli_not_found" ||
    code.includes("not_installed") ||
    code.includes("executable_not_found")
  ) {
    return false;
  }
  const reason = detectionReason?.trim().toLowerCase() ?? "";
  return !(
    reason.includes("executable not found") ||
    reason.includes("executable was not found") ||
    reason.includes("runtime was not detected") ||
    reason.includes("runtime is not installed")
  );
}
