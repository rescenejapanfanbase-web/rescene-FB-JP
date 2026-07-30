import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const records = JSON.parse(await readFile("data/records.json", "utf8"));
const manual = JSON.parse(await readFile("data/records-manual.json", "utf8"));

function merge(current = [], additions = [], { matchSong = false } = {}) {
  const result = current.map((item) => ({ ...item }));
  for (const item of additions) {
    const index = result.findIndex((candidate) =>
      String(candidate.title || "").trim().toLowerCase() === String(item.title || "").trim().toLowerCase()
      || (matchSong && candidate.song && item.song && String(candidate.song).trim().toLowerCase() === String(item.song).trim().toLowerCase()));
    if (index >= 0) result[index] = { ...item, ...result[index], translations: { ...(item.translations || {}), ...(result[index].translations || {}) } };
    else result.push(item);
  }
  return result;
}

records.musicShowWins = merge(records.musicShowWins || [], manual.musicShowWins || []);
records.melonRecords = merge(records.melonRecords || [], manual.melonRecords || [], { matchSong: true });
records.melonRecords.sort((a, b) => String(a.releaseDate || "9999-99-99").localeCompare(String(b.releaseDate || "9999-99-99")) || Number(a.order ?? 9999) - Number(b.order ?? 9999));
records.source = String(records.source || "notion").includes("manual") ? records.source : `${records.source || "notion"}+manual-fallback`;
records.generatedAt = new Date().toISOString();
await writeFile("data/records.json", `${JSON.stringify(records, null, 2)}\n`, "utf8");
await writeFile("data/records-data.js", `window.RESCENE_RECORDS = ${JSON.stringify(records, null, 2)};\n`, "utf8");
await execFileAsync(process.execPath, ["scripts/render-record-pages.mjs"]);
console.log(`手動フォールバックを反映しました（Melon ${records.melonRecords.length}件）。`);
