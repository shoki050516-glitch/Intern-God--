const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);
const PLACEHOLDER = /\{([A-Za-z_$][\w$]*)\}/g;
const FETCH_TIMEOUT_MS = 5000;

function primaryLanguage(tag) {
  return String(tag || "").trim().split(/[-_]/)[0].toLowerCase();
}

function isLocaleId(value) {
  return typeof value === "string" && /^[a-z]{2,3}$/.test(value);
}

async function loadTable(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, import.meta.url), { signal: controller.signal });
    if (!response.ok) return null;
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const [manifest, sourceTable, embeddedSource] = await Promise.all([
  loadTable("../locales/manifest.json"),
  loadTable("../locales/source.json"),
  import("../locales/source.generated.js").then((module) => module.default, () => null),
]);
const source = sourceTable || embeddedSource || {};
const sourceLocale = manifest && typeof manifest.source === "string" ? primaryLanguage(manifest.source) : null;
const declared = manifest && Array.isArray(manifest.locales) ? manifest.locales.map(primaryLanguage).filter(isLocaleId) : [];
const availableLocales = Object.freeze(
  [...new Set(isLocaleId(sourceLocale) ? [sourceLocale, ...declared] : declared)],
);

function pickLocale() {
  const requested = primaryLanguage(new URLSearchParams(location.search).get("lang"));
  if (isLocaleId(requested) && availableLocales.includes(requested)) return requested;
  return sourceLocale;
}

const picked = pickLocale();
const translated = picked && picked !== sourceLocale ? (await loadTable("../locales/" + picked + ".json")) || {} : {};

export const locale = picked || primaryLanguage(document.documentElement.lang) || "und";
export const dir = RTL_LANGUAGES.has(locale) ? "rtl" : "ltr";
if (picked) {
  document.documentElement.lang = picked;
  document.documentElement.dir = dir;
}

const warnedKeys = new Set();

export function t(key, params) {
  let text = typeof translated[key] === "string"
    ? translated[key]
    : typeof source[key] === "string" ? source[key] : null;
  if (text === null) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn("[i18n] missing text for key: " + key);
    }
    text = "";
  }
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}
