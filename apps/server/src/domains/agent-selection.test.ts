import assert from "node:assert/strict";
import test from "node:test";

import { resolveInitialAgentSelection, type AgentTargetSummary } from "@product-competition/shared";

function agent(
  agentTargetId: string,
  providerId: string,
  status: AgentTargetSummary["status"] = "ready",
  models: string[] = [],
): AgentTargetSummary {
  return {
    agentTargetId,
    providerId,
    provider: providerId,
    label: agentTargetId,
    detected: status === "ready",
    supported: status !== "unsupported",
    status,
    models,
  };
}

test("legacy provider migration fails closed when the full catalog is ambiguous", () => {
  const agents = [
    agent("team:ready", "shared-runtime"),
    agent("team:offline", "shared-runtime", "not-installed"),
    agent("team:default", "other-runtime"),
  ];

  assert.equal(
    resolveInitialAgentSelection(agents, "team:default", {
      provider: "shared-runtime",
      model: "legacy-model",
    }),
    null,
  );
});

test("an unavailable unique legacy provider fails closed instead of selecting a default", () => {
  const agents = [
    agent("team:offline", "shared-runtime", "not-installed"),
    agent("team:default", "other-runtime"),
  ];

  assert.equal(
    resolveInitialAgentSelection(agents, "team:default", {
      provider: "shared-runtime",
      model: "legacy-model",
    }),
    null,
  );
});

test("legacy provider migration accepts one full-catalog match only when ready", () => {
  const agents = [agent("team:only", "single-runtime", "ready", ["chosen-model"])];
  assert.deepEqual(
    resolveInitialAgentSelection(agents, null, {
      provider: "single-runtime",
      model: "chosen-model",
    }),
    { agentTargetId: "team:only", model: "chosen-model" },
  );
});

test("an unavailable stored exact target fails closed instead of selecting a default", () => {
  const agents = [
    agent("team:offline", "shared-runtime", "not-installed"),
    agent("team:default", "other-runtime"),
  ];

  assert.equal(
    resolveInitialAgentSelection(agents, "team:default", {
      agentTargetId: "team:offline",
      model: "legacy-model",
    }),
    null,
  );
});

test("an unknown stored exact target fails closed instead of using legacy provider", () => {
  const agents = [agent("team:default", "shared-runtime")];

  assert.equal(
    resolveInitialAgentSelection(agents, "team:default", {
      agentTargetId: "team:removed",
      provider: "shared-runtime",
    }),
    null,
  );
});

test("stored models are kept only when advertised by the exact target", () => {
  const agents = [agent("team:default", "shared-runtime", "ready", ["supported-model"])];

  assert.deepEqual(
    resolveInitialAgentSelection(agents, "team:default", {
      agentTargetId: "team:default",
      model: "removed-model",
    }),
    { agentTargetId: "team:default", model: "" },
  );
});
