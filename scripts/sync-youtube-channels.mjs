import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputPath = "data/youtube-channels.json";
const pythonCommand = process.env.PYTHON_COMMAND || "python";
const LIVE_METADATA_BATCH_SIZE = 40;
const LIVE_METADATA_CONCURRENCY = 3;

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

const terminalLiveStatuses = new Set(["was_live", "not_live"]);

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

function uniqueTypes(...groups) {
  return [...new Set(groups.flat().filter((type) => ["video", "short", "live"].includes(type)))];
}

function uniqueVideoIds(...groups) {
  return [...new Set(groups.flat().map((id) => String(id || "").trim()).filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)))];
}

function normalizeEntry(entry, videoType, previousVideo) {
  if (!entry || isUnavailable(entry)) return null;
  const videoId = videoIdFromEntry(entry);
  if (!videoId) return null;

  const extractedPublishedAt = timestampToIso(entry.timestamp)
    || timestampToIso(entry.release_timestamp)
    || uploadDateToIso(entry.upload_date)
    || null;
  const previousExactPublishedAt = previousVideo?.dateAccuracy === "exact" ? previousVideo.publishedAt : null;
  const publishedAt = previousExactPublishedAt
    || extractedPublishedAt
    || previousVideo?.publishedAt
    || null;

  return {
    videoId,
    title: String(entry.title || previousVideo?.title || "YouTube動画").trim(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: bestThumbnail(entry, videoId) || previousVideo?.thumbnail,
    publishedAt,
    updatedAt: publishedAt || previousVideo?.updatedAt || null,
    videoType,
    sourceTypes: uniqueTypes(previousVideo?.sourceTypes || [], videoType),
    sourceVideoIds: uniqueVideoIds(previousVideo?.sourceVideoIds || [], previousVideo?.videoId, videoId),
    dateAccuracy: previousExactPublishedAt ? "exact" : (extractedPublishedAt ? "approximate" : (previousVideo?.dateAccuracy || "unknown")),
    ...(previousVideo?.liveMetadataVerified ? {
      liveMetadataVerified: true,
      liveStatus: previousVideo.liveStatus,
    } : {}),
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
      if (!current) {
        map.set(video.videoId, {
          ...video,
          sourceTypes: uniqueTypes(video.sourceTypes || [], video.videoType),
          sourceVideoIds: uniqueVideoIds(video.sourceVideoIds || [], video.videoId),
        });
        continue;
      }

      const preferred = typePriority(video.videoType) >= typePriority(current.videoType) ? video : current;
      const secondary = preferred === video ? current : video;
      map.set(video.videoId, {
        ...secondary,
        ...preferred,
        sourceTypes: uniqueTypes(current.sourceTypes || [], current.videoType, video.sourceTypes || [], video.videoType),
        sourceVideoIds: uniqueVideoIds(current.sourceVideoIds || [], current.videoId, video.sourceVideoIds || [], video.videoId),
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.videoId.localeCompare(b.videoId);
  });
}

function preferredNonLiveType(sourceTypes = []) {
  if (sourceTypes.includes("short")) return "short";
  return "video";
}

function shouldRefreshLiveMetadata(previousVideo) {
  if (!previousVideo?.liveMetadataVerified) return true;
  return !terminalLiveStatuses.has(previousVideo.liveStatus);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function parseJsonLines(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function extractExactVideoMetadata(videos) {
  if (!videos.length) return new Map();

  const batches = chunk(videos, LIVE_METADATA_BATCH_SIZE);
  const batchResults = await mapWithConcurrency(batches, LIVE_METADATA_CONCURRENCY, async (batch, batchIndex) => {
    const outputTemplate = "%(.{id,title,webpage_url,original_url,thumbnail,timestamp,release_timestamp,upload_date,release_date,live_status,was_live,duration})j";
    const args = [
      "-m",
      "yt_dlp",
      "--ignore-config",
      "--skip-download",
      "--ignore-errors",
      "--ignore-no-formats-error",
      "--no-warnings",
      "--no-progress",
      "--socket-timeout",
      "30",
      "--retries",
      "3",
      "--extractor-retries",
      "3",
      "--print",
      outputTemplate,
      ...batch.map((video) => video.url),
    ];

    try {
      const result = await execFileAsync(pythonCommand, args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const parsed = parseJsonLines(result.stdout);
      console.log(`ライブ詳細日時の確認 ${batchIndex + 1}/${batches.length}: ${parsed.length}/${batch.length}件`);
      return parsed;
    } catch (error) {
      const parsed = parseJsonLines(error.stdout || "");
      const reason = String(error.stderr || error.message || "").trim().split("\n").filter(Boolean).at(-1);
      console.warn(`::warning::ライブ詳細日時の確認 ${batchIndex + 1}/${batches.length}で一部失敗しました（${parsed.length}/${batch.length}件${reason ? ` / ${reason}` : ""}）`);
      return parsed;
    }
  });

  const map = new Map();
  for (const metadata of batchResults.flat()) {
    const canonicalId = videoIdFromEntry(metadata);
    const requestedId = videoIdFromEntry({ url: metadata?.original_url });
    if (canonicalId) map.set(canonicalId, metadata);
    if (requestedId) map.set(requestedId, metadata);
  }
  return map;
}

function exactLiveDate(metadata) {
  return timestampToIso(metadata?.release_timestamp)
    || timestampToIso(metadata?.timestamp)
    || uploadDateToIso(metadata?.release_date)
    || uploadDateToIso(metadata?.upload_date)
    || null;
}

function isActualLive(metadata) {
  const liveStatus = String(metadata?.live_status || "").toLowerCase();
  if (["is_live", "is_upcoming", "post_live"].includes(liveStatus)) return true;
  if (liveStatus === "was_live") return metadata?.was_live !== false;
  return metadata?.was_live === true;
}

async function verifyLiveVideos(videos, previousVideoMap, channelLabel) {
  const liveCandidates = videos.filter((video) => video.sourceTypes?.includes("live") || video.videoType === "live");
  if (!liveCandidates.length) return videos;

  const needFetch = liveCandidates.filter((video) => shouldRefreshLiveMetadata(previousVideoMap.get(video.videoId)));
  const metadataMap = await extractExactVideoMetadata(needFetch);
  let correctedDates = 0;
  let correctedTypes = 0;
  let reused = 0;

  const verified = videos.map((video) => {
    if (!(video.sourceTypes?.includes("live") || video.videoType === "live")) return video;

    const previousVideo = previousVideoMap.get(video.videoId);
    const metadata = metadataMap.get(video.videoId);
    if (!metadata && previousVideo?.liveMetadataVerified) {
      reused += 1;
      return {
        ...video,
        videoId: previousVideo.videoId || video.videoId,
        title: previousVideo.title || video.title,
        url: previousVideo.url || video.url,
        thumbnail: previousVideo.thumbnail || video.thumbnail,
        publishedAt: previousVideo.publishedAt || video.publishedAt,
        updatedAt: previousVideo.updatedAt || video.updatedAt,
        videoType: previousVideo.videoType || video.videoType,
        sourceTypes: uniqueTypes(video.sourceTypes || [], previousVideo.sourceTypes || [], previousVideo.videoType),
        sourceVideoIds: uniqueVideoIds(video.sourceVideoIds || [], video.videoId, previousVideo.sourceVideoIds || [], previousVideo.videoId),
        dateAccuracy: previousVideo.dateAccuracy || video.dateAccuracy,
        liveMetadataVerified: true,
        liveStatus: previousVideo.liveStatus,
      };
    }
    if (!metadata) return video;

    const canonicalId = videoIdFromEntry(metadata) || video.videoId;
    const actualLive = isActualLive(metadata);
    const liveStatus = String(metadata.live_status || (metadata.was_live ? "was_live" : "not_live")).toLowerCase();
    const publishedAt = exactLiveDate(metadata) || video.publishedAt;
    const nextType = actualLive ? "live" : preferredNonLiveType(video.sourceTypes);

    if (publishedAt && publishedAt !== video.publishedAt) correctedDates += 1;
    if (nextType !== video.videoType) correctedTypes += 1;

    return {
      ...video,
      videoId: canonicalId,
      title: String(metadata.title || video.title).trim(),
      url: `https://www.youtube.com/watch?v=${canonicalId}`,
      thumbnail: metadata.thumbnail || video.thumbnail,
      publishedAt,
      updatedAt: publishedAt || video.updatedAt,
      videoType: nextType,
      dateAccuracy: publishedAt ? "exact" : video.dateAccuracy,
      liveMetadataVerified: true,
      liveStatus,
      sourceTypes: uniqueTypes(video.sourceTypes || [], nextType),
      sourceVideoIds: uniqueVideoIds(video.sourceVideoIds || [], video.videoId, canonicalId),
    };
  });

  const merged = mergeVideos([verified]);
  const removedDuplicates = verified.length - merged.length;
  console.log(`${channelLabel} / ライブ確認: 対象${liveCandidates.length}件、詳細取得${metadataMap.size}件、日時修正${correctedDates}件、分類修正${correctedTypes}件、再利用${reused}件、重複除去${removedDuplicates}件。`);
  return merged;
}

function enrichWithFeed(videos, feedVideos) {
  const feedMap = new Map(feedVideos.map((video) => [video.videoId, video]));
  return videos.map((video) => {
    const exact = feedMap.get(video.videoId);
    if (!exact) return video;

    if (video.videoType === "live" && video.liveMetadataVerified) {
      return {
        ...video,
        title: exact.title || video.title,
        thumbnail: exact.thumbnail || video.thumbnail,
        updatedAt: exact.updatedAt || video.updatedAt,
      };
    }

    return {
      ...video,
      ...exact,
      videoType: video.videoType,
      sourceTypes: video.sourceTypes,
      dateAccuracy: "exact",
      ...(video.liveMetadataVerified ? {
        liveMetadataVerified: true,
        liveStatus: video.liveStatus,
      } : {}),
    };
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
  const previousVideoMap = new Map();
  for (const video of previousVideos) {
    previousVideoMap.set(video.videoId, video);
    for (const sourceVideoId of video.sourceVideoIds || []) previousVideoMap.set(sourceVideoId, video);
  }
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
      const fallback = previousVideos.filter((video) => (video.sourceTypes || [video.videoType || "video"]).includes(tab.type));
      if (fallback.length) groups.push(fallback);
    }
  }

  let finalVideos = mergeVideos(groups);
  if (!finalVideos.length && previousVideos.length) finalVideos = mergeVideos([previousVideos]);
  finalVideos = await verifyLiveVideos(finalVideos, previousVideoMap, config.label);

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
  collectionMode: "all-public-videos-with-verified-live-metadata",
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
