import { access, readFile, writeFile } from 'node:fs/promises';

const FALLBACK = 'news/fanbase-site.jpg';
const DATA_FILES = ['data/news-manual.json', 'data/news.json'];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:https?:)?\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  return raw.replace(/^\/+/, '');
}

async function resolveImage(value) {
  const normalized = normalizePath(value);
  if (!normalized) return '';
  if (/^(?:https?:)?\/\//i.test(normalized) || /^data:/i.test(normalized)) return normalized;
  return (await exists(normalized)) ? normalized : '';
}

async function sanitize(items, source) {
  let changed = false;
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const original = String(item?.image || '').trim();
    const resolved = await resolveImage(original);
    const image = resolved || FALLBACK;
    if (image !== original) {
      changed = true;
      console.warn(`画像参照を補正: ${source} / ${item?.title || item?.slug || '無題'} / ${original || '(空欄)'} -> ${image}`);
    }
    result.push({ ...item, image });
  }
  return { result, changed };
}

for (const file of DATA_FILES) {
  let payload;
  try { payload = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }

  if (Array.isArray(payload)) {
    const { result, changed } = await sanitize(payload, file);
    if (changed) await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } else if (Array.isArray(payload?.news)) {
    const { result, changed } = await sanitize(payload.news, file);
    if (changed) {
      payload.news = result;
      await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }
  }
}

try {
  const payload = JSON.parse(await readFile('data/news.json', 'utf8'));
  const news = Array.isArray(payload?.news) ? payload.news : [];
  await writeFile('data/news-data.js', `window.RESCENE_NEWS = ${JSON.stringify(news, null, 2)};\n`, 'utf8');
} catch {}

console.log('ニュース画像参照の検証・補正が完了しました。');
