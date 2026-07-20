import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_DISCOGRAPHY_DATA_SOURCE_ID || "8f582d52-96eb-4148-a24b-add07379ee07";
const notionVersion = "2026-03-11";
const coverDirectory = "assets/discography/notion";
const databaseUrl = "https://app.notion.com/p/ca4fadead9d64128a5e8dc9730e0033d";

if (!token) {
  throw new Error("NOTION_TOKEN が設定されていません。既存のスケジュール・ニュース同期と同じSecretを利用できます。");
}

const categories = [
  { key: "special", notionName: "スペシャル／デジタル", kicker: "SPECIAL & DIGITAL SINGLE", title: "スペシャル・デジタルシングル", description: "日本語版、英語版、コラボ、配信シングルをまとめています。" },
  { key: "mini", notionName: "ミニアルバム", kicker: "MINI ALBUM", title: "ミニアルバム", description: "RESCENEのミニアルバムを新しい順に掲載しています。" },
  { key: "full", notionName: "フルアルバム", kicker: "FULL ALBUM", title: "フルアルバム", description: "フルアルバムがリリースされた際に掲載します。" },
  { key: "single", notionName: "シングルアルバム", kicker: "SINGLE ALBUM", title: "シングルアルバム", description: "フィジカル・デビュー作品を含むシングルアルバム。" },
  { key: "ost", notionName: "OST", kicker: "ORIGINAL SOUNDTRACK", title: "OST", description: "ドラマ・番組・特別企画で発表されたOST作品をまとめています。" },
];
const categoryMap = Object.fromEntries(categories.map((category) => [category.notionName, category.key]));

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);

function safeSlug(value, pageId = "") {
  const ascii = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
  const suffix = String(pageId).replaceAll("-", "").slice(-8);
  return ascii || `release-${suffix || "item"}`;
}

function safeAnchor(value, title, pageId) {
  const provided = String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (provided) return provided.startsWith("release-") ? provided : `release-${provided}`;
  return `release-${safeSlug(title, pageId)}`;
}

function parseTracks(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length === 1) return { no: String(index + 1).padStart(2, "0"), title: parts[0], video: "", note: "" };
      const firstLooksNumber = /^\d{1,3}$/.test(parts[0]);
      return {
        no: firstLooksNumber ? parts[0].padStart(2, "0") : String(index + 1).padStart(2, "0"),
        title: firstLooksNumber ? (parts[1] || "") : (parts[0] || ""),
        video: firstLooksNumber ? (parts[2] || "") : (parts[1] || ""),
        note: firstLooksNumber ? (parts.slice(3).join(" | ") || "") : (parts.slice(2).join(" | ") || ""),
      };
    })
    .filter((track) => track.title);
}

function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return {
    url: first?.external?.url ?? first?.file?.url ?? "",
    name: first?.name ?? "cover",
  };
}

async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = {
      page_size: 100,
      filter: {
        and: [
          { property: "公開", checkbox: { equals: true } },
          { property: "発売日", date: { is_not_empty: true } },
        ],
      },
      sorts: [
        { property: "発売日", direction: "descending" },
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
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  if (/png/i.test(contentType || "")) return ".png";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".jpg";
}

async function readBytes(path) {
  try { return await readFile(path); } catch { return null; }
}

async function saveCover(file, slug) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  const response = await fetch(file.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`ジャケット取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  await mkdir(coverDirectory, { recursive: true });
  const path = join(coverDirectory, `${slug}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  for (const otherExtension of [".jpg", ".png", ".webp"]) {
    const other = join(coverDirectory, `${slug}${otherExtension}`);
    if (other !== path) await unlink(other).catch(() => {});
  }
  return path.replaceAll("\\", "/");
}

async function convertPage(page) {
  const properties = page.properties ?? {};
  const title = propertyText(properties["タイトル"]);
  const releaseDate = properties["発売日"]?.date?.start?.slice(0, 10) ?? "";
  if (!title || !releaseDate) return null;
  const categoryName = properties["カテゴリー"]?.select?.name ?? "スペシャル／デジタル";
  const category = categoryMap[categoryName] ?? "special";
  const anchor = safeAnchor(propertyText(properties["アンカー"]), title, page.id);
  const slug = anchor.replace(/^release-/, "") || safeSlug(title, page.id);
  const localImage = propertyText(properties["画像パス"]);
  const uploaded = notionFile(properties["ジャケット"]);
  let cover = localImage;
  if (!cover && uploaded?.url) cover = await saveCover(uploaded, slug);
  return {
    anchor,
    slug,
    title,
    releaseDate,
    category,
    categoryName,
    mark: propertyText(properties["マーク"]) || "RS",
    badge: propertyText(properties["バッジ"]) || categoryName,
    type: propertyText(properties["表示タイプ"]) || categoryName,
    description: propertyText(properties["説明"]),
    tracks: parseTracks(propertyText(properties["曲一覧"])),
    appleMusic: properties["Apple Music"]?.url ?? "",
    spotify: properties["Spotify"]?.url ?? "",
    cover,
    order: properties["表示順"]?.number ?? 9999,
    published: true,
    notionPageId: page.id,
    notionUrl: page.url ?? "",
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

const pages = await queryAllPages();
const converted = [];
for (const page of pages) {
  const release = await convertPage(page);
  if (release) converted.push(release);
}
const categoryOrder = Object.fromEntries(categories.map((category, index) => [category.key, index]));
const releases = converted.sort((a, b) =>
  (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99)
  || b.releaseDate.localeCompare(a.releaseDate)
  || a.order - b.order
  || a.title.localeCompare(b.title, "ja")
);

await mkdir(coverDirectory, { recursive: true });
const usedCovers = new Set(releases.map((release) => release.cover).filter((cover) => String(cover).startsWith(`${coverDirectory}/`)));
for (const name of await readdir(coverDirectory).catch(() => [])) {
  if (name === ".gitkeep") continue;
  const path = join(coverDirectory, name).replaceAll("\\", "/");
  if (!usedCovers.has(path)) await unlink(path).catch(() => {});
}

const previous = await readJson("data/discography.json", {});
const comparablePrevious = { categories: previous.categories ?? [], releases: previous.releases ?? [] };
const comparableNext = { categories, releases };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, categories, releases };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_DISCOGRAPHY = ${JSON.stringify(payload, null, 2)};\n`;
const previousJson = await readFile("data/discography.json", "utf8").catch(() => "");
const previousJs = await readFile("data/discography-data.js", "utf8").catch(() => "");
if (previousJson !== jsonText) await writeFile("data/discography.json", jsonText, "utf8");
if (previousJs !== jsText) await writeFile("data/discography-data.js", jsText, "utf8");
console.log(`${releases.length}件の公開作品を同期しました。データ変更: ${changed ? "あり" : "なし"}`);
