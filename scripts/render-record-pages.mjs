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
const rank = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? `#${Number(value)}` : "-";
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
    <div class="win-detail-grid"><div class="win-detail"><small>PROGRAM</small><strong>${esc(item.program || "未入力")}</strong></div><div class="win-detail"><small>DATE</small><strong>${esc(dateJa(item.date))}</strong></div><div class="win-detail"><small>SONG</small><strong>${esc(item.song || "未入力")}</strong></div></div>
    ${video ? `<div class="win-actions"><a class="btn btn-primary" href="${esc(video)}" target="_blank" rel="noopener noreferrer">${esc(item.videoLabel || "映像を見る")} ↗</a></div>` : ""}</div>
  </article>`;
}).join("\n")}</div>` : '<div class="card record-empty">公開中の音楽番組1位記録はまだありません。</div>';

const melonOverview = `
<div class="record-overview" aria-label="Melonチャート記録の概要">
  <article class="card record-stat"><small>TRACKS</small><strong>${melon.length}</strong><span>掲載楽曲数</span></article>
  <article class="card record-stat"><small>TOP100 PEAK</small><strong>${bestTop100 ? `#${bestTop100}` : "—"}</strong><span>TOP100最高順位</span></article>
  <article class="card record-stat"><small>DAILY PEAK</small><strong>${bestDaily ? `#${bestDaily}` : "—"}</strong><span>日間最高順位</span></article>
</div>`;

const melonList = melon.length ? `<div class="melon-sort-toolbar card" aria-label="楽曲別チャート記録の並び替え" data-i18n-ko="곡별 차트 기록 정렬" data-i18n-en="Sort chart records by song">
  <div class="melon-sort-copy"><strong data-i18n-ko="정렬" data-i18n-en="Sort">並び替え</strong><span data-i18n-ko="선택하면 즉시 순서가 변경됩니다." data-i18n-en="The list updates immediately after selection.">選択するとすぐに並び替わります。</span></div>
  <label class="melon-sort-field" for="melonRecordSort"><span class="sr-only" data-i18n-ko="정렬 기준" data-i18n-en="Sort by">並び替え条件</span><select id="melonRecordSort" class="melon-sort-select" data-melon-sort aria-controls="melonRecordList">
    <option value="release-asc" data-i18n-ko="발매일: 오래된 순 (오름차순)" data-i18n-en="Release: oldest first (ascending)">リリース：古い順（昇順）</option>
    <option value="release-desc" data-i18n-ko="발매일: 최신 순 (내림차순)" data-i18n-en="Release: newest first (descending)">リリース：新しい順（降順）</option>
    <option value="daily-asc" data-i18n-ko="일간 최고 순위: 높은 순 (1위부터)" data-i18n-en="Daily peak: highest first (No. 1 first)">日間最高順位：高い順（1位から）</option>
    <option value="daily-desc" data-i18n-ko="일간 최고 순위: 낮은 순" data-i18n-en="Daily peak: lowest first">日間最高順位：低い順</option>
  </select></label>
</div>
<div class="melon-record-list" id="melonRecordList" data-default-sort="release-asc">${melon.map((item, index) => {
  const mv = safeLink(item.mvUrl);
  const image = safeImage(item.image, "news/melon-top100-first.jpg");
  const releaseDate = String(item.releaseDate || "").slice(0, 10);
  const dailyPeak = Number.isFinite(Number(item.dailyPeak)) && Number(item.dailyPeak) > 0 ? Number(item.dailyPeak) : "";
  return `<article class="card melon-record-card" data-release-date="${esc(releaseDate)}" data-daily-peak="${esc(dailyPeak)}" data-original-index="${index}">
    <div class="melon-record-index">${String(index + 1).padStart(2, "0")}</div>
    <div class="melon-record-art"><img src="${esc(image)}" alt="${esc(item.song || item.title)}" loading="lazy"></div>
    <div class="melon-record-copy"><small>RELEASE ${esc(dateJa(item.releaseDate))}</small><h2>${esc(item.song || item.title)}</h2><p>${esc(item.description || "Melonチャート記録")}</p>${mv ? `<a class="record-inline-link" href="${esc(mv)}" target="_blank" rel="noopener noreferrer">MVを見る ↗</a>` : '<span class="record-link-pending">MVなし／未登録</span>'}</div>
    <dl class="melon-rank-grid"><div><dt>TOP100最高順位</dt><dd>${esc(rank(item.top100Peak))}</dd>${item.top100PeakDate ? `<small class="melon-rank-date"><span>獲得日</span><time datetime="${esc(item.top100PeakDate)}">${esc(dateJa(item.top100PeakDate))}</time></small>` : ""}</div><div><dt>日間最高順位</dt><dd>${esc(rank(item.dailyPeak))}</dd>${item.dailyPeakDate ? `<small class="melon-rank-date"><span>獲得日</span><time datetime="${esc(item.dailyPeakDate)}">${esc(dateJa(item.dailyPeakDate))}</time></small>` : ""}</div></dl>
  </article>`;
}).join("\n")}</div>` : '<div class="card record-empty">公開中のMelonチャート記録はまだありません。</div>';

await replaceBlock("records.html", "RECORDS-OVERVIEW", landingOverview);
await replaceBlock("records.html", "RECORDS-MILESTONES", milestones);
{
  const recordsPath = "records.html";
  const source = await readFile(recordsPath, "utf8");
  const next = source.replace("番組、獲得日、スコア、獲得時の映像を一覧で確認できます。", "番組、獲得日、楽曲、獲得時の映像を一覧で確認できます。");
  if (next !== source) await writeFile(recordsPath, next, "utf8");
}
await replaceBlock("music-show-wins.html", "MUSIC-WINS-OVERVIEW", winOverview);
await replaceBlock("music-show-wins.html", "MUSIC-WINS-LIST", winList);
await replaceBlock("melon-records.html", "MELON-RECORDS-OVERVIEW", melonOverview);
await replaceBlock("melon-records.html", "MELON-RECORDS-LIST", melonList);

console.log(`記録ページを生成しました（音楽番組1位 ${wins.length}件 / Melon ${melon.length}件）。`);
