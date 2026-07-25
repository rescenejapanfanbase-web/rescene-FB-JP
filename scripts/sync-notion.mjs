import { writeMergedSchedule } from "./merge-schedules.mjs";
import { scheduleLinkFromProperties } from "./notion-schedule-links.mjs";
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
  音楽番組: "event",
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
    image: properties["画像URL"]?.url ?? "",
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

const pages = await queryAllPages();
const events = pages
  .map(convertPage)
  .filter(Boolean)
  .map((event) => ({ ...event, source: "notion" }))
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "ja"));

const existingSchedule = await readExistingNotionSchedule();
const eventsChanged =
  !existingSchedule.exists
  || JSON.stringify(existingSchedule.events) !== JSON.stringify(events);
const generatedAt = eventsChanged
  ? new Date().toISOString()
  : existingSchedule.generatedAt || new Date().toISOString();

await mkdir("data", { recursive: true });
if (eventsChanged) {
  const payload = {
    generatedAt,
    source: "notion",
    dataSourceId,
    events,
  };
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
