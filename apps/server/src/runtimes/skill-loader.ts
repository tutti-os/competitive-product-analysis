import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SKILL_SLUG = "product-swipefile";
const SKILL_MAIN = "SKILL.md";
/** Folders worth materializing for the agent; assets/docs are skipped. */
const INCLUDED_TOP_LEVEL = new Set(["references", "scripts", "run.py"]);
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
 * before launching the local agent, so the skill (including its Python helper
 * scripts) is available on disk for the duration of the run.
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
