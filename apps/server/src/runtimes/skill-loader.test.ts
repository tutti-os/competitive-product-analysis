import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadProductSwipefileSkill } from "./skill-loader.js";

test("materializes provider-agnostic helpers but excludes the nested run.py launcher", async () => {
  const skillDir = await mkdtemp(path.join(tmpdir(), "product-swipefile-loader-"));
  try {
    await mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Fixture skill\n", "utf8");
    await writeFile(path.join(skillDir, "run.py"), "# provider-specific launcher\n", "utf8");
    await writeFile(
      path.join(skillDir, "scripts", "research_helper.py"),
      "# provider-agnostic helper\n",
      "utf8",
    );
    await writeFile(path.join(skillDir, "references", "writing.md"), "# Writing\n", "utf8");

    const record = await loadProductSwipefileSkill(skillDir);
    const paths = record.files?.map((file) => file.path) ?? [];

    assert.equal(paths.includes("run.py"), false);
    assert.equal(paths.includes("scripts/research_helper.py"), true);
    assert.equal(paths.includes("references/writing.md"), true);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
});
