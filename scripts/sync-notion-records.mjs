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

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
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

const existing = await readJson("data/records.json", { musicShowWins: [], melonRecords: [] });
const previousByTitle = new Map([...(existing.musicShowWins || []), ...(existing.melonRecords || [])].map((item) => [String(item.title || item.song || ""), item]));
const pages = await queryAllPages();
const musicShowWins = [];
const melonRecords = [];
const usedImages = new Set();

for (const queryPage of pages) {
  let page = queryPage;
  try { page = await retrievePage(queryPage.id); } catch (error) { console.warn(`記録ページ再取得失敗: ${queryPage.id} / ${error.message}`); }
  const p = page.properties || {};
  const title = plainText(p["タイトル"]?.title);
  const type = p["種別"]?.select?.name || "";
  if (!title || !type) continue;
  const previous = previousByTitle.get(title) || {};
  const image = await resolveImage(page, previous.image || "");
  if (image.startsWith(imageDirectory)) usedImages.add(image);
  const order = p["表示順"]?.number ?? 9999;
  if (type === "音楽番組1位") {
    musicShowWins.push({
      title,
      song: plainText(p["曲名"]?.rich_text),
      date: p["獲得日"]?.date?.start?.slice(0, 10) || "",
      program: plainText(p["番組名"]?.rich_text),
      score: plainText(p["スコア"]?.rich_text),
      description: plainText(p["記録説明"]?.rich_text),
      videoUrl: validHttp(p["映像リンク"]?.url),
      image: image || previous.image || "news/the-show-first-win.jpeg",
      order,
      notionPageId: page.id,
      notionUrl: page.url || "",
    });
  } else if (type === "Melonチャート") {
    melonRecords.push({
      title,
      song: plainText(p["曲名"]?.rich_text),
      releaseDate: p["発売日"]?.date?.start?.slice(0, 10) || "",
      top100Peak: p["TOP100最高順位"]?.number ?? null,
      dailyPeak: p["日間最高順位"]?.number ?? null,
      description: plainText(p["記録説明"]?.rich_text),
      mvUrl: validHttp(p["MVリンク"]?.url),
      image: image || previous.image || "news/melon-top100-first.jpg",
      order,
      notionPageId: page.id,
      notionUrl: page.url || "",
    });
  }
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
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl, musicShowWins, melonRecords };
await mkdir("data", { recursive: true });
await writeFile("data/records.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile("data/records-data.js", `window.RESCENE_RECORDS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
await writeFile("data/notion-records-sync-status.json", `${JSON.stringify({ generatedAt, dataSourceId, queriedPages: pages.length, musicShowWins: musicShowWins.length, melonRecords: melonRecords.length }, null, 2)}\n`, "utf8");

await execFileAsync(process.execPath, ["scripts/render-record-pages.mjs"]);
console.log(`Notion音楽記録を同期しました（音楽番組1位 ${musicShowWins.length}件 / Melon ${melonRecords.length}件 / 変更: ${changed ? "あり" : "なし"}）。`);
