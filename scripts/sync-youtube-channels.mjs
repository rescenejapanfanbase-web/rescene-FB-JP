import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = "data/youtube-channels.json";
const maxVideos = Math.max(1, Math.min(15, Number(process.env.YOUTUBE_MAX_VIDEOS || 12)));

const channelConfigs = [
  {
    key: "rescene",
    label: "RESCENE Official",
    handle: "@RESCENE_official",
    url: "https://www.youtube.com/@RESCENE_official",
    description: "ミュージックビデオ、Re:log、ビハインドなどRESCENEの公式コンテンツ。",
  },
  {
    key: "woni",
    label: "WONI Channel",
    handle: "@helloiamwoninicetomeetyou",
    url: "https://www.youtube.com/@helloiamwoninicetomeetyou",
    description: "ウォニの日常やメンバーとの楽しいコンテンツを届ける個人YouTubeチャンネル。",
  },
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

  if (!response.ok) {
    throw new Error(`${url} の取得に失敗しました（HTTP ${response.status}）`);
  }

  return response.text();
}

function findChannelId(html) {
  const patterns = [
    /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
    /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
    /itemprop="channelId"\s+content="(UC[A-Za-z0-9_-]{22})"/,
    /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  throw new Error("YouTubeチャンネルIDを取得できませんでした。");
}

const tagValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] ?? "");
};

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .slice(0, maxVideos)
    .map(([, entry]) => {
      const videoId = tagValue(entry, "yt:videoId");
      const title = tagValue(entry, "title");
      const publishedAt = tagValue(entry, "published");
      const updatedAt = tagValue(entry, "updated");
      const thumbnail = decodeXml(
        entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)?.[1] ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      );

      return {
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail,
        publishedAt,
        updatedAt,
      };
    })
    .filter((video) => video.videoId && video.title);
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return { generatedAt: null, channels: [] };
  }
}

function comparable(payload) {
  return JSON.stringify({
    channels: (payload.channels || []).map(({ syncError, ...channel }) => channel),
  });
}

const previous = await readPrevious();
const previousMap = new Map((previous.channels || []).map((channel) => [channel.key, channel]));
const channels = [];
let successCount = 0;

for (const config of channelConfigs) {
  try {
    const channelHtml = await fetchText(config.url);
    const channelId = findChannelId(channelHtml);
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const feedXml = await fetchText(feedUrl);
    const videos = parseFeed(feedXml);

    if (!videos.length) throw new Error("YouTube RSSから動画を取得できませんでした。");

    channels.push({
      ...config,
      channelId,
      feedUrl,
      videos,
    });
    successCount += 1;
    console.log(`${config.label}: 最新${videos.length}件を取得しました。`);
  } catch (error) {
    const previousChannel = previousMap.get(config.key);
    console.warn(`::warning::${config.label} の取得に失敗しました: ${error.message}`);
    channels.push({
      ...(previousChannel || config),
      ...config,
      videos: previousChannel?.videos || [],
      syncError: error.message,
    });
  }
}

if (successCount === 0 && !channels.some((channel) => channel.videos?.length)) {
  throw new Error("両方のYouTubeチャンネルから動画を取得できませんでした。");
}

const candidate = {
  generatedAt: new Date().toISOString(),
  source: "YouTube RSS",
  channels,
};

const previousComparable = comparable(previous);
const candidateComparable = comparable(candidate);

if (previousComparable === candidateComparable) {
  console.log("動画一覧に変更はありません。");
  process.exit(0);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
console.log(`YouTubeページ用データを更新しました（${successCount}/${channelConfigs.length}チャンネル取得成功）。`);
