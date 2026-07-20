import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_NEWS_DATA_SOURCE_ID || "3a2229d2-19da-8034-a171-000b9f6bfff2";
const notionVersion = "2026-03-11";

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

function notionFileUrl(property) {
  const first = property?.files?.[0];
  return first?.external?.url ?? first?.file?.url ?? "";
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

function convertPage(page) {
  const properties = page.properties ?? {};
  const title = plainText(properties["タイトル"]?.title);
  const published = properties["公開日"]?.date?.start;
  if (!title || !published) return null;

  const categoryName = properties["カテゴリー"]?.select?.name ?? "お知らせ";
  const summary = plainText(properties["概要"]?.rich_text) || plainText(properties["本文"]?.rich_text);
  const body = plainText(properties["本文"]?.rich_text) || summary;
  const imagePath = plainText(properties["画像パス"]?.rich_text);
  const uploadedImage = notionFileUrl(properties["画像"]);
  const sourceLink = properties["外部リンク"]?.url ?? "";

  return {
    slug: stableSlug(title, page.id),
    date: published.slice(0, 10).replaceAll("-", "."),
    sortDate: published.slice(0, 10),
    order: properties["表示順"]?.number ?? 9999,
    category: categoryType[categoryName] ?? "notice",
    categoryName,
    label: plainText(properties["ラベル"]?.rich_text) || defaultLabel[categoryName] || "NEWS",
    title,
    text: summary || body || "詳細は記事ページをご確認ください。",
    body: body || summary || "",
    image: imagePath || uploadedImage || "news/fanbase-site.jpg",
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
const notionNews = pages.map(convertPage).filter(Boolean);
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
