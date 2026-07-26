import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_HOMEPAGE_DATA_SOURCE_ID || "1a98fbc6-21d6-4a11-8ed9-19b228250182";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/home/notion";
const databaseUrl = "https://app.notion.com/p/23afd46c4c68443d89de65c74f605d68";
const themeDefaults = {
  name: "RESCENE Pink", background: "#120c16", background2: "#20121f", card: "#2a1727", card2: "#341b30",
  primary: "#ff6fae", primarySoft: "#ff9bc7", secondary: "#c8a4ff", accent: "#8fe3ca", blue: "#8ec9ff",
  text: "#fff9fc", muted: "#d4b7c8", lightBackground: "#fff7fb", lightCard: "#ffffff", lightText: "#2f1a29"
};
const themeTitleMap = new Map([
  ["テーマ名", "name"], ["背景色", "background"], ["背景色2", "background2"], ["カード色", "card"], ["カード色2", "card2"],
  ["メインカラー", "primary"], ["メインカラー（淡色）", "primarySoft"], ["サブカラー", "secondary"], ["アクセントカラー", "accent"],
  ["ブルーカラー", "blue"], ["文字色", "text"], ["補助文字色", "muted"], ["ライト背景色", "lightBackground"],
  ["ライトカード色", "lightCard"], ["ライト文字色", "lightText"]
]);
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
async function ensureThemePages(existingPages) {
  const existingTitles = new Set(existingPages.map((page) => propertyText(page.properties?.["タイトル"])));
  const rows = [
    ["テーマ：テーマ名", "RESCENE Pink", "カムバック名など。色ではありません。"],
    ["テーマ：背景色", themeDefaults.background, "ダークモードの基本背景色"],
    ["テーマ：背景色2", themeDefaults.background2, "背景グラデーションの2色目"],
    ["テーマ：カード色", themeDefaults.card, "カード・パネルの基本色"],
    ["テーマ：カード色2", themeDefaults.card2, "カードグラデーションの2色目"],
    ["テーマ：メインカラー", themeDefaults.primary, "ボタン・見出し・強調色"],
    ["テーマ：メインカラー（淡色）", themeDefaults.primarySoft, "ラベルなどの淡い強調色"],
    ["テーマ：サブカラー", themeDefaults.secondary, "グラデーションのサブ色"],
    ["テーマ：アクセントカラー", themeDefaults.accent, "補助アクセント色"],
    ["テーマ：ブルーカラー", themeDefaults.blue, "青系の補助色"],
    ["テーマ：文字色", themeDefaults.text, "ダークモードの本文色"],
    ["テーマ：補助文字色", themeDefaults.muted, "説明・日付などの文字色"],
    ["テーマ：ライト背景色", themeDefaults.lightBackground, "ライトモードの背景色"],
    ["テーマ：ライトカード色", themeDefaults.lightCard, "ライトモードのカード色"],
    ["テーマ：ライト文字色", themeDefaults.lightText, "ライトモードの本文色"]
  ];
  let created = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const [title, value, note] = rows[index];
    if (existingTitles.has(title)) continue;
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": notionVersion, "Content-Type": "application/json" },
      body: JSON.stringify({
        parent: { data_source_id: dataSourceId },
        properties: {
          "タイトル": { title: [{ text: { content: title } }] },
          "種類": { select: { name: "ページ設定" } },
          "値": { rich_text: [{ text: { content: value } }] },
          "補足": { rich_text: [{ text: { content: note } }] },
          "公開": { checkbox: true },
          "表示順": { number: 900 + index }
        }
      })
    });
    if (!response.ok) throw new Error(`テーマ設定行の作成に失敗しました ${response.status}: ${await response.text()}`);
    created += 1;
  }
  return created;
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
let pages = await queryAllPages(); const createdThemePages = await ensureThemePages(pages); if (createdThemePages) pages = await queryAllPages(); const items = [];
for (const page of pages) { const item = await convertPage(page); if (item) items.push(item); }
items.sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title,"ja"));
await mkdir(imageDirectory, { recursive: true }); const usedImages = new Set(items.map(item=>item.image).filter(image=>String(image).startsWith(`${imageDirectory}/`)));
for (const name of await readdir(imageDirectory).catch(()=>[])) { if (name === ".gitkeep") continue; const path = join(imageDirectory,name).replaceAll("\\","/"); if (!usedImages.has(path)) await unlink(path).catch(()=>{}); }
const normalizeHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
const theme = { ...themeDefaults };
for (const item of items) {
  const rawTitle = String(item.title || "").replace(/^テーマ[：:]\s*/, "").trim();
  const key = themeTitleMap.get(rawTitle);
  if (!key || !item.value) continue;
  theme[key] = key === "name" ? String(item.value).trim() : normalizeHex(item.value, themeDefaults[key]);
}
const publicItems = items.filter((item) => !/^テーマ[：:]/.test(String(item.title || "")));
const previous = await readJson("data/homepage.json", {}); const changed = JSON.stringify(previous.items ?? []) !== JSON.stringify(publicItems) || JSON.stringify(previous.theme ?? {}) !== JSON.stringify(theme); const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, theme, items: publicItems }; const jsonText = `${JSON.stringify(payload,null,2)}\n`; const jsText = `window.RESCENE_HOMEPAGE = ${JSON.stringify(payload,null,2)};\n`;
const themePayload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, theme };
const themeCss = `/* Notion-controlled comeback theme. Generated by sync-notion-homepage.mjs */
:root{
 --bg:${theme.background};--bg2:${theme.background2};--card:${theme.card};--card2:${theme.card2};--pink:${theme.primary};--pink-soft:${theme.primarySoft};--purple:${theme.secondary};--green:${theme.accent};--blue:${theme.blue};--text:${theme.text};--muted:${theme.muted};
 --border:color-mix(in srgb,${theme.primarySoft} 22%,transparent);--header-bg:color-mix(in srgb,${theme.background} 90%,transparent);--header-border:color-mix(in srgb,${theme.primarySoft} 14%,transparent);--hover-bg:color-mix(in srgb,${theme.primary} 9%,transparent);--soft-bg:color-mix(in srgb,${theme.text} 5%,transparent);--shadow:0 18px 48px color-mix(in srgb,${theme.background} 65%,transparent);
}
body{background:radial-gradient(circle at 8% 7%,color-mix(in srgb,var(--pink) 22%,transparent),transparent 29%),radial-gradient(circle at 92% 12%,color-mix(in srgb,var(--purple) 16%,transparent),transparent 31%),radial-gradient(circle at 82% 88%,color-mix(in srgb,var(--blue) 7%,transparent),transparent 30%),linear-gradient(145deg,var(--bg) 0%,var(--bg2) 48%,var(--bg) 100%)!important}
.card,.news-card{background:linear-gradient(145deg,color-mix(in srgb,var(--card) 96%,transparent),color-mix(in srgb,var(--bg2) 90%,transparent))}
.hero,.page-header,.focus-card{background:radial-gradient(circle at 88% 8%,color-mix(in srgb,var(--pink) 25%,transparent),transparent 31%),radial-gradient(circle at 12% 93%,color-mix(in srgb,var(--purple) 16%,transparent),transparent 36%),linear-gradient(135deg,color-mix(in srgb,var(--card2) 94%,transparent),color-mix(in srgb,var(--bg2) 90%,transparent))}
.logo span,.hero h1 span{background:linear-gradient(120deg,var(--pink),var(--pink-soft),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.btn-primary{background:linear-gradient(120deg,var(--pink),var(--pink-soft) 58%,var(--purple))}
html.light-mode{--bg:${theme.lightBackground};--bg2:color-mix(in srgb,${theme.lightBackground} 88%,${theme.secondary});--card:${theme.lightCard};--card2:color-mix(in srgb,${theme.lightCard} 92%,${theme.primarySoft});--text:${theme.lightText};--muted:color-mix(in srgb,${theme.lightText} 66%,transparent);--header-bg:color-mix(in srgb,${theme.lightCard} 92%,transparent);--soft-bg:color-mix(in srgb,${theme.primary} 6%,${theme.lightCard});--border:color-mix(in srgb,${theme.primary} 20%,transparent)}
`;
await mkdir("data",{recursive:true}); await mkdir("css",{recursive:true});
if ((await readFile("data/homepage.json","utf8").catch(()=>"")) !== jsonText) await writeFile("data/homepage.json",jsonText,"utf8");
if ((await readFile("data/homepage-data.js","utf8").catch(()=>"")) !== jsText) await writeFile("data/homepage-data.js",jsText,"utf8");
const themeJsonText = `${JSON.stringify(themePayload,null,2)}\n`;
if ((await readFile("data/site-theme.json","utf8").catch(()=>"")) !== themeJsonText) await writeFile("data/site-theme.json",themeJsonText,"utf8");
if ((await readFile("css/notion-theme.css","utf8").catch(()=>"")) !== themeCss) await writeFile("css/notion-theme.css",themeCss,"utf8");
console.log(`${publicItems.length}件のホーム・共通表示コンテンツとサイトテーマ「${theme.name}」を同期しました。テーマ設定新規作成: ${createdThemePages}件。データ変更: ${changed ? "あり" : "なし"}`);
