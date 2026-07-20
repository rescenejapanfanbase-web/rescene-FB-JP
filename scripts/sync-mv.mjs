import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN || "";
const dataSourceId = process.env.NOTION_MV_DATA_SOURCE_ID || "e85d399d-5506-4ab3-8355-e94325fbf5b1";
const notionVersion = "2026-03-11";
const notionDatabaseUrl = "https://app.notion.com/p/5f26ec69338a46f1ad9a82e070e92ad9";
const outputPath = "data/mv.json";
const outputScriptPath = "data/mv-data.js";
const notionImageDirectory = "assets/mv/notion";
const youtubeImageDirectory = "assets/mv/youtube";
const allowFallback = process.env.MV_SYNC_ALLOW_FALLBACK === "1";

if (!token && !allowFallback) {
  throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");
}

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, fallback = "mv") => String(value || "")
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 58) || fallback;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

function notionFile(property) {
  const first = property?.files?.[0];
  if (!first) return null;
  return {
    url: first?.external?.url ?? first?.file?.url ?? "",
    name: first?.name ?? "thumbnail",
  };
}

async function queryAllPages() {
  if (!token) return [];
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100, sorts: [{ property: "表示順", direction: "ascending" }] };
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

async function saveRemoteImage(url, directory, basename, suggestedName = "thumbnail.jpg") {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)" },
  });
  if (!response.ok) throw new Error(`画像取得失敗 ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = extensionFrom(suggestedName, response.headers.get("content-type"), url);
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

function dateInTokyo(value) {
  if (!value) return "";
  const direct = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct && !String(value).includes("T")) return direct;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return direct || "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function classifyTitle(title = "") {
  const value = String(title).normalize("NFKC");
  if (/\bOST\b/i.test(value) && /(M\/?V|MUSIC\s*VIDEO|VIDEO|CLIP|뮤직비디오)/i.test(value)) return "OST MV";
  if (/THE\s+FILM/i.test(value)) return "THE FILM";
  if (/SPECIAL\s+CLIP/i.test(value)) return "SPECIAL CLIP";
  if (/PERFORMANCE\s+(?:VIDEO|FILM)|PERFORMANCE\s+CLIP/i.test(value)) return "PERFORMANCE VIDEO";
  if (/SPECIAL\s+VIDEO/i.test(value)) return "SPECIAL VIDEO";
  if (/OFFICIAL\s*(?:M\/?V|MV|MUSIC\s*VIDEO)|\bM\/?V\b|\bMUSIC\s*VIDEO\b|뮤직비디오/i.test(value)) return "OFFICIAL MV";
  return "";
}

function cleanDisplayTitle(title = "") {
  const value = String(title).normalize("NFKC").replace(/\s+/g, " ").trim();
  const quoted = value.match(/[‘'“"「『]([^’'”"」』]{1,90})[’'”"」』]/)?.[1]?.trim();
  if (quoted) return quoted;
  return value
    .replace(/^\s*\[?RESCENE\]?\s*(?:\(리센느\))?\s*/i, "")
    .replace(/\s*(?:OFFICIAL\s*)?(?:M\/?V|MV|MUSIC\s*VIDEO)\s*$/i, "")
    .replace(/\s*(?:SPECIAL\s+VIDEO|PERFORMANCE\s+(?:VIDEO|FILM)|SPECIAL\s+CLIP|THE\s+FILM|OST\s*(?:M\/?V|MV|VIDEO))\s*$/i, "")
    .replace(/^[-–—|:]+|[-–—|:]+$/g, "")
    .trim() || value;
}

function groupForKind(kind) {
  return kind === "OFFICIAL MV" ? "official" : "special";
}

function youtubeVideoMap(data) {
  const channel = (Array.isArray(data?.channels) ? data.channels : []).find((item) => item?.key === "rescene")
    || (Array.isArray(data?.channels) ? data.channels[0] : null);
  const videos = Array.isArray(channel?.videos) ? channel.videos : [];
  return new Map(videos.map((video) => [String(video.videoId || ""), video]).filter(([id]) => /^[A-Za-z0-9_-]{11}$/.test(id)));
}

function fallbackOverrides(previous) {
  return (Array.isArray(previous?.items) ? previous.items : []).map((item, index) => ({
    videoId: item.videoId,
    state: "表示",
    title: item.title,
    displayTitle: item.title,
    kind: item.kind || item.badge || "OFFICIAL MV",
    group: item.type === "special" ? "SPECIAL / OST" : "OFFICIAL MV",
    date: item.date || dateInTokyo(item.publishedAt),
    uploaded: null,
    imagePath: item.thumbnail || "",
    order: Number(item.order) || (index + 1) * 10,
    note: item.note || "",
    notionUrl: item.notionUrl || "",
  })).filter((item) => item.videoId);
}

function convertPage(page) {
  const properties = page.properties ?? {};
  const videoId = propertyText(properties["YouTube動画ID"]).trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    state: properties["掲載状態"]?.select?.name || "",
    title: propertyText(properties["タイトル"]),
    displayTitle: propertyText(properties["表示タイトル"]),
    kind: properties["種類"]?.select?.name || "",
    group: properties["区分"]?.select?.name || "",
    date: properties["公開日"]?.date?.start || "",
    uploaded: notionFile(properties["サムネイル"]),
    imagePath: propertyText(properties["画像パス"]),
    order: properties["表示順"]?.number ?? 9999,
    note: propertyText(properties["注記"]),
    notionUrl: page.url || "",
  };
}

function sourceCandidate(video) {
  if (!video || video.videoType === "short" || video.videoType === "live") return null;
  const kind = classifyTitle(video.title);
  if (!kind) return null;
  const date = dateInTokyo(video.publishedAt || video.updatedAt);
  return {
    videoId: video.videoId,
    title: cleanDisplayTitle(video.title),
    sourceTitle: video.title,
    url: video.url || `https://www.youtube.com/watch?v=${video.videoId}`,
    remoteThumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    date,
    publishedAt: video.publishedAt || "",
    kind,
    type: groupForKind(kind),
    note: "",
    order: 9999,
    autoDetected: true,
    source: "youtube-auto",
  };
}

async function cleanupDirectory(directory, usedPaths) {
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory).catch(() => [])) {
    if (name === ".gitkeep") continue;
    const path = join(directory, name).replaceAll("\\", "/");
    if (!usedPaths.has(path)) await unlink(path).catch(() => {});
  }
}

const previous = await readJson(outputPath, { items: [] });
const youtubeData = await readJson("data/youtube-channels.json", { channels: [] });
const videoMap = youtubeVideoMap(youtubeData);
const previousItemMap = new Map((Array.isArray(previous?.items) ? previous.items : []).map((item) => [item.videoId, item]));
let notionRows = [];
try {
  notionRows = token ? (await queryAllPages()).map(convertPage).filter(Boolean) : fallbackOverrides(previous);
} catch (error) {
  if (!allowFallback) throw error;
  console.warn(`::warning::NotionのMV管理データを取得できないため既存データを使用します（${error.message}）`);
  notionRows = fallbackOverrides(previous);
}

const notionMap = new Map(notionRows.map((row) => [row.videoId, row]));
const excluded = new Set(notionRows.filter((row) => row.state === "除外").map((row) => row.videoId));
const items = [];
const usedNotionImages = new Set();
const usedYoutubeImages = new Set();

for (const row of notionRows) {
  if (row.state !== "表示") continue;
  const video = videoMap.get(row.videoId) || {};
  let thumbnail = row.imagePath || "";
  if (row.uploaded?.url) {
    thumbnail = await saveRemoteImage(row.uploaded.url, notionImageDirectory, row.videoId, row.uploaded.name);
    if (thumbnail) usedNotionImages.add(thumbnail);
  }
  if (!thumbnail) {
    const remote = video.thumbnail || `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`;
    try {
      thumbnail = await saveRemoteImage(remote, youtubeImageDirectory, row.videoId, "thumbnail.jpg");
      if (thumbnail) usedYoutubeImages.add(thumbnail);
    } catch (error) {
      console.warn(`::warning::${row.videoId}のYouTubeサムネイル保存に失敗しました（${error.message}）`);
      thumbnail = remote;
    }
  }
  const kind = row.kind || classifyTitle(video.title) || "OFFICIAL MV";
  const date = dateInTokyo(row.date || video.publishedAt || video.updatedAt);
  const title = row.displayTitle || row.title || cleanDisplayTitle(video.title) || "Music Video";
  items.push({
    videoId: row.videoId,
    anchor: previousItemMap.get(row.videoId)?.anchor || `mv-${safeSlug(title, row.videoId)}-${row.videoId.slice(-4).toLowerCase()}`,
    title,
    sourceTitle: video.title || row.title || title,
    url: video.url || `https://www.youtube.com/watch?v=${row.videoId}`,
    thumbnail,
    date,
    year: date.slice(0, 4),
    publishedAt: video.publishedAt || (date ? `${date}T00:00:00+09:00` : ""),
    kind,
    badge: kind,
    type: row.group === "SPECIAL / OST" ? "special" : row.group === "OFFICIAL MV" ? "official" : groupForKind(kind),
    note: row.note,
    order: row.order,
    autoDetected: false,
    source: "notion",
    notionUrl: row.notionUrl,
  });
}

for (const video of videoMap.values()) {
  if (notionMap.has(video.videoId) || excluded.has(video.videoId)) continue;
  const candidate = sourceCandidate(video);
  if (!candidate) continue;
  let thumbnail = candidate.remoteThumbnail;
  try {
    thumbnail = await saveRemoteImage(candidate.remoteThumbnail, youtubeImageDirectory, candidate.videoId, "thumbnail.jpg");
    if (thumbnail) usedYoutubeImages.add(thumbnail);
  } catch (error) {
    console.warn(`::warning::${candidate.videoId}のYouTubeサムネイル保存に失敗しました（${error.message}）`);
  }
  items.push({
    ...candidate,
    anchor: `mv-${safeSlug(candidate.title, candidate.videoId)}-${candidate.videoId.slice(-4).toLowerCase()}`,
    thumbnail,
    year: candidate.date.slice(0, 4),
    badge: candidate.kind,
  });
}

items.sort((a, b) => {
  const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateCompare) return dateCompare;
  const orderCompare = (Number(a.order) || 9999) - (Number(b.order) || 9999);
  if (orderCompare) return orderCompare;
  return a.title.localeCompare(b.title, "ja");
});

await cleanupDirectory(notionImageDirectory, usedNotionImages);
await cleanupDirectory(youtubeImageDirectory, usedYoutubeImages);

const years = [...new Set(items.map((item) => item.year).filter(Boolean))].sort((a, b) => b.localeCompare(a));
const stats = {
  total: items.length,
  official: items.filter((item) => item.type === "official").length,
  special: items.filter((item) => item.type === "special").length,
  autoDetected: items.filter((item) => item.autoDetected).length,
  notionManaged: items.filter((item) => !item.autoDetected).length,
  excluded: excluded.size,
};
const comparablePrevious = { items: previous.items || [] };
const comparableNext = { items };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = {
  generatedAt,
  source: token ? "youtube+notion" : "initial-fallback",
  youtubeGeneratedAt: youtubeData.generatedAt || null,
  dataSourceId,
  notionDatabaseUrl,
  years,
  stats,
  items,
};
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_MV = ${JSON.stringify(payload, null, 2)};\n`;
if ((await readFile(outputPath, "utf8").catch(() => "")) !== jsonText) await writeFile(outputPath, jsonText, "utf8");
if ((await readFile(outputScriptPath, "utf8").catch(() => "")) !== jsText) await writeFile(outputScriptPath, jsText, "utf8");
console.log(`MV一覧 ${items.length}件を生成しました（Notion管理 ${stats.notionManaged} / 自動検出 ${stats.autoDetected} / 除外 ${stats.excluded}）。データ変更: ${changed ? "あり" : "なし"}`);
