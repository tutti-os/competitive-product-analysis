import { createDefaultLocalAgentRuntime } from "@tutti-os/agent-acp-kit";
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
  if (selection.code === "provider_ambiguous" && selection.requested) {
    return `Provider "${selection.requested}" maps to multiple agents. Select an exact Agent Target.`;
  }
  return (
    selection.reason ?? "No ready Tutti agent is available. Check the agent manager and retry."
  );
}

async function runDetection(): Promise<AgentCatalog> {
  try {
    const detections = await runtime.detect();
    const projected = detections.flatMap((detection) => {
      const agentTargetId = detection.agentTargetId?.trim();
      if (!agentTargetId) return [];
      const authenticated =
        detection.authState !== "missing" && detection.authState !== "expired";
      const ready = detection.supported && authenticated;
      const detected = detection.supported || Boolean(detection.executablePath);
      return [{
        agent: {
          agentTargetId,
          providerId: String(detection.provider),
          provider: String(detection.provider),
          label: detection.displayName,
          detected,
          supported: detection.supported,
          status: ready ? "ready" : detected ? "unsupported" : "not-installed",
          models: detection.models.map((model) => model.id),
          ...(detection.reason ? { reason: detection.reason } : {}),
        } satisfies AgentTargetSummary,
        isDefault: detection.isDefault === true,
      }];
    });
    const agents = projected.map((entry) => entry.agent);
    const preferred = projected.find(
      (entry) => entry.isDefault && entry.agent.status === "ready",
    )?.agent;
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
