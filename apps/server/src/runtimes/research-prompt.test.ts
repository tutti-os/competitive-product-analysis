import assert from "node:assert/strict";
import test from "node:test";

import { buildResearchSystemPrompt } from "./research-prompt.js";
import type { ResearchRunContext } from "./runtime-provider.js";

test("system prompt keeps the selected target in-process and forbids nested launchers", () => {
  const prompt = buildResearchSystemPrompt({
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
  } satisfies ResearchRunContext);

  assert.match(prompt, /exact Agent Target selected for this run/);
  assert.match(prompt, /Do not execute the skill root `run\.py`/);
  assert.match(prompt, /do not invoke any provider CLI/);
  assert.match(prompt, /do not launch any other provider-specific or nested agent process/);
  assert.match(prompt, /use only the provider-agnostic .*research_helper\.py/);
  assert.match(prompt, /Perform collection and writing directly with your current tools/);
});
