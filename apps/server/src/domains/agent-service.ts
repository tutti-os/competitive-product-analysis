import { createDefaultLocalAgentRuntime } from "@tutti-os/agent-acp-kit";
import { loadTuttiAgentProviderCatalog } from "@tutti-os/agent-acp-kit/tutti";
import type { AgentProviderSummary } from "@product-competition/shared";

export type AgentProviderCatalog = {
  defaultProvider: string | null;
  providers: AgentProviderSummary[];
};

const runtime = createDefaultLocalAgentRuntime();

const DETECTION_TTL_MS = 30_000;
let detectionCache: { at: number; value: AgentProviderCatalog } | null = null;
let detectionInFlight: Promise<AgentProviderCatalog> | null = null;

export async function detectAgentProviderCatalog(
  options: { maxAgeMs?: number } = {},
): Promise<AgentProviderCatalog> {
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

export async function detectAgentProviders(
  options: { maxAgeMs?: number } = {},
): Promise<AgentProviderSummary[]> {
  return (await detectAgentProviderCatalog(options)).providers;
}

export function warmAgentProviders(): void {
  void detectAgentProviderCatalog({ maxAgeMs: 0 }).catch(() => undefined);
}

export function pickDefaultProvider(
  providers: AgentProviderSummary[],
  preferred?: string | null,
): string | null {
  const ready = providers.filter((provider) => provider.status === "ready");
  const requested = preferred?.trim();
  return ready.find((provider) => provider.provider === requested)?.provider
    ?? ready[0]?.provider
    ?? null;
}

async function runDetection(): Promise<AgentProviderCatalog> {
  try {
    const detectionsPromise = runtime.detect();
    const catalogRuntime = {
      listProviders: () => runtime.listProviders(),
      detect: () => detectionsPromise,
    } as typeof runtime;
    const [catalog, detections] = await Promise.all([
      loadTuttiAgentProviderCatalog({ runtime: catalogRuntime }),
      detectionsPromise,
    ]);
    const detectionByProvider = new Map(
      detections.map((detection) => [detection.provider, detection]),
    );
    const providers = catalog.providers.map((provider) => {
      const detection = detectionByProvider.get(provider.providerId);
      const result = detection?.result;
      const detected = Boolean(result);
      const supported = provider.runtimeSupported && result?.supported !== false;
      const authenticated = result?.authState !== "missing" && result?.authState !== "expired";
      const ready =
        detected &&
        supported &&
        authenticated &&
        provider.availability.status === "available";
      return {
        provider: provider.providerId,
        label: provider.displayName,
        detected,
        supported,
        status: ready ? "ready" : provider.runtimeSupported && !detected ? "not-installed" : "unsupported",
        models: result?.models?.map((model) => model.id) ?? [],
        reason:
          provider.availability.detail ||
          result?.unsupportedReason ||
          (result?.authState === "missing"
            ? "CLI detected but authentication is missing."
            : undefined),
      } satisfies AgentProviderSummary;
    });
    return {
      defaultProvider: pickDefaultProvider(providers, catalog.defaultProviderId),
      providers,
    };
  } catch {
    return { defaultProvider: null, providers: [] };
  }
}
