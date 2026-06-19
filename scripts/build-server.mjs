import path from "node:path";
import { builtinModules } from "node:module";
import { cp, mkdir, rm } from "node:fs/promises";

import { build } from "esbuild";

const rootDir = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(rootDir, "apps", "server");
const outDir = path.join(serverDir, "dist");
const outFile = path.join(outDir, "server.js");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

await build({
  entryPoints: [path.join(serverDir, "src", "main.ts")],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  external: [...nodeBuiltins],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

// The product-swipefile skill is materialized into each run cwd at runtime, so
// it must ship as plain files next to the server bundle. config.ts resolves it
// relative to the running server file.
//
// Skip any `assets/` directory: the runtime skill loader (skill-loader.ts)
// only materializes SKILL.md + references/ + scripts/ + run.py and explicitly
// skips assets/, so the skill README's example images (~6.5MB) are dead weight
// in the package. Excluding them keeps the runtime package small.
await cp(
  path.join(serverDir, "skills"),
  path.join(outDir, "skills"),
  {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("assets"),
  },
);
