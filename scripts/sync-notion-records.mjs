import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, readdir, rm, unlink, writeFile, mkdtemp } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_RECORDS_DATA_SOURCE_ID || "12dd657f-8ca2-44b0-a10f-ee099ca9a799";
const notionDatabaseUrl = "https://app.notion.com/p/3119e49d127048ceb8388f3434fd13d7";
const notionVersion = "2026-03-11";
const notionApiBase = (process.env.NOTION_API_BASE || "https://api.notion.com").replace(/\/$/, "");
const imageDirectory = "assets/records/notion";
const execFileAsync = promisify(execFile);

if (!token) throw new Error("NOTION_TOKEN が設定されていません。音楽記録データベースをGitHub連携と共有してください。");

const plainText = (items) => (Array.isArray(items) ? items : []).map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
function propertyValue(property) {
  if (!property) return "";
  if (typeof property.number === "number") return property.number;
  if (typeof property.formula?.number === "number") return property.formula.number;
  if (typeof property.rollup?.number === "number") return property.rollup.number;
  if (property.url) return property.url;
  if (property.date?.start) return property.date.start;
  if (property.select?.name) return property.select.name;
  if (property.status?.name) return property.status.name;
  return plainText(property.title || property.rich_text || property.text || property[property.type]);
}
function propertyByAliases(properties, aliases = []) {
  for (const name of aliases) {
    const value = propertyValue(properties?.[name]);
    if (value !== "" && value !== null && value !== undefined) return value;
  }
  return "";
}
function numericPropertyDetails(properties, aliases = []) {
  const candidates = [];
  for (const name of aliases) {
    const raw = propertyValue(properties?.[name]);
    if (raw === "" || raw === null || raw === undefined) continue;
    const normalized = String(raw).replace(/[#,，,位\s]/g, "");
    const number = Number(normalized);
    if (Number.isFinite(number) && number > 0) candidates.push({ name, value: number, raw });
  }
  return { value: candidates[0]?.value ?? null, source: candidates[0]?.name || "", candidates };
}
function numericProperty(properties, aliases = []) {
  return numericPropertyDetails(properties, aliases).value;
}
function warnNumericConflicts(title, label, details) {
  const distinct = [...new Set(details.candidates.map((item) => item.value))];
  if (distinct.length <= 1) return;
  console.warn(`警告: ${title} / ${label}の候補値が一致しません: ${details.candidates.map((item) => `${item.name}=${item.value}`).join(" / ")}。先頭の ${details.source}=${details.value} を取得し、確定値ガードがある項目は検証後に反映します。`);
}
function dateProperty(properties, aliases = []) {
  const value = propertyByAliases(properties, aliases);
  return value ? String(value).slice(0, 10) : "";
}
function normalizedRecordType(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (/音楽番組.*1位|musicshow.*win|musicshowwins/.test(text)) return "music-show-win";
  if (/melon|メロン/.test(text)) return "melon";
  return "";
}
function recordTranslations(properties, kind) {
  const fields = kind === "melon"
    ? ["title", "song", "description"]
    : ["title", "song", "program", "description", "videoLabel"];
  const baseNames = { title: "タイトル", song: "曲名", program: "番組名", description: "記録説明", videoLabel: "映像リンク名" };
  const translations = {};
  for (const [language, suffixes] of Object.entries({ ko: ["（韓国語）", "_KO"], en: ["（英語）", "_EN"] })) {
    const values = {};
    for (const field of fields) {
      const base = baseNames[field];
      const aliases = [...suffixes.map((suffix) => `${base}${suffix}`), `${language === "ko" ? "韓国語" : "英語"}${base}`];
      const value = propertyByAliases(properties, aliases);
      if (value) values[field] = String(value);
    }
    if (Object.keys(values).length) translations[language] = values;
  }
  return translations;
}
function mergeRecords(manual = [], notion = [], { matchSong = false } = {}) {
  const merged = manual.map((item) => ({ ...item }));
  for (const item of notion) {
    const index = merged.findIndex((current) =>
      (current.notionPageId && item.notionPageId && current.notionPageId === item.notionPageId)
      || String(current.title || "").trim().toLowerCase() === String(item.title || "").trim().toLowerCase()
      || (matchSong && current.song && item.song && String(current.song).trim().toLowerCase() === String(item.song).trim().toLowerCase()));
    if (index >= 0) {
      const fallback = merged[index];
      const next = { ...fallback };
      for (const [field, value] of Object.entries(item)) {
        const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
        if (!empty && field !== "translations") next[field] = value;
      }
      next.image = item.image || fallback.image || "";
      next.translations = { ...(fallback.translations || {}), ...(item.translations || {}) };
      const guard = fallback.notionGuard;
      const expected = guard?.expected && typeof guard.expected === "object" ? guard.expected : {};
      const mismatches = Object.entries(expected).filter(([field, value]) => next[field] !== value);
      if (mismatches.length) {
        const preserve = Array.isArray(guard?.preserve) ? guard.preserve : Object.keys(expected);
        for (const field of preserve) {
          if (Object.prototype.hasOwnProperty.call(fallback, field)) next[field] = fallback[field];
        }
        console.warn(`警告: Notionの音楽記録値を保留しました: ${fallback.song || fallback.title} / ${mismatches.map(([field, value]) => `${field}: Notion=${item[field] ?? "未入力"}, 確定=${value}`).join(" / ")}。Notion APIが確定値を返すまでは既存の検証済み値を維持します。`);
      }
      merged[index] = next;
    } else merged.push(item);
  }
  return merged;
}
function publicRecord(item) {
  const { notionGuard, ...record } = item;
  return record;
}
const localPath = (value) => String(value || "").trim().replace(/^\/+/, "").replaceAll("\\", "/");
const validHttp = (value) => /^https?:\/\//i.test(String(value || "")) ? String(value) : "";
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"]);

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}
async function notionRequest(path, options = {}) {
  const response = await fetch(`${notionApiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Notion API ${response.status} (${path}): ${detail}`);
  }
  return response.json();
}
async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = {
      page_size: 100,
      filter: { property: "公開", checkbox: { equals: true } },
      sorts: [{ property: "表示順", direction: "ascending" }],
    };
    if (startCursor) body.start_cursor = startCursor;
    const data = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, { method: "POST", body: JSON.stringify(body) });
    results.push(...data.results.filter((item) => item.object === "page"));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}
function notionFiles(property) {
  const files = Array.isArray(property?.files) ? property.files : (property?.type === "files" && Array.isArray(property[property.type]) ? property[property.type] : []);
  return files.map((file, index) => ({
    url: file?.external?.url ?? file?.file?.url ?? "",
    name: file?.name ?? `record-image-${index + 1}`,
  })).filter((file) => validHttp(file.url));
}
async function retrievePage(pageId) { return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`); }
async function retrieveProperty(pageId, propertyId) {
  if (!propertyId) return null;
  return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}`);
}
async function findImage(page) {
  const property = page?.properties?.["画像"];
  let files = notionFiles(property);
  if (!files.length && property?.id) {
    try { files = notionFiles(await retrieveProperty(page.id, property.id)); }
    catch (error) { console.warn(`記録画像プロパティの再取得に失敗: ${page.id} / ${error.message}`); }
  }
  return files[0] || null;
}
function extensionFrom(name, contentType, url) {
  for (const candidate of [extname(String(name || "").split("?")[0]).toLowerCase(), (() => { try { return extname(new URL(url).pathname).toLowerCase(); } catch { return ""; } })()]) {
    if (supportedExtensions.has(candidate)) return candidate === ".jpeg" ? ".jpg" : candidate;
  }
  if (/heic|heif/i.test(contentType || "")) return ".heic";
  if (/avif/i.test(contentType || "")) return ".avif";
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  if (/gif/i.test(contentType || "")) return ".gif";
  return ".jpg";
}
async function downloadImage(file) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(file.url, { redirect: "follow", cache: "no-store", headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8", "User-Agent": "RESCENE-JAPAN-FANBASE/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 32) throw new Error("画像データが小さすぎます。");
      return { bytes, contentType: response.headers.get("content-type") || "" };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw lastError;
}
async function normalizeImage(bytes, extension, basename) {
  if (![".heic", ".heif"].includes(extension)) return { bytes, extension };
  const directory = await mkdtemp(join(tmpdir(), "rescene-record-image-"));
  const source = join(directory, `${basename}${extension}`);
  const target = join(directory, `${basename}.jpg`);
  try {
    await writeFile(source, bytes);
    await execFileAsync(process.env.PYTHON_COMMAND || "python3", ["scripts/convert-heic.py", source, target]);
    return { bytes: await readFile(target), extension: ".jpg" };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function saveImage(file, pageId) {
  const fetched = await downloadImage(file);
  const basename = `record-${String(pageId).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const normalized = await normalizeImage(fetched.bytes, extensionFrom(file.name, fetched.contentType, file.url), basename);
  const digest = createHash("sha256").update(normalized.bytes).digest("hex").slice(0, 12);
  await mkdir(imageDirectory, { recursive: true });
  const output = join(imageDirectory, `${basename}-${digest}${normalized.extension}`).replaceAll("\\", "/");
  await writeFile(output, normalized.bytes);
  for (const name of await readdir(imageDirectory).catch(() => [])) {
    if (name.startsWith(`${basename}-`) && join(imageDirectory, name).replaceAll("\\", "/") !== output) await unlink(join(imageDirectory, name)).catch(() => {});
  }
  return output;
}
async function resolveImage(page, previous) {
  const title = plainText(page.properties?.["タイトル"]?.title);
  const upload = await findImage(page);
  if (upload) {
    try {
      const path = await saveImage(upload, page.id);
      console.log(`Notion記録画像を保存: ${title} -> ${path}`);
      return path;
    } catch (error) { console.warn(`Notion記録画像の保存に失敗: ${title} / ${error.message}`); }
  }
  const configured = localPath(plainText(page.properties?.["画像パス"]?.rich_text));
  if (configured && await fileExists(configured)) return configured;
  if (configured) console.warn(`記録の画像パスを無視（ファイルなし）: ${title} / ${configured}`);
  return previous || "";
}

const TOP100_ALIASES = ["TOP100最高順位", "Melon TOP100最高順位", "TOP100 Peak", "TOP100順位"];
const DAILY_ALIASES = ["日間最高順位", "Melon日間最高順位", "Daily Peak", "日間順位"];

const existing = await readJson("data/records.json", { musicShowWins: [], melonRecords: [] });
const manual = await readJson("data/records-manual.json", { musicShowWins: [], melonRecords: [] });
const previousByTitle = new Map([...(existing.musicShowWins || []), ...(existing.melonRecords || [])].map((item) => [String(item.title || item.song || ""), item]));
const pages = await queryAllPages();
const notionMusicShowWins = [];
const notionMelonRecords = [];
const usedImages = new Set();

for (const queryPage of pages) {
  let page = queryPage;
  try { page = await retrievePage(queryPage.id); } catch (error) { console.warn(`記録ページ再取得失敗: ${queryPage.id} / ${error.message}`); }
  const p = page.properties || {};
  const title = String(propertyByAliases(p, ["タイトル", "記録名", "名前"]));
  const rawType = propertyByAliases(p, ["種別", "種類", "カテゴリー"]);
  const type = normalizedRecordType(rawType);
  if (!title || !type) {
    console.warn(`記録行をスキップ: title=${title || "(空)"} / type=${rawType || "(空)"}`);
    continue;
  }
  const previous = previousByTitle.get(title) || {};
  const image = await resolveImage(page, previous.image || "");
  if (image.startsWith(imageDirectory)) usedImages.add(image);
  const order = numericProperty(p, ["表示順", "順番", "Order"]) ?? 9999;
  if (type === "music-show-win") {
    notionMusicShowWins.push({
      title,
      song: String(propertyByAliases(p, ["曲名", "楽曲名", "Song"])),
      date: dateProperty(p, ["獲得日", "日付", "Win Date"]),
      program: String(propertyByAliases(p, ["番組名", "音楽番組", "Program"])),
      description: String(propertyByAliases(p, ["記録説明", "説明", "Description"])),
      videoUrl: validHttp(propertyByAliases(p, ["映像リンク", "動画リンク", "Video URL"])),
      videoLabel: String(propertyByAliases(p, ["映像リンク名", "動画リンク名", "Video Label"])),
      image: image || previous.image || "news/the-show-first-win.jpeg",
      order,
      translations: recordTranslations(p, "music-show-win"),
      notionPageId: page.id,
      notionUrl: page.url || "",
    });
  } else if (type === "melon") {
    const top100 = numericPropertyDetails(p, TOP100_ALIASES);
    const daily = numericPropertyDetails(p, DAILY_ALIASES);
    warnNumericConflicts(title, "TOP100最高順位", top100);
    warnNumericConflicts(title, "日間最高順位", daily);
    notionMelonRecords.push({
      title,
      song: String(propertyByAliases(p, ["曲名", "楽曲名", "Song"])),
      releaseDate: dateProperty(p, ["発売日", "リリース日", "Release Date"]),
      top100Peak: top100.value,
      top100PeakDate: dateProperty(p, ["TOP100最高順位獲得日", "TOP100獲得日", "TOP100 Peak Date"]),
      dailyPeak: daily.value,
      dailyPeakDate: dateProperty(p, ["日間最高順位獲得日", "日間獲得日", "Daily Peak Date"]),
      description: String(propertyByAliases(p, ["記録説明", "説明", "Description"])),
      mvUrl: validHttp(propertyByAliases(p, ["MVリンク", "MV URL", "動画リンク"])),
      image: image || previous.image || "news/melon-top100-first.jpg",
      order,
      translations: recordTranslations(p, "melon"),
      notionPageId: page.id,
      notionUrl: page.url || "",
    });
    const top100Source = top100.source ? ` (${top100.source})` : "";
    const dailySource = daily.source ? ` (${daily.source})` : "";
    console.log(`Melon記録取得: ${title} / TOP100=${top100.value ?? "未入力"}${top100Source} / 日間=${daily.value ?? "未入力"}${dailySource}`);
  }
}

const musicShowWins = mergeRecords(manual.musicShowWins || [], notionMusicShowWins).map(publicRecord);
const melonRecords = mergeRecords(manual.melonRecords || [], notionMelonRecords, { matchSong: true }).map(publicRecord);
if (melonRecords.length < (manual.melonRecords || []).length) {
  throw new Error(`Melon記録の件数がフォールバックより減少しました: ${melonRecords.length}/${manual.melonRecords.length}`);
}

musicShowWins.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.order - b.order);
melonRecords.sort((a, b) => String(a.releaseDate || "9999-99-99").localeCompare(String(b.releaseDate || "9999-99-99")) || a.order - b.order);

await mkdir(imageDirectory, { recursive: true });
for (const name of await readdir(imageDirectory).catch(() => [])) {
  const path = join(imageDirectory, name).replaceAll("\\", "/");
  if (!usedImages.has(path)) await unlink(path).catch(() => {});
}

const comparable = { musicShowWins, melonRecords };
const changed = JSON.stringify({ musicShowWins: existing.musicShowWins || [], melonRecords: existing.melonRecords || [] }) !== JSON.stringify(comparable);
const generatedAt = changed ? new Date().toISOString() : (existing.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion+manual-fallback", dataSourceId, notionDatabaseUrl, musicShowWins, melonRecords };
await mkdir("data", { recursive: true });
await writeFile("data/records.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile("data/records-data.js", `window.RESCENE_RECORDS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
await writeFile("data/notion-records-sync-status.json", `${JSON.stringify({ generatedAt, dataSourceId, queriedPages: pages.length, notionMusicShowWins: notionMusicShowWins.length, notionMelonRecords: notionMelonRecords.length, musicShowWins: musicShowWins.length, melonRecords: melonRecords.length }, null, 2)}\n`, "utf8");

await execFileAsync(process.execPath, ["scripts/render-record-pages.mjs"]);
console.log(`Notion音楽記録を同期しました（音楽番組1位 ${musicShowWins.length}件 / Melon ${melonRecords.length}件 / 変更: ${changed ? "あり" : "なし"}）。`);
