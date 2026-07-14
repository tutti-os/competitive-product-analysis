import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchSystemPrompt,
  buildStage1Prompt,
  buildStage2Prompt,
} from "./research-prompt.js";
import type { ResearchRunContext } from "./runtime-provider.js";

test("host prompts enforce separate fresh collection and writing invocations", () => {
  const context = {
    runId: "run-1",
    sessionId: "session-1",
    prompt: "Research Example",
    history: [],
    cwd: "/tmp/research-run",
    agentSessionsDir: "/tmp/agent-sessions",
    skill: null,
    pythonBin: "python3",
    agentTargetId: "team:researcher",
    providerId: "shared-runtime",
  } satisfies ResearchRunContext;
  const prompt = buildResearchSystemPrompt(context);
  const stage1 = buildStage1Prompt(context);
  const rollbackStage1 = buildStage1Prompt(
    context,
    "/tmp/research-run/example/run/stage2_collection_gap.md",
  );
  const stage2 = buildStage2Prompt(context, "/tmp/research-run/checkpoint_stage1.md");

  assert.match(prompt, /exact Agent Target selected for this stage/);
  assert.match(prompt, /Do not execute the skill root `run\.py`/);
  assert.match(prompt, /do not invoke any agent-provider CLI/);
  assert.match(prompt, /Evidence tools such as opencli remain allowed/);
  assert.match(prompt, /do not launch any other provider-specific or nested agent process/);
  assert.match(prompt, /use only the provider-agnostic .*research_helper\.py/);
  assert.match(prompt, /separate fresh agent invocations/);
  assert.match(stage1, /stage1_collect_and_freeze/);
  assert.match(stage1, /Do not write report\.md/);
  assert.match(rollbackStage1, /prior Stage 2 invocation recorded an essential evidence gap/);
  assert.match(rollbackStage1, /stage2_collection_gap\.md/);
  assert.match(stage2, /stage2_write_from_frozen_evidence/);
  assert.match(stage2, /This is a fresh Agent invocation/);
  assert.match(stage2, /Do not use WebSearch, WebFetch, opencli, conversation history/);
  assert.doesNotMatch(stage2, /<continuation>/);
});
