(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const fallback = window.RESCENE_SURVEY_RESULTS || null;
  const number = (value) => Number(value || 0).toLocaleString("ja-JP");
  const percent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
  const dateTime = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  };
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    return el;
  };
  const hidden = (el, value) => { if (el) el.hidden = Boolean(value); };
  async function getJson(path) {
    const sep = path.includes("?") ? "&" : "?";
    const response = await fetch(`${path}${sep}t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  function ranking(campaign, config) {
    const host = $("#surveyRanking");
    const empty = $("#surveyRankingEmpty");
    host.replaceChildren();
    const rows = Array.isArray(campaign?.ranking) ? campaign.ranking.slice(0, 5) : [];
    hidden(empty, rows.length > 0);
    if (!rows.length) return;
    const maxVotes = Math.max(...rows.map((item) => Number(item.votes || 0)), 1);
    rows.forEach((item, index) => {
      const row = document.createElement("article");
      row.className = "survey-ranking-row";
      const rank = node("span", "survey-rank-number", String(index + 1));
      const body = document.createElement("div"); body.className = "survey-rank-body";
      const top = document.createElement("div"); top.className = "survey-rank-top";
      top.append(node("strong", "survey-rank-song", item.name || "—"), node("span", "survey-rank-votes", `${number(item.votes)}票 · 選択率 ${percent(item.respondentRate)}`));
      const track = document.createElement("div"); track.className = "survey-rank-track";
      const fill = document.createElement("span"); fill.className = "survey-rank-fill"; fill.style.width = `${Math.max(2, (Number(item.votes || 0) / maxVotes) * 100)}%`; track.append(fill);
body.append(top, track); row.append(rank, body); host.append(row);
    });
  }
  function ratings(campaign) {
    const section = $("#surveyRatingsSection"), host = $("#surveyRatings"); host.replaceChildren();
    const rows = Array.isArray(campaign?.ratings) ? campaign.ratings : [];
    hidden(section, rows.length === 0);
    rows.forEach((item) => {
      const card = document.createElement("article"); card.className = "card survey-rating-card";
      const value = item.average == null ? "—" : Number(item.average).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      card.append(node("small", "", item.label || "評価"), node("strong", "", value), node("span", "", `${number(item.count)}件の回答`));
      host.append(card);
    });
  }
  function members(campaign) {
    const section = $("#surveyMembersSection"), host = $("#surveyMembers"); host.replaceChildren();
    const rows = Array.isArray(campaign?.memberDistribution) ? campaign.memberDistribution : [];
    hidden(section, rows.length === 0); if (!rows.length) return;
    const maxVotes = Math.max(...rows.map((item) => Number(item.votes || 0)), 1);
    rows.forEach((item) => {
      const row = document.createElement("div"); row.className = "survey-member-row";
      const top = document.createElement("div"); top.className = "survey-member-top";
      top.append(node("strong", "", item.name || "—"), node("span", "", `${number(item.votes)}票 · ${percent(item.respondentRate)}`));
      const track = document.createElement("div"); track.className = "survey-member-track";
      const fill = document.createElement("span"); fill.style.width = `${Math.max(2, (Number(item.votes || 0) / maxVotes) * 100)}%`; track.append(fill);
      row.append(top, track); host.append(row);
    });
  }
  function comments(campaign) {
    const section = $("#surveyCommentsSection"), host = $("#surveyComments"); host.replaceChildren();
    const rows = Array.isArray(campaign?.publicComments) ? campaign.publicComments : [];
    hidden(section, rows.length === 0);
    rows.forEach((item) => {
      const card = document.createElement("article"); card.className = "card survey-comment-card";
      const meta = document.createElement("div"); meta.className = "survey-comment-meta"; meta.append(node("strong", "", item.author || "匿名REMINE"), node("span", "", item.date || ""));
      card.append(node("p", "survey-comment-text", item.text || ""), meta); host.append(card);
    });
  }
  function campaign(campaign, config, payload) {
    $("#surveyResponseCount").textContent = number(campaign?.responseCount);
$("#surveyLastSync").textContent = dateTime(payload.generatedAt);
    $("#surveyLastResponse").textContent = campaign?.lastResponseAt ? dateTime(campaign.lastResponseAt) : "—";
    $("#surveyRankingTitle").textContent = config.rankingTitle || "好きな曲ランキング";
    $("#surveyRankingDescription").textContent = config.rankingDescription || "回答者が選択した楽曲を集計しています。";
    ranking(campaign, config); ratings(campaign); members(campaign); comments(campaign);
  }
  function form(config) {
    const cta = $("#surveyFormCta"), button = $("#surveyFormButton"), status = $("#surveyFormStatus");
    const url = String(config.formUrl || "").trim(); const open = String(config.formStatus || "open").toLowerCase() === "open";
    if (!url) { hidden(cta, true); return; }
    hidden(cta, false); button.href = url; button.textContent = open ? "アンケートに回答する" : "回答フォームを見る"; status.textContent = open ? "現在受付中" : "受付終了"; status.dataset.status = open ? "open" : "closed";
  }
  function render(payload, config) {
    const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
    $("#surveyTitle").textContent = payload?.surveyTitle || config.surveyTitle || "RESCENE アンケート";
    $("#surveyAutoUpdate").textContent = `${Number(config.updateIntervalMinutes || payload?.meta?.updateIntervalMinutes || 60)}分ごとに自動集計`;
    form(config);
    if (!campaigns.length) { hidden($("#surveyLoading"), true); hidden($("#surveyDataError"), false); $("#surveyDataError").textContent = "まだ集計対象の回答がありません。"; return; }
    const selectWrap = $("#surveyCampaignWrap"), select = $("#surveyCampaign"); select.replaceChildren();
    campaigns.forEach((item) => { const option = document.createElement("option"); option.value = item.name; option.textContent = item.name; select.append(option); });
    const active = campaigns.find((item) => item.name === payload.activeCampaign) || campaigns[0]; select.value = active.name; hidden(selectWrap, campaigns.length <= 1); campaign(active, config, payload);
    select.addEventListener("change", () => { campaign(campaigns.find((item) => item.name === select.value) || campaigns[0], config, payload); window.dispatchEvent(new CustomEvent("rescene:content-rendered")); });
    hidden($("#surveyLoading"), true); window.dispatchEvent(new CustomEvent("rescene:content-rendered"));
  }
  async function main() {
    let config = {}, payload = fallback; hidden($("#surveyDataError"), true);
    try {
      const [freshConfig, freshPayload] = await Promise.all([getJson("data/survey-config.json"), getJson("data/survey-results.json")]); config = freshConfig || {}; payload = freshPayload || fallback;
    } catch (error) {
      try { config = await getJson("data/survey-config.json"); } catch {}
      if (!payload) { hidden($("#surveyLoading"), true); hidden($("#surveyDataError"), false); $("#surveyDataError").textContent = "アンケート集計データを読み込めませんでした。時間をおいて再度お試しください。"; console.error(error); return; }
    }
    render(payload, config);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", main, { once: true }) : main();
})();
