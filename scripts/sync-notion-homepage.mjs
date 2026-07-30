import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";

const token = process.env.NOTION_TOKEN;
const dataSourceId = process.env.NOTION_HOMEPAGE_DATA_SOURCE_ID || "1a98fbc6-21d6-4a11-8ed9-19b228250182";
const notionVersion = "2026-03-11";
const imageDirectory = "assets/home/notion";
const databaseUrl = "https://app.notion.com/p/23afd46c4c68443d89de65c74f605d68";
const themeDefaults = {
  name: "RESCENE Member Colors",
  background: "#111118", background2: "#191823", card: "#20202b", card2: "#292837",
  primary: "#79d98c", primarySoft: "#a8e8b3", secondary: "#9c72ff", accent: "#79d98c", blue: "#4f8dff",
  yellow: "#f4d04b", ink: "#2c2c35",
  memberWoni: "#79d98c", memberLiv: "#2c2c35", memberMinami: "#4f8dff", memberMay: "#f4d04b", memberZena: "#9c72ff",
  text: "#f8f7fb", muted: "#bbb7c6", lightBackground: "#fffdf6", lightCard: "#ffffff", lightText: "#292630"
};
const themeTitleMap = new Map([
  ["テーマ名", "name"], ["背景色", "background"], ["背景色2", "background2"], ["カード色", "card"], ["カード色2", "card2"],
  ["メインカラー", "primary"], ["メインカラー（淡色）", "primarySoft"], ["サブカラー", "secondary"], ["アクセントカラー", "accent"],
  ["ブルーカラー", "blue"], ["イエローカラー", "yellow"], ["インクカラー", "ink"],
  ["ウォニカラー", "memberWoni"], ["リブカラー", "memberLiv"], ["ミナミカラー", "memberMinami"], ["メイカラー", "memberMay"], ["ゼナカラー", "memberZena"], ["文字色", "text"], ["補助文字色", "muted"], ["ライト背景色", "lightBackground"],
  ["ライトカード色", "lightCard"], ["ライト文字色", "lightText"]
]);
if (!token) throw new Error("NOTION_TOKEN が設定されていません。既存のNotion同期と同じSecretを利用できます。");

const plainText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
const propertyText = (property) => plainText(property?.rich_text ?? property?.title ?? []);
const safeSlug = (value, pageId = "") => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || `home-${String(pageId).replaceAll("-", "").slice(-8) || "item"}`;
const safeAnchor = (value) => String(value || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
const firstPropertyText = (properties, names = []) => { for (const name of names) { const value = propertyText(properties?.[name]); if (value) return value; } return ""; };
const localizedField = (properties, baseName, language) => {
  const suffixes = language === "ko" ? ["（韓国語）", "_KO", " KO", "韓国語"] : ["（英語）", "_EN", " EN", "英語"];
  const prefixes = language === "ko" ? ["韓国語", "KO ", "KO_"] : ["英語", "EN ", "EN_"];
  return firstPropertyText(properties, [...suffixes.map((suffix) => `${baseName}${suffix}`), ...prefixes.map((prefix) => `${prefix}${baseName}`)]);
};
const localizedItem = (properties) => {
  const fields = { title: "タイトル", englishLabel: "英語ラベル", heading: "見出し", description: "説明", note: "補足", number: "番号", value: "値", subLabel: "サブラベル", buttonLabel: "ボタン文言", secondaryButtonLabel: "追加ボタン文言", thirdButtonLabel: "第3ボタン文言" };
  const result = { ko: {}, en: {} };
  for (const [key, baseName] of Object.entries(fields)) {
    const ko = localizedField(properties, baseName, "ko");
    const en = localizedField(properties, baseName, "en");
    if (ko) result.ko[key] = ko;
    if (en) result.en[key] = en;
  }
  return result;
};
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
const requiredThemeRows = [
  ["テーマ：テーマ名", themeDefaults.name],
  ["テーマ：背景色", themeDefaults.background],
  ["テーマ：背景色2", themeDefaults.background2],
  ["テーマ：カード色", themeDefaults.card],
  ["テーマ：カード色2", themeDefaults.card2],
  ["テーマ：メインカラー", themeDefaults.primary],
  ["テーマ：メインカラー（淡色）", themeDefaults.primarySoft],
  ["テーマ：サブカラー", themeDefaults.secondary],
  ["テーマ：アクセントカラー", themeDefaults.accent],
  ["テーマ：ブルーカラー", themeDefaults.blue],
  ["テーマ：イエローカラー", themeDefaults.yellow],
  ["テーマ：インクカラー", themeDefaults.ink],
  ["テーマ：ウォニカラー", themeDefaults.memberWoni],
  ["テーマ：リブカラー", themeDefaults.memberLiv],
  ["テーマ：ミナミカラー", themeDefaults.memberMinami],
  ["テーマ：メイカラー", themeDefaults.memberMay],
  ["テーマ：ゼナカラー", themeDefaults.memberZena],
  ["テーマ：文字色", themeDefaults.text],
  ["テーマ：補助文字色", themeDefaults.muted],
  ["テーマ：ライト背景色", themeDefaults.lightBackground],
  ["テーマ：ライトカード色", themeDefaults.lightCard],
  ["テーマ：ライト文字色", themeDefaults.lightText]
];

function findMissingThemeRows(existingPages) {
  const existingTitles = new Set(existingPages.map((page) => propertyText(page.properties?.["タイトル"])));
  return requiredThemeRows.filter(([title]) => !existingTitles.has(title));
}

function extensionFrom(name, contentType, url) {
  const known = new Set([".jpg", ".jpeg", ".png", ".webp"]); const fromName = extname(String(name || "").split("?")[0]).toLowerCase(); if (known.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  const fromUrl = extname(new URL(url).pathname).toLowerCase(); if (known.has(fromUrl)) return fromUrl === ".jpeg" ? ".jpg" : fromUrl; if (/png/i.test(contentType || "")) return ".png"; if (/webp/i.test(contentType || "")) return ".webp"; return ".jpg";
}
async function readBytes(path) { try { return await readFile(path); } catch { return null; } }
async function saveImage(file, slug) {
  if (!file?.url || !/^https?:\/\//i.test(file.url)) return "";
  const response = await fetch(file.url, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`ホーム画像取得失敗 ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`ホーム画像取得失敗: 空の画像データです (${slug})`);
  const extension = extensionFrom(file.name, response.headers.get("content-type"), file.url);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  await mkdir(imageDirectory, { recursive: true });
  // 画像内容のハッシュをファイル名へ含め、同じ「画像」セルを差し替えた場合も
  // ブラウザ・PWA・CDNの古いキャッシュを確実に回避する。
  const path = join(imageDirectory, `${slug}-${digest}${extension}`);
  const previous = await readBytes(path);
  if (!previous || !previous.equals(bytes)) await writeFile(path, bytes);
  console.log(`ホーム画像保存: ${slug} -> ${path.replaceAll("\\", "/")} (${bytes.length} bytes / ${digest})`);
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
  const imagePathFallback = propertyText(properties["画像パス"]);
  const image = upload?.url ? await saveImage(upload, slug) : imagePathFallback;
  if (title === "ホームヒーロー") {
    console.log(`ホームヒーロー画像: ${upload?.url ? "Notionの画像を使用" : imagePathFallback ? "画像パスを使用" : "画像なし"} -> ${image || "(空)"}`);
  }
  return { slug, title, type: properties["種類"]?.select?.name ?? "ページ設定", englishLabel: propertyText(properties["英語ラベル"]), heading: propertyText(properties["見出し"]), description: propertyText(properties["説明"]), note: propertyText(properties["補足"]), number: propertyText(properties["番号"]), value: propertyText(properties["値"]), subLabel: propertyText(properties["サブラベル"]), buttonLabel: propertyText(properties["ボタン文言"]), linkUrl: propertyText(properties["リンクURL"]), secondaryButtonLabel: propertyText(properties["追加ボタン文言"]), secondaryLinkUrl: propertyText(properties["追加リンクURL"]), thirdButtonLabel: propertyText(properties["第3ボタン文言"]), thirdLinkUrl: propertyText(properties["第3リンクURL"]), image, icon: propertyText(properties["アイコン"]), anchor, order: properties["表示順"]?.number ?? 9999, translations: localizedItem(properties), notionPageId: page.id, notionUrl: page.url ?? "" };
}
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; } }
const pages = await queryAllPages();
const missingThemeRows = findMissingThemeRows(pages);
if (missingThemeRows.length) {
  console.warn(`警告: Notionのテーマ設定が${missingThemeRows.length}件不足しています。該当項目は既定色を使用します。`);
  for (const [title, value] of missingThemeRows) console.warn(`- ${title}（既定値: ${value}）`);
}
const items = [];
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
const previous = await readJson("data/homepage.json", {});
const defaultNavigation = [
  ["home", "ホーム", "index.html", "", 10, "홈", "Home"],
  ["about", "RESCENEについて", "about.html", "RESCENE", 20, "RESCENE 소개", "About RESCENE"],
  ["members", "メンバー", "members.html", "RESCENE", 21, "멤버", "Members"],
  ["schedule", "スケジュール", "schedule.html", "", 30, "스케줄", "Schedule"],
  ["news", "ニュース", "news.html", "", 40, "뉴스", "News"],
  ["discography", "ディスコグラフィ", "discography.html", "音楽", 50, "디스코그래피", "Discography"],
  ["mv", "MV一覧", "mv.html", "音楽", 51, "MV 목록", "MV List"],
  ["youtube", "YouTube", "youtube.html", "音楽", 52, "YouTube", "YouTube"],
  ["records", "記録", "records.html", "音楽", 53, "기록", "Records"],
  ["streaming", "ストリーミング", "streaming.html", "応援ガイド", 60, "스트리밍", "Streaming"],
  ["voting", "投票ガイド", "voting.html", "応援ガイド", 61, "투표 가이드", "Voting Guide"],
  ["chants", "掛け声ガイド", "chants.html", "応援ガイド", 62, "응원법 가이드", "Fan Chant Guide"],
  ["links", "公式リンク", "links.html", "リンク", 70, "공식 링크", "Official Links"],
  ["fan-services", "ファンサービスガイド", "fan-services.html", "リンク", 71, "팬 서비스 가이드", "Fan Service Guide"],
  ["contact", "お問い合わせ", "contact.html", "リンク", 72, "문의", "Contact"],
].map(([id, heading, linkUrl, note, order, ko, en]) => ({ title: `ナビ：${heading}`, heading, linkUrl, note, order, anchor: `nav-${id}`, translations: { ko: { heading: ko }, en: { heading: en } } }));
const defaultLinks = {
  "bubble-app": { title: "RESCENE bubble", heading: "RESCENE bubble", buttonLabel: "RESCENE bubbleを開く ↗", linkUrl: "https://apps.apple.com/app/id1556582179", anchor: "link-bubble-app", order: 10, translations: { ko: { buttonLabel: "RESCENE bubble 열기 ↗" }, en: { buttonLabel: "Open RESCENE bubble ↗" } } },
};
const notionNavigation = publicItems.filter((item) => /^nav-/.test(item.anchor)).map((item) => ({ ...item }));
const notionPages = Object.fromEntries(publicItems.filter((item) => /^page-/.test(item.anchor)).map((item) => [item.anchor.replace(/^page-/, ""), { ...item }]));
const notionLinks = Object.fromEntries(publicItems.filter((item) => /^link-/.test(item.anchor)).map((item) => [item.anchor.replace(/^link-/, ""), { ...item }]));
const notionUpdates = publicItems.filter((item) => /^update-/.test(item.anchor)).map((item) => ({ ...item }));
const notionTranslations = publicItems.filter((item) => /^translation-/.test(item.anchor)).map((item) => ({ ...item }));
const siteManagement = {
  navigation: notionNavigation.length ? notionNavigation : (previous.siteManagement?.navigation?.length ? previous.siteManagement.navigation : defaultNavigation),
  pages: Object.keys(notionPages).length ? notionPages : (previous.siteManagement?.pages || {}),
  links: Object.keys(notionLinks).length ? { ...defaultLinks, ...notionLinks } : { ...defaultLinks, ...(previous.siteManagement?.links || {}) },
  updates: notionUpdates.length ? notionUpdates : (previous.siteManagement?.updates || []),
  translations: notionTranslations.length ? notionTranslations : (previous.siteManagement?.translations || []),
};
const homepageItems = publicItems.filter((item) => !/^(?:nav|page|link|update|translation)-/.test(item.anchor));
const changed = JSON.stringify(previous.items ?? []) !== JSON.stringify(homepageItems) || JSON.stringify(previous.theme ?? {}) !== JSON.stringify(theme) || JSON.stringify(previous.siteManagement ?? {}) !== JSON.stringify(siteManagement); const generatedAt = changed ? new Date().toISOString() : (previous.generatedAt || new Date().toISOString());
const payload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, theme, siteManagement, items: homepageItems }; const jsonText = `${JSON.stringify(payload,null,2)}\n`; const jsText = `window.RESCENE_HOMEPAGE = ${JSON.stringify(payload,null,2)};\n`;
const themePayload = { generatedAt, source: "notion", dataSourceId, notionDatabaseUrl: databaseUrl, theme };
const themeCss = `/* Notion-controlled five-member theme. Generated by sync-notion-homepage.mjs */
:root{
 --member-woni:${theme.memberWoni};--member-liv:${theme.memberLiv};--member-minami:${theme.memberMinami};--member-may:${theme.memberMay};--member-zena:${theme.memberZena};
 --bg:${theme.background};--bg2:${theme.background2};--card:${theme.card};--card2:${theme.card2};--pink:var(--member-woni);--pink-soft:${theme.primarySoft};--purple:var(--member-zena);--green:var(--member-woni);--blue:var(--member-minami);--yellow:var(--member-may);--ink:var(--member-liv);--text:${theme.text};--muted:${theme.muted};
 --member-spectrum:linear-gradient(110deg,var(--member-woni),var(--member-minami) 32%,var(--member-zena) 58%,var(--member-may) 82%,var(--member-liv));
 --border:color-mix(in srgb,var(--member-zena) 22%,transparent);--header-bg:color-mix(in srgb,${theme.background} 91%,transparent);--header-border:color-mix(in srgb,var(--member-minami) 18%,transparent);--hover-bg:color-mix(in srgb,var(--member-woni) 10%,transparent);--soft-bg:color-mix(in srgb,${theme.text} 5%,transparent);--shadow:0 18px 48px color-mix(in srgb,${theme.background} 68%,transparent);
}
body{background:radial-gradient(circle at 8% 7%,color-mix(in srgb,var(--member-woni) 18%,transparent),transparent 28%),radial-gradient(circle at 92% 11%,color-mix(in srgb,var(--member-zena) 18%,transparent),transparent 31%),radial-gradient(circle at 12% 88%,color-mix(in srgb,var(--member-minami) 12%,transparent),transparent 30%),radial-gradient(circle at 86% 88%,color-mix(in srgb,var(--member-may) 9%,transparent),transparent 28%),linear-gradient(145deg,var(--bg) 0%,var(--bg2) 52%,var(--bg) 100%)!important}
.card,.news-card{background:linear-gradient(145deg,color-mix(in srgb,var(--card) 97%,transparent),color-mix(in srgb,var(--card2) 91%,transparent));border-color:color-mix(in srgb,var(--member-zena) 15%,transparent)}
.hero,.page-header,.focus-card{background:radial-gradient(circle at 88% 8%,color-mix(in srgb,var(--member-woni) 22%,transparent),transparent 31%),radial-gradient(circle at 10% 92%,color-mix(in srgb,var(--member-minami) 16%,transparent),transparent 36%),radial-gradient(circle at 68% 90%,color-mix(in srgb,var(--member-may) 8%,transparent),transparent 26%),linear-gradient(135deg,color-mix(in srgb,var(--card2) 96%,transparent),color-mix(in srgb,var(--bg2) 92%,transparent))}
.logo span,.hero h1 span{background:var(--member-spectrum);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.btn-primary,.filter.active,.language-options button.is-active{background:linear-gradient(120deg,var(--member-woni),var(--member-minami) 48%,var(--member-zena));color:#fff;border-color:transparent}
.section-kicker,.page-kicker,.badge{color:var(--member-woni)}
html.light-mode{--bg:${theme.lightBackground};--bg2:color-mix(in srgb,${theme.lightBackground} 90%,var(--member-zena));--card:${theme.lightCard};--card2:color-mix(in srgb,${theme.lightCard} 94%,var(--member-may));--text:${theme.lightText};--muted:color-mix(in srgb,${theme.lightText} 68%,transparent);--header-bg:color-mix(in srgb,${theme.lightCard} 94%,transparent);--soft-bg:color-mix(in srgb,var(--member-woni) 7%,${theme.lightCard});--border:color-mix(in srgb,var(--member-zena) 19%,transparent);--shadow:0 18px 42px rgba(44,44,53,.10)}
html.light-mode body{background:radial-gradient(circle at 7% 8%,color-mix(in srgb,var(--member-woni) 23%,transparent),transparent 29%),radial-gradient(circle at 94% 8%,color-mix(in srgb,var(--member-zena) 18%,transparent),transparent 31%),radial-gradient(circle at 10% 90%,color-mix(in srgb,var(--member-minami) 14%,transparent),transparent 30%),radial-gradient(circle at 88% 90%,color-mix(in srgb,var(--member-may) 17%,transparent),transparent 30%),linear-gradient(145deg,var(--bg),var(--bg2) 52%,var(--bg))!important}
html.light-mode .card,html.light-mode .news-card{box-shadow:0 14px 36px rgba(44,44,53,.08);border-color:color-mix(in srgb,var(--member-minami) 16%,transparent)}
html.light-mode .member-liv .member-color-chip,html.light-mode .member-liv .badge{color:#fff}
`;
await mkdir("data",{recursive:true}); await mkdir("css",{recursive:true});
if ((await readFile("data/homepage.json","utf8").catch(()=>"")) !== jsonText) await writeFile("data/homepage.json",jsonText,"utf8");
if ((await readFile("data/homepage-data.js","utf8").catch(()=>"")) !== jsText) await writeFile("data/homepage-data.js",jsText,"utf8");
const themeJsonText = `${JSON.stringify(themePayload,null,2)}\n`;
if ((await readFile("data/site-theme.json","utf8").catch(()=>"")) !== themeJsonText) await writeFile("data/site-theme.json",themeJsonText,"utf8");
if ((await readFile("css/notion-theme.css","utf8").catch(()=>"")) !== themeCss) await writeFile("css/notion-theme.css",themeCss,"utf8");
console.log(`${homepageItems.length}件のホーム表示、ナビ${siteManagement.navigation.length}件、ページ設定${Object.keys(siteManagement.pages).length}件、リンク設定${Object.keys(siteManagement.links).length}件、更新履歴${siteManagement.updates.length}件、追加翻訳${siteManagement.translations.length}件とサイトテーマ「${theme.name}」を同期しました。テーマ設定不足: ${missingThemeRows.length}件。データ変更: ${changed ? "あり" : "なし"}`);
