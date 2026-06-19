export type AppLocale = "en" | "zh-CN";

type TuttiAppContextValue = {
  locale?: unknown;
  language?: unknown;
};

type TuttiAppContext = TuttiAppContextValue & {
  get?: () => Promise<TuttiAppContextValue | null> | TuttiAppContextValue | null;
  getLocale?: () => Promise<string> | string;
  subscribe?: (listener: (context: TuttiAppContextValue | null) => void) => (() => void) | undefined;
  onLocaleChanged?: (listener: (locale: string) => void) => (() => void) | undefined;
};

declare global {
  interface Window {
    tuttiExternal?: {
      app?: {
        getContext(): Promise<unknown>;
        subscribe(listener: (context: unknown) => void): () => void;
      };
    };
  }
}

export function normalizeLocale(value: unknown): AppLocale | null {
  const next = String(value ?? "")
    .trim()
    .replaceAll("_", "-")
    .toLowerCase();
  if (!next) return null;
  if (next === "zh" || next.startsWith("zh-")) return "zh-CN";
  if (next === "en" || next.startsWith("en-")) return "en";
  return null;
}

export function resolveFallbackLocale(): AppLocale {
  return readBrowserLocale() ?? "en";
}

function readBrowserLocale(): AppLocale | null {
  if (typeof navigator === "undefined") return null;
  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return null;
}

export function readSyncAppContextLocale(): AppLocale | null {
  return normalizeLocale(normalizeAppContextLocaleValue(readTuttiAppContextValue()));
}

export async function readAppContextLocaleAsync(): Promise<AppLocale | null> {
  const appContext = readTuttiAppContextValue();
  if (!appContext || typeof appContext !== "object") return null;

  if (typeof appContext.get === "function") {
    try {
      return normalizeLocale(normalizeAppContextLocaleValue(await appContext.get()));
    } catch {
      return null;
    }
  }

  if (typeof appContext.getLocale === "function") {
    try {
      return normalizeLocale(await appContext.getLocale());
    } catch {
      return null;
    }
  }

  return normalizeLocale(normalizeAppContextLocaleValue(appContext));
}

export function subscribeHostLocale(listener: (locale: AppLocale | null) => void) {
  const appContext = readTuttiAppContextValue();
  if (!appContext || typeof appContext !== "object") {
    return () => {};
  }

  if (typeof appContext.subscribe === "function") {
    return appContext.subscribe((context) => {
      listener(normalizeLocale(normalizeAppContextLocaleValue(context)));
    }) ?? (() => {});
  }

  if (typeof appContext.onLocaleChanged === "function") {
    return appContext.onLocaleChanged((locale) => {
      listener(normalizeLocale(locale));
    }) ?? (() => {});
  }

  return () => {};
}

export async function resolveInitialLocale(): Promise<AppLocale> {
  return normalizeLocale(await readAppContextLocaleAsync()) ?? readSyncAppContextLocale() ?? resolveFallbackLocale();
}

function readTuttiAppContextValue(): TuttiAppContext | null {
  if (typeof window === "undefined") return null;
  const externalApp = window.tuttiExternal?.app;
  if (!externalApp) return null;
  return {
    async get() {
      return normalizeExternalAppContext(await externalApp.getContext());
    },
    subscribe(listener) {
      return externalApp.subscribe((context) => {
        listener(normalizeExternalAppContext(context));
      });
    },
  };
}

function normalizeExternalAppContext(context: unknown): TuttiAppContextValue {
  if (!context || typeof context !== "object") return {};
  const record = context as Record<string, unknown>;
  return {
    ...(typeof record.locale === "string" ? { locale: record.locale } : {}),
    ...(typeof record.language === "string" ? { language: record.language } : {}),
  };
}

function normalizeAppContextLocaleValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;
  const record = value as { locale?: unknown; language?: unknown };
  if (typeof record.locale === "string") return record.locale;
  if (typeof record.language === "string") return record.language;
  return null;
}
