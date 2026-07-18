import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID || "eea8a017-8ad1-4c00-ba09-8bca95cf8618";
const notionVersion = "2026-03-11";

if (!token) {
  throw new Error("NOTION_TOKEN が設定されていません。GitHubのSettings → Secrets and variables → Actionsで登録してください。");
}

const plainText = (items = []) =>
  items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();

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
};

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

    const response = await fetch(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": notionVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

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
  const title = plainText(properties["イベント名"]?.title);
  const date = properties["日付"]?.date;
  if (!title || !date?.start) return null;

  const category = properties["カテゴリー"]?.select?.name ?? "イベント";
  return {
    id: page.id,
    title,
    date: date.start.slice(0, 10),
    start: date.start,
    end: date.end ?? "",
    category,
    type: categoryType[category] ?? "event",
    description: plainText(properties["メモ"]?.rich_text),
    link: properties["リンク"]?.url ?? "",
    linkLabel: plainText(properties["リンク名"]?.rich_text) || "詳細を見る",
    image: properties["画像URL"]?.url ?? "",
    notionUrl: page.url ?? "",
  };
}

async function readExistingEvents() {
  try {
    const raw = await readFile("data/schedule.json", "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

const pages = await queryAllPages();
const events = pages
  .map(convertPage)
  .filter(Boolean)
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "ja"));

const existingEvents = await readExistingEvents();
if (JSON.stringify(existingEvents) === JSON.stringify(events)) {
  console.log(`変更なし（公開予定 ${events.length}件）`);
  process.exit(0);
}

await mkdir("data", { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  source: "notion",
  dataSourceId,
  events,
};

await writeFile("data/schedule.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(
  "data/schedule-data.js",
  `window.RESCENE_SCHEDULE = ${JSON.stringify(events, null, 2)};\n`,
  "utf8",
);

console.log(`${events.length}件の公開予定を同期しました。`);
