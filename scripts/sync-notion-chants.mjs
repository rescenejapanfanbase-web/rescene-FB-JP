import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_CHANTS_DATA_SOURCE_ID || "bc32e32a-adcb-418d-828b-03ea458d4560";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/chants/notion";
const databaseUrl = "https://app.notion.com/p/1616bd27522949b582095498f939aea9";
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, pageId = "") => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || `chant-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeKey = (value, title, pageId) => {
  const key = String(value || "").trim().toLowerCase().replace(/[^0-9a-z_-]+/g, "-").replace(/^-+|-+$/g, "");
  return key || safeSlug(title, pageId);
};
const safeAnchor = (value, title, pageId) => {
  const raw = String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (raw) return raw.startsWith("chant-") ? raw : `chant-${raw}`;
  return `chant-${safeSlug(title, pageId)}`;
};
function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return { url: first?.external?.url ?? first?.file?.url ?? "", name: first?.name ?? "chant" };
}
async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100, filter: { property: "公開", checkbox: { equals: true } }, sorts: [{ property: "カテゴリー表示順", direction: "ascending" }, { property: "表示順", direction: "ascending" }] };
    if (startCursor) body.start_cursor = startCursor;
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": notionVersion, "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  if (!response.ok) throw new Error(`掛け声画像取得失敗 ${response.status}: ${file.url}`);
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
  const anchor = safeAnchor(propertyText(properties["アンカー"]), title, page.id);
  const slug = anchor.replace(/^chant-/, "") || safeSlug(title, page.id);
  const rawCategoryTitle = propertyText(properties["カテゴリー"]) || "その他";
  const rawAlbum = propertyText(properties["作品名"]) || rawCategoryTitle;
  const isJapaneseVersion = /^(?:Japanese\s+Single|Pinball\s+Japanese\s+Ver\.?|JAPANESE\s+VERSION)$/i.test(rawCategoryTitle)
    || /^(?:Japanese\s+Single|JAPANESE\s+VERSION)$/i.test(rawAlbum)
    || /Pinball\s+Japanese\s+Ver\.?/i.test(title);
  const categoryTitle = isJapaneseVersion ? "JAPANESE VERSION" : rawCategoryTitle;
  const categoryKey = isJapaneseVersion ? "japanese-version" : safeKey(propertyText(properties["カテゴリースラッグ"]), categoryTitle, page.id);
  const uploaded = notionFile(properties["掛け声画像"]);
  const localImage = propertyText(properties["画像パス"]);
  const image = uploaded?.url ? await saveImage(uploaded, slug) : localImage;
  const videoType = properties["動画区分"]?.select?.name || (properties["動画URL"]?.url ? "公式" : "なし");
  return {
    anchor, slug, title,
    album: isJapaneseVersion ? "JAPANESE VERSION" : rawAlbum,
    categoryKey, categoryTitle,
    categoryOrder: properties["カテゴリー表示順"]?.number ?? 9999,
    image,
    videoUrl: properties["動画URL"]?.url ?? "",
    videoType,
    note: propertyText(properties["注記"]),
    buttonLabel: propertyText(properties["ボタン文言"]) || (videoType === "公式" ? "公式掛け声動画を見る" : videoType === "非公式" ? "掛け声動画を見る" : ""),
    order: properties["表示順"]?.number ?? 9999,
    published: true,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
const pages = await queryAllPages();
const chants = [];
for (const page of pages) { const chant = await convertPage(page); if (chant) chants.push(chant); }
chants.sort((a,b)=>a.categoryOrder-b.categoryOrder||a.order-b.order||a.title.localeCompare(b.title,"ja"));
const categoryMap = new Map();
for (const chant of chants) if (!categoryMap.has(chant.categoryKey)) categoryMap.set(chant.categoryKey,{key:chant.categoryKey,title:chant.categoryTitle,order:chant.categoryOrder});
const categories=[...categoryMap.values()].sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title,"ja"));
await mkdir(imageDirectory,{recursive:true});
const usedImages=new Set(chants.map(item=>item.image).filter(image=>String(image).startsWith(`${imageDirectory}/`)));
for(const name of await readdir(imageDirectory).catch(()=>[])){if(name===".gitkeep")continue;const path=join(imageDirectory,name).replaceAll("\\","/");if(!usedImages.has(path))await unlink(path).catch(()=>{});}
const previous=await readJson("data/chants.json",{});
const comparablePrevious={categories:previous.categories??[],chants:previous.chants??[]};
const comparableNext={categories,chants};
const changed=JSON.stringify(comparablePrevious)!==JSON.stringify(comparableNext);
const generatedAt=changed?new Date().toISOString():(previous.generatedAt||new Date().toISOString());
const payload={generatedAt,source:"notion",dataSourceId,notionDatabaseUrl:databaseUrl,categories,chants};
const jsonText=`${JSON.stringify(payload,null,2)}\n`;
const jsText=`window.RESCENE_CHANTS = ${JSON.stringify(payload,null,2)};\n`;
if((await readFile("data/chants.json","utf8").catch(()=>""))!==jsonText)await writeFile("data/chants.json",jsonText,"utf8");
if((await readFile("data/chants-data.js","utf8").catch(()=>""))!==jsText)await writeFile("data/chants-data.js",jsText,"utf8");
console.log(`${chants.length}件の公開掛け声ガイドを同期しました。データ変更: ${changed?"あり":"なし"}`);
