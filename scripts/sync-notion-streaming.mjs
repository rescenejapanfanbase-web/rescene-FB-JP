import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_STREAMING_DATA_SOURCE_ID || "c769b3a6-e306-4665-84c7-dcfff92cfe5b";
const notionVersion = "2026-03-11";
const notionDatabaseUrl = "https://app.notion.com/p/a0180c81202a46b780f0045abfd0f00e";
const outputPath = "data/streaming-guide.json";
const outputScriptPath = "data/streaming-guide-data.js";
const iconDirectory = "assets/streaming/notion/icons";
const guideDirectory = "assets/streaming/notion/guides";

if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const splitLines = (value = "") => String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const splitPair = (line = "") => {
  const separator = line.indexOf("|");
  if (separator < 0) return [line.trim(), ""];
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
};
const safeSlug = (value, fallback = "guide") => String(value || "")
  .normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || fallback;

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
      sorts: [{ property: "表示順", direction: "ascending" }],
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

async function saveImage(file, directory, basename) {
  if (!file?.url) return "";
  const response = await fetch(file.url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)" },
  });
  if (!response.ok) throw new Error(`ストリーミングガイド画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${basename}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) {
    const other = join(directory, `${basename}${otherExtension}`);
    if (other !== path) await unlink(other).catch(() => {});
  }
  return path.replaceAll("\\", "/");
}

async function cleanupDirectory(directory, usedPaths) {
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory).catch(() => [])) {
    if (name === ".gitkeep") continue;
    const path = join(directory, name).replaceAll("\\", "/");
    if (!usedPaths.has(path)) await unlink(path).catch(() => {});
  }
}

async function convertGuide(page, usedIcons, usedGuides) {
  const p = page.properties ?? {};
  const title = propertyText(p["タイトル"]);
  if (!title) return null;
  const order = p["表示順"]?.number ?? 9999;
  const slug = safeSlug(propertyText(p["アンカー"]) || title, `guide-${order}`);
  const iconUpload = notionFiles(p["アイコン"])[0];
  let icon = propertyText(p["アイコンパス"]);
  if (iconUpload) {
    icon = await saveImage(iconUpload, iconDirectory, slug);
    if (icon) usedIcons.add(icon);
  }

  const uploadedImages = notionFiles(p["ガイド画像"]);
  const fallbackImages = splitLines(propertyText(p["ガイド画像パス"]));
  const stepRows = splitLines(propertyText(p["ガイド手順"])).map((line) => {
    const [stepTitle, text] = splitPair(line);
    return { title: stepTitle, text };
  });
  const count = Math.max(uploadedImages.length, fallbackImages.length, stepRows.length);
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    const row = stepRows[index] ?? { title: `${index + 1}. 手順`, text: "" };
    let image = fallbackImages[index] ?? "";
    if (uploadedImages[index]) {
      image = await saveImage(uploadedImages[index], guideDirectory, `${slug}-${index + 1}`);
      if (image) usedGuides.add(image);
    }
    if (row.title || row.text || image) steps.push({ title: row.title, text: row.text, image });
  }

  return {
    title,
    type: p["種類"]?.select?.name ?? "",
    subtitle: propertyText(p["サブタイトル"]),
    description: propertyText(p["説明"]),
    points: splitLines(propertyText(p["ポイント"])),
    steps,
    link: propertyText(p["リンクURL"]),
    buttonLabel: propertyText(p["ボタン文言"]),
    icon,
    note: propertyText(p["注記"]),
    anchor: propertyText(p["アンカー"]) || `streaming-${slug}`,
    order,
    notionUrl: page.url ?? "",
  };
}

const pages = await queryAllPages();
const usedIcons = new Set();
const usedGuides = new Set();
const guides = [];
for (const page of pages) {
  const item = await convertGuide(page, usedIcons, usedGuides);
  if (item) guides.push(item);
}
guides.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja"));
await cleanupDirectory(iconDirectory, usedIcons);
await cleanupDirectory(guideDirectory, usedGuides);

const previous = await readJson(outputPath, {});
const comparablePrevious = { guides: previous.guides ?? [] };
const comparableNext = { guides };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl, guides };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_STREAMING_GUIDE = ${JSON.stringify(payload, null, 2)};\n`;
if ((await readFile(outputPath, "utf8").catch(() => "")) !== jsonText) await writeFile(outputPath, jsonText, "utf8");
if ((await readFile(outputScriptPath, "utf8").catch(() => "")) !== jsText) await writeFile(outputScriptPath, jsText, "utf8");
console.log(`ストリーミングガイドを同期しました。公開ガイド ${guides.length}件 / データ変更: ${changed ? "あり" : "なし"}`);
