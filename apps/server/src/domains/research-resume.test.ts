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
  assert.equal(
    await shouldResumeResearchRun(
      root,
      "Continue research Notion with more pricing evidence",
      "Research Notion",
    ),
    true,
  );
  assert.equal(await shouldResumeResearchRun(root, "Research Notion pricing", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Analyze Notion pricing", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "继续调研 Notion 的定价证据", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "继续补充 Notion 定价证据", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "继续调研Notion的定价证据", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "继续补充Notion更多定价证据", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Continue Notion's pricing research", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Please continue", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "请继续", "调研 Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Keep going", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Go on", "Research Notion"), true);
});

test("raw evidence metadata cannot replace the run product identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, "notion", "20260715");
  await mkdir(join(runDir, "raw"), { recursive: true });
  await writeFile(join(runDir, "meta.json"), JSON.stringify({ product: "Notion" }));
  await writeFile(join(runDir, "raw", "meta.json"), JSON.stringify({ product: "Cursor" }));

  assert.equal(await shouldResumeResearchRun(root, "Research Cursor", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue Notion pricing", "Research Notion"), true);
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
  assert.equal(await shouldResumeResearchRun(root, "Continue researching Cursor", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue analysis of Cursor", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Go", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Keep", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research More", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Report", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Complete", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Write", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Update", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Evidence", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue Go", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue More", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue Report", "Research Notion"), false);
  assert.equal(
    await shouldResumeResearchRun(root, "Research Notion Calendar", "Research Notion"),
    false,
  );
  assert.equal(
    await shouldResumeResearchRun(root, "继续调研 Notion Calendar", "Research Notion"),
    false,
  );
  assert.equal(
    await shouldResumeResearchRun(root, "继续补充 Notion Calendar", "Research Notion"),
    false,
  );
});

test("without metadata, resume requires the current and prior subject tokens to match", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "inventory.md"), "partial inventory\n");

  assert.equal(await shouldResumeResearchRun(root, "继续调研 Notion", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Notion", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Retry the Notion analysis", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Keep going", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Go on", "Research Notion"), true);
  assert.equal(await shouldResumeResearchRun(root, "Continue Report", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Report", "Research Notion"), false);
  assert.equal(await shouldResumeResearchRun(root, "Continue research Cursor", "Research Notion"), false);
  assert.equal(
    await shouldResumeResearchRun(root, "继续补充 Notion Calendar", "Research Notion"),
    false,
  );
});
