import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_CONTACT_DATA_SOURCE_ID || "669db280-d2ac-45f2-8515-0992e002239c";
const notionVersion = "2026-03-11";
const databaseUrl = "https://app.notion.com/p/1220e9a875ac4374bd9cf8167565723c";
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, pageId = "") => String(value || "")
  .normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54)
  || `contact-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeAnchor = (value) => String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");

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
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": notionVersion, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Notion API ${response.status}: ${await response.text()}`);
    const data = await response.json();
    results.push(...data.results.filter((item) => item.object === "page"));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}

function convertPage(page) {
  const properties = page.properties ?? {};
  const title = propertyText(properties["タイトル"]);
  if (!title) return null;
  return {
    slug: safeSlug(title, page.id),
    title,
    type: properties["種類"]?.select?.name ?? "連絡経路",
    englishLabel: propertyText(properties["英語ラベル"]),
    heading: propertyText(properties["見出し"]),
    description: propertyText(properties["説明"]),
    number: propertyText(properties["番号"]),
    buttonLabel: propertyText(properties["ボタン文言"]),
    linkUrl: propertyText(properties["リンクURL"]),
    anchor: safeAnchor(propertyText(properties["アンカー"])),
    order: properties["表示順"]?.number ?? 9999,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }

const pages = await queryAllPages();
const items = pages.map(convertPage).filter(Boolean).sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title,"ja"));
const previous = await readJson("data/contact.json", {});
const changed = JSON.stringify(previous.items ?? []) !== JSON.stringify(items);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, items };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_CONTACT = ${JSON.stringify(payload, null, 2)};\n`;
await mkdir("data", { recursive: true });
if ((await readFile("data/contact.json", "utf8").catch(() => "")) !== jsonText) await writeFile("data/contact.json", jsonText, "utf8");
if ((await readFile("data/contact-data.js", "utf8").catch(() => "")) !== jsText) await writeFile("data/contact-data.js", jsText, "utf8");
console.log(`${items.length}件の公開お問い合わせコンテンツを同期しました。データ変更: ${changed ? "あり" : "なし"}`);
