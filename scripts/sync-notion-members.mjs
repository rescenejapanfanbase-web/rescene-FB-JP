import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_MEMBERS_DATA_SOURCE_ID || "659553c4-dfa8-4d81-98e1-c259df27bafe";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/members/notion";
const databaseUrl = "https://app.notion.com/p/5c70b299a510423c9c6d71dcf57968af";
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, pageId = "") => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `member-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeAnchor = (value, title, pageId) => {
  const raw = String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (raw) return raw.endsWith("-profile") ? raw : `${raw}-profile`;
  return `${safeSlug(title, pageId)}-profile`;
};
const normalizeHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : "#ff6fae";
const dateValue = (property) => property?.date?.start || "";
const dateLabel = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : String(value || "");
};
function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return { url: first?.external?.url ?? first?.file?.url ?? "", name: first?.name ?? "member" };
}
async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100, filter: { property: "公開", checkbox: { equals: true } }, sorts: [{ property: "表示順", direction: "ascending" }] };
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
async function saveImage(file, slug, kind) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  const response = await fetch(file.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`メンバー画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  await mkdir(imageDirectory, { recursive: true });
  const path = join(imageDirectory, `${slug}-${kind}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) {
    const other = join(imageDirectory, `${slug}-${kind}${otherExtension}`);
    if (other !== path) await unlink(other).catch(() => {});
  }
  return path.replaceAll("\\", "/");
}
async function convertPage(page) {
  const properties = page.properties ?? {};
  const name = propertyText(properties["タイトル"]);
  if (!name) return null;
  const anchor = safeAnchor(propertyText(properties["アンカー"]), name, page.id);
  const slug = anchor.replace(/-profile$/, "") || safeSlug(name, page.id);
  const previewUpload = notionFile(properties["一覧画像"]);
  const detailUpload = notionFile(properties["詳細画像"]);
  const desktopUpload = notionFile(properties["PC画像"]);
  const previewImage = previewUpload?.url ? await saveImage(previewUpload, slug, "preview") : propertyText(properties["一覧画像パス"]);
  const detailImage = detailUpload?.url ? await saveImage(detailUpload, slug, "detail") : propertyText(properties["詳細画像パス"]) || previewImage;
  const desktopImage = desktopUpload?.url ? await saveImage(desktopUpload, slug, "desktop") : propertyText(properties["PC画像パス"]);
  const birthDate = dateValue(properties["生年月日"]);
  const ambassadorTitle = propertyText(properties["広報大使名"]);
  const ambassador = ambassadorTitle ? {
    title: ambassadorTitle,
    date: dateValue(properties["広報大使就任日"]),
    description: propertyText(properties["広報大使説明"]),
    articleUrl: propertyText(properties["広報大使記事URL"]),
  } : null;
  return {
    slug, name,
    koreanName: propertyText(properties["韓国語名"]),
    japaneseName: propertyText(properties["日本語名"]),
    birthDate,
    birthDateLabel: dateLabel(birthDate),
    birthPlace: propertyText(properties["出身地"]),
    realName: propertyText(properties["本名"]),
    keywords: propertyText(properties["キーワード"]),
    shortDescription: propertyText(properties["短い紹介"]),
    profile: propertyText(properties["プロフィール"]),
    colorName: propertyText(properties["カラー名"]) || "MEMBER COLOR",
    colorCode: normalizeHex(propertyText(properties["カラーコード"])),
    previewImage, detailImage, desktopImage, anchor,
    order: properties["表示順"]?.number ?? 9999,
    personalUrl: properties["個人リンク"]?.url ?? "",
    ambassador,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
const pages = await queryAllPages();
const members = [];
for (const page of pages) { const member = await convertPage(page); if (member) members.push(member); }
members.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "en"));
await mkdir(imageDirectory, { recursive: true });
const usedImages = new Set(members.flatMap((item) => [item.previewImage, item.detailImage, item.desktopImage]).filter((image) => String(image).startsWith(`${imageDirectory}/`)));
for (const name of await readdir(imageDirectory).catch(() => [])) {
  if (name === ".gitkeep") continue;
  const path = join(imageDirectory, name).replaceAll("\\", "/");
  if (!usedImages.has(path)) await unlink(path).catch(() => {});
}
const previous = await readJson("data/members.json", {});
const comparablePrevious = { members: previous.members ?? [] };
const comparableNext = { members };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, members };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_MEMBERS = ${JSON.stringify(payload, null, 2)};\n`;
if ((await readFile("data/members.json", "utf8").catch(() => "")) !== jsonText) await writeFile("data/members.json", jsonText, "utf8");
if ((await readFile("data/members-data.js", "utf8").catch(() => "")) !== jsText) await writeFile("data/members-data.js", jsText, "utf8");
console.log(`${members.length}人の公開メンバープロフィールを同期しました。データ変更: ${changed ? "あり" : "なし"}`);
