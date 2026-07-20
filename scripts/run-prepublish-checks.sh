#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/7] Python構文"
python3 -m compileall -q scripts check-site-links.py

echo "[2/7] JavaScript / MJS構文"
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done < <(find . -type f \( -name '*.js' -o -name '*.mjs' \) \
  -not -path './.git/*' -not -path './node_modules/*' -print0)

echo "[3/7] JSON"
python3 - <<'PY'
import json
from pathlib import Path
files=[]
for p in Path('.').rglob('*.json'):
    if '.git' in p.parts or 'node_modules' in p.parts: continue
    json.loads(p.read_text(encoding='utf-8'))
    files.append(p)
print(f'JSON {len(files)}ファイル正常')
PY

echo "[4/7] Workflow YAML"
python3 - <<'PY'
from pathlib import Path
try:
    import yaml
except ImportError as exc:
    raise SystemExit('PyYAMLが必要です: pip install PyYAML') from exc
files=list(Path('.github/workflows').glob('*.yml'))+list(Path('.github/workflows').glob('*.yaml'))
for p in files:
    yaml.safe_load(p.read_text(encoding='utf-8'))
print(f'Workflow {len(files)}件正常')
PY

echo "[5/7] Workflow内Bash構文"
python3 - <<'PY'
from pathlib import Path
import subprocess, tempfile, yaml
count=0
for p in sorted(Path('.github/workflows').glob('*.yml')):
    data=yaml.safe_load(p.read_text(encoding='utf-8')) or {}
    for job in (data.get('jobs') or {}).values():
        for step in job.get('steps') or []:
            run=step.get('run')
            shell=str(step.get('shell','bash'))
            if not run or ('bash' not in shell and shell not in ('','sh')): continue
            with tempfile.NamedTemporaryFile('w',suffix='.sh',delete=False,encoding='utf-8') as f:
                f.write(run); name=f.name
            result=subprocess.run(['bash','-n',name],capture_output=True,text=True)
            Path(name).unlink(missing_ok=True)
            if result.returncode:
                raise SystemExit(f'{p}: Bash構文エラー\n{result.stderr}')
            count+=1
print(f'Workflow内Bash {count}ブロック正常')
PY

echo "[6/7] サイト内参照"
python3 scripts/check-site-links.py

echo "[7/7] データ・HTML品質"
python3 scripts/validate-site.py

echo "✅ 公開前チェックがすべて完了しました。"
