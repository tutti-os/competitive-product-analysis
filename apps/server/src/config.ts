import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";

export type AppRuntimePaths = {
  dataDir: string;
  logDir: string;
  packageDir: string;
  runtimeDir: string;
  /** dataDir/sessions — per-session messages, artifacts, and run workspaces. */
  sessionsDir: string;
  /** dataDir/sessions/index.json — the session index. */
  sessionsIndexFile: string;
  /** dataDir/agent-sessions — local-agent resume tokens keyed by session id. */
  agentSessionsDir: string;
  /** Vendored product-swipefile skill directory, or null when missing. */
  skillDir: string | null;
  webDistDir: string | null;
  workspaceRoot: string | null;
};

export type AppRuntimeConfig = {
  baseUrl: string | null;
  host: string;
  paths: AppRuntimePaths;
  port: number;
  /** Python interpreter the agent should use to drive the skill scripts. */
  pythonBin: string;
};

export async function createRuntimeConfig(): Promise<AppRuntimeConfig> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = process.env.TUTTI_APP_PACKAGE_DIR ?? path.resolve(currentDir, "../../..");
  const repoGeneratedDir = path.resolve(packageDir, "generated");
  const runtimeDir = process.env.TUTTI_APP_RUNTIME_DIR ?? path.join(repoGeneratedDir, "runtime");
  const dataDir = process.env.TUTTI_APP_DATA_DIR ?? path.join(repoGeneratedDir, "data");
  const logDir = process.env.TUTTI_APP_LOG_DIR ?? path.join(repoGeneratedDir, "logs");
  const workspaceRoot = process.env.TUTTI_WORKSPACE_ROOT ?? null;
  const sessionsDir = path.join(dataDir, "sessions");
  const sessionsIndexFile = path.join(sessionsDir, "index.json");
  const agentSessionsDir = path.join(dataDir, "agent-sessions");
  const webDistDir = await resolveWebDistDir(currentDir);
  const skillDir = await resolveSkillDir(currentDir, packageDir);

  await Promise.all([
    mkdir(runtimeDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(sessionsDir, { recursive: true }),
    mkdir(agentSessionsDir, { recursive: true }),
  ]);

  const host = process.env.TUTTI_APP_HOST ?? "127.0.0.1";
  const port = Number(process.env.TUTTI_APP_PORT ?? "4310");

  return {
    host,
    port,
    baseUrl: process.env.TUTTI_APP_BASE_URL ?? null,
    pythonBin: process.env.TUTTI_APP_PYTHON ?? "python3",
    paths: {
      dataDir,
      logDir,
      packageDir,
      runtimeDir,
      sessionsDir,
      sessionsIndexFile,
      agentSessionsDir,
      skillDir,
      webDistDir,
      workspaceRoot,
    },
  };
}

async function resolveWebDistDir(currentDir: string): Promise<string | null> {
  const candidates = [
    process.env.CR_WEB_DIST_DIR,
    path.resolve(currentDir, "../web"),
    path.resolve(currentDir, "../../web/dist"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "index.html"), constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveSkillDir(currentDir: string, packageDir: string): Promise<string | null> {
  const candidates = [
    process.env.PRODUCT_SWIPEFILE_SKILL_DIR,
    // dev (tsx, src layout): apps/server/src -> apps/server/skills
    path.resolve(currentDir, "../skills/product-swipefile"),
    // bundled (esbuild): apps/server/dist/server.js -> apps/server/dist/skills
    path.resolve(currentDir, "skills/product-swipefile"),
    // packaged Tutti app: package/server/server.js -> package/server/skills
    path.resolve(packageDir, "server/skills/product-swipefile"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "SKILL.md"), constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}
