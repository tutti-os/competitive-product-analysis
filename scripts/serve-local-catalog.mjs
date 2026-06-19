// Serves a local Tutti app catalog (group-chat / DistributionRemote style) so the
// desktop App Center can install "product-competition" without embedding it into tuttid.
//
// What it does:
//   1. Ensures the packaged app artifact exists (build/tutti-app/product-competition-0.2.0.zip).
//   2. Stages a CDN-like directory: build/local-catalog/apps/<appId>/<version>/{zip,icon}.
//   3. Computes the artifact sha256 + size and writes catalog.json (schema tutti.app.catalog.v1).
//   4. Merges the official remote catalog so other recommended apps (group-chat, etc.) stay visible.
//   5. Serves everything over http://127.0.0.1:<port> for tuttid to fetch.
//
// Point tuttid at it via:  export TUTTI_APP_CATALOG_URL=http://127.0.0.1:<port>/catalog.json
//
// Usage:
//   node scripts/serve-local-catalog.mjs            # reuse existing build, serve on :4555
//   PORT=5000 node scripts/serve-local-catalog.mjs  # custom port
//   node scripts/serve-local-catalog.mjs --rebuild  # force re-package before serving

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const appId = "product-competition";
const version = "0.2.0";

const rootDir = path.resolve(import.meta.dirname, "..");
const buildRoot = path.join(rootDir, "build", "tutti-app");
const packageRoot = path.join(buildRoot, "package");
const zipPath = path.join(buildRoot, `${appId}-${version}.zip`);
const iconPath = path.join(rootDir, "icon.svg");
const manifestPath = path.join(rootDir, "tutti.app.json");

const serveDir = path.join(rootDir, "build", "local-catalog");
const releaseRel = `apps/${appId}/${version}`;
const artifactName = `${appId}-${version}.zip`;
const iconName = "icon.svg";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4555", 10);
const officialCatalogURL =
  process.env.TUTTI_OFFICIAL_CATALOG_URL?.trim() ||
  "https://d1x7gb6wqsqmnm.cloudfront.net/tutti-app-releases/catalog.json";
const forceRebuild = process.argv.includes("--rebuild");

await main();

async function main() {
  await ensureArtifact();
  await stageReleaseFiles();
  const { sha256, size } = await fileDigestAndSize(zipPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const base = `http://${host}:${port}`;

  const localEntry = {
    manifest,
    distribution: {
      kind: "remote",
      artifactUrl: `${base}/${releaseRel}/${artifactName}`,
      artifactSha256: sha256,
      iconUrl: `${base}/${releaseRel}/${iconName}`,
    },
  };

  const apps = await mergeWithOfficialCatalog(localEntry);
  const catalog = { schemaVersion: "tutti.app.catalog.v1", apps };
  await writeFile(
    path.join(serveDir, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );

  startServer(base, sha256, size, apps.length);
}

async function ensureArtifact() {
  const haveZip = !forceRebuild && (await exists(zipPath));
  if (haveZip) {
    return;
  }
  console.log(
    forceRebuild
      ? "[catalog] --rebuild requested, repackaging app..."
      : "[catalog] artifact not found, packaging app (pnpm build)...",
  );
  await run("node", [path.join("scripts", "package-tutti-app.mjs")], rootDir);
}

async function stageReleaseFiles() {
  await rm(serveDir, { recursive: true, force: true });
  const releaseDir = path.join(serveDir, releaseRel);
  await mkdir(releaseDir, { recursive: true });
  await cp(zipPath, path.join(releaseDir, artifactName));
  // Prefer the packaged icon (kept identical), fall back to the source icon.
  const packagedIcon = path.join(packageRoot, "icon.svg");
  const iconSource = (await exists(packagedIcon)) ? packagedIcon : iconPath;
  await cp(iconSource, path.join(releaseDir, iconName));
}

async function mergeWithOfficialCatalog(localEntry) {
  try {
    const response = await fetch(officialCatalogURL, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const official = await response.json();
    const others = Array.isArray(official?.apps)
      ? official.apps.filter((app) => app?.manifest?.appId !== appId)
      : [];
    console.log(
      `[catalog] merged official catalog (${others.length} other app(s) kept).`,
    );
    return sortByAppId([...others, localEntry]);
  } catch (error) {
    console.warn(
      `[catalog] WARNING: could not fetch official catalog (${error.message}).`,
    );
    console.warn(
      "[catalog] Serving local-only catalog. Other recommended apps (group-chat, etc.) will be hidden while TUTTI_APP_CATALOG_URL points here.",
    );
    return [localEntry];
  }
}

function sortByAppId(apps) {
  return [...apps].sort((left, right) =>
    String(left.manifest.appId).localeCompare(String(right.manifest.appId)),
  );
}

function startServer(base, sha256, size, appCount) {
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(`internal error: ${error.message}`);
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[catalog] ERROR: port ${port} on ${host} is already in use.`);
      console.error("[catalog] Another catalog server is likely still running. Either:");
      console.error(`[catalog]   - stop it:    lsof -nP -iTCP:${port} -sTCP:LISTEN  then  kill <PID>`);
      console.error(`[catalog]   - use a port: PORT=4666 pnpm serve:catalog`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, host, () => {
    const sizeMb = (size / (1024 * 1024)).toFixed(2);
    console.log("");
    console.log("==================================================================");
    console.log(` Local Tutti app catalog is live (${appCount} app(s))`);
    console.log(` catalog : ${base}/catalog.json`);
    console.log(` artifact: ${base}/${releaseRel}/${artifactName} (${sizeMb} MB)`);
    console.log(` sha256  : ${sha256}`);
    console.log("------------------------------------------------------------------");
    console.log(" Point tuttid at this catalog, then restart the desktop dev app:");
    console.log("");
    console.log(`   export TUTTI_APP_CATALOG_URL=${base}/catalog.json`);
    console.log("");
    console.log(" Keep this process running while installing/opening the app.");
    console.log(" Press Ctrl+C to stop.");
    console.log("==================================================================");
  });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const relPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const target = path.join(serveDir, relPath);
  const normalized = path.normalize(target);
  if (!normalized.startsWith(serveDir)) {
    response.statusCode = 403;
    response.end("forbidden");
    return;
  }
  let fileStat;
  try {
    fileStat = await stat(normalized);
  } catch {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  if (!fileStat.isFile()) {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("Content-Type", contentTypeFor(normalized));
  response.setHeader("Content-Length", fileStat.size);
  response.setHeader("Cache-Control", "no-store");
  console.log(`[catalog] 200 ${relPath}`);
  createReadStream(normalized).pipe(response);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".zip")) {
    return "application/zip";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  return "application/octet-stream";
}

async function fileDigestAndSize(filePath) {
  const data = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    size: data.length,
  };
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}
