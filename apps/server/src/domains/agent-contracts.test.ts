import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { agentRunStartRequestSchema, cliResearchRequestSchema } from "@product-competition/shared";

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

test("rejects both canonical CLI aliases and blank exact targets", () => {
  assert.equal(
    cliResearchRequestSchema.safeParse({
      product: "Example",
      "agent-id": "team:researcher",
      agentTargetId: "team:reviewer",
    }).success,
    false,
  );
  assert.equal(
    cliResearchRequestSchema.safeParse({ product: "Example", "agent-id": "  " }).success,
    false,
  );
  assert.equal(
    agentRunStartRequestSchema.safeParse({
      type: "start",
      sessionId: "session-1",
      prompt: "Research Example",
      agentTargetId: "  ",
    }).success,
    false,
  );
  assert.equal(
    cliResearchRequestSchema.safeParse({ product: "Example", provider: "  " }).success,
    false,
  );
  assert.equal(
    agentRunStartRequestSchema.safeParse({
      type: "start",
      sessionId: "session-1",
      prompt: "Research Example",
      provider: "  ",
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

test("CLI manifest keeps selector validation in the runtime contract", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../../tutti.cli.json", import.meta.url), "utf8"),
  ) as {
    commands: Array<{
      path: string[];
      inputSchema: { properties: Record<string, Record<string, unknown>> };
    }>;
  };
  const research = manifest.commands.find((command) => command.path.join(" ") === "research");
  assert.ok(research);
  assert.equal(research.inputSchema.properties["agent-id"].type, "string");
  assert.equal(research.inputSchema.properties.provider.type, "string");
  assert.equal("pattern" in research.inputSchema.properties["agent-id"], false);
  assert.equal("minLength" in research.inputSchema.properties["agent-id"], false);
});
