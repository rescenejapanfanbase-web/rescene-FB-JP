import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourceFiles = [
  "data/homepage.json",
  "data/news.json",
  "data/schedule.json",
  "data/members.json",
  "data/about.json",
  "data/discography.json",
  "data/chants.json",
  "data/voting-guide.json",
  "data/streaming-guide.json",
  "data/official-links.json",
  "data/contact.json",
  "data/records.json",
  "data/mv.json",
  "data/site-updates.json",
];

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

const overrides = await readJson("data/language-overrides.json", { ko: {}, en: {} });
const catalog = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [],
  ko: { ...(overrides.ko || {}) },
  en: { ...(overrides.en || {}) },
};

const languageAliases = {
  ko: ["ko", "kr", "korean"],
  en: ["en", "eng", "english"],
};

function languageBlock(translations, language) {
  for (const key of languageAliases[language]) {
    if (translations && typeof translations[key] === "object" && translations[key]) return translations[key];
  }
  return null;
}

function addMapping(baseValue, translatedValue, language) {
  const base = typeof baseValue === "string" ? baseValue.trim() : "";
  const translated = typeof translatedValue === "string" ? translatedValue.trim() : "";
  if (!base || !translated || base === translated) return;
  catalog[language][base] = translated;
}

function visit(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }

  const translations = value.translations || value.i18n || value.language || null;
  if (translations && typeof translations === "object") {
    for (const language of ["ko", "en"]) {
      const translated = languageBlock(translations, language);
      if (!translated) continue;
      for (const [field, translatedValue] of Object.entries(translated)) {
        if (field in value) addMapping(value[field], translatedValue, language);
      }
    }
  }

  for (const nested of Object.values(value)) visit(nested);
}

for (const path of sourceFiles) {
  const parsed = await readJson(path);
  if (parsed == null) continue;
  catalog.sourceFiles.push(path);
  visit(parsed);
}

await mkdir("data", { recursive: true });
await writeFile("data/language-catalog.json", `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile("data/language-catalog-data.js", `window.RESCENE_LANGUAGE_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`, "utf8");
console.log(`多言語カタログを生成しました（韓国語 ${Object.keys(catalog.ko).length}件 / 英語 ${Object.keys(catalog.en).length}件）。`);
