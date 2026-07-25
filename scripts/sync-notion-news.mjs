import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_NEWS_DATA_SOURCE_ID || "3a2229d2-19da-8034-a171-000b9f6bfff2";
const notionVersion = "2026-03-11";
const notionApiBase = (process.env.NOTION_API_BASE || "https://api.notion.com").replace(/\/$/, "");
const imageDirectory = "assets/news/notion";
const fallbackImage = "news/fanbase-site.jpg";

if (!token) {
  throw new Error("NOTION_TOKEN が設定されていません。スケジュール連携で使っている同じSecretを利用できます。");
}

const plainText = (items = []) =>
  items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();

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
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

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

function notionFiles(property) {
  return (property?.files ?? [])
    .map((file, index) => ({
      url: file?.external?.url ?? file?.file?.url ?? "",
      name: file?.name ?? `image-${index + 1}`,
    }))
    .filter((file) => /^https?:\/\//i.test(file.url));
}

function coverFile(page) {
  const cover = page?.cover;
  const url = cover?.external?.url ?? cover?.file?.url ?? "";
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, name: `cover-${String(page?.id || "news")}.jpg` };
}

function findImageUpload(page) {
  const properties = page?.properties ?? {};

  for (const name of preferredImageProperties) {
    const file = notionFiles(properties[name])[0];
    if (file) return { file, propertyName: name };
  }

  for (const [name, property] of Object.entries(properties)) {
    if (!/(画像|写真|サムネイル|アイキャッチ|image|photo)/i.test(name)) continue;
    const file = notionFiles(property)[0];
    if (file) return { file, propertyName: name };
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

  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  if (/gif/i.test(contentType || "")) return ".gif";
  return ".jpg";
}

async function fetchImage(file, title) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(file.url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
        throw new Error(`画像ではないContent-Typeです: ${contentType}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 32) throw new Error(`画像データが小さすぎます: ${bytes.length} bytes`);
      return { bytes, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw new Error(`Notionニュース画像の取得に失敗しました: ${title} / ${lastError?.message || lastError}`);
}

async function saveImage(file, basename, title) {
  const { bytes, contentType } = await fetchImage(file, title);
  const extension = extensionFrom(file.name, contentType, file.url);
  await mkdir(imageDirectory, { recursive: true });

  const path = join(imageDirectory, `${basename}${extension}`).replaceAll("\\", "/");
  const previous = await readFile(path).catch(() => null);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);

  for (const otherExtension of [".jpg", ".png", ".webp", ".gif"]) {
    const otherPath = join(imageDirectory, `${basename}${otherExtension}`).replaceAll("\\", "/");
    if (otherPath !== path) await unlink(otherPath).catch(() => {});
  }
  return path;
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

    const response = await fetch(`${notionApiBase}/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Notion API ${response.status}: ${detail}`);
    }

    const data = await response.json();
    results.push(...data.results.filter((item) => item.object === "page"));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return results;
}

async function convertPage(page, usedImages) {
  const properties = page.properties ?? {};
  const title = plainText(properties["タイトル"]?.title);
  const published = properties["公開日"]?.date?.start;
  if (!title || !published) return null;

  const slug = stableSlug(title, page.id);
  const categoryName = properties["カテゴリー"]?.select?.name ?? "お知らせ";
  const summary = plainText(properties["概要"]?.rich_text) || plainText(properties["本文"]?.rich_text);
  const body = plainText(properties["本文"]?.rich_text) || summary;
  const sourceLink = properties["外部リンク"]?.url ?? "";

  let image = "";
  const upload = findImageUpload(page);
  if (upload) {
    const basename = `notion-${String(page.id || slug).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    image = await saveImage(upload.file, basename, title);
    usedImages.add(image);
    console.log(`Notion画像を保存: ${title} / ${upload.propertyName} -> ${image}`);
  } else {
    image = await resolveImagePath(plainText(properties["画像パス"]?.rich_text), title);
  }

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

const pages = await queryAllPages();
const usedImages = new Set();
const notionNews = [];
for (const page of pages) {
  const item = await convertPage(page, usedImages);
  if (item) notionNews.push(item);
}
await cleanupImageDirectory(usedImages);

const manualNews = await readJson("data/news-manual.json", []);
const news = mergeNews(Array.isArray(manualNews) ? manualNews : [], notionNews);

const existingPayload = await readJson("data/news.json", { news: [] });
const payloadChanged = JSON.stringify(existingPayload.news ?? []) !== JSON.stringify(news);
const payload = {
  generatedAt: payloadChanged ? new Date().toISOString() : (existingPayload.generatedAt || new Date().toISOString()),
  source: "manual+notion",
  dataSourceId,
  notionCount: notionNews.length,
  news,
};

await mkdir("data", { recursive: true });
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_NEWS = ${JSON.stringify(news, null, 2)};\n`;
if ((await readFile("data/news.json", "utf8").catch(() => "")) !== jsonText) {
  await writeFile("data/news.json", jsonText, "utf8");
}
if ((await readFile("data/news-data.js", "utf8").catch(() => "")) !== jsText) {
  await writeFile("data/news-data.js", jsText, "utf8");
}

console.log(`${notionNews.length}件のNotion公開ニュースを同期しました（全体 ${news.length}件 / データ変更: ${payloadChanged ? "あり" : "なし"}）。`);
