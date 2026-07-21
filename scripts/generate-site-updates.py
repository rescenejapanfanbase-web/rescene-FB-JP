#!/usr/bin/env python3
"""Generate public site update history from curated entries and git commits."""
from __future__ import annotations
import json, subprocess
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read_json(path,default):
    try:return json.loads(path.read_text(encoding='utf-8'))
    except Exception:return default
def git_entries():
    try:
        raw=subprocess.check_output(['git','log','-n','40','--date=format:%Y-%m-%d','--pretty=format:%H%x1f%ad%x1f%s','--name-only'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL)
    except Exception:return []
    entries=[];current=None
    for line in raw.splitlines():
        if '\x1f' in line:
            sha,date,title=line.split('\x1f',2);current={'date':date,'title':title,'description':'GitHubでサイト内容を更新しました。','commit':sha[:7],'files':[]};entries.append(current)
        elif line.strip() and current and len(current['files'])<8:current['files'].append(line.strip())
    return [x for x in entries if not x['title'].lower().startswith(('chore: synchronize','chore: sync'))]
manual=read_json(ROOT/'data'/'site-updates-manual.json',[])
seen=set();items=[]
for item in [*manual,*git_entries()]:
    key=(item.get('date'),item.get('title'))
    if key in seen:continue
    seen.add(key);items.append(item)
items.sort(key=lambda x:(x.get('date',''),x.get('title','')),reverse=True)
old=read_json(ROOT/'data'/'site-updates.json',{})
comparable={'items':items}
generated=old.get('generatedAt') if old.get('items')==items else datetime.now(timezone.utc).isoformat()
payload={'generatedAt':generated or datetime.now(timezone.utc).isoformat(),'items':items}
(ROOT/'data'/'site-updates.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'data'/'site-updates-data.js').write_text('window.RESCENE_SITE_UPDATES = '+json.dumps(payload,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print(f'サイト更新履歴を{len(items)}件生成しました。')
