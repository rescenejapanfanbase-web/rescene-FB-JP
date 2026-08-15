#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

NEW_SEO_DESCRIPTION = "RESCENE JAPAN FANBASEのアンケート結果から、好きな曲ランキング上位5曲や掲載許可済みのコメントを紹介します。"
NEW_RANKING_DESCRIPTION = "アンケートで選ばれた楽曲のうち、得票数上位5曲を掲載しています。"
NEW_FOOTER_NOTE = "アンケート結果は定期的に集計・更新しています。"


def read(path: Path) -> str:
    if not path.exists():
        raise RuntimeError(f"必要なファイルがありません: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def write_if_changed(path: Path, source: str, original: str, changes: list[str]) -> None:
    if source != original:
        path.write_text(source, encoding="utf-8")
        changes.append(str(path.relative_to(ROOT)))


def patch_survey_html(changes: list[str]) -> None:
    path = ROOT / "survey.html"
    original = read(path)
    source = original

    for old in [
        "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計し、好きな曲ランキングや評価、掲載許可済みコメントを表示します。",
        "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計して掲載します。",
    ]:
        source = source.replace(old, NEW_SEO_DESCRIPTION)

    source = source.replace(
        "REMINEの皆さんから届いた回答をNotionから自動集計し、結果を公開しています。",
        "REMINEの皆さんから届いた回答を集計し、結果を公開しています。",
    )
    source = source.replace(
        "回答はNotionフォームから送信できます。",
        "回答フォームから送信できます。",
    )

    source = re.sub(
        r"\s*<article class=\"card survey-stat-card\"><small>SELECTIONS</small><strong id=\"surveySelectionCount\">—</strong><span>楽曲選択数</span></article>",
        "",
        source,
        count=1,
    )

    source = source.replace("<span class=\"section-kicker\">ABOUT DATA</span>", "<span class=\"section-kicker\">ABOUT RESULTS</span>")

    method_content = (
        '<p><strong>ランキング：</strong>アンケートで選ばれた楽曲を1曲につき1票として集計し、得票数上位5曲を掲載しています。'
        '「選択率」は回答者のうち何%がその曲を選んだかを表します。</p>'
        '<p><strong>コメント：</strong>自由コメントは「サイト掲載許可」がある回答のみ掲載しています。</p>'
        '<p><strong>更新：</strong>結果は定期的に集計・更新しています。回答後、反映まで時間がかかる場合があります。</p>'
    )
    source, count = re.subn(
        r'(<div class="card survey-method-card">).*?(</div></section>\s*</main>)',
        lambda m: m.group(1) + method_content + m.group(2),
        source,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError("survey.html: 集計についての説明欄を特定できません。")

    source = source.replace(
        "アンケート結果はNotionの回答を自動集計して表示しています。",
        NEW_FOOTER_NOTE,
    )

    write_if_changed(path, source, original, changes)


def patch_survey_js(changes: list[str]) -> None:
    path = ROOT / "js" / "survey.js"
    original = read(path)
    source = original

    old_rows = 'const rows = Array.isArray(campaign?.ranking) ? campaign.ranking : [];'
    new_rows = 'const rows = Array.isArray(campaign?.ranking) ? campaign.ranking.slice(0, 5) : [];'
    if old_rows in source:
        source = source.replace(old_rows, new_rows, 1)
    elif new_rows not in source:
        raise RuntimeError("js/survey.js: ランキング取得処理を特定できません。")

    source = re.sub(
        r'^\s*\$\("#surveySelectionCount"\)\.textContent = number\(campaign\?\.totalSelections\);\s*\n?',
        "",
        source,
        count=1,
        flags=re.M,
    )

    source = re.sub(
        r'^\s*const sub = node\("div", "survey-rank-sub", config\.showSelectionShare !== false \? `全選択票に占める割合 \$\{percent\(item\.selectionShare\)\}` : ""\);\s*\n?',
        "",
        source,
        count=1,
        flags=re.M,
    )
    source = source.replace("body.append(top, track, sub);", "body.append(top, track);")

    write_if_changed(path, source, original, changes)


def patch_config(changes: list[str]) -> None:
    path = ROOT / "data" / "survey-config.json"
    original = read(path)
    data = json.loads(original)
    data["rankingDescription"] = NEW_RANKING_DESCRIPTION
    data["showSelectionShare"] = False
    source = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    write_if_changed(path, source, original, changes)


def patch_css(changes: list[str]) -> None:
    path = ROOT / "css" / "survey.css"
    original = read(path)
    source = original.replace(
        ".page-survey .survey-hero-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));",
        ".page-survey .survey-hero-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));",
        1,
    )
    if "repeat(4,minmax(0,1fr))" in source.split("@media", 1)[0]:
        raise RuntimeError("css/survey.css: 上部集計カードの4列設定が残っています。")
    write_if_changed(path, source, original, changes)


def patch_sync_script(changes: list[str]) -> None:
    path = ROOT / "scripts" / "sync-notion-survey.mjs"
    original = read(path)
    source = original

    ranking_sort = '  })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ja"));'
    ranking_top5 = '  })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ja")).slice(0, 5);'
    if ranking_top5 not in source:
        if ranking_sort not in source:
            raise RuntimeError("sync-notion-survey.mjs: 楽曲ランキングの並び替え処理を特定できません。")
        source = source.replace(ranking_sort, ranking_top5, 1)

    source = source.replace('  source: "notion",\n  dataSourceId,\n', '  source: "survey",\n', 1)
    source = source.replace("Notionアンケート集計完了:", "アンケート集計完了:")

    write_if_changed(path, source, original, changes)


def patch_public_results(changes: list[str]) -> None:
    json_path = ROOT / "data" / "survey-results.json"
    if json_path.exists():
        original = read(json_path)
        data = json.loads(original)
        data["source"] = "survey"
        data.pop("dataSourceId", None)
        source = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        write_if_changed(json_path, source, original, changes)

    js_path = ROOT / "data" / "survey-results-data.js"
    if js_path.exists():
        original = read(js_path)
        source = original.replace('"source": "notion"', '"source": "survey"')
        source = re.sub(r'^\s*"dataSourceId":\s*"[^"]+",?\s*\n?', "", source, count=1, flags=re.M)
        write_if_changed(js_path, source, original, changes)


def patch_generate_seo(changes: list[str]) -> None:
    path = ROOT / "scripts" / "generate-seo.py"
    original = read(path)
    source = original
    for old in [
        "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計し、好きな曲ランキングや評価、掲載許可済みコメントを表示します。",
        "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計して掲載します。",
    ]:
        source = source.replace(old, NEW_SEO_DESCRIPTION)
    write_if_changed(path, source, original, changes)


def patch_site_shell(changes: list[str]) -> None:
    path = ROOT / "scripts" / "sync-site-shell.py"
    original = read(path)
    source = original.replace(
        "'survey.html':'アンケート結果はNotionの回答を自動集計して表示しています。'",
        f"'survey.html':'{NEW_FOOTER_NOTE}'",
    )
    write_if_changed(path, source, original, changes)


def patch_installer(changes: list[str]) -> None:
    path = ROOT / "scripts" / "install-survey-integration.py"
    if not path.exists():
        return
    original = read(path)
    source = original
    source = source.replace(
        "RESCENE JAPAN FANBASEのアンケート結果をNotion回答から自動集計し、好きな曲ランキングや評価、掲載許可済みコメントを表示します。",
        NEW_SEO_DESCRIPTION,
    )
    source = source.replace(
        "アンケート結果はNotionの回答を自動集計して表示しています。",
        NEW_FOOTER_NOTE,
    )
    # This comment is not public, but removing the vendor name keeps future maintenance output neutral.
    source = source.replace(
        "# アンケートはサイト機能として常設。Notion側に同じリンクが追加された場合は重複させません。",
        "# アンケートはサイト機能として常設。同じリンクが追加された場合は重複させません。",
    )
    write_if_changed(path, source, original, changes)


def patch_workflow_name(changes: list[str]) -> None:
    path = ROOT / ".github" / "workflows" / "sync-notion-survey.yml"
    if not path.exists():
        return
    original = read(path)
    source = original.replace("name: Sync Notion Survey Results", "name: Sync Survey Results", 1)
    write_if_changed(path, source, original, changes)


def verify() -> None:
    html = read(ROOT / "survey.html")
    js = read(ROOT / "js" / "survey.js")
    config = json.loads(read(ROOT / "data" / "survey-config.json"))
    sync_script = read(ROOT / "scripts" / "sync-notion-survey.mjs")
    seo = read(ROOT / "scripts" / "generate-seo.py")
    shell = read(ROOT / "scripts" / "sync-site-shell.py")

    required_html = [
        "REMINEの皆さんから届いた回答を集計し、結果を公開しています。",
        "得票数上位5曲を掲載しています。",
        NEW_FOOTER_NOTE,
    ]
    for marker in required_html:
        if marker not in html:
            raise RuntimeError(f"survey.html: 必須文言がありません: {marker}")

    forbidden_html = [
        "surveySelectionCount",
        "楽曲選択数",
        "Notionから自動集計",
        "Notionフォーム",
        "GitHub Actions",
        "アンケート結果はNotionの回答",
    ]
    for marker in forbidden_html:
        if marker in html:
            raise RuntimeError(f"survey.html: 公開ページに不要な文言が残っています: {marker}")

    if "campaign.ranking.slice(0, 5)" not in js:
        raise RuntimeError("js/survey.js: 上位5曲制限がありません。")
    if "surveySelectionCount" in js:
        raise RuntimeError("js/survey.js: 楽曲選択数の表示処理が残っています。")
    if config.get("rankingDescription") != NEW_RANKING_DESCRIPTION:
        raise RuntimeError("survey-config.json: ランキング説明が最新版ではありません。")
    if config.get("showSelectionShare") is not False:
        raise RuntimeError("survey-config.json: 全選択票割合が非表示になっていません。")
    if ".slice(0, 5);" not in sync_script:
        raise RuntimeError("sync-notion-survey.mjs: 公開ランキングが上位5件に制限されていません。")
    if NEW_SEO_DESCRIPTION not in seo:
        raise RuntimeError("generate-seo.py: アンケートSEO説明が最新版ではありません。")
    if NEW_FOOTER_NOTE not in shell:
        raise RuntimeError("sync-site-shell.py: アンケートフッター文言が最新版ではありません。")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if not args.check:
        changes: list[str] = []
        patch_survey_html(changes)
        patch_survey_js(changes)
        patch_config(changes)
        patch_css(changes)
        patch_sync_script(changes)
        patch_public_results(changes)
        patch_generate_seo(changes)
        patch_site_shell(changes)
        patch_installer(changes)
        patch_workflow_name(changes)
        verify()
        if changes:
            print("アンケート公開表示を更新しました:")
            for path in changes:
                print(f"- {path}")
        else:
            print("アンケート公開表示はすでに最新版です。")
    else:
        verify()
        print("✅ アンケート公開表示チェック成功")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
