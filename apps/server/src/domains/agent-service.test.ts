import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTargetSummary } from "@product-competition/shared";

import {
  agentSelectionErrorMessage,
  resolveAgentSelection,
  runtimeWasDetected,
  type AgentCatalog,
} from "./agent-service.js";

function agent(agentTargetId: string, providerId: string): AgentTargetSummary {
  return {
    agentTargetId,
    providerId,
    label: agentTargetId,
    detected: true,
    supported: true,
    status: "ready",
    models: [],
  };
}

const catalog: AgentCatalog = {
  defaultAgentTargetId: "team:primary",
  agents: [
    agent("team:primary", "shared-runtime"),
    agent("team:reviewer", "shared-runtime"),
    agent("local:other", "other-runtime"),
  ],
};

test("resolves an exact Agent Target without collapsing shared providers", () => {
  assert.deepEqual(resolveAgentSelection(catalog, { agentTargetId: "team:reviewer" }), {
    ok: true,
    agent: catalog.agents[1],
  });
});

test("fails closed when a deprecated provider maps to multiple targets", () => {
  assert.deepEqual(resolveAgentSelection(catalog, { provider: "shared-runtime" }), {
    ok: false,
    code: "provider_ambiguous",
    requested: "shared-runtime",
    matches: ["team:primary", "team:reviewer"],
  });
});

test("accepts a deprecated provider only when the complete catalog mapping is unique", () => {
  assert.deepEqual(resolveAgentSelection(catalog, { provider: "other-runtime" }), {
    ok: true,
    agent: catalog.agents[2],
  });
});

test("uses the explicit default Agent Target when no override is provided", () => {
  assert.deepEqual(resolveAgentSelection(catalog, {}), {
    ok: true,
    agent: catalog.agents[0],
  });
});

test("reports actionable exact-target and ambiguous-provider errors", () => {
  assert.match(
    agentSelectionErrorMessage({
      ok: false,
      code: "agent_unknown",
      requested: "team:removed",
    }),
    /Refresh the Agent list/,
  );
  assert.match(
    agentSelectionErrorMessage({
      ok: false,
      code: "provider_ambiguous",
      requested: "shared-runtime",
      matches: ["team:primary", "team:reviewer"],
    }),
    /exact Agent Target/,
  );
});

test("runtime detection recognizes explicit unavailable reason codes and text", () => {
  assert.equal(runtimeWasDetected("runtime_not_detected", undefined, true), false);
  assert.equal(runtimeWasDetected(undefined, "Executable was not found on PATH", true), false);
  assert.equal(runtimeWasDetected(undefined, undefined, false), false);
  assert.equal(runtimeWasDetected(undefined, "Authentication is missing", true), true);
});
