import { spawn } from "node:child_process";
import path from "node:path";
import { chmod, cp, mkdir, rm } from "node:fs/promises";

const rootDir = path.resolve(import.meta.dirname, "..");
const buildRoot = path.join(rootDir, "build", "tutti-app");
const packageRoot = path.join(buildRoot, "package");
const packageServerDir = path.join(packageRoot, "server");
const packageWebDir = path.join(packageRoot, "web");
const appId = "product-competition";
const version = "0.2.0";

await run("pnpm", ["build"], rootDir);
await rm(buildRoot, { recursive: true, force: true });
await mkdir(packageServerDir, { recursive: true });

await cp(path.join(rootDir, "apps", "server", "dist", "server.js"), path.join(packageServerDir, "server.js"));
await cp(path.join(rootDir, "apps", "server", "dist", "server.js.map"), path.join(packageServerDir, "server.js.map"));
await cp(
  path.join(rootDir, "apps", "server", "dist", "skills"),
  path.join(packageServerDir, "skills"),
  { recursive: true },
);
await cp(path.join(rootDir, "apps", "web", "dist"), packageWebDir, { recursive: true });
await cp(path.join(rootDir, "bootstrap.sh"), path.join(packageRoot, "bootstrap.sh"));
await cp(path.join(rootDir, "tutti.app.json"), path.join(packageRoot, "tutti.app.json"));
await cp(path.join(rootDir, "tutti.cli.json"), path.join(packageRoot, "tutti.cli.json"));
await cp(path.join(rootDir, "icon.svg"), path.join(packageRoot, "icon.svg"));
await cp(path.join(rootDir, "AGENTS.md"), path.join(packageRoot, "AGENTS.md"));
await cp(path.join(rootDir, "COMMANDS.md"), path.join(packageRoot, "COMMANDS.md"));
await cp(path.join(rootDir, "README.md"), path.join(packageRoot, "README.md"));
await cp(path.join(rootDir, "LICENSE"), path.join(packageRoot, "LICENSE"));
await cp(path.join(rootDir, "locales"), path.join(packageRoot, "locales"), { recursive: true });

await chmod(path.join(packageRoot, "bootstrap.sh"), 0o755);

const zipPath = path.join(buildRoot, `${appId}-${version}.zip`);
await rm(zipPath, { force: true });
await run("zip", ["-qry", zipPath, "."], packageRoot);
console.log(`Created ${zipPath}`);

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });

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
