import { spawn } from "node:child_process";

/**
 * Consumer of the local Tutti CLI. `TUTTI_CLI` is the stable app-runtime
 * contract for calling other installed Tutti apps and daemon capabilities; it
 * is the same path in development and packaged production. Every call here is
 * best-effort: a missing or failing CLI must never break this app's own
 * startup or requests, so callers fall back to a local-only result instead.
 *
 * See references/tutti-cli-commands.md in the tutti-workspace-app-factory skill.
 */

export type TuttiCliResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function tuttiCliCommand(): string | null {
  const command = (process.env.TUTTI_CLI ?? "").trim();
  return command.length > 0 ? command : null;
}

/**
 * Invoke the Tutti CLI with `--json` and parse its stdout. Always resolves —
 * never rejects — so call sites can treat the CLI as optional.
 */
export function runTuttiCli(args: string[], timeoutMs = 15_000): Promise<TuttiCliResult> {
  const command = tuttiCliCommand();
  if (!command) {
    return Promise.resolve({ ok: false, error: "TUTTI_CLI is not configured" });
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: TuttiCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(command, ["--json", ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, error: `TUTTI_CLI ${args.join(" ")} timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false, error: (stderr || stdout).trim() || `exited with code ${code}` });
        return;
      }
      const text = stdout.trim();
      if (!text) {
        finish({ ok: true, value: {} });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(text) });
      } catch {
        finish({ ok: false, error: "TUTTI_CLI returned non-JSON output" });
      }
    });
  });
}

export type TuttiCliProbe = {
  /** Whether TUTTI_CLI is present in the environment at all. */
  configured: boolean;
  command: string | null;
  /** Whether the daemon answered a `status` probe. */
  reachable: boolean;
  daemon?: unknown;
  error?: string;
};

/**
 * Probe daemon health so the app (and its `status` CLI command) can report
 * whether the wider Tutti ecosystem is reachable from inside the runtime.
 */
export async function probeTuttiCli(timeoutMs = 4_000): Promise<TuttiCliProbe> {
  const command = tuttiCliCommand();
  if (!command) {
    return { configured: false, command: null, reachable: false };
  }
  const result = await runTuttiCli(["status"], timeoutMs);
  if (result.ok) {
    return { configured: true, command, reachable: true, daemon: result.value };
  }
  return { configured: true, command, reachable: false, error: result.error };
}
