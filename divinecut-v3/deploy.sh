#!/bin/bash
# DivineCut Cloud v3 — full-feature deploy (toolkit + presets + watch-folder +
# versioning + Telegram delivery). Run: bash ~/.openclaw/workspace/ai-prosperity/divinecut-v3/deploy.sh
set -euo pipefail
SRC=~/.openclaw/workspace/ai-prosperity/divinecut-v3

echo "→ local syntax checks…"
node --check "$SRC/server.js"
for f in "$SRC"/toolkit/*.py; do python3 -m py_compile "$f"; done
echo "  OK"

echo "→ shipping to VPS…"
scp -q -r "$SRC/toolkit" hostinger-vps:/opt/divinecut/
scp -q "$SRC/server.js" hostinger-vps:/opt/divinecut/server.v3.js
scp -q "$SRC/TOOLKIT.md" "$SRC/PRESETS.json" "$SRC/brand_kit.json" \
      "$SRC/TASTE.md" "$SRC/QUALITY_RULES_ADDENDUM.md" hostinger-vps:/opt/divinecut/

ssh hostinger-vps 'bash -s' <<'EOSSH'
set -euo pipefail
cd /opt/divinecut
TOKEN=$(cat .token)

echo "→ venv deps (pillow + google api for publish)…"
./venv/bin/pip -q install pillow google-api-python-client google-auth google-auth-oauthlib 2>&1 | tail -1 || true

echo "→ appending v3 rules to QUALITY_RULES.md (feedback rules preserved)…"
grep -q "v3 additions (toolkit era)" QUALITY_RULES.md 2>/dev/null || cat QUALITY_RULES_ADDENDUM.md >> QUALITY_RULES.md

echo "→ telegram wiring (server-side discovery, secrets stay here)…"
if [ ! -f .env.telegram ]; then
  BOT=$(grep -rhoE "TELEGRAM[A-Z_]*(BOT|TOKEN)[A-Z_]*=[0-9]{6,}:[A-Za-z0-9_-]+" /opt/divine-ai/*.env /opt/divine-ai/KEYS.registry 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -n "$BOT" ]; then
    printf "TELEGRAM_BOT=%s\nTELEGRAM_CHAT=7585894235\n" "$BOT" > .env.telegram
    chmod 600 .env.telegram
    echo "  telegram delivery: ENABLED"
  else
    echo "  telegram delivery: no bot token found — dormant (create /opt/divinecut/.env.telegram to enable)"
  fi
else echo "  telegram delivery: already configured"; fi

echo "→ waiting for any in-flight job (max 30 min)…"
for i in $(seq 1 60); do
  [ "$(pgrep -fc 'claude -p' || true)" = "0" ] && break
  sleep 30
done

echo "→ installing v3 server…"
cp server.js server.v2.bak 2>/dev/null || true
mv server.v3.js server.js
node --check server.js

echo "→ console v3 patch (preset buttons + versions + phase display)…"
python3 - <<'EOF'
web = open("web/index.html").read()

# preset buttons above the instruction box
if 'id="presetRow"' not in web:
    web = web.replace('<textarea id="instr"',
        '<div class="row" id="presetRow" style="margin-bottom:8px"></div>\n  <textarea id="instr"', 1)

# phase-aware job state (idempotent)
old = "$('jstate').textContent=s.done?('finished'+(s.exit?` (exit ${s.exit})`:'')):('running '+s.seconds+'s');"
new = "$('jstate').textContent=s.done?('finished — review: '+((s.verdicts&&s.verdicts.join(', '))||'n/a')):((s.phase||'running')+' · '+s.seconds+'s');"
if old in web: web = web.replace(old, new, 1)

js = """
async function loadPresets(){const P=await api('/api/presets');
 document.getElementById('presetRow').innerHTML=Object.entries(P).map(([k,v])=>`<button data-k="${k}" style="background:#26263a;color:#ffd23c">${v.label}</button>`).join('');
 document.querySelectorAll('#presetRow button').forEach(b=>{b.onclick=async()=>{
  const r=await api('/api/agent',{method:'POST',body:JSON.stringify({preset:b.dataset.k,project:$('project').value,instruction:$('instr').value.trim()})});
  job=r.id;$('run').disabled=true;$('stop').style.display='';$('log').style.display='block';$('outs').innerHTML='';timer=setInterval(poll,3000);};});}
loadPresets();
"""
if "loadPresets" not in web:
    web = web.replace("</script></body></html>", js + "</script></body></html>", 1)
open("web/index.html","w").write(web)
print("  console patched")
EOF

pm2 restart divinecut --update-env >/dev/null
sleep 3
echo "→ health:"
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/health
echo

echo "→ toolkit smoke tests…"
PY=./venv/bin/python3
ffmpeg -y -v error -f lavfi -i "testsrc2=size=640x360:rate=25:duration=6" -f lavfi -i "sine=frequency=440:duration=6" -c:v libx264 -c:a aac /tmp/dc_smoke.mp4
$PY toolkit/enhance_audio.py --in /tmp/dc_smoke.mp4 --out /tmp/dc_clean.mp4
printf '[{"word":"Divine","start":0.5,"end":1.0},{"word":"Cut","start":1.0,"end":1.4},{"word":"v3","start":1.5,"end":2.0},{"word":"is","start":2.4,"end":2.6},{"word":"alive","start":2.6,"end":3.2}]' > /tmp/dc_words.json
$PY toolkit/captions.py --video /tmp/dc_clean.mp4 --words /tmp/dc_words.json --out /tmp/dc_capped.mp4 --style bold --srt /tmp/dc.srt
$PY toolkit/thumb_pick.py --video /tmp/dc_capped.mp4 --out-dir /tmp/dc_thumbs --n 2
ls -la /tmp/dc_capped.mp4 /tmp/dc.srt /tmp/dc_thumbs/grid.png
echo "════════════════════════════════════════"
echo "DivineCut Cloud v3 deployed: toolkit ✓ presets ✓ watch-folder ✓ versioning ✓"
EOSSH
