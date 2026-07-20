import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_OFFICIAL_LINKS_DATA_SOURCE_ID || "362c800c-adc2-4586-be84-7b3a427e747d";
const notionVersion = "2026-03-11";
const notionDatabaseUrl = "https://app.notion.com/p/e4ee14f07e8d4ad9aa8ef3f8694620ab";
const outputPath = "data/official-links.json";
const outputScriptPath = "data/official-links-data.js";
const iconDirectory = "assets/links/notion";

if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, fallback = "link") => String(value || "")
  .normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || fallback;
const isSafeUrl = (value) => /^(https?:\/\/\S+|[a-z0-9_-]+\.html(?:[#?].*)?)$/i.test(String(value || "").trim());

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

function notionFiles(property) {
  return (property?.files ?? []).map((file, index) => ({
    url: file?.external?.url ?? file?.file?.url ?? "",
    name: file?.name ?? `image-${index + 1}`,
  })).filter((file) => /^https?:\/\//i.test(file.url));
}

async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = {
      page_size: 100,
      filter: { property: "公開", checkbox: { equals: true } },
      sorts: [
        { property: "カテゴリー表示順", direction: "ascending" },
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
  try {
    const fromUrl = extname(new URL(url).pathname).toLowerCase();
    if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  } catch {}
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".jpg";
}

async function readBytes(path) {
  try { return await readFile(path); }
  catch { return null; }
}

async function saveImage(file, basename) {
  if (!file?.url) return "";
  const response = await fetch(file.url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)" },
  });
  if (!response.ok) throw new Error(`公式リンク画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  await mkdir(iconDirectory, { recursive: true });
  const path = join(iconDirectory, `${basename}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) {
    const other = join(iconDirectory, `${basename}${otherExtension}`);
    if (other !== path) await unlink(other).catch(() => {});
  }
  return path.replaceAll("\\", "/");
}

async function cleanupDirectory(usedPaths) {
  await mkdir(iconDirectory, { recursive: true });
  for (const name of await readdir(iconDirectory).catch(() => [])) {
    if (name === ".gitkeep") continue;
    const path = join(iconDirectory, name).replaceAll("\\", "/");
    if (!usedPaths.has(path)) await unlink(path).catch(() => {});
  }
}

async function convertLink(page, usedIcons) {
  const p = page.properties ?? {};
  const title = propertyText(p["タイトル"]);
  const rawUrl = propertyText(p["URL"]);
  if (!title || !isSafeUrl(rawUrl)) return null;
  const category = p["カテゴリー"]?.select?.name ?? "公式SNS";
  const categoryOrder = p["カテゴリー表示順"]?.number ?? 9999;
  const order = p["表示順"]?.number ?? 9999;
  const slug = safeSlug(propertyText(p["アンカー"]) || title, `link-${categoryOrder}-${order}`);
  const iconUpload = notionFiles(p["アイコン"])[0];
  let icon = propertyText(p["アイコンパス"]);
  if (iconUpload) {
    icon = await saveImage(iconUpload, slug);
    if (icon) usedIcons.add(icon);
  }
  return {
    title,
    category,
    categoryOrder,
    order,
    url: rawUrl,
    subtitle: propertyText(p["サブタイトル"]),
    description: propertyText(p["説明"]),
    label: propertyText(p["ラベル"]),
    icon,
    iconText: propertyText(p["アイコン文字"]) || title.slice(0, 2).toUpperCase(),
    anchor: propertyText(p["アンカー"]) || slug,
    notionUrl: page.url ?? "",
  };
}

const pages = await queryAllPages();
const usedIcons = new Set();
const links = [];
for (const page of pages) {
  const item = await convertLink(page, usedIcons);
  if (item) links.push(item);
}
links.sort((a, b) => a.categoryOrder - b.categoryOrder || a.order - b.order || a.title.localeCompare(b.title, "ja"));
await cleanupDirectory(usedIcons);

const previous = await readJson(outputPath, {});
const comparablePrevious = { links: previous.links ?? [] };
const comparableNext = { links };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const next = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl, links };
const jsonText = `${JSON.stringify(next, null, 2)}\n`;
const jsText = `window.RESCENE_OFFICIAL_LINKS = ${JSON.stringify(next, null, 2)};\n`;
if ((await readFile(outputPath, "utf8").catch(() => "")) !== jsonText) await writeFile(outputPath, jsonText, "utf8");
if ((await readFile(outputScriptPath, "utf8").catch(() => "")) !== jsText) await writeFile(outputScriptPath, jsText, "utf8");
console.log(`公式リンクを同期しました。公開リンク ${links.length}件 / データ変更: ${changed ? "あり" : "なし"}`);
