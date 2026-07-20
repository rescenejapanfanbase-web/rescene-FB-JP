import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_HOMEPAGE_DATA_SOURCE_ID || "1a98fbc6-21d6-4a11-8ed9-19b228250182";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/home/notion";
const databaseUrl = "https://app.notion.com/p/23afd46c4c68443d89de65c74f605d68";
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, pageId = "") => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || `home-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeAnchor = (value) => String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
function notionFile(property) { const first = property?.files?.[0]; return first ? { url: first?.external?.url ?? first?.file?.url ?? "", name: first?.name ?? "home" } : null; }

async function queryAllPages() {
  const results = []; let startCursor;
  do {
    const body = { page_size: 100, filter: { property: "公開", checkbox: { equals: true } }, sorts: [{ property: "表示順", direction: "ascending" }] };
    if (startCursor) body.start_cursor = startCursor;
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": notionVersion, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Notion API ${response.status}: ${await response.text()}`);
    const data = await response.json(); results.push(...data.results.filter((item) => item.object === "page")); startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}
function extensionFrom(name, contentType, url) {
  const known = new Set([".jpg", ".jpeg", ".png", ".webp"]); const fromName = extname(String(name || "").split("?")[0]).toLowerCase(); if (known.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  const fromUrl = extname(new URL(url).pathname).toLowerCase(); if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl; if (/png/i.test(contentType || "")) return ".png"; if (/webp/i.test(contentType || "")) return ".webp"; return ".jpg";
}
async function readBytes(path) { try { return await readFile(path); } catch { return null; } }
async function saveImage(file, slug) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  const response = await fetch(file.url, { redirect: "follow" }); if (!response.ok) throw new Error(`ホーム画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer()); const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url); await mkdir(imageDirectory, { recursive: true });
  const path = join(imageDirectory, `${slug}${extension}`); const previous = await readBytes(path); if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) { const other = join(imageDirectory, `${slug}${otherExtension}`); if (other !== path) await unlink(other).catch(() => {}); }
  return path.replaceAll("\\", "/");
}
async function convertPage(page) {
  const properties = page.properties ?? {};
  const title = propertyText(properties["タイトル"]);
  if (!title) return null;
  const anchor = safeAnchor(propertyText(properties["アンカー"]));
  const pageSuffix = String(page.id || "").replaceAll("-", "").slice(-8) || "item";
  const slug = anchor || `${safeSlug(title, page.id)}-${pageSuffix}`;
  const upload = notionFile(properties["画像"]);
  const image = upload?.url ? await saveImage(upload, slug) : propertyText(properties["画像パス"]);
  return { slug, title, type: properties["種類"]?.select?.name ?? "ページ設定", englishLabel: propertyText(properties["英語ラベル"]), heading: propertyText(properties["見出し"]), description: propertyText(properties["説明"]), note: propertyText(properties["補足"]), number: propertyText(properties["番号"]), value: propertyText(properties["値"]), subLabel: propertyText(properties["サブラベル"]), buttonLabel: propertyText(properties["ボタン文言"]), linkUrl: propertyText(properties["リンクURL"]), secondaryButtonLabel: propertyText(properties["追加ボタン文言"]), secondaryLinkUrl: propertyText(properties["追加リンクURL"]), thirdButtonLabel: propertyText(properties["第3ボタン文言"]), thirdLinkUrl: propertyText(properties["第3リンクURL"]), image, icon: propertyText(properties["アイコン"]), anchor, order: properties["表示順"]?.number ?? 9999, notionPageId: page.id, notionUrl: page.url ?? "" };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
const pages = await queryAllPages(); const items = [];
for (const page of pages) { const item = await convertPage(page); if (item) items.push(item); }
items.sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title,"ja"));
await mkdir(imageDirectory, { recursive: true }); const usedImages = new Set(items.map(item=>item.image).filter(image=>String(image).startsWith(`${imageDirectory}/`)));
for (const name of await readdir(imageDirectory).catch(()=>[])) { if (name === ".gitkeep") continue; const path = join(imageDirectory,name).replaceAll("\\","/"); if (!usedImages.has(path)) await unlink(path).catch(()=>{}); }
const previous = await readJson("data/homepage.json", {}); const changed = JSON.stringify(previous.items ?? []) !== JSON.stringify(items); const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, items }; const jsonText = `${JSON.stringify(payload,null,2)}\n`; const jsText = `window.RESCENE_HOMEPAGE = ${JSON.stringify(payload,null,2)};\n`;
await mkdir("data",{recursive:true}); if ((await readFile("data/homepage.json","utf8").catch(()=>"")) !== jsonText) await writeFile("data/homepage.json",jsonText,"utf8"); if ((await readFile("data/homepage-data.js","utf8").catch(()=>"")) !== jsText) await writeFile("data/homepage-data.js",jsText,"utf8");
console.log(`${items.length}件のホーム・共通表示コンテンツを同期しました。データ変更: ${changed ? "あり" : "なし"}`);
