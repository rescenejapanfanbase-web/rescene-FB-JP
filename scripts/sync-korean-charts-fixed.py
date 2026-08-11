#!/usr/bin/env python3
"""Daily chart adapters with reliable Genie Daily pagination."""
from __future__ import annotations
import importlib.util, re, sys
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable
from bs4 import BeautifulSoup

BASE_PATH=Path(__file__).with_name("sync-korean-charts.py")
SPEC=importlib.util.spec_from_file_location("rescene_korean_chart_base",BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"同期本体を読み込めません: {BASE_PATH}")
BASE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

BROWSER_HEADERS={
 "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
 "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
 "Accept-Language":"ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.6",
 "Cache-Control":"no-cache",
}

def expected_daily_date(fetched_at:datetime):
    return fetched_at.astimezone(BASE.KST).date()-timedelta(days=1)

def daily_chart_at(target):
    return datetime.combine(target,time.min,tzinfo=BASE.KST).isoformat()

def normalized_space(value:Any)->str:
    return re.sub(r"\s+"," ",str(value or "")).strip()

def target_date_is_present(html:str,target)->bool:
    text=normalized_space(BeautifulSoup(html,"html.parser").get_text(" ",strip=True))
    compact=re.sub(r"\s+","",text)
    variants={
      target.strftime("%Y.%m.%d"),target.strftime("%Y-%m-%d"),
      target.strftime("%Y/%m/%d"),target.strftime("%Y%m%d"),
      f"{target.year}년 {target.month:02d}월 {target.day:02d}일",
      f"{target.year}년 {target.month}월 {target.day}일",
    }
    return any(v in text or re.sub(r"\s+","",v) in compact for v in variants)

def request_html(url:str,referer:str)->str:
    raw=BASE.http_request(url,headers={**BROWSER_HEADERS,"Referer":referer})
    return raw.decode("utf-8",errors="replace")

def node_text(row,selectors:Iterable[str])->str:
    for selector in selectors:
        node=row.select_one(selector)
        if node:
            value=normalized_space(node.get_text(" ",strip=True))
            if value:return value
    return ""

def rank_from_row(row,selectors):
    for selector in selectors:
        node=row.select_one(selector)
        if not node:continue
        match=re.search(r"(?<!\d)(\d{1,3})(?!\d)",normalized_space(node.get_text(" ",strip=True)))
        if match:
            rank=int(match.group(1))
            if 1<=rank<=200:return rank
    return None

def id_from_row(row)->str:
    blob=" ".join(str(v) for el in [row,*row.find_all(True)] for v in (getattr(el,"attrs",{}) or {}).values())
    match=re.search(r"\b(\d{6,})\b",blob)
    return match.group(1) if match else ""

def unique_sorted_items(items,max_rank):
    by_rank={}
    identities=set()
    for item in items:
        rank=BASE.safe_int(item.get("rank"))
        title=normalized_space(item.get("title"))
        artist=normalized_space(item.get("artist"))
        if rank is None or not 1<=rank<=max_rank or not title:continue
        identity=str(item.get("id") or "") or f"{BASE.compact(title)}::{BASE.compact(artist)}"
        if identity in identities or rank in by_rank:continue
        identities.add(identity)
        by_rank[rank]={"id":str(item.get("id") or ""),"rank":rank,"title":title,"artist":artist}
    return [by_rank[k] for k in sorted(by_rank)]

def parse_melon_daily_html(html):
    soup=BeautifulSoup(html,"html.parser")
    rows=soup.select("tr.lst50, tr.lst100") or soup.select("table tbody tr")
    out=[]
    for row in rows:
        rank=rank_from_row(row,(".rank","span.rank","td:nth-of-type(2)"))
        title=node_text(row,(".ellipsis.rank01 a",".rank01 a","a[href*='song/detail']"))
        artist=node_text(row,(".ellipsis.rank02 a",".rank02 a",".ellipsis.rank02"))
        if rank is not None and title:
            out.append({"id":str(row.get("data-song-no") or id_from_row(row)),"rank":rank,"title":title,"artist":artist})
    return unique_sorted_items(out,100)

def parse_bugs_daily_html(html):
    soup=BeautifulSoup(html,"html.parser")
    rows=soup.select("table.list.trackList tbody tr") or soup.select("table tbody tr")
    out=[]
    for row in rows:
        rank=rank_from_row(row,(".ranking strong","td.ranking strong",".rank"))
        title=node_text(row,("p.title a",".title a","a.trackInfo"))
        artist=node_text(row,("p.artist a",".artist a","p.artist"))
        if rank is not None and title:
            out.append({"id":str(row.get("trackid") or row.get("track-id") or id_from_row(row)),"rank":rank,"title":title,"artist":artist})
    return unique_sorted_items(out,100)

def assert_complete(name,items,minimum):
    if len(items)<minimum:
        raise RuntimeError(f"{name}の取得件数が不足しています: {len(items)}件（最低{minimum}件）")

def fetch_melon_daily_fixed(chart,fetched_at):
    target=expected_daily_date(fetched_at)
    url=f"https://www.melon.com/chart/day/index.htm?chartSearchData={target.strftime('%Y%m%d')}"
    html=request_html(url,"https://www.melon.com/chart/day/index.htm")
    if not target_date_is_present(html,target):
        raise RuntimeError(f"Melon Dailyの日付が未更新または確認不能です: expected={target.isoformat()}")
    items=parse_melon_daily_html(html)
    assert_complete("Melon Daily",items,90)
    return BASE.SourceResult(chart["id"],daily_chart_at(target),items,{
      "period":"daily","sourceMode":"official-html","sourceUrl":url,
      "nativeDate":target.isoformat(),"publishedAt":"12:40 KST",
      "chartDateRule":"source-verified-previous-day","total":len(items)})

def genie_page_items(payload,page,page_size=25):
    result=BASE.parse_genie(payload,{"id":"genie-daily","cadence":"daily"},BASE.now_kst())
    out=[]
    for index,item in enumerate(result.items,1):
        rank=BASE.safe_int(item.get("rank"))
        if rank is None: rank=(page-1)*page_size+index
        elif page>1 and rank<=page_size: rank=(page-1)*page_size+rank
        out.append({**item,"rank":rank})
    return out

def fetch_genie_daily_fixed(chart,fetched_at):
    now=fetched_at.astimezone(BASE.KST)
    if now.timetz().replace(tzinfo=None)<time(12,5):
        raise RuntimeError("Genie Dailyは12:00 KST公開後に取得します。")
    target=expected_daily_date(fetched_at)
    endpoint="https://app.genie.co.kr/chart/j_RankSongList.json"
    merged=[]
    counts=[]
    for page in range(1,9):
        payload=BASE.request_json(
          endpoint,method="POST",
          headers={
            "User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
            "Accept":"application/json",
            "Origin":"https://www.genie.co.kr",
            "Referer":"https://www.genie.co.kr/chart/top200",
          },
          form={"ditc":"D","pg":page,"pgSize":25},
        )
        page_items=genie_page_items(payload,page,25)
        counts.append(len(page_items))
        merged.extend(page_items)
    items=unique_sorted_items(merged,200)
    assert_complete("Genie Daily",items,180)
    return BASE.SourceResult(chart["id"],daily_chart_at(target),items,{
      "period":"daily","sourceMode":"official-json",
      "sourceUrl":endpoint,"nativeDate":target.isoformat(),
      "publishedAt":"12:00 KST","chartDateRule":"previous-day-after-publication",
      "pageSize":25,"pageCount":8,"pageItemCounts":counts,"total":len(items)})

def fetch_bugs_daily_fixed(chart,fetched_at):
    target=expected_daily_date(fetched_at)
    url=f"https://music.bugs.co.kr/chart/track/day/total?chartdate={target.strftime('%Y%m%d')}"
    html=request_html(url,"https://music.bugs.co.kr/chart/track/day/total")
    if not target_date_is_present(html,target):
        raise RuntimeError(f"Bugs Dailyの日付が未更新または確認不能です: expected={target.isoformat()}")
    items=parse_bugs_daily_html(html)
    assert_complete("Bugs Daily",items,90)
    return BASE.SourceResult(chart["id"],daily_chart_at(target),items,{
      "period":"daily","sourceMode":"official-html","sourceUrl":url,
      "nativeDate":target.isoformat(),"publishedAt":"12:00 KST",
      "chartDateRule":"source-verified-previous-day","total":len(items)})

def install_fixes():
    BASE.FETCHERS["melon-daily"]=fetch_melon_daily_fixed
    BASE.FETCHERS["genie-daily"]=fetch_genie_daily_fixed
    BASE.FETCHERS["bugs-daily"]=fetch_bugs_daily_fixed

def self_test():
    sample=datetime(2026,8,11,13,0,tzinfo=BASE.KST)
    assert expected_daily_date(sample).isoformat()=="2026-08-10"
    assert daily_chart_at(expected_daily_date(sample))=="2026-08-10T00:00:00+09:00"
    install_fixes()
    assert BASE.FETCHERS["genie-daily"] is fetch_genie_daily_fixed
    print("Daily adapter self-test passed.")
    return 0

def main():
    if "--self-test" in sys.argv:return self_test()
    install_fixes()
    return int(BASE.main())

if __name__=="__main__":
    raise SystemExit(main())
