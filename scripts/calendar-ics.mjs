import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_SITE_URL = "https://rescene-fb.jp";
const DEFAULT_CALENDAR_NAME = "RESCENE JAPAN FANBASE Schedule";

const recurringDefinitions = [
  { id: "woni", title: "WONI 誕生日", date: "2024-05-25", member: "WONI", description: "ウォニの誕生日です。", link: "members.html#woni-profile", category: "Birthday" },
  { id: "may", title: "MAY 誕生日", date: "2024-08-19", member: "MAY", description: "メイの誕生日です。", link: "members.html#may-profile", category: "Birthday" },
  { id: "liv", title: "LIV 誕生日", date: "2024-10-11", member: "LIV", description: "リブの誕生日です。", link: "members.html#liv-profile", category: "Birthday" },
  { id: "zena", title: "ZENA 誕生日", date: "2024-11-27", member: "ZENA", description: "ゼナの誕生日です。", link: "members.html#zena-profile", category: "Birthday" },
  { id: "minami", title: "MINAMI 誕生日", date: "2024-11-29", member: "MINAMI", description: "ミナミの誕生日です。", link: "members.html#minami-profile", category: "Birthday" },
  { id: "debut", title: "RESCENE デビュー記念日", date: "2024-03-26", description: "2024年3月26日にRESCENEがデビューしました。", link: "about.html", category: "記録" },
];

const pad = (value) => String(value).padStart(2, "0");
const toDateOnly = (value = "") => String(value).slice(0, 10);
const formatDateOnly = (value = "") => toDateOnly(value).replaceAll("-", "");
const formatUtc = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};
const addDays = (value, count) => {
  const [year, month, day] = toDateOnly(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const escapeIcsText = (value = "") => String(value)
  .replaceAll("\\", "\\\\")
  .replaceAll("\r\n", "\\n")
  .replaceAll("\n", "\\n")
  .replaceAll("\r", "\\n")
  .replaceAll(";", "\\;")
  .replaceAll(",", "\\,");
const absoluteUrl = (value = "", siteUrl = DEFAULT_SITE_URL) => {
  const text = String(value).trim();
  if (!text) return "";
  try {
    return new URL(text, `${siteUrl.replace(/\/$/, "")}/`).href;
  } catch {
    return "";
  }
};
const foldLine = (line) => {
  const chunks = [];
  let current = "";
  let bytes = 0;
  for (const char of String(line)) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = chunks.length ? 74 : 75;
    if (bytes + size > limit && current) {
      chunks.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks.join("\r\n ");
};
const normalizeTitle = (value = "") => String(value).toUpperCase().replace(/\s+/g, "");
const isRecurringSourceDuplicate = (event) => {
  const date = toDateOnly(event.start || event.date || "");
  const title = normalizeTitle(event.title);
  const category = String(event.category || "").toLowerCase();
  for (const item of recurringDefinitions.filter((entry) => entry.member)) {
    if (date.slice(5) !== item.date.slice(5) || !title.includes(item.member)) continue;
    if (category === "birthday" || /HAPPYBIRTHDAY|誕生日/.test(title)) return true;
  }
  return date.slice(5) === "03-26" && /RESCENE/.test(title) && /デビュー|ANNIVERSARY|周年|記念/.test(title);
};

function eventLines(event, { siteUrl, stamp }) {
  const startValue = String(event.start || event.date || "");
  if (!startValue) return [];
  const isTimed = startValue.includes("T");
  const id = String(event.id || `${event.title}-${startValue}`).replace(/[^a-zA-Z0-9._-]/g, "-");
  const scheduleUrl = `${siteUrl.replace(/\/$/, "")}/schedule.html?date=${encodeURIComponent(toDateOnly(startValue))}&event=${encodeURIComponent(event.id || "")}`;
  const eventLink = absoluteUrl(event.link, siteUrl);
  const descriptionParts = [event.description, eventLink ? `関連リンク: ${eventLink}` : "", `RESCENE JAPAN FANBASE: ${scheduleUrl}`].filter(Boolean);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${id}@rescene-fb.jp`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${escapeIcsText(event.title || "RESCENE 予定")}`,
  ];

  if (isTimed) {
    const start = new Date(startValue);
    if (Number.isNaN(start.getTime())) return [];
    let end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatUtc(start)}`, `DTEND:${formatUtc(end)}`);
  } else {
    const startDate = toDateOnly(startValue);
    const inclusiveEnd = toDateOnly(event.end || startDate);
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(startDate)}`, `DTEND;VALUE=DATE:${formatDateOnly(addDays(inclusiveEnd, 1))}`);
  }

  if (descriptionParts.length) lines.push(`DESCRIPTION:${escapeIcsText(descriptionParts.join("\n\n"))}`);
  if (eventLink) lines.push(`URL:${eventLink}`);
  if (event.category) lines.push(`CATEGORIES:${escapeIcsText(event.category)}`);
  lines.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

function recurringLines(item, { siteUrl, stamp }) {
  const eventLink = absoluteUrl(item.link, siteUrl);
  const details = [item.description, eventLink ? `関連リンク: ${eventLink}` : ""].filter(Boolean).join("\n\n");
  return [
    "BEGIN:VEVENT",
    `UID:auto-${item.id}@rescene-fb.jp`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${escapeIcsText(item.title)}`,
    `DTSTART;VALUE=DATE:${formatDateOnly(item.date)}`,
    `DTEND;VALUE=DATE:${formatDateOnly(addDays(item.date, 1))}`,
    "RRULE:FREQ=YEARLY",
    `DESCRIPTION:${escapeIcsText(details)}`,
    ...(eventLink ? [`URL:${eventLink}`] : []),
    `CATEGORIES:${escapeIcsText(item.category)}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

export function buildScheduleIcs(events = [], options = {}) {
  const siteUrl = String(options.siteUrl || DEFAULT_SITE_URL).replace(/\/$/, "");
  const calendarName = options.calendarName || DEFAULT_CALENDAR_NAME;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const stamp = formatUtc(generatedAt) || formatUtc(new Date());
  const sourceEvents = Array.isArray(events) ? events.filter((event) => event && !isRecurringSourceDuplicate(event)) : [];
  const body = sourceEvents.flatMap((event) => eventLines(event, { siteUrl, stamp }));
  for (const item of recurringDefinitions) body.push(...recurringLines(item, { siteUrl, stamp }));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RESCENE JAPAN FANBASE//Schedule//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    "X-PUBLISHED-TTL:PT1H",
    ...body,
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

async function runCli() {
  const inputPath = process.argv[2] || "data/schedule.json";
  const outputPath = process.argv[3] || "data/rescene-schedule.ics";
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const events = Array.isArray(payload) ? payload : payload.events;
  const content = buildScheduleIcs(events, { generatedAt: payload.generatedAt, siteUrl: process.env.SITE_BASE_URL || DEFAULT_SITE_URL });
  await writeFile(outputPath, content, "utf8");
  console.log(`${outputPath} を生成しました（元予定 ${Array.isArray(events) ? events.length : 0}件）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
