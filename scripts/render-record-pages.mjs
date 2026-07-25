import { readFile, writeFile } from "node:fs/promises";

const dataPath = process.argv[2] || "data/records.json";
const payload = JSON.parse(await readFile(dataPath, "utf8"));
const wins = Array.isArray(payload.musicShowWins) ? [...payload.musicShowWins] : [];
const melon = Array.isArray(payload.melonRecords) ? [...payload.melonRecords] : [];

wins.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || Number(a.order ?? 9999) - Number(b.order ?? 9999));
melon.sort((a, b) => String(a.releaseDate || "9999-99-99").localeCompare(String(b.releaseDate || "9999-99-99")) || Number(a.order ?? 9999) - Number(b.order ?? 9999));

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const dateJa = (value) => value ? String(value).slice(0, 10).replaceAll("-", ".") : "未入力";
const rank = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? `#${Number(value)}` : "未入力";
const safeLink = (url) => /^https?:\/\//i.test(String(url || "")) ? String(url) : "";
const safeImage = (value, fallback) => {
  const image = String(value || "").trim().replace(/^\/+/, "");
  return image || fallback;
};

async function replaceBlock(path, startName, html) {
  const start = `<!-- ${startName}-START -->`;
  const end = `<!-- ${startName}-END -->`;
  const source = await readFile(path, "utf8");
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (!pattern.test(source)) throw new Error(`${path}: ${startName} の生成範囲が見つかりません。`);
  const next = source.replace(pattern, `${start}\n${html.trim()}\n${end}`);
  if (next !== source) await writeFile(path, next, "utf8");
}

const newestWin = wins.at(-1);
const firstWin = wins[0];
const bestTop100 = melon.reduce((best, item) => {
  const value = Number(item.top100Peak);
  return Number.isFinite(value) && value > 0 && (!best || value < best) ? value : best;
}, null);
const bestDaily = melon.reduce((best, item) => {
  const value = Number(item.dailyPeak);
  return Number.isFinite(value) && value > 0 && (!best || value < best) ? value : best;
}, null);

const landingOverview = `
<div class="record-overview" aria-label="記録の概要">
  <article class="card record-stat"><small>MUSIC SHOW WINS</small><strong>${wins.length}</strong><span>音楽番組1位 総獲得数</span></article>
  <article class="card record-stat"><small>MELON TOP100</small><strong>${bestTop100 ? `#${bestTop100}` : "—"}</strong><span>TOP100最高順位</span></article>
  <article class="card record-stat"><small>MELON DAILY</small><strong>${bestDaily ? `#${bestDaily}` : "—"}</strong><span>日間最高順位</span></article>
</div>`;

const milestoneItems = [];
for (const item of [...wins].reverse().slice(0, 3)) {
  milestoneItems.push(`<article class="card record-timeline-item"><time class="record-timeline-date" datetime="${esc(item.date)}">${esc(dateJa(item.date))}</time><div class="record-timeline-copy"><h3>${esc(item.song || item.title)} — ${esc(item.program || "音楽番組")}</h3><p>${esc(item.description || "音楽番組で1位を獲得しました。")}</p></div><span class="record-timeline-tag">MUSIC SHOW</span></article>`);
}
for (const item of [...melon].reverse().slice(0, 3)) {
  milestoneItems.push(`<article class="card record-timeline-item"><time class="record-timeline-date" datetime="${esc(item.releaseDate)}">${esc(dateJa(item.releaseDate))}</time><div class="record-timeline-copy"><h3>${esc(item.song || item.title)} — Melon</h3><p>TOP100最高 ${esc(rank(item.top100Peak))}／日間最高 ${esc(rank(item.dailyPeak))}</p></div><span class="record-timeline-tag">MELON</span></article>`);
}
const milestones = milestoneItems.length ? `<div class="record-timeline">${milestoneItems.join("\n")}</div>` : '<div class="card record-empty">公開中の記録はまだありません。</div>';

const winOverview = `
<div class="record-overview" aria-label="音楽番組1位の概要">
  <article class="card record-stat"><small>TOTAL WINS</small><strong>${wins.length}</strong><span>通算1位回数</span></article>
  <article class="card record-stat"><small>FIRST WIN</small><strong>${firstWin?.date ? esc(String(firstWin.date).slice(0, 4)) : "—"}</strong><span>${firstWin?.date ? esc(dateJa(firstWin.date)) : "未登録"}</span></article>
  <article class="card record-stat"><small>LATEST WIN</small><strong>${newestWin?.song ? esc(newestWin.song) : "—"}</strong><span>${newestWin?.program ? esc(newestWin.program) : "未登録"}</span></article>
</div>`;

const winList = wins.length ? `<div class="wins-list">${[...wins].reverse().map((item, index) => {
  const video = safeLink(item.videoUrl);
  const image = safeImage(item.image, "news/the-show-first-win.jpeg");
  return `<article class="card record-win-card">
    <div class="record-win-image"><img src="${esc(image)}" alt="${esc(item.song || item.title)}が${esc(item.program || "音楽番組")}で1位を獲得した際の画像" loading="lazy"></div>
    <div class="record-win-copy"><div class="record-win-meta"><span class="wins-number">${String(wins.length - index).padStart(2, "0")}</span><time datetime="${esc(item.date)}">${esc(dateJa(item.date))}</time><span class="badge">${esc(item.program || "MUSIC SHOW")}</span></div>
    <h2>${esc(item.song || item.title)}</h2><p>${esc(item.description || "音楽番組で1位を獲得しました。")}</p>
    <div class="win-detail-grid"><div class="win-detail"><small>PROGRAM</small><strong>${esc(item.program || "未入力")}</strong></div><div class="win-detail"><small>DATE</small><strong>${esc(dateJa(item.date))}</strong></div><div class="win-detail"><small>SCORE</small><strong>${esc(item.score || "未入力")}</strong></div><div class="win-detail"><small>SONG</small><strong>${esc(item.song || "未入力")}</strong></div></div>
    <div class="win-actions">${video ? `<a class="btn btn-primary" href="${esc(video)}" target="_blank" rel="noopener noreferrer">1位獲得時の映像を見る ↗</a>` : '<span class="record-link-pending">映像リンクはNotionから追加できます</span>'}</div></div>
  </article>`;
}).join("\n")}</div>` : '<div class="card record-empty">公開中の音楽番組1位記録はまだありません。</div>';

const melonOverview = `
<div class="record-overview" aria-label="Melonチャート記録の概要">
  <article class="card record-stat"><small>TRACKS</small><strong>${melon.length}</strong><span>掲載楽曲数</span></article>
  <article class="card record-stat"><small>TOP100 PEAK</small><strong>${bestTop100 ? `#${bestTop100}` : "—"}</strong><span>TOP100最高順位</span></article>
  <article class="card record-stat"><small>DAILY PEAK</small><strong>${bestDaily ? `#${bestDaily}` : "—"}</strong><span>日間最高順位</span></article>
</div>`;

const melonList = melon.length ? `<div class="melon-record-list">${melon.map((item, index) => {
  const mv = safeLink(item.mvUrl);
  const image = safeImage(item.image, "news/melon-top100-first.jpg");
  return `<article class="card melon-record-card">
    <div class="melon-record-index">${String(index + 1).padStart(2, "0")}</div>
    <div class="melon-record-art"><img src="${esc(image)}" alt="${esc(item.song || item.title)}" loading="lazy"></div>
    <div class="melon-record-copy"><small>RELEASE ${esc(dateJa(item.releaseDate))}</small><h2>${esc(item.song || item.title)}</h2><p>${esc(item.description || "Melonチャート記録")}</p>${mv ? `<a class="record-inline-link" href="${esc(mv)}" target="_blank" rel="noopener noreferrer">MVを見る ↗</a>` : '<span class="record-link-pending">MVなし／未登録</span>'}</div>
    <dl class="melon-rank-grid"><div><dt>TOP100最高順位</dt><dd>${esc(rank(item.top100Peak))}</dd></div><div><dt>日間最高順位</dt><dd>${esc(rank(item.dailyPeak))}</dd></div></dl>
  </article>`;
}).join("\n")}</div>` : '<div class="card record-empty">公開中のMelonチャート記録はまだありません。</div>';

await replaceBlock("records.html", "RECORDS-OVERVIEW", landingOverview);
await replaceBlock("records.html", "RECORDS-MILESTONES", milestones);
await replaceBlock("music-show-wins.html", "MUSIC-WINS-OVERVIEW", winOverview);
await replaceBlock("music-show-wins.html", "MUSIC-WINS-LIST", winList);
await replaceBlock("melon-records.html", "MELON-RECORDS-OVERVIEW", melonOverview);
await replaceBlock("melon-records.html", "MELON-RECORDS-LIST", melonList);

console.log(`記録ページを生成しました（音楽番組1位 ${wins.length}件 / Melon ${melon.length}件）。`);
