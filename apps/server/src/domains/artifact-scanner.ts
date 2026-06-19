import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";
import type { ArtifactKind, ResearchArtifact } from "@product-competition/shared";

import type { SessionStore } from "../local/session-store.js";

const SKIP_DIRS = new Set([".local-agent", "__pycache__", ".git", "node_modules"]);
const MAX_DEPTH = 6;

interface ScannedFile {
  absolutePath: string;
  basename: string;
  /** Directory depth from the run root (raw/ files are deeper). */
  inRaw: boolean;
}

export interface ScanResult {
  artifacts: ResearchArtifact[];
  productName: string | null;
  reportTitle: string | null;
}

/**
 * After a research run, walk the run cwd and index the skill's evidence-backed
 * artifacts (report.md / inventory.md / meta.json / checkpoints). The skill
 * materialization dir (.local-agent) is skipped.
 */
export async function scanRunArtifacts(
  cwd: string,
  sessionId: string,
  runId: string,
  store: SessionStore,
): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  await walk(cwd, 0, false, files);

  let productName: string | null = null;
  let reportTitle: string | null = null;

  // Pull product / title hints from any meta.json the skill produced.
  const metaFile = files.find((file) => file.basename === "meta.json");
  let metaSummary: string | undefined;
  if (metaFile) {
    try {
      const meta = JSON.parse(await readFile(metaFile.absolutePath, "utf8")) as Record<string, unknown>;
      productName = stringField(meta, "product") ?? productName;
      reportTitle = stringField(meta, "title") ?? reportTitle;
      metaSummary = stringField(meta, "summary");
    } catch {
      // Ignore malformed meta files.
    }
  }

  const now = new Date().toISOString();
  const artifacts: ResearchArtifact[] = [];

  for (const file of files) {
    const kind = classify(file.basename, file.inRaw);
    if (!kind) continue;

    const relativePath = store.toDataRelative(file.absolutePath);
    let size = 0;
    try {
      size = (await stat(file.absolutePath)).size;
    } catch {
      // Skip files that vanished mid-scan.
      continue;
    }

    // The raw evidence cache produces many zero-byte stubs (e.g. opencli runs
    // that returned nothing); skip them so they don't flood the artifact list.
    if (kind === "raw" && size === 0) continue;

    let title = file.basename;
    let summary: string | undefined;
    const isReport = kind === "report";
    if (isReport) {
      const heading = await firstHeading(file.absolutePath);
      title = reportTitle ?? heading ?? "Research report";
      reportTitle = title;
      summary = metaSummary;
    } else if (kind === "inventory") {
      title = "Evidence inventory";
    } else if (kind === "meta") {
      title = "Run metadata";
    } else if (kind === "checkpoint") {
      title = file.basename.replace(/\.md$/, "");
    } else if (kind === "raw") {
      // Keep the source path (e.g. "raw/web/lovart_home.html") as the title so
      // the cached evidence is traceable back to where it came from.
      title = toPosix(path.relative(cwd, file.absolutePath)) || file.basename;
    }

    artifacts.push({
      id: nanoid(),
      sessionId,
      runId,
      kind,
      title,
      relativePath,
      sizeBytes: size,
      createdAt: now,
      ...(isReport ? { isCanonical: true } : {}),
      ...(summary ? { summary } : {}),
    });
  }

  // Keep the canonical report first and push the raw evidence cache last so the
  // curated outputs (report / inventory / meta / checkpoints) stay on top.
  artifacts.sort((left, right) => artifactOrder(left) - artifactOrder(right));

  return { artifacts, productName, reportTitle };
}

async function walk(dir: string, depth: number, inRaw: boolean, out: ScannedFile[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, depth + 1, inRaw || entry.name === "raw", out);
    } else if (entry.isFile()) {
      out.push({ absolutePath: absolute, basename: entry.name, inRaw });
    }
  }
}

function classify(basename: string, inRaw: boolean): ArtifactKind | null {
  if (inRaw) return "raw"; // raw evidence cache (web/opencli/source_log) is surfaced too.
  if (basename === "report.md") return "report";
  if (basename === "inventory.md") return "inventory";
  if (basename === "meta.json") return "meta";
  if (/^checkpoint_stage\d\.md$/.test(basename)) return "checkpoint";
  return null;
}

const KIND_ORDER: Record<ArtifactKind, number> = {
  report: 0,
  inventory: 1,
  meta: 2,
  checkpoint: 3,
  other: 4,
  raw: 5,
};

function artifactOrder(artifact: ResearchArtifact): number {
  if (artifact.isCanonical) return -1;
  return KIND_ORDER[artifact.kind] ?? 4;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function firstHeading(absolutePath: string): Promise<string | null> {
  try {
    const text = await readFile(absolutePath, "utf8");
    const match = text.match(/^#\s+(.+)$/m);
    return match ? match[1]!.trim() : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
