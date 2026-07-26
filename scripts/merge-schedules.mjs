import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildScheduleIcs } from "./calendar-ics.mjs";

const NOTION_PATH = "data/schedule-notion.json";
const PLUSCHAT_PATH = "data/pluschat-schedule.json";
const FINAL_PATH = "data/schedule.json";
const SCRIPT_PATH = "data/schedule-data.js";
const ICS_PATH = "data/rescene-schedule.ics";

async function readJson(path, fallback = {}) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

const dateOnly = (event) => String(event?.date || event?.start || "").slice(0, 10);
const startMinutes = (event) => {
  const value = String(event?.start || "");
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const compact = (value = "") => String(value)
  .normalize("NFKC")
  .toUpperCase()
  .replace(/[「」『』〈〉《》<>\[\]()（）【】]/g, "")
  .replace(/[!！?？'"“”‘’・·.,，。:：;；／/\\\-_+＋&＆]/g, "")
  .replace(/\s+/g, "");

function programKey(value = "") {
  const text = compact(value);
  const programs = [
    ["INKIGAYO", /人気歌謡|INKIGAYO/],
    ["MCOUNTDOWN", /MCOUNTDOWN|엠카운트다운/],
    ["MUSICBANK", /MUSICBANK|ミュージックバンク|뮤직뱅크/],
    ["MUSICCORE", /SHOW音楽中心|音楽中心|쇼음악중심/],
    ["THESHOW", /THESHOW|더쇼/],
    ["SHOWCHAMPION", /SHOWCHAMPION|쇼챔피언/],
    ["IDOLRADIO", /IDOLRADIO|アイドルラジオ|아이돌라디오/],
    ["FANPOPTY", /FANPOPTY|ファンポプティ|팬팝티/],
    ["KISSTHERADIO", /KISSTHERADIO|キスザラジオ|키스더라디오/],
  ];
  return programs.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function subtypeKey(value = "") {
  const text = compact(value);
  if (/事前収録2|事前録画2|사전녹화2/.test(text)) return "PRERECORD2";
  if (/事前収録1|事前録画1|사전녹화1/.test(text)) return "PRERECORD1";
  if (/事前収録|事前録画|사전녹화/.test(text)) return "PRERECORD";
  if (/ビデオ通話|映像通話|영상통화/.test(text) && /サイン会|팬사인회/.test(text)) return "VIDEOSIGN";
  if (/サイン会|팬사인회/.test(text)) return "FANSIGN";
  if (/ミニファンミーティング|미니팬미팅/.test(text)) return "MINIFANMEETING";
  if (/発売|リリース|RELEASE|발매|SINGLE|ALBUM|EP/.test(text)) return "RELEASE";
  if (/収録|録画|녹화/.test(text)) return "RECORDING";
  if (/出演|本放送|生放送|방송/.test(text)) return "BROADCAST";
  return "GENERAL";
}

function signature(event) {
  const title = `${event?.title || ""} ${event?.originalTitle || ""}`;
  const program = programKey(title);
  if (program) return `${program}:${subtypeKey(title)}`;
  if (subtypeKey(title) === "RELEASE") {
    return `RELEASE:${compact(title).replace(/発売|リリース|RELEASE|SPECIALSINGLE|SINGLE|ALBUM|EP/g, "")}`;
  }
  return "";
}

function bigrams(value) {
  const text = compact(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
}

function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function likelyDuplicate(notionEvent, plusEvent) {
  if (dateOnly(notionEvent) !== dateOnly(plusEvent)) return false;

  const notionSignature = signature(notionEvent);
  const plusSignature = signature(plusEvent);
  if (notionSignature && notionSignature === plusSignature) return true;

  const notionTitle = compact(notionEvent.title);
  const plusTitle = compact(plusEvent.title);
  const originalTitle = compact(plusEvent.originalTitle);
  const notionTime = startMinutes(notionEvent);
  const plusTime = startMinutes(plusEvent);
  const timeClose = notionTime === null || plusTime === null || Math.abs(notionTime - plusTime) <= 90;

  if (timeClose && notionTitle && plusTitle && (notionTitle === plusTitle || notionTitle.includes(plusTitle) || plusTitle.includes(notionTitle))) {
    return true;
  }
  if (timeClose && originalTitle && notionTitle && (notionTitle.includes(originalTitle) || originalTitle.includes(notionTitle))) {
    return true;
  }
  if (notionTime !== null && plusTime !== null && notionTime === plusTime && similarity(notionEvent.title, plusEvent.title) >= 0.55) {
    return true;
  }
  return false;
}

export function mergeScheduleEvents(notionEvents = [], plusChatEvents = []) {
  const notion = Array.isArray(notionEvents)
    ? notionEvents.filter(Boolean).map((event) => ({ ...event, source: event.source || "notion" }))
    : [];
  const plus = Array.isArray(plusChatEvents)
    ? plusChatEvents.filter(Boolean).map((event) => ({ ...event, source: "pluschat" }))
    : [];

  const acceptedPlus = [];
  const duplicates = [];
  for (const event of plus) {
    const matched = notion.find((candidate) => likelyDuplicate(candidate, event));
    if (matched) {
      duplicates.push({ plusChatId: event.id, plusChatTitle: event.title, notionId: matched.id, notionTitle: matched.title, date: dateOnly(event) });
    } else {
      acceptedPlus.push(event);
    }
  }

  const events = [...notion, ...acceptedPlus].sort((a, b) => {
    const aStart = String(a.start || a.date || "");
    const bStart = String(b.start || b.date || "");
    return aStart.localeCompare(bStart) || String(a.title || "").localeCompare(String(b.title || ""), "ja");
  });
  return { events, acceptedPlus, duplicates, notion };
}

export async function writeMergedSchedule(options = {}) {
  const notionPayload = await readJson(options.notionPath || NOTION_PATH, null);
  const currentPayload = await readJson(options.finalPath || FINAL_PATH, { events: [] });
  const notionEvents = Array.isArray(notionPayload?.events)
    ? notionPayload.events
    : (Array.isArray(currentPayload?.events) ? currentPayload.events.filter((event) => event?.source !== "pluschat") : []);
  const plusPayload = await readJson(options.plusChatPath || PLUSCHAT_PATH, { events: [] });
  const plusEvents = Array.isArray(plusPayload?.events) ? plusPayload.events : [];
  const merged = mergeScheduleEvents(notionEvents, plusEvents);

  const eventsChanged = JSON.stringify(currentPayload?.events || []) !== JSON.stringify(merged.events);
  const generatedAt = eventsChanged
    ? new Date().toISOString()
    : currentPayload?.generatedAt || notionPayload?.generatedAt || new Date().toISOString();
  const payload = {
    generatedAt,
    source: "notion+pluschat",
    dataSourceId: notionPayload?.dataSourceId || currentPayload?.dataSourceId || "",
    sourceCounts: {
      notion: merged.notion.length,
      plusChatAvailable: plusEvents.length,
      plusChatAdded: merged.acceptedPlus.length,
      plusChatDuplicates: merged.duplicates.length,
    },
    plusChatGeneratedAt: plusPayload?.generatedAt || "",
    events: merged.events,
  };
  const desiredJson = `${JSON.stringify(payload, null, 2)}\n`;
  const desiredScript = `window.RESCENE_SCHEDULE_PAYLOAD = ${JSON.stringify(payload, null, 2)};\n`;
  const desiredIcs = buildScheduleIcs(merged.events, {
    generatedAt,
    siteUrl: process.env.SITE_BASE_URL || "https://rescene-fb.jp",
  });

  await mkdir("data", { recursive: true });
  const currentJson = await readText(options.finalPath || FINAL_PATH);
  const currentScript = await readText(options.scriptPath || SCRIPT_PATH);
  const currentIcs = await readText(options.icsPath || ICS_PATH);
  if (currentJson !== desiredJson) await writeFile(options.finalPath || FINAL_PATH, desiredJson, "utf8");
  if (currentScript !== desiredScript) await writeFile(options.scriptPath || SCRIPT_PATH, desiredScript, "utf8");
  if (currentIcs !== desiredIcs) await writeFile(options.icsPath || ICS_PATH, desiredIcs, "utf8");

  return {
    changed: currentJson !== desiredJson || currentScript !== desiredScript || currentIcs !== desiredIcs,
    eventsChanged,
    total: merged.events.length,
    notion: merged.notion.length,
    plusChatAvailable: plusEvents.length,
    plusChatAdded: merged.acceptedPlus.length,
    plusChatDuplicates: merged.duplicates.length,
    duplicates: merged.duplicates,
  };
}

async function runCli() {
  const result = await writeMergedSchedule();
  console.log(
    `スケジュール統合: 全${result.total}件 / Notion ${result.notion}件 / `
    + `Plus Chat追加 ${result.plusChatAdded}件 / 重複除外 ${result.plusChatDuplicates}件 / 変更 ${result.changed ? "あり" : "なし"}`,
  );
  if (result.duplicates.length) {
    console.log("Notionを優先して除外したPlus Chat予定:");
    for (const item of result.duplicates) {
      console.log(`- ${item.date} ${item.plusChatTitle} -> ${item.notionTitle}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
