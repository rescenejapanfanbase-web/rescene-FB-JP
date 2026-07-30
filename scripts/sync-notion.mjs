import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { writeMergedSchedule } from "./merge-schedules.mjs";
import { scheduleLinkFromProperties } from "./notion-schedule-links.mjs";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID || "eea8a017-8ad1-4c00-ba09-8bca95cf8618";
const notionVersion = "2026-03-11";
const notionApiBase = (process.env.NOTION_API_BASE || "https://api.notion.com").replace(/\/$/, "");
const imageDirectory = "assets/schedule/notion";
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"]);
const execFileAsync = promisify(execFile);

if (!token) {
  throw new Error("NOTION_TOKEN が設定されていません。GitHubのSettings → Secrets and variables → Actionsで登録してください。");
}

const plainText = (items = []) =>
  items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
function propertyText(properties, aliases = []) {
  for (const name of aliases) {
    const property = properties?.[name];
    if (!property) continue;
    const value = plainText(property.title || property.rich_text || property.text || property[property.type]);
    if (value) return value;
  }
  return "";
}
function scheduleTranslations(properties) {
  const fields = {
    ko: {
      title: ["イベント名（韓国語）", "イベント名_KO", "韓国語イベント名"],
      description: ["テキスト（韓国語）", "説明（韓国語）", "テキスト_KO", "韓国語説明"],
      linkLabel: ["リンク名（韓国語）", "リンク名_KO", "韓国語リンク名"],
      category: ["カテゴリー（韓国語）", "カテゴリー_KO", "韓国語カテゴリー"],
    },
    en: {
      title: ["イベント名（英語）", "イベント名_EN", "英語イベント名"],
      description: ["テキスト（英語）", "説明（英語）", "テキスト_EN", "英語説明"],
      linkLabel: ["リンク名（英語）", "リンク名_EN", "英語リンク名"],
      category: ["カテゴリー（英語）", "カテゴリー_EN", "英語カテゴリー"],
    },
  };
  const translations = {};
  for (const language of ["ko", "en"]) {
    const values = {};
    for (const [field, aliases] of Object.entries(fields[language])) {
      const value = propertyText(properties, aliases);
      if (value) values[field] = value;
    }
    if (Object.keys(values).length) translations[language] = values;
  }
  return translations;
}
const normalizeLocalPath = (value = "") => String(value).trim().replace(/^\/+/, "").replaceAll("\\", "/");

const categoryType = {
  Birthday: "birthday",
  イベント: "event",
  出演: "event",
  リリース: "release",
  投票: "vote",
  記録: "record",
  お知らせ: "notice",
  その他: "event",
  仕事: "event",
  プライベート: "event",
  音楽番組: "event",
};

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
      filter: {
        and: [
          { property: "公開", checkbox: { equals: true } },
          { property: "日付", date: { is_not_empty: true } },
        ],
      },
      sorts: [{ property: "日付", direction: "ascending" }],
    };
    if (startCursor) body.start_cursor = startCursor;
    const data = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    results.push(...data.results.filter((item) => item.object === "page"));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function retrievePage(pageId) {
  return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`);
}

async function retrieveProperty(pageId, propertyId) {
  return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}`);
}

function notionFiles(property) {
  const values = Array.isArray(property?.files)
    ? property.files
    : (property?.type === "files" && Array.isArray(property[property.type]) ? property[property.type] : []);
  return values.map((file, index) => ({
    url: file?.external?.url ?? file?.file?.url ?? "",
    name: file?.name ?? `schedule-image-${index + 1}`,
  })).filter((file) => /^https?:\/\//i.test(file.url));
}

async function findImageUpload(page) {
  for (const propertyName of ["画像", "スケジュール画像"]) {
    const property = page?.properties?.[propertyName];
    if (!property) continue;
    let files = notionFiles(property);
    if (!files.length && property.id) {
      try {
        files = notionFiles(await retrieveProperty(page.id, property.id));
      } catch (error) {
        console.warn(`スケジュール画像プロパティの再取得に失敗: ${page.id} / ${propertyName} / ${error.message}`);
      }
    }
    if (files[0]) return { ...files[0], propertyName };
  }
  return null;
}

function extensionFrom(name, contentType, url) {
  const candidates = [extname(String(name || "").split("?")[0]).toLowerCase()];
  try { candidates.push(extname(new URL(url).pathname).toLowerCase()); } catch {}
  for (const candidate of candidates) {
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
      const response = await fetch(file.url, {
        redirect: "follow",
        cache: "no-store",
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          "User-Agent": "RESCENE-JAPAN-FANBASE/1.0",
        },
      });
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
  const directory = await mkdtemp(join(tmpdir(), "rescene-schedule-image-"));
  const source = join(directory, `${basename}${extension}`);
  const target = join(directory, `${basename}.jpg`);
  try {
    await writeFile(source, bytes);
    await execFileAsync(process.env.PYTHON_COMMAND || "python3", ["scripts/convert-heic.py", source, target]);
    return { bytes: await readFile(target), extension: ".jpg" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function saveImage(file, pageId) {
  const fetched = await downloadImage(file);
  const basename = `schedule-${String(pageId).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  const normalized = await normalizeImage(fetched.bytes, extensionFrom(file.name, fetched.contentType, file.url), basename);
  const digest = createHash("sha256").update(normalized.bytes).digest("hex").slice(0, 12);
  await mkdir(imageDirectory, { recursive: true });
  const output = join(imageDirectory, `${basename}-${digest}${normalized.extension}`).replaceAll("\\", "/");
  await writeFile(output, normalized.bytes);
  for (const name of await readdir(imageDirectory).catch(() => [])) {
    const candidate = join(imageDirectory, name).replaceAll("\\", "/");
    if (name.startsWith(`${basename}-`) && candidate !== output) await unlink(candidate).catch(() => {});
  }
  return output;
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function resolveConfiguredImage(value, title) {
  const configured = String(value || "").trim();
  if (!configured) return "";
  if (/^https?:\/\//i.test(configured)) return configured;
  const normalized = normalizeLocalPath(configured);
  if (normalized && await fileExists(normalized)) return normalized;
  console.warn(`スケジュール画像パスを無視（ファイルなし）: ${title} / ${configured}`);
  return "";
}

async function resolveImage(page, title) {
  const upload = await findImageUpload(page);
  if (upload) {
    try {
      const path = await saveImage(upload, page.id);
      console.log(`Notionスケジュール画像を保存: ${title} / ${upload.propertyName} / ${upload.name} -> ${path}`);
      return path;
    } catch (error) {
      console.warn(`Notionスケジュール画像の保存に失敗したため画像パスを確認します: ${title} / ${error.message}`);
    }
  }
  const imagePath = plainText(page.properties?.["画像パス"]?.rich_text);
  const configured = await resolveConfiguredImage(imagePath, title);
  if (configured) return configured;
  return page.properties?.["画像URL"]?.url ?? "";
}

async function convertPage(page) {
  const properties = page.properties ?? {};
  const title = plainText(properties["イベント名"]?.title);
  const date = properties["日付"]?.date;
  if (!title || !date?.start) return null;

  const categoryProperty = properties["カテゴリー"] ?? {};
  const category = categoryProperty.select?.name
    ?? categoryProperty.status?.name
    ?? categoryProperty.multi_select?.[0]?.name
    ?? "イベント";
  const summary = plainText(properties["テキスト"]?.rich_text);
  const memo = plainText(properties["メモ"]?.rich_text);
  const description = [...new Set([summary, memo].filter(Boolean))].join("\n");
  const { link, linkLabel } = scheduleLinkFromProperties(properties);

  return {
    id: page.id,
    title,
    date: date.start.slice(0, 10),
    start: date.start,
    end: date.end ?? "",
    category,
    type: /誕生日|birthday/i.test(`${category} ${title}`) ? "birthday"
      : categoryType[category]
        ?? (/リリース|release/i.test(category) ? "release"
          : /投票|vote/i.test(category) ? "vote"
            : /記録|record|anniversary/i.test(category) ? "record"
              : /お知らせ|notice/i.test(category) ? "notice" : "event"),
    description,
    link,
    linkLabel,
    image: await resolveImage(page, title),
    translations: scheduleTranslations(properties),
    notionUrl: page.url ?? "",
  };
}

async function readExistingNotionSchedule() {
  try {
    const raw = await readFile("data/schedule-notion.json", "utf8");
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      generatedAt: parsed.generatedAt ?? null,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { exists: false, generatedAt: null, events: [] };
  }
}

const queryPages = await queryAllPages();
const events = [];
const usedImages = new Set();
for (const queryPage of queryPages) {
  let page = queryPage;
  try { page = await retrievePage(queryPage.id); }
  catch (error) { console.warn(`スケジュールページ再取得失敗: ${queryPage.id} / ${error.message}`); }
  const event = await convertPage(page);
  if (!event) continue;
  event.source = "notion";
  if (String(event.image).startsWith(`${imageDirectory}/`)) usedImages.add(event.image);
  events.push(event);
}
events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "ja"));

await mkdir(imageDirectory, { recursive: true });
for (const name of await readdir(imageDirectory).catch(() => [])) {
  const path = join(imageDirectory, name).replaceAll("\\", "/");
  if (!usedImages.has(path)) await unlink(path).catch(() => {});
}

const existingSchedule = await readExistingNotionSchedule();
const eventsChanged = !existingSchedule.exists || JSON.stringify(existingSchedule.events) !== JSON.stringify(events);
const generatedAt = eventsChanged ? new Date().toISOString() : existingSchedule.generatedAt || new Date().toISOString();

await mkdir("data", { recursive: true });
if (eventsChanged) {
  const payload = { generatedAt, source: "notion", dataSourceId, events };
  await writeFile("data/schedule-notion.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const merged = await writeMergedSchedule();
if (!eventsChanged && !merged.changed) {
  console.log(`変更なし（Notion ${events.length}件 / 統合後 ${merged.total}件）`);
} else {
  console.log(
    `${events.length}件のNotion予定を同期しました。Notion更新: ${eventsChanged ? "あり" : "なし"} / `
    + `統合後 ${merged.total}件（Plus Chat追加 ${merged.plusChatAdded}件 / 重複除外 ${merged.plusChatDuplicates}件）`,
  );
}
