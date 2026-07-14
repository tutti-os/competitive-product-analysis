import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInitialAgentSelection,
  type AgentTargetSummary,
} from "@product-competition/shared";

function agent(
  agentTargetId: string,
  providerId: string,
  status: AgentTargetSummary["status"] = "ready",
): AgentTargetSummary {
  return {
    agentTargetId,
    providerId,
    provider: providerId,
    label: agentTargetId,
    detected: status === "ready",
    supported: status !== "unsupported",
    status,
    models: [],
  };
}

test("legacy provider migration counts unavailable targets when checking uniqueness", () => {
  const agents = [
    agent("team:ready", "shared-runtime"),
    agent("team:offline", "shared-runtime", "not-installed"),
    agent("team:default", "other-runtime"),
  ];

  assert.deepEqual(
    resolveInitialAgentSelection(agents, "team:default", {
      provider: "shared-runtime",
      model: "legacy-model",
    }),
    { agentTargetId: "team:default", model: "" },
  );
});

test("legacy provider migration accepts one full-catalog match only when ready", () => {
  const agents = [agent("team:only", "single-runtime")];
  assert.deepEqual(
    resolveInitialAgentSelection(agents, null, {
      provider: "single-runtime",
      model: "chosen-model",
    }),
    { agentTargetId: "team:only", model: "chosen-model" },
  );
});
