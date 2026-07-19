import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = "data/youtube-channels.json";
const pythonCommand = process.env.PYTHON_COMMAND || "python";

const channelConfigs = [
  {
    key: "rescene",
    label: "RESCENE Official",
    handle: "@RESCENE_official",
    channelId: "UCtKtCiaWRz-d3EZn2xd1mdA",
    url: "https://www.youtube.com/@RESCENE_official",
    description: "ミュージックビデオ、Re:log、ビハインドなどRESCENEの公式コンテンツ。",
  },
  {
    key: "woni",
    label: "안녕하세요원이입니다잘부탁드립니다",
    handle: "@helloiamwoninicetomeetyou",
    channelId: "UCWpY0eSJtyO-qNAPbKFRSSg",
    url: "https://www.youtube.com/@helloiamwoninicetomeetyou",
    description: "ウォニの日常やメンバーとの楽しいコンテンツを届ける個人YouTubeチャンネル。",
  },
];

const tabConfigs = [
  { path: "videos", type: "video", label: "通常動画" },
  { path: "shorts", type: "short", label: "ショート" },
  { path: "streams", type: "live", label: "ライブ" },
];

const decodeXml = (value = "") =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RESCENE-JAPAN-FANBASE/1.0)",
      "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const tagValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] ?? "");
};

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .map(([, entry]) => {
      const videoId = tagValue(entry, "yt:videoId");
      const publishedAt = tagValue(entry, "published");
      return {
        videoId,
        title: tagValue(entry, "title"),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: decodeXml(
          entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1]
            || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        ),
        publishedAt,
        updatedAt: tagValue(entry, "updated") || publishedAt,
      };
    })
    .filter((video) => video.videoId && video.title);
}

function timestampToIso(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uploadDateToIso(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function videoIdFromEntry(entry) {
  const direct = String(entry?.id || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;

  const candidates = [entry?.url, entry?.webpage_url, entry?.original_url];
  for (const candidate of candidates) {
    const text = String(candidate || "");
    const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|live\/))([A-Za-z0-9_-]{11})/i);
    if (match) return match[1];
  }
  return "";
}

function bestThumbnail(entry, videoId) {
  if (entry?.thumbnail) return entry.thumbnail;
  const thumbnails = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
  const candidates = thumbnails
    .filter((item) => item?.url && !/storyboard|sb\d|_live_storyboard/i.test(item.url))
    .sort((a, b) => ((Number(a.width) || 0) * (Number(a.height) || 0)) - ((Number(b.width) || 0) * (Number(b.height) || 0)));
  return candidates.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function isUnavailable(entry) {
  const title = String(entry?.title || "").trim();
  const availability = String(entry?.availability || "").toLowerCase();
  return !title || /^\[(?:private|deleted) video\]$/i.test(title) || ["private", "premium_only", "subscriber_only", "needs_auth"].includes(availability);
}

function normalizeEntry(entry, videoType, previousVideo) {
  if (!entry || isUnavailable(entry)) return null;
  const videoId = videoIdFromEntry(entry);
  if (!videoId) return null;

  const publishedAt = previousVideo?.publishedAt
    || timestampToIso(entry.timestamp)
    || timestampToIso(entry.release_timestamp)
    || uploadDateToIso(entry.upload_date)
    || null;

  return {
    videoId,
    title: String(entry.title || previousVideo?.title || "YouTube動画").trim(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: bestThumbnail(entry, videoId) || previousVideo?.thumbnail,
    publishedAt,
    updatedAt: publishedAt || previousVideo?.updatedAt || null,
    videoType,
  };
}

async function extractTab(channel, tab, previousMap) {
  const tabUrl = `${channel.url}/${tab.path}`;
  const args = [
    "-m",
    "yt_dlp",
    "--ignore-config",
    "--flat-playlist",
    "--dump-single-json",
    "--skip-download",
    "--ignore-errors",
    "--no-warnings",
    "--no-progress",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--extractor-retries",
    "3",
    "--extractor-args",
    "youtubetab:approximate_date",
    tabUrl,
  ];

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(pythonCommand, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = error.stdout || "";
    stderr = error.stderr || error.message || "";
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    const reason = String(stderr).trim().split("\n").filter(Boolean).at(-1) || "yt-dlpの出力を解析できませんでした。";
    throw new Error(`${tab.label}タブの取得に失敗しました：${reason}`);
  }

  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const videos = entries
    .map((entry) => {
      const videoId = videoIdFromEntry(entry);
      return normalizeEntry(entry, tab.type, previousMap.get(videoId));
    })
    .filter(Boolean);

  console.log(`${channel.label} / ${tab.label}: ${videos.length}件を取得しました。`);
  return videos;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return { generatedAt: null, channels: [] };
  }
}

function typePriority(type) {
  return { video: 1, short: 2, live: 3 }[type] || 0;
}

function mergeVideos(videoGroups) {
  const map = new Map();
  for (const videos of videoGroups) {
    for (const video of videos) {
      const current = map.get(video.videoId);
      if (!current || typePriority(video.videoType) >= typePriority(current.videoType)) {
        map.set(video.videoId, { ...current, ...video });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.videoId.localeCompare(b.videoId);
  });
}

function enrichWithFeed(videos, feedVideos) {
  const feedMap = new Map(feedVideos.map((video) => [video.videoId, video]));
  return videos.map((video) => {
    const exact = feedMap.get(video.videoId);
    return exact ? { ...video, ...exact, videoType: video.videoType } : video;
  }).sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.videoId.localeCompare(b.videoId);
  });
}

async function fetchFeedVideos(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const xml = await fetchText(feedUrl);
  return { feedUrl, videos: parseFeed(xml) };
}

function countTypes(videos) {
  return videos.reduce((counts, video) => {
    const type = video.videoType || "video";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, { video: 0, short: 0, live: 0 });
}

function comparable(payload) {
  return JSON.stringify({
    source: payload.source,
    channels: (payload.channels || []).map((channel) => ({
      key: channel.key,
      label: channel.label,
      handle: channel.handle,
      channelId: channel.channelId,
      url: channel.url,
      description: channel.description,
      feedUrl: channel.feedUrl,
      totalVideos: channel.totalVideos,
      typeCounts: channel.typeCounts,
      syncError: channel.syncError || null,
      videos: channel.videos,
    })),
  });
}

const previous = await readPrevious();
const previousMap = new Map((previous.channels || []).map((channel) => [channel.key, channel]));
const channels = [];
let successfulTabs = 0;
let failedTabs = 0;

for (const config of channelConfigs) {
  const previousChannel = previousMap.get(config.key);
  const previousVideos = Array.isArray(previousChannel?.videos) ? previousChannel.videos : [];
  const previousVideoMap = new Map(previousVideos.map((video) => [video.videoId, video]));
  const groups = [];
  const errors = [];

  for (const tab of tabConfigs) {
    try {
      groups.push(await extractTab(config, tab, previousVideoMap));
      successfulTabs += 1;
    } catch (error) {
      failedTabs += 1;
      errors.push(error.message);
      console.warn(`::warning::${config.label}: ${error.message}`);
      const fallback = previousVideos.filter((video) => (video.videoType || "video") === tab.type);
      if (fallback.length) groups.push(fallback);
    }
  }

  const videos = mergeVideos(groups);
  if (!videos.length && previousVideos.length) groups.push(previousVideos);
  let finalVideos = videos.length ? videos : mergeVideos(groups);
  let feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.channelId}`;
  try {
    const feed = await fetchFeedVideos(config.channelId);
    feedUrl = feed.feedUrl;
    finalVideos = enrichWithFeed(finalVideos, feed.videos);
    console.log(`${config.label} / RSS日時補完: ${feed.videos.length}件を確認しました。`);
  } catch (error) {
    console.warn(`::warning::${config.label}: RSSによる最新日時の補完に失敗しました（${error.message}）`);
  }

  channels.push({
    ...config,
    feedUrl,
    totalVideos: finalVideos.length,
    typeCounts: countTypes(finalVideos),
    videos: finalVideos,
    ...(errors.length ? { syncError: errors.join(" / ") } : {}),
  });
}

if (!channels.some((channel) => channel.videos.length)) {
  throw new Error("YouTubeチャンネルから公開動画を取得できませんでした。");
}

const candidate = {
  generatedAt: new Date().toISOString(),
  source: "YouTube channel tabs via yt-dlp",
  collectionMode: "all-public-videos",
  channels,
};

if (comparable(previous) === comparable(candidate)) {
  console.log("YouTube動画一覧に変更はありません。");
  process.exit(0);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
const totalVideos = channels.reduce((sum, channel) => sum + channel.videos.length, 0);
console.log(`YouTubeページ用データを更新しました（全${totalVideos}件 / 成功タブ ${successfulTabs} / 失敗タブ ${failedTabs}）。`);
