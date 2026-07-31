import { readFile, readdir } from "node:fs/promises";

const token = process.env.NOTION_TOKEN;
const homepageDataSourceId = process.env.NOTION_HOMEPAGE_DATA_SOURCE_ID || "1a98fbc6-21d6-4a11-8ed9-19b228250182";
const votingDataSourceId = process.env.NOTION_VOTING_DATA_SOURCE_ID || "8e870649-722b-45aa-9b0f-3da6d51b139b";
const recordsDataSourceId = process.env.NOTION_RECORDS_DATA_SOURCE_ID || "12dd657f-8ca2-44b0-a10f-ee099ca9a799";
const notionVersion = "2026-03-11";
const dryRun = /^(?:1|true|yes|dry-run)$/i.test(process.env.NOTION_SETUP_DRY_RUN || "true");
if (!token) throw new Error("NOTION_TOKEN が設定されていません。");

const headers = { Authorization: `Bearer ${token}`, "Notion-Version": notionVersion, "Content-Type": "application/json" };
async function notion(path, { method = "GET", body } = {}) {
  if (dryRun && method !== "GET" && method !== "POST_QUERY") {
    console.log(`[DRY RUN] ${method} ${path}`, body ? JSON.stringify(body) : "");
    return {};
  }
  const actualMethod = method === "POST_QUERY" ? "POST" : method;
  const response = await fetch(`https://api.notion.com/v1${path}`, { method: actualMethod, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`${actualMethod} ${path}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
const richText = (value) => ({ rich_text: value ? [{ type: "text", text: { content: String(value).slice(0, 2000) } }] : [] });
const titleText = (value) => ({ title: value ? [{ type: "text", text: { content: String(value).slice(0, 2000) } }] : [] });
const propText = (property) => (property?.title || property?.rich_text || []).map((item) => item?.plain_text || item?.text?.content || "").join("").trim();

async function queryAll(dataSourceId) {
  const results = []; let startCursor;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const data = await notion(`/data_sources/${dataSourceId}/query`, { method: "POST_QUERY", body });
    results.push(...(data.results || []));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}

function valueForType(definition, value) {
  const type = definition?.type;
  if (type === "title") return titleText(value);
  if (type === "rich_text") return richText(value);
  if (type === "number") return { number: value === "" || value == null ? null : Number(value) };
  if (type === "checkbox") return { checkbox: Boolean(value) };
  if (type === "url") return { url: value || null };
  if (type === "select") return { select: value ? { name: String(value) } : null };
  if (type === "date") return { date: value ? { start: String(value).slice(0, 10) } : null };
  return richText(value);
}

async function updateProperties(pageId, schema, values) {
  const properties = {};
  for (const [name, value] of Object.entries(values)) {
    if (schema[name]) properties[name] = valueForType(schema[name], value);
  }
  if (!Object.keys(properties).length) return;
  await notion(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
}

async function createPage(dataSourceId, schema, values) {
  const properties = {};
  for (const [name, value] of Object.entries(values)) {
    if (schema[name]) properties[name] = valueForType(schema[name], value);
  }
  await notion("/pages", { method: "POST", body: { parent: { type: "data_source_id", data_source_id: dataSourceId }, properties } });
}

async function ensureHomepageSchemaAndRows() {
  const source = await notion(`/data_sources/${homepageDataSourceId}`);
  let schema = source.properties || {};
  const localizedBases = ["タイトル", "英語ラベル", "見出し", "説明", "補足", "番号", "値", "サブラベル", "ボタン文言", "追加ボタン文言", "第3ボタン文言"];
  const missing = {};
  for (const base of localizedBases) for (const suffix of ["（韓国語）", "（英語）"]) {
    const name = `${base}${suffix}`;
    if (!schema[name]) missing[name] = { rich_text: {} };
  }
  if (Object.keys(missing).length) {
    console.log(`ホーム管理DBへ多言語列を${Object.keys(missing).length}件追加します。`);
    await notion(`/data_sources/${homepageDataSourceId}`, { method: "PATCH", body: { properties: missing } });
    if (!dryRun) schema = (await notion(`/data_sources/${homepageDataSourceId}`)).properties || schema;
    else for (const name of Object.keys(missing)) schema[name] = { type: "rich_text", rich_text: {} };
  }

  const existing = await queryAll(homepageDataSourceId);
  const titles = new Set(existing.map((page) => propText(page.properties?.["タイトル"])));
  const anchors = new Set(existing.map((page) => propText(page.properties?.["アンカー"])));
  const homepage = JSON.parse(await readFile("data/homepage.json", "utf8"));
  const theme = (JSON.parse(await readFile("data/site-theme.json", "utf8"))).theme || {};
  const themeRows = [
    ["テーマ名", theme.name], ["背景色", theme.background], ["背景色2", theme.background2], ["カード色", theme.card], ["カード色2", theme.card2],
    ["メインカラー", theme.primary], ["メインカラー（淡色）", theme.primarySoft], ["サブカラー", theme.secondary], ["アクセントカラー", theme.accent],
    ["ブルーカラー", theme.blue], ["イエローカラー", theme.yellow], ["インクカラー", theme.ink], ["ウォニカラー", theme.memberWoni],
    ["リブカラー", theme.memberLiv], ["ミナミカラー", theme.memberMinami], ["メイカラー", theme.memberMay], ["ゼナカラー", theme.memberZena],
    ["文字色", theme.text], ["補助文字色", theme.muted], ["ライト背景色", theme.lightBackground], ["ライトカード色", theme.lightCard], ["ライト文字色", theme.lightText],
  ].map(([label, value], index) => ({ "タイトル": `テーマ：${label}`, "種類": "ページ設定", "値": value || "", "公開": true, "表示順": 9000 + index }));

  const navigationRows = (homepage.siteManagement?.navigation || []).map((item, index) => ({
    "タイトル": item.title || `ナビ：${item.heading}`, "種類": "ページ設定", "アンカー": item.anchor || `nav-${index + 1}`,
    "見出し": item.heading || "", "リンクURL": item.linkUrl || "", "補足": item.note || "", "公開": true, "表示順": Number(item.order || 100 + index),
    "見出し（韓国語）": item.translations?.ko?.heading || "", "見出し（英語）": item.translations?.en?.heading || "",
  }));

  const managedFiles = ["index.html", "about.html", "members.html", "schedule.html", "news.html", "discography.html", "mv.html", "youtube.html", "records.html", "music-show-wins.html", "melon-records.html", "streaming.html", "voting.html", "chants.html", "links.html", "fan-services.html", "contact.html", "search.html", "favorites.html", "updates.html", "sync-status.html", "external-links.html", "analytics.html"];
  const pageRows = [];
  for (const file of managedFiles) {
    try {
      const html = await readFile(file, "utf8");
      const heading = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || file.replace(/\.html$/, "")).replace(/<[^>]+>/g, "").trim();
      const description = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || "").trim();
      const slug = file.replace(/\.html$/, "");
      pageRows.push({ "タイトル": `ページ：${heading}`, "種類": "ページ設定", "アンカー": `page-${slug}`, "見出し": heading, "説明": description, "リンクURL": file, "公開": true, "表示順": 3000 + pageRows.length });
    } catch {}
  }
  const specialRows = [
    { "タイトル": "リンク：RESCENE bubble", "種類": "ページ設定", "アンカー": "link-bubble-app", "見出し": "RESCENE bubble", "ボタン文言": "RESCENE bubbleを開く ↗", "リンクURL": "https://apps.apple.com/app/id1556582179", "公開": true, "表示順": 5000 },
    { "タイトル": "更新：Notion完全管理を導入", "種類": "ページ設定", "アンカー": "update-notion-full-management", "見出し": "Notion完全管理・5色テーマ・自動更新監視を更新", "説明": "サイト構成、色、ページ文言、画像、更新履歴をNotionから管理できる基盤を追加。", "公開": true, "表示順": 6000 },
    { "タイトル": "翻訳：投票アプリ", "種類": "ページ設定", "アンカー": "translation-voting-app", "見出し": "投票アプリ", "見出し（韓国語）": "투표 앱", "見出し（英語）": "Voting App", "公開": true, "表示順": 7000 },
  ];
  for (const row of [...themeRows, ...navigationRows, ...pageRows, ...specialRows]) {
    const title = row["タイトル"] || ""; const anchor = row["アンカー"] || "";
    if (titles.has(title) || (anchor && anchors.has(anchor))) continue;
    console.log(`作成: ${title}${anchor ? ` / ${anchor}` : ""}`);
    await createPage(homepageDataSourceId, schema, row);
    titles.add(title); if (anchor) anchors.add(anchor);
  }
}

async function migrateVoting() {
  const source = await notion(`/data_sources/${votingDataSourceId}`);
  const schema = source.properties || {};
  const pages = await queryAll(votingDataSourceId);
  for (const page of pages) {
    const title = propText(page.properties?.["タイトル"]);
    const subtitle = propText(page.properties?.["サブタイトル"]);
    if (/^Music Bank$/i.test(title)) {
      console.log("Notion Music Bank行をcoogoongへ更新します。");
      await updateProperties(page.id, schema, { "使用アプリ": "coogoong", "アイコンパス": "assets/voting/apps/coogoong.png" });
    }
    if (/^Fancast$/i.test(title) && /Music Bank/i.test(subtitle)) {
      console.log("Notion Fancast行をcoogoongへ改名します。");
      await updateProperties(page.id, schema, { "タイトル": "coogoong", "アイコンパス": "assets/voting/apps/coogoong.png", "App Store": "https://apps.apple.com/app/id1641638840", "Google Play": "https://play.google.com/store/apps/details?id=com.contentsmadang.fancast" });
    }
  }
}

async function migrateDejaVu() {
  const source = await notion(`/data_sources/${recordsDataSourceId}`);
  const schema = source.properties || {};
  const pages = await queryAll(recordsDataSourceId);
  for (const page of pages) {
    const title = propText(page.properties?.["タイトル"]);
    const song = propText(page.properties?.["曲名"]);
    if (/Deja\s*Vu/i.test(`${title} ${song}`) && /Melon|メロン/i.test(title)) {
      console.log("Notion Deja Vu行の確定順位をTOP100=13・日間=11へ設定します。");
      await updateProperties(page.id, schema, { "TOP100最高順位": 13, "日間最高順位": 11 });
    }
  }
}

console.log(`Notion完全管理セットアップを開始します（${dryRun ? "DRY RUN" : "APPLY"}）。`);
await ensureHomepageSchemaAndRows();
await migrateVoting();
await migrateDejaVu();
console.log("Notion完全管理セットアップが完了しました。");
