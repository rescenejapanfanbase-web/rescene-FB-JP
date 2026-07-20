import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(root, 'data/home-guides.json');
const definitions = [
  { key: 'voting', title: '投票ガイド', summary: '音楽番組の投票方法、アプリ、スコア配分を確認できます。', url: 'voting.html', category: 'VOTING', path: 'voting.html' },
  { key: 'chants', title: '掛け声ガイド', summary: '楽曲ごとの掛け声をサムネイルからすぐに開けます。', url: 'chants.html', category: 'FANCHANT', path: 'chants.html' },
  { key: 'streaming', title: 'ストリーミングガイド', summary: 'YouTube、Spotify、Apple Musicなどの応援方法をまとめています。', url: 'streaming.html', category: 'STREAMING', path: 'streaming.html' },
  { key: 'youtube', title: 'YouTube一覧', summary: '公式・ウォニチャンネルの動画、ショート、ライブを横断して確認できます。', url: 'youtube.html', category: 'YOUTUBE', path: 'youtube.html' },
  { key: 'mv', title: 'MV一覧', summary: 'RESCENEのミュージックビデオを作品別に確認できます。', url: 'mv.html', category: 'MUSIC VIDEO', path: 'mv.html' },
  { key: 'discography', title: 'ディスコグラフィ', summary: 'アルバム、シングル、OST、収録曲と配信リンクを掲載しています。', url: 'discography.html', category: 'DISCOGRAPHY', path: 'data/discography.json' },
];

let previousPayload = {};
let previous = {};
try {
  previousPayload = JSON.parse(readFileSync(outputPath, 'utf8'));
  previous = Object.fromEntries((previousPayload.guides || []).map((guide) => [guide.key, guide]));
} catch {}

function gitValue(format, file) {
  try {
    return execFileSync('git', ['log', '-1', `--format=${format}`, '--', file], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const now = new Date().toISOString();
const guides = definitions.map((definition) => {
  const updatedAt = gitValue('%cI', definition.path) || previous[definition.key]?.updatedAt || now;
  const commit = gitValue('%h', definition.path) || previous[definition.key]?.commit || '';
  return { ...definition, updatedAt, commit };
}).map(({ path, ...guide }) => guide).sort((a, b) => {
  const byDate = new Date(b.updatedAt) - new Date(a.updatedAt);
  return byDate || definitions.findIndex((item) => item.key === a.key) - definitions.findIndex((item) => item.key === b.key);
});

const guidesUnchanged = JSON.stringify(previousPayload.guides || []) === JSON.stringify(guides);
const payload = {
  generatedAt: guidesUnchanged && previousPayload.generatedAt ? previousPayload.generatedAt : now,
  source: 'git-history',
  guides,
};
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`ホーム用ガイド更新情報を${guides.length}件生成しました。`);
