#!/usr/bin/env python3
"""Fetch, translate, cache, and parse the public RESCENE Plus Chat schedule.

Trial mode writes a preview and returns an error when no events are found.
Production mode refreshes the current/next month cache, preserves the last good
month when Plus Chat is temporarily unavailable, and never blocks the rest of
the site synchronization solely because Plus Chat failed.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

BASE_URL = "https://artist.mnetplus.world/main/stg/rescene-official/schedule/{year:04d}/{month:02d}"
TRANSLATIONS_PATH = Path(__file__).with_name("pluschat-schedule-translations.json")
JA_DATE_HEADER_RE = re.compile(r"^(\d{1,2})日[月火水木金土日]曜日$")
EN_DATE_HEADER_RE = re.compile(
    r"^(\d{1,2})\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$",
    re.IGNORECASE,
)
ISO_DATE_YMD_RE = re.compile(r"^(\d{4})/(\d{2})/(\d{2})$")
ISO_DATE_MDY_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
JA_TIME_RE = re.compile(r"^(午前|午後)(\d{1,2}):(\d{2})$")
EN_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", re.IGNORECASE)
HANGUL_RE = re.compile(r"[가-힣]")
ALL_DAY_WORDS = {"終日", "all day", "all-day", "all_day"}
IGNORE_EXACT = {
    "HOME", "RESCENE", "MEDIA", "FEED", "SHOP", "通知", "カレンダー",
    "URLをコピーしました。", "URLをコピーしました", "ログイン", "会員登録",
    "Time Event", "Time", "Event", "Today", "Previous Month", "Next Month",
    "All", "방송", "라디오", "행사", "팬사인회", "기념일", "공연", "공지",
    "Cookie settings", "Allow all cookies",
}


@dataclass(frozen=True)
class Event:
    id: str
    title: str
    originalTitle: str
    translationStatus: str
    date: str
    start: str
    end: str
    allDay: bool
    category: str
    type: str
    description: str
    link: str
    linkLabel: str
    image: str
    notionUrl: str
    source: str
    sourceMonth: str


def load_translations() -> dict:
    try:
        return json.loads(TRANSLATIONS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"警告: 翻訳辞書を読み込めませんでした: {exc}", file=sys.stderr)
        return {"exact": {}, "replacements": []}


TRANSLATIONS = load_translations()


def clean_lines(text: str) -> list[str]:
    lines = []
    for raw in text.replace("\u00a0", " ").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


def parse_day_header(label: str) -> int | None:
    for pattern in (JA_DATE_HEADER_RE, EN_DATE_HEADER_RE):
        match = pattern.match(label)
        if match:
            return int(match.group(1))
    return None


def parse_date_line(label: str, expected_year: int, expected_month: int) -> int | None:
    match = ISO_DATE_YMD_RE.match(label)
    if match:
        year, month, day = map(int, match.groups())
        return day if (year, month) == (expected_year, expected_month) else None
    match = ISO_DATE_MDY_RE.match(label)
    if match:
        month, day, year = map(int, match.groups())
        return day if (year, month) == (expected_year, expected_month) else None
    return None


def parse_time(label: str) -> tuple[int, int] | None:
    match = JA_TIME_RE.match(label)
    if match:
        period, hour_text, minute_text = match.groups()
        hour = int(hour_text)
        minute = int(minute_text)
        if period == "午前":
            hour = 0 if hour == 12 else hour
        else:
            hour = hour if hour == 12 else hour + 12
        return hour, minute

    match = EN_TIME_RE.match(label)
    if match:
        hour_text, minute_text, period = match.groups()
        hour = int(hour_text)
        minute = int(minute_text)
        if period.upper() == "AM":
            hour = 0 if hour == 12 else hour
        else:
            hour = hour if hour == 12 else hour + 12
        return hour, minute
    return None


def is_all_day(label: str) -> bool:
    return label.strip().casefold() in ALL_DAY_WORDS


def is_ignored_title_line(value: str, year: int, month: int) -> bool:
    if value in IGNORE_EXACT:
        return True
    if parse_day_header(value) is not None:
        return True
    if parse_date_line(value, year, month) is not None:
        return True
    if parse_time(value) is not None or is_all_day(value):
        return True
    if re.match(r"^\d{1,2}月,?\s*\d{4}$", value):
        return True
    if re.match(r"^[A-Za-z]{3,9},?\s*\d{4}$", value):
        return True
    if value.startswith("The RESCENE website requires the use of cookies"):
        return True
    return False


def title_from_block(block: list[str], year: int, month: int) -> str:
    for value in block:
        if not is_ignored_title_line(value, year, month):
            return value
    return ""


def infer_category(original: str, translated: str, override: str = "") -> str:
    if override:
        return override
    value = f"{original} {translated}".casefold()
    if any(term in value for term in (
        "인기가요", "m count", "뮤직뱅크", "music bank", "음악중심",
        "音楽中心", "더쇼", "더 쇼", "the show", "챔피언", "champion",
    )):
        return "音楽番組"
    if any(term in value for term in ("release", "single", "album", "発売", "リリース", "발매")):
        return "リリース"
    if any(term in value for term in ("vote", "投票", "투표")):
        return "投票"
    if any(term in value for term in ("誕生日", "생일", "birthday")):
        return "Birthday"
    if any(term in value for term in (
        "radio", "ラジオ", "방송", "出演", "festival", "フェスティバル",
        "super live", "ライブ", "퍼포먼스", "performance",
    )):
        return "出演"
    return "イベント"


def event_type(category: str) -> str:
    if category == "リリース":
        return "release"
    if category == "投票":
        return "vote"
    if category == "Birthday":
        return "birthday"
    return "event"


def translate_title(original: str) -> tuple[str, str, str]:
    exact = TRANSLATIONS.get("exact", {}).get(original)
    if isinstance(exact, dict) and exact.get("title"):
        return str(exact["title"]).strip(), str(exact.get("category", "")).strip(), "exact"
    if isinstance(exact, str) and exact.strip():
        return exact.strip(), "", "exact"

    translated = original
    for item in TRANSLATIONS.get("replacements", []):
        if isinstance(item, list) and len(item) == 2:
            translated = translated.replace(str(item[0]), str(item[1]))

    translated = re.sub(r"<\s*([^<>]+?)\s*>", r"「\1」", translated)
    translated = re.sub(r"\[\s*([^\[\]]+?)\s*\]", r"「\1」", translated)
    translated = translated.replace("(+", "＋").replace(")", "")
    translated = translated.replace("/", "／")
    translated = re.sub(r"\s+", " ", translated).strip()

    category = infer_category(original, translated)
    if category == "音楽番組" and not any(word in translated for word in ("事前収録", "収録", "出演", "放送")):
        translated = f"{translated} 出演"
    if "Special Single" in translated and "発売" not in translated:
        translated = translated.replace(" - Special Single", " スペシャルシングル発売")

    status = "partial" if HANGUL_RE.search(translated) else "rules"
    if translated == original:
        status = "original"
    return translated, "", status


def build_event(
    *,
    original_title: str,
    year: int,
    month: int,
    day: int,
    time_value: tuple[int, int] | None,
    all_day: bool,
    source_url: str,
) -> Event:
    translated_title, category_override, translation_status = translate_title(original_title)
    category = infer_category(original_title, translated_title, category_override)
    date_value = f"{year:04d}-{month:02d}-{day:02d}"
    if all_day:
        start = date_value
    else:
        assert time_value is not None
        hour, minute = time_value
        start = f"{date_value}T{hour:02d}:{minute:02d}:00+09:00"

    stable_time = "all-day" if all_day else start[11:16].replace(":", "")
    event_id = re.sub(
        r"[^a-z0-9]+",
        "-",
        f"pluschat-{date_value}-{stable_time}-{original_title}".lower(),
    ).strip("-")
    description_parts = ["Plus Chat公式スケジュールから自動取得"]
    if original_title != translated_title:
        description_parts.append(f"原文: {original_title}")
    if translation_status in {"partial", "original"}:
        description_parts.append("一部は公式の原文表記です。")

    return Event(
        id=event_id[:180],
        title=translated_title,
        originalTitle=original_title,
        translationStatus=translation_status,
        date=date_value,
        start=start,
        end="",
        allDay=all_day,
        category=category,
        type=event_type(category),
        description="\n".join(description_parts),
        link=source_url,
        linkLabel="Plus Chat公式スケジュールで確認",
        image="",
        notionUrl="",
        source="pluschat",
        sourceMonth=f"{year:04d}-{month:02d}",
    )


def parse_schedule_text(text: str, year: int, month: int, source_url: str) -> list[Event]:
    lines = clean_lines(text)
    events: list[Event] = []
    seen: set[tuple[str, str, str]] = set()

    section_starts: list[tuple[int, int]] = []
    for index, line in enumerate(lines):
        day = parse_day_header(line)
        if day is not None:
            section_starts.append((index, day))

    if not section_starts:
        for index, line in enumerate(lines):
            day = parse_date_line(line, year, month)
            if day is not None:
                section_starts.append((index, day))

    for section_number, (start_index, day) in enumerate(section_starts):
        end_index = section_starts[section_number + 1][0] if section_number + 1 < len(section_starts) else len(lines)
        section = lines[start_index + 1:end_index]
        block_start = 0

        for index, line in enumerate(section):
            all_day = is_all_day(line)
            time_value = parse_time(line)
            if not all_day and time_value is None:
                continue

            block = section[block_start:index]
            original_title = title_from_block(block, year, month)
            block_start = index + 1
            if not original_title:
                continue

            event = build_event(
                original_title=original_title,
                year=year,
                month=month,
                day=day,
                time_value=time_value,
                all_day=all_day,
                source_url=source_url,
            )
            key = (event.date, event.start, event.originalTitle)
            if key in seen:
                continue
            seen.add(key)
            events.append(event)

    return sorted(events, key=lambda event: (event.start, event.title))


def validate_events(events: Iterable[Event], year: int, month: int) -> list[str]:
    warnings: list[str] = []
    items = list(events)
    for event in items:
        if not event.date.startswith(f"{year:04d}-{month:02d}-"):
            warnings.append(f"対象月外: {event.title} / {event.date}")
        if len(event.title) < 2 or len(event.title) > 180:
            warnings.append(f"タイトル長を確認: {event.title!r}")
        if event.translationStatus in {"partial", "original"}:
            warnings.append(f"翻訳辞書への追加候補: {event.originalTitle} -> {event.title}")
    if len(items) > 120:
        warnings.append(f"件数が多すぎます: {len(items)}件")
    return warnings


def fetch_rendered_text(url: str, screenshot_path: Path, html_path: Path) -> str:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("playwright がありません。`python -m pip install playwright` を実行してください。") from exc

    with sync_playwright() as playwright:
        launch_errors = []
        browser = None
        if shutil.which("google-chrome") or shutil.which("google-chrome-stable"):
            try:
                browser = playwright.chromium.launch(channel="chrome", headless=True)
            except Exception as exc:
                launch_errors.append(f"Google Chrome: {exc}")
        if browser is None:
            try:
                browser = playwright.chromium.launch(headless=True)
            except Exception as exc:
                launch_errors.append(f"Playwright Chromium: {exc}")
                raise RuntimeError("ブラウザを起動できませんでした。 " + " / ".join(launch_errors)) from exc

        context = browser.new_context(
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            viewport={"width": 430, "height": 1800},
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 "
                "Mobile/15E148 Safari/604.1"
            ),
        )
        page = context.new_page()
        response = page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        if response and response.status >= 400:
            raise RuntimeError(f"Plus Chat HTTP {response.status}: {url}")
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except Exception:
            pass
        page.wait_for_timeout(8_000)
        try:
            cookie_button = page.get_by_text("Allow all cookies", exact=True)
            if cookie_button.count():
                cookie_button.first.click(timeout=3_000)
                page.wait_for_timeout(1_000)
        except Exception:
            pass

        previous_height = 0
        for _ in range(20):
            height = page.evaluate("document.documentElement.scrollHeight")
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(700)
            if height == previous_height:
                break
            previous_height = height

        text = page.locator("body").inner_text(timeout=30_000)
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(screenshot_path), full_page=True)
        browser.close()
        return text


def add_month(year: int, month: int, offset: int) -> tuple[int, int]:
    value = year * 12 + (month - 1) + offset
    return value // 12, value % 12 + 1


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def read_json(path: Path, fallback: dict) -> dict:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else fallback
    except Exception:
        return fallback


def write_trial(args: argparse.Namespace) -> int:
    year, month = args.year, args.month
    if year is None or month is None:
        now = datetime.now(ZoneInfo("Asia/Tokyo"))
        year, month = now.year, now.month
    url = BASE_URL.format(year=year, month=month)
    diagnostics = Path(args.diagnostics_dir or "data/pluschat-diagnostics")
    diagnostics.mkdir(parents=True, exist_ok=True)
    text_path = diagnostics / f"{year:04d}-{month:02d}-rendered.txt"
    html_path = diagnostics / f"{year:04d}-{month:02d}-page.html"
    screenshot_path = diagnostics / f"{year:04d}-{month:02d}-page.png"

    if args.input_text:
        rendered_text = Path(args.input_text).read_text(encoding="utf-8")
    else:
        rendered_text = fetch_rendered_text(url, screenshot_path, html_path)
        text_path.write_text(rendered_text, encoding="utf-8")

    events = parse_schedule_text(rendered_text, year, month, url)
    warnings = validate_events(events, year, month)
    payload = {
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "pluschat-trial",
        "sourceUrl": url,
        "year": year,
        "month": month,
        "eventCount": len(events),
        "warnings": warnings,
        "events": [asdict(event) for event in events],
    }
    output = Path(args.output or "data/pluschat-schedule-preview.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Plus Chatスケジュール試験取得: {len(events)}件 / {url}")
    for event in events:
        timing = "終日" if event.allDay else event.start[11:16]
        print(f"- {event.date} {timing} {event.title}")
    if warnings:
        print("警告:", file=sys.stderr)
        for warning in warnings:
            print(f"- {warning}", file=sys.stderr)
    if not events:
        print("予定を取得できませんでした。診断HTML・本文・スクリーンショットを確認してください。", file=sys.stderr)
        return 2
    return 0


def write_production(args: argparse.Namespace) -> int:
    output = Path(args.output or "data/pluschat-schedule.json")
    existing = read_json(output, {"events": [], "months": {}})
    existing_events = [item for item in existing.get("events", []) if isinstance(item, dict)]
    existing_by_month: dict[str, list[dict]] = {}
    for item in existing_events:
        key = str(item.get("sourceMonth") or str(item.get("date", ""))[:7])
        if re.match(r"^\d{4}-\d{2}$", key):
            existing_by_month.setdefault(key, []).append(item)

    now_tokyo = datetime.now(ZoneInfo("Asia/Tokyo"))
    start_year = args.year if args.year is not None else now_tokyo.year
    start_month = args.month if args.month is not None else now_tokyo.month
    target_months = [add_month(start_year, start_month, offset) for offset in range(args.months_ahead + 1)]
    diagnostics = Path(args.diagnostics_dir or "/tmp/rescene-pluschat-diagnostics")
    diagnostics.mkdir(parents=True, exist_ok=True)
    month_status = dict(existing.get("months", {})) if isinstance(existing.get("months"), dict) else {}
    failures: list[str] = []
    refreshed_count = 0

    for index, (year, month) in enumerate(target_months):
        key = month_key(year, month)
        url = BASE_URL.format(year=year, month=month)
        text_path = diagnostics / f"{key}-rendered.txt"
        html_path = diagnostics / f"{key}-page.html"
        screenshot_path = diagnostics / f"{key}-page.png"
        try:
            if args.input_text:
                if index > 0:
                    continue
                rendered_text = Path(args.input_text).read_text(encoding="utf-8")
            else:
                rendered_text = fetch_rendered_text(url, screenshot_path, html_path)
                text_path.write_text(rendered_text, encoding="utf-8")
            events = parse_schedule_text(rendered_text, year, month, url)
            warnings = validate_events(events, year, month)
            serialized_events = [asdict(event) for event in events]
            previous_events = existing_by_month.get(key, [])
            previous_status = month_status.get(key, {}) if isinstance(month_status.get(key), dict) else {}
            content_changed = previous_events != serialized_events
            existing_by_month[key] = serialized_events
            month_status[key] = {
                "sourceUrl": url,
                "fetchedAt": (
                    datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
                    if content_changed or previous_status.get("status") != "ok"
                    else previous_status.get("fetchedAt", "")
                ),
                "eventCount": len(events),
                "status": "ok",
                "warnings": warnings,
            }
            refreshed_count += len(events)
            print(f"Plus Chat {key}: {len(events)}件を取得・日本語化しました。")
            for warning in warnings:
                print(f"  警告: {warning}", file=sys.stderr)
        except Exception as exc:
            failures.append(f"{key}: {exc}")
            cached = existing_by_month.get(key, [])
            month_status[key] = {
                "sourceUrl": url,
                "fetchedAt": month_status.get(key, {}).get("fetchedAt", ""),
                "eventCount": len(cached),
                "status": "cached" if cached else "failed",
                "error": str(exc),
            }
            print(f"警告: Plus Chat {key} の取得に失敗しました。前回データ {len(cached)}件を維持します: {exc}", file=sys.stderr)

    lower_bound = add_month(now_tokyo.year, now_tokyo.month, -18)
    upper_bound = add_month(now_tokyo.year, now_tokyo.month, 24)
    min_key, max_key = month_key(*lower_bound), month_key(*upper_bound)
    kept_months = {key: value for key, value in existing_by_month.items() if min_key <= key <= max_key}
    kept_status = {key: value for key, value in month_status.items() if key in kept_months or key in {month_key(*item) for item in target_months}}
    events = [item for key in sorted(kept_months) for item in kept_months[key]]
    events.sort(key=lambda item: (str(item.get("start", "")), str(item.get("title", ""))))

    run_generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    payload = {
        "generatedAt": existing.get("generatedAt", run_generated_at),
        "source": "pluschat",
        "sourceBaseUrl": "https://artist.mnetplus.world/main/stg/rescene-official/schedule/",
        "translationDictionary": str(TRANSLATIONS_PATH.relative_to(Path.cwd())) if TRANSLATIONS_PATH.is_relative_to(Path.cwd()) else str(TRANSLATIONS_PATH),
        "targetMonths": [month_key(*item) for item in target_months],
        "eventCount": len(events),
        "refreshedEventCount": refreshed_count,
        "failures": failures,
        "months": kept_status,
        "events": events,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    desired = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    current = output.read_text(encoding="utf-8") if output.exists() else ""
    if current != desired:
        payload["generatedAt"] = run_generated_at
        desired = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        output.write_text(desired, encoding="utf-8")
        changed = "あり"
    else:
        changed = "なし"
    print(f"Plus Chat本番キャッシュ: 全{len(events)}件 / 今回取得{refreshed_count}件 / 変更{changed}")
    if failures:
        print("Plus Chatの取得失敗はサイト全体の同期を停止せず、前回成功データを使用します。", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    parser.add_argument("--months-ahead", type=int, default=1, help="開始月に加えて何か月先まで取得するか")
    parser.add_argument("--output")
    parser.add_argument("--diagnostics-dir")
    parser.add_argument("--input-text", help="既存の表示本文を使うオフライン解析テスト")
    parser.add_argument("--production", action="store_true", help="本番キャッシュを更新し、取得失敗時は前回成功データを維持する")
    args = parser.parse_args()

    if args.month is not None and not 1 <= args.month <= 12:
        parser.error("month must be 1..12")
    if args.months_ahead < 0 or args.months_ahead > 12:
        parser.error("months-ahead must be 0..12")
    if (args.year is None) != (args.month is None):
        parser.error("year and month must be supplied together")

    return write_production(args) if args.production else write_trial(args)


if __name__ == "__main__":
    raise SystemExit(main())
