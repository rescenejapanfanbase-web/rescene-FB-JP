import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_NEWS_DATA_SOURCE_ID || "3a2229d2-19da-8034-a171-000b9f6bfff2";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/news/notion";

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

function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return {
    url: first?.external?.url ?? first?.file?.url ?? "",
    name: first?.name ?? "news",
  };
}

function extensionFrom(name, contentType, url) {
  const known = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const fromName = extname(String(name || "").split("?")[0]).toLowerCase();
  if (known.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  try {
    const fromUrl = extname(new URL(url).pathname).toLowerCase();
    if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  } catch {}
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".jpg";
}

async function readBytes(path) {
  try { return await readFile(path); } catch { return null; }
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)" },
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw lastError;
}

async function saveImage(file, slug) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  let response;
  try {
    response = await fetchWithRetry(file.url);
  } catch (error) {
    throw new Error(`ニュース画像取得失敗: ${error?.message || error} / ${file.url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`ニュース画像が空です: ${file.url}`);
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  await mkdir(imageDirectory, { recursive: true });
  const path = join(imageDirectory, `${slug}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) {
    const other = join(imageDirectory, `${slug}${otherExtension}`);
    if (other !== path) await unlink(other).catch(() => {});
  }
  return path.replaceAll("\\", "/");
}

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

    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
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

async function convertPage(page) {
  const properties = page.properties ?? {};
  const title = plainText(properties["タイトル"]?.title);
  const published = properties["公開日"]?.date?.start;
  if (!title || !published) return null;

  const categoryName = properties["カテゴリー"]?.select?.name ?? "お知らせ";
  const summary = plainText(properties["概要"]?.rich_text) || plainText(properties["本文"]?.rich_text);
  const body = plainText(properties["本文"]?.rich_text) || summary;
  const imagePathRaw = plainText(properties["画像パス"]?.rich_text);
  const imagePath = imagePathRaw.replace(/^\/+/, "");
  const uploadedImage = notionFile(properties["画像"]);
  const slug = stableSlug(title, page.id);

  let image = "";
  if (uploadedImage?.url) {
    image = await saveImage(uploadedImage, slug);
  } else if (imagePath) {
    const localImage = await readBytes(imagePath);
    if (localImage) {
      image = imagePath;
    } else {
      console.warn(`画像パスが存在しないため無視します: ${title} / ${imagePathRaw}`);
    }
  }
  const sourceLink = properties["外部リンク"]?.url ?? "";

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
    image: image || "news/fanbase-site.jpg",
    sourceLink,
    sourceLabel: plainText(properties["リンク名"]?.rich_text) || (sourceLink ? "関連リンクを見る" : ""),
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function mergeNews(manualNews, notionNews) {
  const merged = manualNews.map((item) => ({ ...item }));

  for (const notionItem of notionNews) {
    const index = merged.findIndex((item) => item.title.trim() === notionItem.title.trim());
    if (index >= 0) {
      const current = merged[index];
      merged[index] = {
        ...current,
        ...notionItem,
        slug: current.slug || notionItem.slug,
        image: notionItem.image === "news/fanbase-site.jpg" ? (current.image || notionItem.image) : notionItem.image,
        sourceLink: notionItem.sourceLink || current.sourceLink || "",
        sourceLabel: notionItem.sourceLabel || current.sourceLabel || "",
      };
    } else {
      merged.push(notionItem);
    }
  }

  return merged
    .map(({ sortDate, order, ...item }) => ({ ...item, _sortDate: sortDate || String(item.date || "").replaceAll(".", "-"), _order: order ?? 9999 }))
    .sort((a, b) => b._sortDate.localeCompare(a._sortDate) || a._order - b._order || a.title.localeCompare(b.title, "ja"))
    .map(({ _sortDate, _order, ...item }) => item);
}

const pages = await queryAllPages();
const notionNews = [];
for (const page of pages) {
  const item = await convertPage(page);
  if (item) notionNews.push(item);
}

await mkdir(imageDirectory, { recursive: true });
const usedImages = new Set(notionNews.map((item) => item.image).filter((image) => String(image).startsWith(`${imageDirectory}/`)));
for (const name of await readdir(imageDirectory).catch(() => [])) {
  if (name === ".gitkeep") continue;
  const path = join(imageDirectory, name).replaceAll("\\", "/");
  if (!usedImages.has(path)) await unlink(path).catch(() => {});
}
const manualNews = await readJson("data/news-manual.json", []);
const news = mergeNews(Array.isArray(manualNews) ? manualNews : [], notionNews);

const existingPayload = await readJson("data/news.json", { news: [] });
if (JSON.stringify(existingPayload.news ?? []) === JSON.stringify(news)) {
  console.log(`変更なし（Notion公開ニュース ${notionNews.length}件 / 全体 ${news.length}件）`);
  process.exit(0);
}

await mkdir("data", { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  source: "manual+notion",
  dataSourceId,
  notionCount: notionNews.length,
  news,
};

await writeFile("data/news.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile("data/news-data.js", `window.RESCENE_NEWS = ${JSON.stringify(news, null, 2)};\n`, "utf8");

console.log(`${notionNews.length}件のNotion公開ニュースを同期しました（全体 ${news.length}件）。`);
