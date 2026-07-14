import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { shouldResumeResearchRun } from "./research-run-service.js";

test("resume accepts exact retries, explicit continuations, and the same recorded product", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, "notion", "20260715");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "meta.json"), JSON.stringify({ product: "Notion" }));

  assert.equal(await shouldResumeResearchRun(root, "Research Notion", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "继续补齐定价证据", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Retry the Notion analysis", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Notion", "Research Notion"), true);
});

test("a different or unknown product starts in a fresh working directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, "notion", "20260715");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "meta.json"), JSON.stringify({ product: "Notion" }));

  assert.equal(await shouldResumeResearchRun(root, "Research Cursor", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "What about Linear?", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "继续调研 Cursor", "Research Notion"), false);
  assert.equal(
    await shouldResumeResearchRun(root, "Research Notion Calendar", "Research Notion"),
    false,
  );
});
