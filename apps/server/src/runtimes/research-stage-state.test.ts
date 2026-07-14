import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hasCompleteStage2Outputs,
  inspectResearchStageState,
} from "./local-agent-provider.js";

test("stage inspection discovers one checkpoint and a collection rollback marker", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, "notion", "20260715");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "checkpoint_stage1.md"), "frozen inventory\n");
  await writeFile(join(runDir, "stage2_collection_gap.md"), "missing pricing evidence\n");

  const state = await inspectResearchStageState(root);
  assert.equal(state.checkpointPath, join(runDir, "checkpoint_stage1.md"));
  assert.equal(state.rollbackGapPath, join(runDir, "stage2_collection_gap.md"));
  assert.equal(state.hasResearchArtifacts, true);
});

test("stage inspection ignores the materialized skill and rejects ambiguous checkpoints", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".local-agent"), { recursive: true });
  await writeFile(join(root, ".local-agent", "checkpoint_stage1.md"), "template\n");
  assert.deepEqual(await inspectResearchStageState(root), {
    checkpointPath: null,
    rollbackGapPath: null,
    hasResearchArtifacts: false,
  });

  await mkdir(join(root, "one"));
  await mkdir(join(root, "two"));
  await writeFile(join(root, "one", "checkpoint_stage1.md"), "one\n");
  await writeFile(join(root, "two", "checkpoint_stage1.md"), "two\n");
  await assert.rejects(
    inspectResearchStageState(root),
    /Multiple Stage 1 checkpoints were found/,
  );
});

test("stage 2 completion requires non-empty regular files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "competitive-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "report.md"), "");
  await mkdir(join(root, "checkpoint_stage2.md"));
  assert.equal(await hasCompleteStage2Outputs(root), false);

  await rm(join(root, "checkpoint_stage2.md"), { recursive: true });
  await writeFile(join(root, "report.md"), "# Report\n");
  await writeFile(join(root, "checkpoint_stage2.md"), "validated\n");
  assert.equal(await hasCompleteStage2Outputs(root), true);
});
