import {
  createDefaultLocalAgentProviderPlugins,
  createLocalAgentRuntime,
} from "@tutti-os/agent-acp-kit";
import type { AgentProviderSummary } from "@product-competition/shared";

const runtime = createLocalAgentRuntime({
  providers: createDefaultLocalAgentProviderPlugins(),
});

/** How long a provider detection result stays fresh before a re-detect. */
const DETECTION_TTL_MS = 30_000;
let detectionCache: { at: number; value: AgentProviderSummary[] } | null = null;
let detectionInFlight: Promise<AgentProviderSummary[]> | null = null;

/**
 * Detect installed local-agent providers. Detection spawns the provider CLIs
 * and costs seconds, so results are cached with a short TTL and concurrent
 * callers share one in-flight detection. This keeps app-to-app prechecks
 * (`status`, `research`) well under their CLI timeouts once the cache is warm
 * (it is warmed at server startup via `warmAgentProviders`). Pass `maxAgeMs: 0`
 * to bypass the cache and force a fresh detection.
 */
export async function detectAgentProviders(
  options: { maxAgeMs?: number } = {},
): Promise<AgentProviderSummary[]> {
  const maxAgeMs = options.maxAgeMs ?? DETECTION_TTL_MS;
  if (detectionCache && Date.now() - detectionCache.at <= maxAgeMs) {
    return detectionCache.value;
  }
  if (!detectionInFlight) {
    detectionInFlight = runDetection()
      .then((value) => {
        detectionCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        detectionInFlight = null;
      });
  }
  return detectionInFlight;
}

/** Warm the detection cache so the first request doesn't pay the detect cost. */
export function warmAgentProviders(): void {
  void detectAgentProviders({ maxAgeMs: 0 }).catch(() => undefined);
}

async function runDetection(): Promise<AgentProviderSummary[]> {
  try {
    const detections = await runtime.detect();
    return detections.map((detection) => {
      const models = detection.result?.models?.map((model) => model.id) ?? [];
      const supported = detection.result?.supported !== false;
      const detected = Boolean(detection.result);
      const ready = detected && supported && detection.result?.authState !== "missing";

      return {
        provider: detection.provider,
        label: detection.displayName,
        detected,
        supported,
        status: ready ? "ready" : detected ? "unsupported" : "not-installed",
        models,
        reason:
          detection.result?.unsupportedReason ??
          (detection.result?.authState === "missing"
            ? "CLI detected but authentication is missing."
            : undefined),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Provider the UI should preselect. The product-swipefile skill is tuned for
 * Claude, so prefer a ready Claude; otherwise the first ready provider.
 */
export function pickDefaultProvider(providers: AgentProviderSummary[]): string | null {
  const ready = providers.filter((provider) => provider.status === "ready");
  const claude = ready.find((provider) => provider.provider === "claude");
  return claude?.provider ?? ready[0]?.provider ?? null;
}
