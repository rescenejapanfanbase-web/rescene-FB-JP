#!/usr/bin/env python3
"""Write the public GA4 configuration from a GitHub Actions variable."""
from __future__ import annotations
import json, os, re
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'data'/'analytics-config.json'
measurement=os.environ.get('GA_MEASUREMENT_ID','').strip()
if measurement and not re.fullmatch(r'G-[A-Z0-9]+',measurement,re.I):
    raise SystemExit('GA_MEASUREMENT_ID は G- から始まるGA4測定IDで設定してください。')
payload={
    'generatedAt':datetime.now(timezone.utc).isoformat(),
    'measurementId':measurement,
    'enabled':bool(measurement),
    'privacy':{'anonymizeIp':True,'personalData':'not-collected-by-site'},
    'events':['page_view','search','share','favorite_add','favorite_remove','calendar_add','pwa_install_prompt','theme_change'],
}
previous={}
try: previous=json.loads(out.read_text(encoding='utf-8'))
except Exception: pass
# Avoid changing generatedAt on every run if the actual configuration is unchanged.
if {k:previous.get(k) for k in ('measurementId','enabled','privacy','events')}=={k:payload.get(k) for k in ('measurementId','enabled','privacy','events')}:
    payload['generatedAt']=previous.get('generatedAt',payload['generatedAt'])
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('アクセス解析設定:', 'GA4有効' if measurement else '未設定（GA_MEASUREMENT_IDをActions Variablesへ追加すると有効化）')
