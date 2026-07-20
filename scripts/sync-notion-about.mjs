import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_ABOUT_DATA_SOURCE_ID || "ea6db3e1-e0ad-4441-9b7f-c41a739b92bd";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/about/notion";
const databaseUrl = "https://app.notion.com/p/233f65d59c4347188049afdeda030c80";
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const dateValue = (property) => property?.date?.start?.slice(0, 10) ?? "";
const safeSlug = (value, pageId = "") => String(value || "")
  .normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54)
  || `about-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeAnchor = (value) => String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
const normalizeHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : "";

function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return { url: first?.external?.url ?? first?.file?.url ?? "", name: first?.name ?? "about" };
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

function extensionFrom(name, contentType, url) {
  const known = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const fromName = extname(String(name || "").split("?")[0]).toLowerCase();
  if (known.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".jpg";
}
async function readBytes(path) { try { return await readFile(path); } catch { return null; } }
async function saveImage(file, slug) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  const response = await fetch(file.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`About画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
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

async function convertPage(page) {
  const properties = page.properties ?? {};
  const title = propertyText(properties["タイトル"]);
  if (!title) return null;
  const slug = safeSlug(title, page.id);
  const upload = notionFile(properties["画像"]);
  const image = upload?.url ? await saveImage(upload, slug) : propertyText(properties["画像パス"]);
  return {
    slug,
    title,
    type: properties["種類"]?.select?.name ?? "紹介文",
    englishLabel: propertyText(properties["英語ラベル"]),
    heading: propertyText(properties["見出し"]),
    value: propertyText(properties["値"]),
    description: propertyText(properties["説明"]),
    note: propertyText(properties["補足"]),
    date: dateValue(properties["日付"]),
    image,
    colorCode: normalizeHex(propertyText(properties["カラーコード"])),
    linkUrl: propertyText(properties["リンクURL"]),
    buttonLabel: propertyText(properties["ボタン文言"]),
    anchor: safeAnchor(propertyText(properties["アンカー"])),
    order: properties["表示順"]?.number ?? 9999,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }

const pages = await queryAllPages();
const items = [];
for (const page of pages) { const item = await convertPage(page); if (item) items.push(item); }
items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja"));

await mkdir(imageDirectory, { recursive: true });
const usedImages = new Set(items.map((item) => item.image).filter((image) => String(image).startsWith(`${imageDirectory}/`)));
for (const name of await readdir(imageDirectory).catch(() => [])) {
  if (name === ".gitkeep") continue;
  const path = join(imageDirectory, name).replaceAll("\\", "/");
  if (!usedImages.has(path)) await unlink(path).catch(() => {});
}

const previous = await readJson("data/about.json", {});
const comparablePrevious = { items: previous.items ?? [] };
const comparableNext = { items };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, items };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_ABOUT = ${JSON.stringify(payload, null, 2)};\n`;
if ((await readFile("data/about.json", "utf8").catch(() => "")) !== jsonText) await writeFile("data/about.json", jsonText, "utf8");
if ((await readFile("data/about-data.js", "utf8").catch(() => "")) !== jsText) await writeFile("data/about-data.js", jsText, "utf8");
console.log(`${items.length}件の公開Aboutコンテンツを同期しました。データ変更: ${changed ? "あり" : "なし"}`);
