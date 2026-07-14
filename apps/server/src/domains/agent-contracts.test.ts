import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRunStartRequestSchema,
  cliResearchRequestSchema,
} from "@product-competition/shared";

test("normalizes canonical CLI agent-id input", () => {
  assert.deepEqual(
    cliResearchRequestSchema.parse({ product: "Example", "agent-id": "team:researcher" }),
    { product: "Example", agentId: "team:researcher" },
  );
});

test("keeps deprecated provider input for runtime uniqueness resolution", () => {
  assert.deepEqual(
    cliResearchRequestSchema.parse({ product: "Example", provider: "shared-runtime" }),
    { product: "Example", provider: "shared-runtime", agentId: undefined },
  );
});

test("rejects conflicting canonical and deprecated CLI selectors", () => {
  assert.equal(
    cliResearchRequestSchema.safeParse({
      product: "Example",
      "agent-id": "team:researcher",
      provider: "shared-runtime",
    }).success,
    false,
  );
});

test("rejects conflicting WebSocket selectors", () => {
  assert.equal(
    agentRunStartRequestSchema.safeParse({
      type: "start",
      sessionId: "session-1",
      prompt: "Research Example",
      agentTargetId: "team:researcher",
      provider: "shared-runtime",
    }).success,
    false,
  );
});
