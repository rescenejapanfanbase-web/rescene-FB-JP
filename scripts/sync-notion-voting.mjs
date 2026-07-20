import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_VOTING_DATA_SOURCE_ID || "8e870649-722b-45aa-9b0f-3da6d51b139b";
const notionVersion = "2026-03-11";
const notionDatabaseUrl = "https://app.notion.com/p/db7689f9a5b2445fbe3fb9f7cd9a04de";
const outputPath = "data/voting-guide.json";
const outputScriptPath = "data/voting-guide-data.js";
const iconDirectory = "assets/voting/notion/icons";
const scoreDirectory = "assets/voting/notion/scores";
const guideDirectory = "assets/voting/notion/guides";

if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const splitLines = (value = "") => String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const splitPair = (line = "") => {
  const separator = line.indexOf("|");
  if (separator < 0) return [line.trim(), ""];
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
};
const safeSlug = (value, fallback = "item") => String(value || "")
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
  if (!response.ok) throw new Error(`投票ガイド画像取得失敗 ${response.status}: ${file.url}`);
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

async function convertProgram(page, usedIcons, usedScores) {
  const p = page.properties ?? {};
  const title = propertyText(p["タイトル"]);
  if (!title) return null;
  const order = p["表示順"]?.number ?? 9999;
  const slug = `${safeSlug(title, "program")}-${order}`;
  const iconUpload = notionFiles(p["アイコン"])[0];
  const scoreUpload = notionFiles(p["スコア画像"])[0];
  let icon = propertyText(p["アイコンパス"]);
  let scoreImage = propertyText(p["スコア画像パス"]);
  if (iconUpload) {
    icon = await saveImage(iconUpload, iconDirectory, slug);
    if (icon) usedIcons.add(icon);
  }
  if (scoreUpload) {
    scoreImage = await saveImage(scoreUpload, scoreDirectory, slug);
    if (scoreImage) usedScores.add(scoreImage);
  }
  const scoreItems = splitLines(propertyText(p["スコア配分"])).map((line) => {
    const [label, value] = splitPair(line);
    return { label, value };
  }).filter((item) => item.label || item.value);
  return {
    title,
    subtitle: propertyText(p["サブタイトル"]),
    mark: propertyText(p["略称"]),
    voteType: propertyText(p["投票区分"]),
    app: propertyText(p["使用アプリ"]),
    currency: propertyText(p["準備するもの"]),
    period: propertyText(p["投票期間"]),
    note: propertyText(p["案内"]),
    icon,
    order,
    score: {
      image: scoreImage,
      meta: `${String(propertyText(p["サブタイトル"])).split("・").pop() || ""} / ${propertyText(p["使用アプリ"])}`.replace(/^\s*\/\s*|\s*\/\s*$/g, ""),
      items: scoreItems,
      note: propertyText(p["詳細注記"]),
    },
    notionUrl: page.url ?? "",
  };
}

async function convertApp(page, usedIcons, usedGuides) {
  const p = page.properties ?? {};
  const title = propertyText(p["タイトル"]);
  if (!title) return null;
  const order = p["表示順"]?.number ?? 9999;
  const slug = `${safeSlug(title, "app")}-${order}`;
  const iconUpload = notionFiles(p["アイコン"])[0];
  let icon = propertyText(p["アイコンパス"]);
  if (iconUpload) {
    icon = await saveImage(iconUpload, iconDirectory, slug);
    if (icon) usedIcons.add(icon);
  }
  const uploadedGuideFiles = notionFiles(p["ガイド画像"]);
  const fallbackPaths = String(propertyText(p["ガイド画像パス"])).split(/\r?\n/).map((line) => line.trim());
  const stepRows = splitLines(propertyText(p["ガイド手順"])).map((line) => {
    const [stepTitle, text] = splitPair(line);
    return { title: stepTitle, text };
  });
  const stepCount = Math.max(stepRows.length, uploadedGuideFiles.length, fallbackPaths.length);
  const steps = [];
  for (let index = 0; index < stepCount; index += 1) {
    const row = stepRows[index] ?? { title: `${index + 1}. 手順`, text: "" };
    let image = fallbackPaths[index] ?? "";
    if (uploadedGuideFiles[index]) {
      image = await saveImage(uploadedGuideFiles[index], guideDirectory, `${slug}-${index + 1}`);
      if (image) usedGuides.add(image);
    }
    if (row.title || row.text || image) steps.push({ image, title: row.title, text: row.text });
  }
  return {
    title,
    subtitle: propertyText(p["サブタイトル"]),
    description: propertyText(p["説明"]) || propertyText(p["サブタイトル"]),
    icon,
    tags: splitLines(propertyText(p["タグ"])),
    appStore: p["App Store"]?.url ?? "",
    googlePlay: p["Google Play"]?.url ?? "",
    guide: { steps, note: propertyText(p["詳細注記"]) },
    order,
    notionUrl: page.url ?? "",
  };
}

function convertStatus(page) {
  const p = page.properties ?? {};
  return {
    title: propertyText(p["タイトル"]) || "現在の投票案内",
    description: propertyText(p["説明"]),
    type: propertyText(p["投票区分"]),
    lastChecked: propertyText(p["最終確認"]),
    notionUrl: page.url ?? "",
  };
}

const pages = await queryAllPages();
const programs = [];
const apps = [];
let status = null;
const usedIcons = new Set();
const usedScores = new Set();
const usedGuides = new Set();

for (const page of pages) {
  const type = page.properties?.["種類"]?.select?.name || "";
  if (type === "現在の投票" && !status) status = convertStatus(page);
  if (type === "音楽番組") {
    const program = await convertProgram(page, usedIcons, usedScores);
    if (program) programs.push(program);
  }
  if (type === "投票アプリ") {
    const app = await convertApp(page, usedIcons, usedGuides);
    if (app) apps.push(app);
  }
}

programs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja"));
apps.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja"));
status ??= {
  title: "現在の投票案内",
  description: "現在、常設で案内しているRESCENE対象の投票はありません。",
  type: "常設案内なし",
  lastChecked: "",
};

await cleanupDirectory(iconDirectory, usedIcons);
await cleanupDirectory(scoreDirectory, usedScores);
await cleanupDirectory(guideDirectory, usedGuides);

const previous = await readJson(outputPath, {});
const comparablePrevious = { status: previous.status ?? {}, programs: previous.programs ?? [], apps: previous.apps ?? [] };
const comparableNext = { status, programs, apps };
const changed = JSON.stringify(comparablePrevious) !== JSON.stringify(comparableNext);
const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl, status, programs, apps };
const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
const jsText = `window.RESCENE_VOTING_GUIDE = ${JSON.stringify(payload, null, 2)};\n`;

if ((await readFile(outputPath, "utf8").catch(() => "")) !== jsonText) await writeFile(outputPath, jsonText, "utf8");
if ((await readFile(outputScriptPath, "utf8").catch(() => "")) !== jsText) await writeFile(outputScriptPath, jsText, "utf8");
console.log(`投票ガイドを同期しました。番組 ${programs.length}件 / アプリ ${apps.length}件 / データ変更: ${changed ? "あり" : "なし"}`);
