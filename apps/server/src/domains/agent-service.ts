import {
  createDefaultLocalAgentProviderPlugins,
  createLocalAgentRuntime,
} from "@tutti-os/agent-acp-kit";
import type { AgentProviderSummary } from "@product-competition/shared";

const runtime = createLocalAgentRuntime({
  providers: createDefaultLocalAgentProviderPlugins(),
});

export async function detectAgentProviders(): Promise<AgentProviderSummary[]> {
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
