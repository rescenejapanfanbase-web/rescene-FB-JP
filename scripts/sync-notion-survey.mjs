import { readFile, writeFile } from "node:fs/promises";

const CONFIG_PATH = "data/survey-config.json";
const OUTPUT_JSON = "data/survey-results.json";
const OUTPUT_JS = "data/survey-results-data.js";
const NOTION_VERSION = "2026-03-11";

const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const token = String(process.env.NOTION_TOKEN || "").trim();
const dataSourceId = String(process.env.NOTION_SURVEY_DATA_SOURCE_ID || config.dataSourceId || "").trim();
if (!token) throw new Error("NOTION_TOKEN が設定されていません。");
if (!dataSourceId) throw new Error("NotionアンケートのData Source IDがありません。");
const notionApiBase = String(process.env.NOTION_API_BASE || "https://api.notion.com").replace(/\/$/, "");

function richText(items) {
  return (Array.isArray(items) ? items : []).map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();
}
function propText(prop) {
  if (!prop || typeof prop !== "object") return "";
  switch (prop.type) {
    case "title": return richText(prop.title);
    case "rich_text": return richText(prop.rich_text);
    case "select": return String(prop.select?.name || "").trim();
    case "status": return String(prop.status?.name || "").trim();
    case "url": return String(prop.url || "").trim();
    case "created_time": return String(prop.created_time || "").trim();
    case "last_edited_time": return String(prop.last_edited_time || "").trim();
    case "date": return String(prop.date?.start || "").trim();
    case "number": return Number.isFinite(prop.number) ? String(prop.number) : "";
    case "formula":
      if (typeof prop.formula?.number === "number") return String(prop.formula.number);
      if (typeof prop.formula?.string === "string") return prop.formula.string.trim();
      return "";
    default: return "";
  }
}
function propNames(prop) {
  if (!prop || typeof prop !== "object") return [];
  if (prop.type === "multi_select") return (prop.multi_select || []).map((item) => String(item?.name || "").trim()).filter(Boolean);
  const text = propText(prop);
  return text ? [text] : [];
}
function propNumber(prop) {
  if (!prop || typeof prop !== "object") return null;
  if (prop.type === "number" && typeof prop.number === "number" && Number.isFinite(prop.number)) return prop.number;
  if (prop.type === "formula" && typeof prop.formula?.number === "number" && Number.isFinite(prop.formula.number)) return prop.formula.number;
  const raw = propText(prop).replace(/[^\d.+-]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function propCheckbox(prop) { return Boolean(prop && prop.type === "checkbox" && prop.checkbox === true); }
function firstExistingProperty(properties, candidates = []) {
  for (const name of candidates) if (Object.prototype.hasOwnProperty.call(properties || {}, name)) return name;
  return "";
}
function firstText(properties, candidates = []) {
  for (const name of candidates) { const value = propText(properties?.[name]); if (value) return value; }
  return "";
}
function normalizedIso(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
function containsExcludedMarker(page) {
  const markers = Array.isArray(config.excludeMarkers) ? config.excludeMarkers.filter(Boolean) : [];
  if (!markers.length) return false;
  const props = page?.properties || {};
  const haystack = Object.values(props).flatMap((prop) => {
    const values = propNames(prop);
    const text = propText(prop);
    return text ? [...values, text] : values;
  }).join("\n");
  return markers.some((marker) => haystack.includes(marker));
}
async function notionRequest(path, options = {}) {
  const response = await fetch(`${notionApiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${await response.text()}`);
  return response.json();
}
async function queryAllPages() {
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const data = await notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: "POST", body: JSON.stringify(body) });
    results.push(...(data.results || []).filter((item) => item?.object === "page" && !item.in_trash));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);
  return results;
}
function makeCampaign(name) {
  return { name, responseCount: 0, totalSelections: 0, firstResponseAt: "", lastResponseAt: "", songVotes: new Map(), memberVotes: new Map(), ratingValues: new Map(), publicComments: [] };
}

const pages = await queryAllPages();
const campaigns = new Map();
const discoveredFields = new Set();
for (const page of pages) {
  if (containsExcludedMarker(page)) continue;
  const properties = page.properties || {};
  Object.keys(properties).forEach((key) => discoveredFields.add(key));
  const campaignName = firstText(properties, config.campaignFieldCandidates || []) || String(config.defaultCampaign || config.surveyTitle || "アンケート");
  if (!campaigns.has(campaignName)) campaigns.set(campaignName, makeCampaign(campaignName));
  const campaign = campaigns.get(campaignName);
  const responseIso = normalizedIso(propText(properties["回答日時"]) || page.created_time || "");
  campaign.responseCount += 1;
  if (responseIso) {
    if (!campaign.firstResponseAt || responseIso < campaign.firstResponseAt) campaign.firstResponseAt = responseIso;
    if (!campaign.lastResponseAt || responseIso > campaign.lastResponseAt) campaign.lastResponseAt = responseIso;
  }
  const songField = firstExistingProperty(properties, config.songFieldCandidates || ["好きな曲", "対象作品"]);
  const songs = [...new Set(propNames(properties[songField]).map((x) => x.trim()).filter(Boolean))];
  for (const song of songs) {
    campaign.songVotes.set(song, (campaign.songVotes.get(song) || 0) + 1);
    campaign.totalSelections += 1;
  }
  const memberField = firstExistingProperty(properties, config.memberFieldCandidates || ["推しメンバー"]);
  const members = [...new Set(propNames(properties[memberField]).map((x) => x.trim()).filter(Boolean))];
  for (const member of members) campaign.memberVotes.set(member, (campaign.memberVotes.get(member) || 0) + 1);
  for (const ratingConfig of config.ratingFields || []) {
    const field = firstExistingProperty(properties, ratingConfig.candidates || [ratingConfig.label]);
    const value = field ? propNumber(properties[field]) : null;
    if (value === null) continue;
    if (!campaign.ratingValues.has(ratingConfig.key)) campaign.ratingValues.set(ratingConfig.key, { key: ratingConfig.key, label: ratingConfig.label || field, values: [] });
    campaign.ratingValues.get(ratingConfig.key).values.push(value);
  }
  const permissionField = firstExistingProperty(properties, config.permissionFieldCandidates || ["サイト掲載許可"]);
  if (permissionField && propCheckbox(properties[permissionField])) {
    const comment = firstText(properties, config.commentFieldCandidates || ["テキスト", "自由コメント", "コメント", "感想"]);
    if (comment) {
      const author = firstText(properties, config.authorFieldCandidates || ["ニックネーム", "回答者名"]) || "匿名REMINE";
      campaign.publicComments.push({ text: comment, author, date: responseIso ? responseIso.slice(0, 10) : "", createdAt: responseIso });
    }
  }
}
if (campaigns.size === 0) {
  const name = String(config.defaultCampaign || config.surveyTitle || "アンケート");
  campaigns.set(name, makeCampaign(name));
}

const publicCampaigns = [...campaigns.values()].map((campaign) => {
  const ranking = [...campaign.songVotes.entries()].map(([name, votes]) => ({
    name, votes,
    respondentRate: campaign.responseCount ? round((votes / campaign.responseCount) * 100, 1) : 0,
    selectionShare: campaign.totalSelections ? round((votes / campaign.totalSelections) * 100, 1) : 0,
  })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ja")).slice(0, 5);
  const ratings = [...campaign.ratingValues.values()].map((rating) => ({
    key: rating.key,
    label: rating.label,
    average: rating.values.length ? round(rating.values.reduce((sum, value) => sum + value, 0) / rating.values.length, 2) : null,
    count: rating.values.length,
  })).filter((item) => item.count > 0);
  const memberTotal = [...campaign.memberVotes.values()].reduce((sum, value) => sum + value, 0);
  const memberDistribution = [...campaign.memberVotes.entries()].map(([name, votes]) => ({
    name, votes,
    respondentRate: campaign.responseCount ? round((votes / campaign.responseCount) * 100, 1) : 0,
    share: memberTotal ? round((votes / memberTotal) * 100, 1) : 0,
  })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ja"));
  const publicComments = [...campaign.publicComments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, Number(config.maxPublicComments || 20)).map(({ createdAt, ...comment }) => comment);
  return { name: campaign.name, responseCount: campaign.responseCount, totalSelections: campaign.totalSelections, firstResponseAt: campaign.firstResponseAt, lastResponseAt: campaign.lastResponseAt, ranking, ratings, memberDistribution, publicComments };
}).sort((a, b) => String(b.lastResponseAt || "").localeCompare(String(a.lastResponseAt || "")) || a.name.localeCompare(b.name, "ja"));

const configuredActive = String(config.activeCampaign || "").trim();
const activeCampaign = publicCampaigns.some((item) => item.name === configuredActive) ? configuredActive : publicCampaigns[0]?.name || String(config.defaultCampaign || "");
const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "survey",
  surveyTitle: String(config.surveyTitle || "RESCENE アンケート"),
  activeCampaign,
  campaigns: publicCampaigns,
  meta: {
    rawResponsesPublished: false,
    commentsRequirePermission: true,
    updateIntervalMinutes: Number(config.updateIntervalMinutes || 60),
    discoveredFields: [...discoveredFields].sort((a, b) => a.localeCompare(b, "ja")),
  },
};
await writeFile(OUTPUT_JSON, JSON.stringify(payload, null, 2) + "\n", "utf8");
await writeFile(OUTPUT_JS, `window.RESCENE_SURVEY_RESULTS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
console.log(`アンケート集計完了: ${publicCampaigns.length}企画 / ${publicCampaigns.reduce((sum, item) => sum + item.responseCount, 0)}回答 / ${publicCampaigns.reduce((sum, item) => sum + item.totalSelections, 0)}楽曲選択`);
