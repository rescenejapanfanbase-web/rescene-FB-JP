import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_NEWS_DATA_SOURCE_ID || "3a2229d2-19da-8034-a171-000b9f6bfff2";
const notionVersion = "2026-03-11";
const notionApiBase = (process.env.NOTION_API_BASE || "https://api.notion.com").replace(/\/$/, "");
const imageDirectory = "assets/news/notion";
const fallbackImage = "news/fanbase-site.jpg";
const syncStatusPath = "data/notion-news-sync-status.json";

if (!token) {
  throw new Error("NOTION_TOKEN が設定されていません。スケジュール連携で使っている同じSecretを利用できます。");
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

const translationAliases = {
  ko: {
    title: ["タイトル（韓国語）", "タイトル_KO", "韓国語タイトル"],
    text: ["概要（韓国語）", "概要_KO", "韓国語概要"],
    body: ["本文（韓国語）", "本文_KO", "韓国語本文"],
    label: ["ラベル（韓国語）", "ラベル_KO", "韓国語ラベル"],
    sourceLabel: ["リンク名（韓国語）", "リンク名_KO", "韓国語リンク名"],
    categoryName: ["カテゴリー（韓国語）", "カテゴリー_KO", "韓国語カテゴリー"],
  },
  en: {
    title: ["タイトル（英語）", "タイトル_EN", "英語タイトル"],
    text: ["概要（英語）", "概要_EN", "英語概要"],
    body: ["本文（英語）", "本文_EN", "英語本文"],
    label: ["ラベル（英語）", "ラベル_EN", "英語ラベル"],
    sourceLabel: ["リンク名（英語）", "リンク名_EN", "英語リンク名"],
    categoryName: ["カテゴリー（英語）", "カテゴリー_EN", "英語カテゴリー"],
  },
};

function readTranslations(properties) {
  const translations = {};
  for (const language of ["ko", "en"]) {
    const values = {};
    for (const [field, aliases] of Object.entries(translationAliases[language])) {
      const value = propertyText(properties, aliases);
      if (value) values[field] = value;
    }
    if (Object.keys(values).length) translations[language] = values;
  }
  return translations;
}

const categoryType = {
  "お知らせ": "notice",
  "リリース": "release",
  "記録": "notice",
  "イベント": "event",
  "広報大使": "ambassador",
  "記念日": "notice",
};

const defaultLabel = {
  "お知らせ": "NOTICE",
  "リリース": "RELEASE",
  "記録": "RECORD",
  "イベント": "EVENT",
  "広報大使": "AMBASSADOR",
  "記念日": "ANNIVERSARY",
};

const preferredImageProperties = ["画像", "ニュース画像", "サムネイル", "アイキャッチ"];
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"]);
const removableExtensions = [".jpg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"];
const execFileAsync = promisify(execFile);

function stableSlug(title, pageId) {
  const ascii = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = String(pageId ?? "").replaceAll("-", "").slice(-10);
  return `${ascii || "notion-news"}-${suffix}`;
}

function normalizeLocalPath(value) {
  return String(value || "").trim().replace(/^\/+/, "").replaceAll("\\", "/");
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
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

function fileObjects(value) {
  if (Array.isArray(value?.files)) return value.files;
  if (value?.type === "files" && Array.isArray(value[value.type])) return value[value.type];
  return [];
}

function notionFiles(property) {
  return fileObjects(property)
    .map((file, index) => ({
      url: file?.external?.url ?? file?.file?.url ?? "",
      name: file?.name ?? `image-${index + 1}`,
      expiryTime: file?.file?.expiry_time ?? "",
      type: file?.type ?? (file?.file ? "file" : file?.external ? "external" : "unknown"),
    }))
    .filter((file) => /^https?:\/\//i.test(file.url));
}

function coverFile(page) {
  const cover = page?.cover;
  const url = cover?.external?.url ?? cover?.file?.url ?? "";
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    name: `cover-${String(page?.id || "news")}.jpg`,
    expiryTime: cover?.file?.expiry_time ?? "",
    type: cover?.type ?? "cover",
  };
}

function imagePropertyCandidates(properties = {}) {
  const seen = new Set();
  const candidates = [];

  for (const name of preferredImageProperties) {
    if (properties[name] && !seen.has(name)) {
      candidates.push([name, properties[name]]);
      seen.add(name);
    }
  }

  for (const [name, property] of Object.entries(properties)) {
    if (seen.has(name)) continue;
    if (!/(画像|写真|サムネイル|アイキャッチ|image|photo)/i.test(name)) continue;
    candidates.push([name, property]);
    seen.add(name);
  }
  return candidates;
}

async function retrievePage(pageId) {
  return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`);
}

async function retrievePropertyItem(pageId, propertyId) {
  if (!propertyId) return null;
  return notionRequest(`/v1/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}`);
}

async function findImageUpload(page) {
  const properties = page?.properties ?? {};

  for (const [name, property] of imagePropertyCandidates(properties)) {
    let files = notionFiles(property);

    // Data source query responses can omit or lag file values. Re-read the exact
    // property item before deciding that the image column is empty.
    if (!files.length && property?.id && (property?.type === "files" || "files" in property)) {
      try {
        const propertyItem = await retrievePropertyItem(page.id, property.id);
        files = notionFiles(propertyItem);
      } catch (error) {
        console.warn(`画像プロパティの再取得に失敗: ${page.id} / ${name} / ${error.message}`);
      }
    }

    if (files[0]) return { file: files[0], propertyName: name };
  }

  const cover = coverFile(page);
  return cover ? { file: cover, propertyName: "ページカバー" } : null;
}

function extensionFrom(name, contentType, url) {
  const fromName = extname(String(name || "").split("?")[0]).toLowerCase();
  if (supportedExtensions.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;

  try {
    const fromUrl = extname(new URL(url).pathname).toLowerCase();
    if (supportedExtensions.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  } catch {}

  if (/heic|heif/i.test(contentType || "")) return ".heic";
  if (/avif/i.test(contentType || "")) return ".avif";
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  if (/gif/i.test(contentType || "")) return ".gif";
  return ".jpg";
}

function looksLikeHtml(bytes) {
  const head = bytes.subarray(0, 200).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<title>access denied");
}

async function fetchImage(file, title) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(file.url, {
        redirect: "follow",
        cache: "no-store",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
        throw new Error(`画像ではないContent-Typeです: ${contentType}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 32) throw new Error(`画像データが小さすぎます: ${bytes.length} bytes`);
      if (looksLikeHtml(bytes)) throw new Error("画像URLからHTMLが返されました（署名URL切れまたは権限不足）");
      return { bytes, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw new Error(`Notionニュース画像の取得に失敗しました: ${title} / ${lastError?.message || lastError}`);
}

async function normalizeDownloadedImage(bytes, extension, contentType, basename) {
  if (![".heic", ".heif"].includes(extension)) return { bytes, extension, contentType };

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rescene-notion-image-"));
  const source = join(temporaryDirectory, `${basename}${extension}`);
  const target = join(temporaryDirectory, `${basename}.jpg`);
  try {
    await writeFile(source, bytes);
    const pythonCommand = process.env.PYTHON_COMMAND || "python3";
    await execFileAsync(pythonCommand, ["scripts/convert-heic.py", source, target], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const converted = await readFile(target);
    if (converted.length < 32) throw new Error("HEIC変換後の画像データが小さすぎます。");
    return { bytes: converted, extension: ".jpg", contentType: "image/jpeg" };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function saveImage(file, basename, title) {
  const fetched = await fetchImage(file, title);
  const detectedExtension = extensionFrom(file.name, fetched.contentType, file.url);
  const normalized = await normalizeDownloadedImage(fetched.bytes, detectedExtension, fetched.contentType, basename);
  const digest = createHash("sha256").update(normalized.bytes).digest("hex").slice(0, 12);
  await mkdir(imageDirectory, { recursive: true });

  const path = join(imageDirectory, `${basename}-${digest}${normalized.extension}`).replaceAll("\\", "/");
  const previous = await readFile(path).catch(() => null);
  if (!previous || !previous.equals(normalized.bytes)) await writeFile(path, normalized.bytes);

  for (const name of await readdir(imageDirectory).catch(() => [])) {
    if (!name.startsWith(`${basename}-`)) continue;
    if (!removableExtensions.some((candidate) => name.toLowerCase().endsWith(candidate))) continue;
    const otherPath = join(imageDirectory, name).replaceAll("\\", "/");
    if (otherPath !== path) await unlink(otherPath).catch(() => {});
  }
  return { path, bytes: normalized.bytes.length, contentType: normalized.contentType, extension: normalized.extension, digest };
}

async function resolveImagePath(value, title) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const normalized = normalizeLocalPath(raw);
  if (await fileExists(normalized)) return normalized;
  console.warn(`画像パスを無視します（ファイルなし）: ${title} / ${raw}`);
  return "";
}

async function cleanupImageDirectory(usedPaths) {
  await mkdir(imageDirectory, { recursive: true });
  for (const name of await readdir(imageDirectory).catch(() => [])) {
    if (name === ".gitkeep") continue;
    const path = join(imageDirectory, name).replaceAll("\\", "/");
    if (!usedPaths.has(path)) await unlink(path).catch(() => {});
  }
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
          { property: "公開日", date: { is_not_empty: true } },
        ],
      },
      sorts: [
        { property: "公開日", direction: "descending" },
        { property: "表示順", direction: "ascending" },
      ],
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

async function convertPage(queryPage, usedImages, statusRows) {
  // Always re-fetch the page immediately before reading the file property. Notion
  // file URLs are temporary, and this also avoids using a stale query response.
  let page = queryPage;
  try {
    page = await retrievePage(queryPage.id);
  } catch (error) {
    console.warn(`ページの再取得に失敗したためクエリ結果を使用: ${queryPage.id} / ${error.message}`);
  }

  const properties = page.properties ?? {};
  const title = plainText(properties["タイトル"]?.title);
  const published = properties["公開日"]?.date?.start;
  if (!title || !published) return null;

  const slug = stableSlug(title, page.id);
  const categoryName = properties["カテゴリー"]?.select?.name ?? "お知らせ";
  const summary = plainText(properties["概要"]?.rich_text) || plainText(properties["本文"]?.rich_text);
  const body = plainText(properties["本文"]?.rich_text) || summary;
  const sourceLink = properties["外部リンク"]?.url ?? "";
  const translations = readTranslations(properties);

  let image = "";
  let imageStatus = "fallback";
  let imageProperty = "";
  let imageFilename = "";
  let imageBytes = 0;
  let imageContentType = "";

  const upload = await findImageUpload(page);
  const configuredImagePath = plainText(properties["画像パス"]?.rich_text);
  if (upload) {
    try {
      const basename = `notion-${String(page.id || slug).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
      const saved = await saveImage(upload.file, basename, title);
      image = saved.path;
      usedImages.add(image);
      imageStatus = "notion-file";
      imageProperty = upload.propertyName;
      imageFilename = upload.file.name;
      imageBytes = saved.bytes;
      imageContentType = saved.contentType;
      console.log(`Notion画像を保存: ${title} / ${upload.propertyName} / ${upload.file.name} -> ${image} (${saved.bytes} bytes)`);
    } catch (error) {
      console.warn(`Notion画像の保存に失敗したため画像パスを確認します: ${title} / ${error.message}`);
      image = await resolveImagePath(configuredImagePath, title);
      if (image) {
        imageStatus = "local-path-after-notion-error";
      } else {
        throw error;
      }
    }
  } else {
    image = await resolveImagePath(configuredImagePath, title);
    if (image) imageStatus = "local-path";
    console.warn(`Notion画像なし: ${title} / 画像パス=${configuredImagePath || "(空欄)"}`);
  }

  statusRows.push({
    title,
    pageId: page.id,
    lastEditedTime: page.last_edited_time || "",
    imageStatus,
    imageProperty,
    imageFilename,
    imagePath: image || fallbackImage,
    imageBytes,
    imageContentType,
  });

  return {
    slug,
    date: published.slice(0, 10).replaceAll("-", "."),
    sortDate: published.slice(0, 10),
    order: properties["表示順"]?.number ?? 9999,
    category: categoryType[categoryName] ?? "notice",
    categoryName,
    label: plainText(properties["ラベル"]?.rich_text) || defaultLabel[categoryName] || "NEWS",
    title,
    text: summary || body || "詳細は記事ページをご確認ください。",
    body: body || summary || "",
    image,
    sourceLink,
    sourceLabel: plainText(properties["リンク名"]?.rich_text) || (sourceLink ? "関連リンクを見る" : ""),
    translations,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}

function mergeNews(manualNews, notionNews) {
  const merged = manualNews.map((item) => ({ ...item }));

  for (const notionItem of notionNews) {
    const index = merged.findIndex((item) =>
      (item.notionPageId && notionItem.notionPageId && item.notionPageId === notionItem.notionPageId)
      || String(item.title || "").trim() === String(notionItem.title || "").trim());

    if (index >= 0) {
      const current = merged[index];
      merged[index] = {
        ...current,
        ...notionItem,
        slug: current.slug || notionItem.slug,
        image: notionItem.image || current.image || fallbackImage,
        sourceLink: notionItem.sourceLink || current.sourceLink || "",
        sourceLabel: notionItem.sourceLabel || current.sourceLabel || "",
        translations: {
          ...(current.translations || {}),
          ...(notionItem.translations || {}),
        },
      };
    } else {
      merged.push({ ...notionItem, image: notionItem.image || fallbackImage });
    }
  }

  return merged
    .map(({ sortDate, order, ...item }) => ({
      ...item,
      image: item.image || fallbackImage,
      _sortDate: sortDate || String(item.date || "").replaceAll(".", "-"),
      _order: order ?? 9999,
    }))
    .sort((a, b) => b._sortDate.localeCompare(a._sortDate) || a._order - b._order || a.title.localeCompare(b.title, "ja"))
    .map(({ _sortDate, _order, ...item }) => item);
}

const queryPages = await queryAllPages();
const usedImages = new Set();
const statusRows = [];
const notionNews = [];
for (const page of queryPages) {
  const item = await convertPage(page, usedImages, statusRows);
  if (item) notionNews.push(item);
}
await cleanupImageDirectory(usedImages);

const manualNews = await readJson("data/news-manual.json", []);
const news = mergeNews(Array.isArray(manualNews) ? manualNews : [], notionNews);

const existingPayload = await readJson("data/news.json", { news: [] });
const payloadChanged = JSON.stringify(existingPayload.news ?? []) !== JSON.stringify(news);
const generatedAt = payloadChanged ? new Date().toISOString() : (existingPayload.generatedAt || new Date().toISOString());
const payload = {
  generatedAt,
  source: "manual+notion",
  dataSourceId,
  notionCount: notionNews.length,
  news,
};

const statusPayload = {
  generatedAt,
  dataSourceId,
  queriedPages: queryPages.length,
  notionNews: notionNews.length,
  notionImages: statusRows.filter((item) => item.imageStatus === "notion-file").length,
  rows: statusRows,
};

await mkdir("data", { recursive: true });
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_NEWS = ${JSON.stringify(news, null, 2)};\n`;
const statusText = `${JSON.stringify(statusPayload, null, 2)}\n`;
if ((await readFile("data/news.json", "utf8").catch(() => "")) !== jsonText) {
  await writeFile("data/news.json", jsonText, "utf8");
}
if ((await readFile("data/news-data.js", "utf8").catch(() => "")) !== jsText) {
  await writeFile("data/news-data.js", jsText, "utf8");
}
if ((await readFile(syncStatusPath, "utf8").catch(() => "")) !== statusText) {
  await writeFile(syncStatusPath, statusText, "utf8");
}

console.log(`${notionNews.length}件のNotion公開ニュースを同期しました（Notion画像 ${statusPayload.notionImages}件 / 全体 ${news.length}件 / データ変更: ${payloadChanged ? "あり" : "なし"}）。`);
