#!/usr/bin/env python3
"""Fetch and parse a public Plus Chat monthly schedule page.

Trial importer: writes a standalone JSON file and diagnostic files. It does not
modify the live Notion schedule or data/schedule.json.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

BASE_URL = "https://artist.mnetplus.world/main/stg/rescene-official/schedule/{year:04d}/{month:02d}"
JA_DATE_HEADER_RE = re.compile(r"^(\d{1,2})日[月火水木金土日]曜日$")
EN_DATE_HEADER_RE = re.compile(
    r"^(\d{1,2})\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$",
    re.IGNORECASE,
)
ISO_DATE_YMD_RE = re.compile(r"^(\d{4})/(\d{2})/(\d{2})$")
ISO_DATE_MDY_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
JA_TIME_RE = re.compile(r"^(午前|午後)(\d{1,2}):(\d{2})$")
EN_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", re.IGNORECASE)
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
    date: str
    start: str
    end: str
    allDay: bool
    category: str
    type: str
    description: str
    link: str
    linkLabel: str
    source: str


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
    """Use the first meaningful line in an event block as its title.

    Plus Chat sometimes inserts member names or notes between the event title and
    the time. Choosing the first line preserves the actual event title instead of
    accidentally selecting the final member-name line.
    """
    for value in block:
        if not is_ignored_title_line(value, year, month):
            return value
    return ""


def event_type(title: str) -> tuple[str, str]:
    lowered = title.lower()
    if any(word in lowered for word in ("release", "single", "album", "ep", "発売", "リリース")):
        return "リリース", "release"
    if any(word in lowered for word in ("vote", "投票")):
        return "投票", "vote"
    return "Plus Chat", "event"


def build_event(
    *,
    title: str,
    year: int,
    month: int,
    day: int,
    time_value: tuple[int, int] | None,
    all_day: bool,
    source_url: str,
) -> Event:
    date_value = f"{year:04d}-{month:02d}-{day:02d}"
    if all_day:
        start = date_value
    else:
        assert time_value is not None
        hour, minute = time_value
        start = f"{date_value}T{hour:02d}:{minute:02d}:00+09:00"

    category, kind = event_type(title)
    stable_time = "all-day" if all_day else start[11:16].replace(":", "")
    event_id = re.sub(
        r"[^a-z0-9]+",
        "-",
        f"pluschat-{date_value}-{stable_time}-{title}".lower(),
    ).strip("-")
    return Event(
        id=event_id[:180],
        title=title,
        date=date_value,
        start=start,
        end="",
        allDay=all_day,
        category=category,
        type=kind,
        description="Plus Chat公式スケジュールから取得",
        link=source_url,
        linkLabel="Plus Chatで確認",
        source="pluschat",
    )


def parse_schedule_text(text: str, year: int, month: int, source_url: str) -> list[Event]:
    lines = clean_lines(text)
    events: list[Event] = []
    seen: set[tuple[str, str, str]] = set()

    # Find every day section. English is currently returned by GitHub Actions
    # even when Playwright requests ja-JP, so both locales are supported.
    section_starts: list[tuple[int, int]] = []
    for index, line in enumerate(lines):
        day = parse_day_header(line)
        if day is not None:
            section_starts.append((index, day))

    # Fallback for a future layout that omits weekday headings but keeps dates.
    if not section_starts:
        for index, line in enumerate(lines):
            day = parse_date_line(line, year, month)
            if day is not None:
                section_starts.append((index, day))

    for section_number, (start_index, day) in enumerate(section_starts):
        end_index = (
            section_starts[section_number + 1][0]
            if section_number + 1 < len(section_starts)
            else len(lines)
        )
        section = lines[start_index + 1:end_index]
        block_start = 0

        for index, line in enumerate(section):
            all_day = is_all_day(line)
            time_value = parse_time(line)
            if not all_day and time_value is None:
                continue

            block = section[block_start:index]
            title = title_from_block(block, year, month)
            block_start = index + 1
            if not title:
                continue

            event = build_event(
                title=title,
                year=year,
                month=month,
                day=day,
                time_value=time_value,
                all_day=all_day,
                source_url=source_url,
            )
            key = (event.date, event.start, event.title)
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
    if len(items) > 100:
        warnings.append(f"件数が多すぎます: {len(items)}件")
    return warnings


def fetch_rendered_text(url: str, screenshot_path: Path, html_path: Path) -> str:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("playwright がありません。`python -m pip install playwright` を実行してください。") from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
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

        previous_height = 0
        for _ in range(20):
            height = page.evaluate("document.documentElement.scrollHeight")
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(700)
            if height == previous_height:
                break
            previous_height = height

        text = page.locator("body").inner_text(timeout=30_000)
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(screenshot_path), full_page=True)
        browser.close()
        return text


def main() -> int:
    parser = argparse.ArgumentParser()
    now = datetime.now()
    parser.add_argument("--year", type=int, default=now.year)
    parser.add_argument("--month", type=int, default=now.month)
    parser.add_argument("--output", default="data/pluschat-schedule-preview.json")
    parser.add_argument("--diagnostics-dir", default="data/pluschat-diagnostics")
    parser.add_argument("--input-text", help="Offline parser test using an existing text file")
    args = parser.parse_args()

    if not 1 <= args.month <= 12:
        parser.error("month must be 1..12")

    url = BASE_URL.format(year=args.year, month=args.month)
    diagnostics = Path(args.diagnostics_dir)
    diagnostics.mkdir(parents=True, exist_ok=True)
    text_path = diagnostics / f"{args.year:04d}-{args.month:02d}-rendered.txt"
    html_path = diagnostics / f"{args.year:04d}-{args.month:02d}-page.html"
    screenshot_path = diagnostics / f"{args.year:04d}-{args.month:02d}-page.png"

    if args.input_text:
        rendered_text = Path(args.input_text).read_text(encoding="utf-8")
    else:
        rendered_text = fetch_rendered_text(url, screenshot_path, html_path)
        text_path.write_text(rendered_text, encoding="utf-8")

    events = parse_schedule_text(rendered_text, args.year, args.month, url)
    warnings = validate_events(events, args.year, args.month)
    payload = {
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": "pluschat-trial",
        "sourceUrl": url,
        "year": args.year,
        "month": args.month,
        "eventCount": len(events),
        "warnings": warnings,
        "events": [asdict(event) for event in events],
    }
    output = Path(args.output)
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


if __name__ == "__main__":
    raise SystemExit(main())
