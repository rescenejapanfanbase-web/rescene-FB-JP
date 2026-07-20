#!/usr/bin/env python3
"""Check user-facing external links and write a machine-readable report.

The checker intentionally distinguishes definite failures from services that
block automated requests. HTTP 404/410 and unavailable YouTube videos are
reported as broken. Rate limits, bot blocks, and temporary server errors are
reported as warnings to avoid false positives.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import html
import html.parser
import json
import re
import socket
import ssl
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = ROOT / "data" / "external-link-report.json"
DEFAULT_ISSUE = ROOT / ".external-link-issue.md"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
    "RESCENE-Link-Checker/1.0"
)
TIMEOUT_SECONDS = 8
MAX_BODY_BYTES = 220_000
SSL_CONTEXT = ssl.create_default_context()
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
BOT_BLOCK_STATUS = {401, 403, 405, 406, 418, 429}
BROKEN_STATUS = {404, 410, 451}
TRACKING_QUERY_KEYS = {
    "si", "s", "feature", "ref", "ref_src", "igsh", "igshid", "fbclid", "gclid",
}
SKIP_HOSTS = {
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "i.ytimg.com",
    "i1.ytimg.com",
    "i2.ytimg.com",
    "i3.ytimg.com",
    "i4.ytimg.com",
    "app.notion.com",
    "api.notion.com",
    "api.github.com",
    "rescene-fb.jp",
    "www.rescene-fb.jp",
}
JSON_LINK_FIELDS = {
    "sourceLink",
    "link",
    "url",
    "appStore",
    "googlePlay",
}
JSON_SKIP_FIELDS = {
    "notionUrl",
    "feedUrl",
    "thumbnail",
    "image",
    "source",
}


@dataclasses.dataclass
class SourceRef:
    file: str
    line: int | None = None
    label: str = ""


@dataclasses.dataclass
class LinkTarget:
    url: str
    normalized_url: str
    sources: list[SourceRef]


class AnchorParser(html.parser.HTMLParser):
    def __init__(self, path: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.current: dict[str, Any] | None = None
        self.links: list[tuple[str, int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = next((value for name, value in attrs if name.lower() == "href" and value), None)
        if not href or not href.startswith(("http://", "https://")):
            return
        line, _ = self.getpos()
        self.current = {"href": html.unescape(href.strip()), "line": line, "text": []}

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self.current is None:
            return
        label = re.sub(r"\s+", " ", " ".join(self.current["text"])).strip()
        self.links.append((self.current["href"], self.current["line"], label[:120]))
        self.current = None


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def strip_tracking(url: str) -> str:
    parsed = urlsplit(html.unescape(url.strip()))
    query = parse_qs(parsed.query, keep_blank_values=True)
    filtered: list[tuple[str, str]] = []
    for key, values in query.items():
        if key.lower().startswith("utm_") or key.lower() in TRACKING_QUERY_KEYS:
            continue
        for value in values:
            filtered.append((key, value))
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, urlencode(filtered, doseq=True), ""))


def youtube_video_id(url: str) -> str | None:
    parsed = urlsplit(url)
    host = parsed.netloc.lower().split(":", 1)[0]
    path_parts = [part for part in parsed.path.split("/") if part]
    if host in {"youtu.be", "www.youtu.be"} and path_parts:
        return path_parts[0]
    if host.endswith("youtube.com"):
        if parsed.path == "/watch":
            values = parse_qs(parsed.query).get("v")
            return values[0] if values else None
        if path_parts and path_parts[0] in {"shorts", "live", "embed"} and len(path_parts) > 1:
            return path_parts[1]
    return None


def normalize_url(url: str) -> str:
    cleaned = strip_tracking(url)
    video_id = youtube_video_id(cleaned)
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    parsed = urlsplit(cleaned)
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, ""))


def service_for(url: str) -> tuple[str, str]:
    host = urlsplit(url).netloc.lower()
    if "youtube.com" in host or host.endswith("youtu.be"):
        return "youtube", "YouTube"
    if "spotify.com" in host:
        return "spotify", "Spotify"
    if "music.apple.com" in host:
        return "apple-music", "Apple Music"
    if "apps.apple.com" in host:
        return "app-store", "App Store"
    if "play.google.com" in host:
        return "google-play", "Google Play"
    if host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}:
        return "x", "X"
    if "instagram.com" in host:
        return "instagram", "Instagram"
    if "tiktok.com" in host:
        return "tiktok", "TikTok"
    if "facebook.com" in host:
        return "facebook", "Facebook"
    if "weibo.com" in host:
        return "weibo", "Weibo"
    if "naver.com" in host:
        return "naver", "NAVER"
    if "mnetplus.world" in host:
        return "mnetplus", "Mnet Plus"
    if "github.com" in host:
        return "github", "GitHub"
    return "other", host or "その他"


def add_source(targets: dict[str, LinkTarget], url: str, source: SourceRef) -> None:
    parsed = urlsplit(html.unescape(url))
    host = parsed.netloc.lower()
    if parsed.scheme not in {"http", "https"} or not host or host in SKIP_HOSTS:
        return
    if "${" in url or "{{" in url:
        return
    normalized = normalize_url(url)
    target = targets.get(normalized)
    if target is None:
        targets[normalized] = LinkTarget(url=html.unescape(url), normalized_url=normalized, sources=[source])
        return
    if not any(existing.file == source.file and existing.line == source.line for existing in target.sources):
        target.sources.append(source)


def collect_html_links(targets: dict[str, LinkTarget]) -> None:
    for path in sorted(ROOT.rglob("*.html")):
        if ".git" in path.parts or "node_modules" in path.parts:
            continue
        parser = AnchorParser(path)
        try:
            parser.feed(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            continue
        relative = path.relative_to(ROOT).as_posix()
        for url, line, label in parser.links:
            add_source(targets, url, SourceRef(relative, line, label))


def collect_json_links(targets: dict[str, LinkTarget]) -> None:
    files = [
        ROOT / "data" / "news.json",
        ROOT / "data" / "news-manual.json",
        ROOT / "data" / "schedule.json",
        ROOT / "data" / "voting-guide.json",
        ROOT / "data" / "streaming-guide.json",
        ROOT / "data" / "official-links.json",
    ]

    def walk(value: Any, path: Path, parent: dict[str, Any] | None = None, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                walk(child_value, path, value, child_key)
            return
        if isinstance(value, list):
            for child in value:
                walk(child, path, parent, key)
            return
        if not isinstance(value, str) or not value.startswith(("http://", "https://")):
            return
        if key in JSON_SKIP_FIELDS or key not in JSON_LINK_FIELDS:
            return
        label = ""
        if parent:
            label = str(parent.get("title") or parent.get("label") or parent.get("linkLabel") or "")[:120]
        text = path.read_text(encoding="utf-8", errors="replace")
        offset = text.find(value)
        line = text.count("\n", 0, offset) + 1 if offset >= 0 else None
        add_source(targets, value, SourceRef(path.relative_to(ROOT).as_posix(), line, label))

    for path in files:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        walk(data, path)

    # The YouTube page is synchronized from the channels themselves. Checking
    # every automatically collected video would make the daily link check grow
    # without limit, so only the two channel destinations are checked here.
    youtube_path = ROOT / "data" / "youtube-channels.json"
    if youtube_path.exists():
        try:
            youtube_data = json.loads(youtube_path.read_text(encoding="utf-8"))
            for channel in youtube_data.get("channels", []):
                url = channel.get("url")
                if isinstance(url, str):
                    add_source(
                        targets,
                        url,
                        SourceRef(
                            youtube_path.relative_to(ROOT).as_posix(),
                            None,
                            str(channel.get("label") or "YouTube channel")[:120],
                        ),
                    )
        except (json.JSONDecodeError, OSError, AttributeError):
            pass


def request_url(url: str, *, timeout: int = TIMEOUT_SECONDS) -> tuple[int | None, str, bytes, str | None]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
            "Cache-Control": "no-cache",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
            status = int(getattr(response, "status", 200))
            body = response.read(MAX_BODY_BYTES)
            return status, response.geturl(), body, None
    except HTTPError as error:
        try:
            body = error.read(MAX_BODY_BYTES)
        except Exception:
            body = b""
        return int(error.code), error.geturl() or url, body, None
    except (URLError, TimeoutError, socket.timeout, ssl.SSLError, ConnectionError) as error:
        reason = getattr(error, "reason", error)
        return None, url, b"", str(reason)


def http_result(status: int | None, final_url: str, body: bytes, error: str | None, *, restricted_service: bool = False) -> tuple[str, str]:
    if error:
        return "warning", f"一時的な通信エラー: {error}"
    if status is None:
        return "warning", "HTTP状態を取得できませんでした。"
    if 200 <= status < 400:
        return "ok", f"HTTP {status}"
    if status in BROKEN_STATUS:
        return "broken", f"HTTP {status}（参照先が見つかりません）"
    if status in BOT_BLOCK_STATUS or restricted_service:
        return "warning", f"HTTP {status}（自動確認が制限されています）"
    if status >= 500:
        return "warning", f"HTTP {status}（外部サービスの一時的なエラー）"
    return "warning", f"HTTP {status}（手動確認が必要です）"


def check_youtube(target: LinkTarget) -> dict[str, Any]:
    video_id = youtube_video_id(target.normalized_url)
    if not video_id:
        status, final_url, body, error = request_url(target.normalized_url)
        state, message = http_result(status, final_url, body, error, restricted_service=False)
        return result_dict(target, state, status, message, final_url, "youtube-page")

    canonical = f"https://www.youtube.com/watch?v={video_id}"
    oembed = f"https://www.youtube.com/oembed?{urlencode({'url': canonical, 'format': 'json'})}"
    status, final_url, body, error = request_url(oembed)
    if status == 200:
        title = ""
        try:
            title = str(json.loads(body.decode("utf-8", errors="replace")).get("title") or "")
        except json.JSONDecodeError:
            pass
        message = f"公開動画を確認しました{f'：{title}' if title else ''}。"
        return result_dict(target, "ok", status, message, canonical, "youtube-oembed")

    page_status, page_url, page_body, page_error = request_url(canonical)
    text = page_body.decode("utf-8", errors="replace")
    playability = re.search(
        r'"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"([A-Z_]+)"(?:\s*,\s*"reason"\s*:\s*"([^"]*)")?',
        text,
    )
    if playability:
        play_state = playability.group(1)
        reason = bytes(playability.group(2) or "", "utf-8").decode("unicode_escape", errors="ignore")
        if play_state in {"OK", "LIVE_STREAM_OFFLINE"}:
            return result_dict(target, "ok", page_status, "YouTube上で公開状態を確認しました。", page_url, "youtube-page")
        if play_state in {"ERROR", "UNPLAYABLE"}:
            return result_dict(target, "broken", page_status, reason or "YouTubeで視聴できない動画です。", page_url, "youtube-page")
        if play_state == "LOGIN_REQUIRED":
            return result_dict(target, "warning", page_status, reason or "ログイン条件があり、自動確認できません。", page_url, "youtube-page")

    if status in {401, 403, 404} and page_status in BROKEN_STATUS:
        return result_dict(target, "broken", page_status, "YouTube動画が削除・非公開・利用不可の可能性があります。", page_url, "youtube-oembed+page")
    state, message = http_result(page_status, page_url, page_body, page_error, restricted_service=True)
    return result_dict(target, state, page_status, f"YouTube公開状態を確定できませんでした。{message}", page_url, "youtube-oembed+page")


def check_spotify(target: LinkTarget) -> dict[str, Any]:
    endpoint = f"https://open.spotify.com/oembed?{urlencode({'url': target.normalized_url})}"
    status, final_url, body, error = request_url(endpoint)
    if status == 200:
        return result_dict(target, "ok", status, "Spotifyの公開コンテンツを確認しました。", target.normalized_url, "spotify-oembed")
    if status in BROKEN_STATUS:
        return result_dict(target, "broken", status, f"Spotifyコンテンツを確認できません（HTTP {status}）。", target.normalized_url, "spotify-oembed")
    page_status, page_url, page_body, page_error = request_url(target.normalized_url)
    state, message = http_result(page_status, page_url, page_body, page_error, restricted_service=True)
    return result_dict(target, state, page_status, message, page_url, "spotify-page")


def apple_content_id(url: str) -> str | None:
    parsed = urlsplit(url)
    for part in reversed([piece for piece in parsed.path.split("/") if piece]):
        match = re.fullmatch(r"(?:id)?(\d{6,})", part)
        if match:
            return match.group(1)
    return None


def check_apple(target: LinkTarget) -> dict[str, Any]:
    content_id = apple_content_id(target.normalized_url)
    if content_id:
        endpoint = f"https://itunes.apple.com/lookup?{urlencode({'id': content_id, 'country': 'jp'})}"
        status, final_url, body, error = request_url(endpoint)
        if status == 200:
            try:
                payload = json.loads(body.decode("utf-8", errors="replace"))
                if int(payload.get("resultCount") or 0) > 0:
                    return result_dict(target, "ok", status, "Appleの公開コンテンツを確認しました。", target.normalized_url, "apple-lookup")
                return result_dict(target, "broken", 404, "Appleの公開コンテンツが見つかりません。", target.normalized_url, "apple-lookup")
            except (json.JSONDecodeError, ValueError, TypeError):
                pass
        if status in BROKEN_STATUS:
            return result_dict(target, "broken", status, f"Appleの公開コンテンツを確認できません（HTTP {status}）。", target.normalized_url, "apple-lookup")
    return check_generic(target, service_for(target.normalized_url)[0])


def check_x(target: LinkTarget) -> dict[str, Any]:
    parsed = urlsplit(target.normalized_url)
    if re.search(r"/status/\d+", parsed.path):
        endpoint = f"https://publish.twitter.com/oembed?{urlencode({'url': target.normalized_url, 'omit_script': 'true', 'dnt': 'true'})}"
        status, final_url, body, error = request_url(endpoint)
        if status == 200:
            return result_dict(target, "ok", status, "Xの公開投稿を確認しました。", target.normalized_url, "x-oembed")
        if status in BROKEN_STATUS:
            return result_dict(target, "broken", status, f"Xの投稿を確認できません（HTTP {status}）。", target.normalized_url, "x-oembed")
        if error or status in BOT_BLOCK_STATUS or (status and status >= 500):
            return result_dict(target, "warning", status, "X側の制限または一時エラーにより投稿を自動確認できません。", target.normalized_url, "x-oembed")
    return check_generic(target, "x")


def check_generic(target: LinkTarget, service_key: str) -> dict[str, Any]:
    restricted = service_key in {"x", "instagram", "tiktok"}
    last: tuple[int | None, str, bytes, str | None] | None = None
    for attempt in range(2):
        last = request_url(target.normalized_url)
        status = last[0]
        if status not in RETRYABLE_STATUS and last[3] is None:
            break
        if attempt == 0:
            time.sleep(1.2)
    assert last is not None
    status, final_url, body, error = last
    state, message = http_result(status, final_url, body, error, restricted_service=restricted and status in BOT_BLOCK_STATUS)
    return result_dict(target, state, status, message, final_url, "http-get")


def result_dict(
    target: LinkTarget,
    status: str,
    http_status: int | None,
    message: str,
    final_url: str,
    method: str,
) -> dict[str, Any]:
    service_key, service_label = service_for(target.normalized_url)
    return {
        "url": target.url,
        "normalizedUrl": target.normalized_url,
        "finalUrl": final_url or target.normalized_url,
        "service": service_label,
        "serviceKey": service_key,
        "status": status,
        "httpStatus": http_status,
        "message": message,
        "method": method,
        "sources": [dataclasses.asdict(source) for source in sorted(target.sources, key=lambda source: (source.file, source.line or 0))],
    }


def check_target(target: LinkTarget) -> dict[str, Any]:
    service_key, _ = service_for(target.normalized_url)
    if service_key == "youtube":
        return check_youtube(target)
    if service_key == "spotify":
        return check_spotify(target)
    if service_key in {"apple-music", "app-store"}:
        return check_apple(target)
    if service_key == "x":
        return check_x(target)
    return check_generic(target, service_key)


def build_report(results: list[dict[str, Any]], started_at: str, elapsed_seconds: float) -> dict[str, Any]:
    order = {"broken": 0, "warning": 1, "ok": 2}
    results.sort(key=lambda item: (order.get(item["status"], 9), item["service"].lower(), item["url"].lower()))
    counts = {"ok": 0, "warning": 0, "broken": 0}
    services: dict[str, dict[str, Any]] = {}
    hosts: set[str] = set()
    for item in results:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
        hosts.add(urlsplit(item["normalizedUrl"]).netloc.lower())
        service = services.setdefault(item["serviceKey"], {
            "key": item["serviceKey"],
            "label": item["service"],
            "checked": 0,
            "ok": 0,
            "warning": 0,
            "broken": 0,
        })
        service["checked"] += 1
        service[item["status"]] += 1
    return {
        "version": 1,
        "generatedAt": now_iso(),
        "startedAt": started_at,
        "elapsedSeconds": round(elapsed_seconds, 2),
        "summary": {
            "checked": len(results),
            "ok": counts["ok"],
            "warning": counts["warning"],
            "broken": counts["broken"],
            "hosts": len(hosts),
        },
        "services": sorted(services.values(), key=lambda service: (-service["broken"], -service["warning"], service["label"].lower())),
        "items": results,
        "notes": [
            "404・410・451と、YouTubeで明確に視聴不可と判定できたリンクをリンク切れとして扱います。",
            "X・Instagram・TikTokなど自動アクセスを制限するサービスは、誤検知防止のため要確認として扱う場合があります。",
            "要確認には一時的な通信障害、アクセス制限、レート制限、外部サービス側の5xxエラーが含まれます。",
        ],
    }


def write_issue_markdown(report: dict[str, Any], path: Path) -> None:
    summary = report["summary"]
    broken = [item for item in report["items"] if item["status"] == "broken"]
    lines = [
        "## 外部リンク自動チェック結果",
        "",
        f"- 確認日時: `{report['generatedAt']}`",
        f"- 確認リンク: **{summary['checked']}件**",
        f"- リンク切れ: **{summary['broken']}件**",
        f"- 要確認: **{summary['warning']}件**",
        f"- 正常: **{summary['ok']}件**",
        "",
    ]
    if broken:
        lines.extend([
            "### 修正が必要なリンク",
            "",
            "| サービス | URL | 判定 | 記載ファイル |",
            "|---|---|---|---|",
        ])
        for item in broken[:30]:
            source_labels = []
            for source in item.get("sources", [])[:5]:
                suffix = f":{source['line']}" if source.get("line") else ""
                source_labels.append(f"`{source['file']}{suffix}`")
            sources = "<br>".join(source_labels)
            safe_url = item["url"].replace("|", "%7C")
            message = item["message"].replace("|", "／")
            lines.append(f"| {item['service']} | {safe_url} | {message} | {sources} |")
        if len(broken) > 30:
            lines.extend(["", f"ほか {len(broken) - 30}件は公開レポートを確認してください。"])
    else:
        lines.extend(["リンク切れは検出されませんでした。", ""])
    lines.extend([
        "### 確認先",
        "",
        "- サイト: `external-links.html`",
        "- JSON: `data/external-link-report.json`",
        "- Actions: `Check External Links`",
        "",
        "> このIssueはGitHub Actionsが自動更新します。リンク切れが0件になると自動で閉じます。",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--issue-body", type=Path, default=DEFAULT_ISSUE)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--fail-on-broken", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.monotonic()
    started_at = now_iso()
    targets: dict[str, LinkTarget] = {}
    collect_html_links(targets)
    collect_json_links(targets)
    print(f"外部リンクを収集しました: {len(targets)}件")

    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as executor:
        futures = {executor.submit(check_target, target): target for target in targets.values()}
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            target = futures[future]
            try:
                item = future.result()
            except Exception as error:  # Defensive: one failed checker must not lose the report.
                item = result_dict(target, "warning", None, f"チェック処理エラー: {error}", target.normalized_url, "checker-error")
            results.append(item)
            print(f"[{index:03d}/{len(futures):03d}] {item['status'].upper():7} {item['service']}: {item['url']}")

    report = build_report(results, started_at, time.monotonic() - started)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_issue_markdown(report, args.issue_body)

    summary = report["summary"]
    print(
        f"完了: {summary['checked']}件 / 正常 {summary['ok']} / "
        f"要確認 {summary['warning']} / リンク切れ {summary['broken']}"
    )
    if args.fail_on_broken and summary["broken"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
