#!/bin/bash
# DivineCut Cloud v2 deploy — produce → adversarial review → fix pipeline.
# Run from the Mac:  bash ~/.openclaw/workspace/ai-prosperity/divinecut-v2-deploy.sh
set -euo pipefail
SRC=~/.openclaw/workspace/ai-prosperity

echo "→ shipping files to VPS…"
scp -q "$SRC/divinecut-server-v2.js" hostinger-vps:/opt/divinecut/server.v2.js
scp -q "$SRC/divinecut-QUALITY_RULES.md" hostinger-vps:/opt/divinecut/QUALITY_RULES.md

ssh hostinger-vps 'bash -s' <<'EOSSH'
set -euo pipefail
cd /opt/divinecut
TOKEN=$(cat .token)

echo "→ waiting for any in-flight job to finish (max 30 min)…"
for i in $(seq 1 60); do
  BUSY=$(pgrep -fc "claude -p" || true)
  [ "$BUSY" = "0" ] && break
  sleep 30
done
pgrep -fc "claude -p" >/dev/null 2>&1 && echo "  (still busy — restarting anyway; job log survives on disk)" || true

echo "→ installing v2 server…"
cp server.js server.v1.bak
mv server.v2.js server.js

echo "→ patching console UI (phase display + teach-the-editor box)…"
python3 - <<'EOF'
web = open("web/index.html").read()

old = "$('jstate').textContent=s.done?('finished'+(s.exit?` (exit ${s.exit})`:'')):('running '+s.seconds+'s');"
new = "$('jstate').textContent=s.done?('finished — review: '+((s.verdicts&&s.verdicts.join(', '))||'n/a')):((s.phase||'running')+' · '+s.seconds+'s');"
if old in web: web = web.replace(old, new, 1)

anchor = '<b>📦 Finished files</b>'
fb = ('<div class="card"><div class="row">'
      '<input id="fbtext" placeholder="Teach the editor… e.g. \'captions bigger\', \'never use blur bars\'" style="flex:1"/>'
      '<button id="fbsend">Save rule</button></div>'
      '<span style="font-size:11px;color:#8a90b0">Saved into QUALITY_RULES.md — every future job obeys it.</span></div>'
      '<div class="card"><div class="row" style="justify-content:space-between">')
web = web.replace('<div class="card"><div class="row" style="justify-content:space-between">\n<b>📦 Finished files</b>', fb + '\n<b>📦 Finished files</b>', 1) \
      if '<b>📦 Finished files</b>' in web else web

js = ("$('fbsend').onclick=async()=>{const t=$('fbtext').value.trim();if(!t)return;"
      "await api('/api/feedback',{method:'POST',body:JSON.stringify({text:t})});"
      "$('fbtext').value='';alert('Rule saved — future jobs will obey it.');};")
web = web.replace("</script></body></html>", js + "</script></body></html>", 1)
open("web/index.html","w").write(web)
print("console patched")
EOF

pm2 restart divinecut --update-env >/dev/null
sleep 3
echo "→ health check:"
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/health
echo
echo "→ status of the last corrective job (877ed84600ed):"
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/job/877ed84600ed | python3 -c "import json,sys; d=json.load(sys.stdin); print('done:',d.get('done'),'| outputs:',d.get('outputs'))" 2>/dev/null || echo "  (job record reset by restart — files, if produced, are in the Finished files card)"
echo "════════════════════════════════════════"
echo "DivineCut Cloud v2 deployed."
EOSSH
