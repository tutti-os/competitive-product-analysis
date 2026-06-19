// App-level i18n check (run via `pnpm check:i18n`).
//
// Verifies the web app's localization stays consistent:
//   1. Every locale in apps/web/public/locales has the same flattened key set
//      as the default locale (en).
//   2. Every t("key") / translate("key") referenced in apps/web/src exists in
//      every locale.
//   3. (warning) Keys defined in locales but never referenced in code.
//
// Exits non-zero on any parity or missing-key error so CI fails loudly.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const localesDir = path.join(rootDir, "apps", "web", "public", "locales");
const srcDir = path.join(rootDir, "apps", "web", "src");
const DEFAULT_LOCALE = "en";
// product names, model labels, technical identifiers — copy that is intentionally untranslated.
const ALLOWLIST = new Set([]);

const errors = [];
const warnings = [];

const locales = await loadLocales();
const localeNames = Object.keys(locales);
if (!localeNames.includes(DEFAULT_LOCALE)) {
  fail(`Default locale "${DEFAULT_LOCALE}.json" is missing from ${rel(localesDir)}.`);
}

const defaultKeys = new Set(Object.keys(locales[DEFAULT_LOCALE] ?? {}));

// 1. Parity across locales.
for (const name of localeNames) {
  const keys = new Set(Object.keys(locales[name]));
  const missing = [...defaultKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !defaultKeys.has(key));
  if (missing.length) {
    errors.push(`Locale "${name}" is missing ${missing.length} key(s): ${missing.sort().join(", ")}`);
  }
  if (extra.length) {
    errors.push(`Locale "${name}" has ${extra.length} key(s) not in "${DEFAULT_LOCALE}": ${extra.sort().join(", ")}`);
  }
}

// 2. Referenced keys exist in every locale.
const referenced = await collectReferencedKeys();
for (const key of [...referenced].sort()) {
  if (ALLOWLIST.has(key)) continue;
  const missingIn = localeNames.filter((name) => !(key in locales[name]));
  if (missingIn.length) {
    errors.push(`Key "${key}" is used in code but missing from locale(s): ${missingIn.join(", ")}`);
  }
}

// 3. Orphaned keys (warning only).
for (const key of [...defaultKeys].sort()) {
  if (!referenced.has(key) && !ALLOWLIST.has(key)) {
    warnings.push(`Key "${key}" is defined in locales but never referenced in apps/web/src.`);
  }
}

for (const warning of warnings) {
  console.warn(`  warning: ${warning}`);
}

if (errors.length) {
  console.error(`\ni18n check failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`  error: ${error}`);
  process.exit(1);
}

console.log(
  `i18n check passed: ${localeNames.length} locale(s) (${localeNames.join(", ")}), ` +
    `${defaultKeys.size} keys, ${referenced.size} referenced` +
    (warnings.length ? `, ${warnings.length} warning(s)` : ""),
);

// --- helpers ---------------------------------------------------------------

async function loadLocales() {
  let entries;
  try {
    entries = await readdir(localesDir);
  } catch {
    fail(`Locales directory not found: ${rel(localesDir)}`);
  }
  const result = {};
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    const raw = await readFile(path.join(localesDir, entry), "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`Locale "${entry}" is not valid JSON: ${error.message}`);
    }
    result[name] = flatten(parsed);
  }
  if (Object.keys(result).length === 0) {
    fail(`No locale JSON files found in ${rel(localesDir)}`);
  }
  return result;
}

/** Flatten nested objects to dotted keys; flat dotted keys pass through. */
function flatten(value, prefix = "", out = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        flatten(child, next, out);
      } else {
        out[next] = String(child);
      }
    }
  }
  return out;
}

async function collectReferencedKeys() {
  const keys = new Set();
  const pattern = /\b(?:t|translate)\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
  for await (const file of walk(srcDir)) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      keys.add(match[1]);
    }
  }
  return keys;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function rel(target) {
  return path.relative(rootDir, target) || ".";
}

function fail(message) {
  console.error(`i18n check failed: ${message}`);
  process.exit(1);
}
