import type { AgentTargetSummary } from "./contracts.js";

export interface AgentSelectionValue {
  agentTargetId: string;
  model: string;
}

/**
 * Resolve persisted UI selection without ever collapsing the full target
 * catalog by provider. The provider branch exists only for one-time migration
 * of the pre-agent-id localStorage shape.
 */
export function resolveInitialAgentSelection(
  agents: AgentTargetSummary[],
  defaultAgentTargetId: string | null,
  storedValue?: unknown,
): AgentSelectionValue | null {
  const ready = agents.filter((agent) => agent.status === "ready");
  if (isRecord(storedValue)) {
    const agentTargetId = optionalString(storedValue.agentTargetId);
    const selected = ready.find((agent) => agent.agentTargetId === agentTargetId);
    if (selected) {
      return { agentTargetId: selected.agentTargetId, model: optionalString(storedValue.model) ?? "" };
    }

    const legacyProvider = optionalString(storedValue.provider);
    if (legacyProvider) {
      // Count against every catalog entry, including unavailable targets. A
      // ready-only projection could turn an ambiguous provider into a false
      // unique match and silently select the wrong agent.
      const matches = agents.filter((agent) => agent.providerId === legacyProvider);
      if (matches.length === 1 && matches[0].status === "ready") {
        return {
          agentTargetId: matches[0].agentTargetId,
          model: optionalString(storedValue.model) ?? "",
        };
      }
    }
  }

  const defaultAgent = ready.find((agent) => agent.agentTargetId === defaultAgentTargetId);
  return defaultAgent
    ? { agentTargetId: defaultAgent.agentTargetId, model: "" }
    : ready[0]
      ? { agentTargetId: ready[0].agentTargetId, model: "" }
      : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}
