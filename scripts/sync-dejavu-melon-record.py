#!/usr/bin/env python3
from __future__ import annotations
import json, os, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data/records.json"
DATA_JS=ROOT/"data/records-data.js"
SOURCE_ID="12dd657f-8ca2-44b0-a10f-ee099ca9a799"
NOTION_VERSION="2026-03-11"

def plain(prop):
    if not isinstance(prop,dict): return ""
    kind=prop.get("type")
    items=prop.get(kind) if kind in ("title","rich_text") else None
    if isinstance(items,list):
        return "".join(str(x.get("plain_text") or "") for x in items if isinstance(x,dict)).strip()
    return ""

def number(prop):
    if not isinstance(prop,dict): return None
    value=prop.get("number")
    return value if isinstance(value,(int,float)) else None

def date(prop):
    if not isinstance(prop,dict): return ""
    value=prop.get("date") or {}
    return str(value.get("start") or "")[:10]

def url(prop):
    if not isinstance(prop,dict): return ""
    return str(prop.get("url") or "").strip()

def checkbox(prop):
    return bool((prop or {}).get("checkbox"))

def query_notion():
    token=os.getenv("NOTION_TOKEN","").strip()
    if not token:
        raise RuntimeError("NOTION_TOKEN が未設定です。")
    request=urllib.request.Request(
        f"https://api.notion.com/v1/data_sources/{SOURCE_ID}/query",
        method="POST",
        headers={
            "Authorization":f"Bearer {token}",
            "Notion-Version":NOTION_VERSION,
            "Content-Type":"application/json",
        },
        data=b'{"page_size":100}',
    )
    with urllib.request.urlopen(request,timeout=35) as response:
        return json.load(response)

def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def main():
    payload=query_notion()
    target=None
    for page in payload.get("results",[]):
        props=page.get("properties") or {}
        song=plain(props.get("曲名"))
        kind=(plain(props.get("種別")) or ((props.get("種別") or {}).get("select") or {}).get("name") or "")
        published=checkbox(props.get("公開"))
        if song=="Deja Vu" and "Melon" in kind and published:
            target=(page,props)
            break
    if not target:
        raise RuntimeError("Notionの公開済み Deja Vu — Melonチャートを見つけられません。")

    page,props=target
    top=number(props.get("TOP100最高順位"))
    daily=number(props.get("日間最高順位"))
    top_date=date(props.get("TOP100最高順位獲得日"))
    daily_date=date(props.get("日間最高順位獲得日"))
    release=date(props.get("発売日"))
    description=plain(props.get("記録説明"))
    mv=url(props.get("MVリンク"))

    records=load_json(DATA)
    found=False
    for item in records.get("melonRecords",[]):
        if str(item.get("song") or "").strip()!="Deja Vu":
            continue
        item["title"]="Deja Vu — Melonチャート"
        item["releaseDate"]=release
        item["top100Peak"]=int(top) if top is not None else None
        item["top100PeakDate"]=top_date
        item["dailyPeak"]=int(daily) if daily is not None else None
        item["dailyPeakDate"]=daily_date
        item["description"]=description
        item["mvUrl"]=mv
        item["source"]="notion"
        item["notionPageId"]=page.get("id","")
        item["notionUrl"]=page.get("url","")
        item["translations"]={
            "ko":{
                "title":"Deja Vu — Melon 차트",
                "song":"Deja Vu",
                "description":f"Melon TOP100 최고 {int(top)}위, Melon 일간 차트 최고 {int(daily)}위를 기록했습니다." if top is not None and daily is not None else description,
            },
            "en":{
                "title":"Deja Vu — Melon Chart",
                "song":"Deja Vu",
                "description":f"Peaked at No. {int(top)} on the Melon TOP100 and No. {int(daily)} on the Melon Daily Chart." if top is not None and daily is not None else description,
            }
        }
        found=True
        break
    if not found:
        raise RuntimeError("data/records.json のDeja Vuを見つけられません。")

    records["source"]="notion+manual-fallback"
    DATA.write_text(json.dumps(records,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    DATA_JS.write_text("window.RESCENE_RECORDS = "+json.dumps(records,ensure_ascii=False,indent=2)+";\n",encoding="utf-8")
    print(f"Deja Vu synced from Notion: TOP100 #{top} / Daily #{daily}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
