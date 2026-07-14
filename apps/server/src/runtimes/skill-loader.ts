import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SKILL_SLUG = "product-swipefile";
const SKILL_MAIN = "SKILL.md";
/**
 * Provider-agnostic files worth materializing for the selected Agent Target.
 * The vendored root run.py launches a nested provider-specific process, so the
 * app intentionally excludes it and has the current target execute the stages.
 */
const INCLUDED_TOP_LEVEL = new Set(["references", "scripts"]);
const SKIP_DIR_NAMES = new Set(["__pycache__", ".git", "assets"]);

export interface SkillMaterializationFile {
  content: string;
  path: string;
}

export interface SkillMaterializationRecord {
  content?: string;
  files?: SkillMaterializationFile[];
  skillId: string;
  slug: string;
  materializedPath?: string;
  deliveryMode: "materialized-files" | "prompt-injection" | "project-instructions";
}

let cached: { dir: string; record: SkillMaterializationRecord } | null = null;

/**
 * Read the vendored product-swipefile skill into a kit SkillMaterializationRecord.
 * The kit writes SKILL.md + files into `<run cwd>/.local-agent/skills/<slug>/`
 * before launching the local agent. Provider-agnostic references and helper
 * scripts are available on disk; the provider-specific root run.py is omitted.
 */
export async function loadProductSwipefileSkill(
  skillDir: string,
): Promise<SkillMaterializationRecord> {
  if (cached && cached.dir === skillDir) {
    return cached.record;
  }

  const content = await readFile(path.join(skillDir, SKILL_MAIN), "utf8");
  const files: SkillMaterializationFile[] = [];

  for (const topLevel of await readdir(skillDir, { withFileTypes: true })) {
    if (topLevel.name === SKILL_MAIN) continue;
    if (!INCLUDED_TOP_LEVEL.has(topLevel.name)) continue;
    const absolute = path.join(skillDir, topLevel.name);
    if (topLevel.isDirectory()) {
      await collectFiles(absolute, topLevel.name, files);
    } else if (topLevel.isFile()) {
      files.push({ path: topLevel.name, content: await readFile(absolute, "utf8") });
    }
  }

  const record: SkillMaterializationRecord = {
    skillId: SKILL_SLUG,
    slug: SKILL_SLUG,
    deliveryMode: "materialized-files",
    content,
    files,
  };
  cached = { dir: skillDir, record };
  return record;
}

async function collectFiles(
  dir: string,
  relativeRoot: string,
  out: SkillMaterializationFile[],
): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolute, relative, out);
    } else if (entry.isFile()) {
      out.push({ path: relative, content: await readFile(absolute, "utf8") });
    }
  }
}

export { SKILL_SLUG };
