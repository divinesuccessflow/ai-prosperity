#!/bin/bash
# DivineCut Cloud — one-shot bootstrap for the DT VPS (run: ssh hostinger-vps 'bash -s' < this)
# Agentic video editor: web console -> claude -p agent with 5 editing skills.
# Security: binds 127.0.0.1 ONLY (access via SSH tunnel); every /api call needs
# the bearer token in /opt/divinecut/.token; API key wired server-side only.
set -euo pipefail
cd /opt/divinecut
mkdir -p projects jobs web

# 1) Agent API key from the local registry (never leaves this server)
grep -m1 -iE "^[A-Z_]*ANTHROPIC[A-Z_]*=" /opt/divine-ai/KEYS.registry \
  | sed "s/^[A-Z_]*ANTHROPIC[A-Z_]*=/ANTHROPIC_API_KEY=/" > .env
chmod 600 .env
[ -s .env ] || { echo "FATAL: no anthropic key found in registry"; exit 1; }

# 2) Console auth token
if [ ! -s .token ]; then
  head -c 32 /dev/urandom | base64 | tr -d "/+=" | head -c 40 > .token
fi
chmod 600 .token

# 3) Node deps
[ -f package.json ] || npm init -y >/dev/null
npm install --no-fund --no-audit express >/dev/null 2>&1
echo "deps OK"

# 4) The server
cat > server.js <<'EOSERVER'
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = '/opt/divinecut';
const TOKEN = fs.readFileSync(path.join(ROOT, '.token'), 'utf8').trim();
const PROJECTS = path.join(ROOT, 'projects');
const JOBS_DIR = path.join(ROOT, 'jobs');
const PORT = 3010;
const app = express();
const jobs = {};

const safe = s => String(s || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);

function projectDir(name) {
  const d = path.join(PROJECTS, safe(name) || 'default');
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(d, 'out'), { recursive: true });
  const link = path.join(d, '.claude');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, '.claude'), link);
  return d;
}

// Bearer-token gate on every API route
app.use('/api', (req, res, next) => {
  if ((req.headers.authorization || '') === 'Bearer ' + TOKEN) return next();
  res.status(401).json({ error: 'bad token' });
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_q, r) => r.json({
  agent: true, skills: fs.readdirSync(path.join(ROOT, '.claude', 'skills')) }));

app.post('/api/upload', (req, res) => {
  const name = safe(req.query.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const dest = path.join(projectDir(req.query.project), 'assets', name);
  const ws = fs.createWriteStream(dest);
  req.pipe(ws);
  ws.on('finish', () => res.json({ ok: true, name, size: fs.statSync(dest).size }));
  ws.on('error', e => res.status(500).json({ error: String(e) }));
});

app.get('/api/assets', (req, res) => {
  const d = path.join(projectDir(req.query.project), 'assets');
  res.json(fs.readdirSync(d).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size })));
});

app.post('/api/agent', (req, res) => {
  const { instruction, project } = req.body || {};
  if (!instruction) return res.status(400).json({ error: 'instruction required' });
  const pdir = projectDir(project);
  const id = crypto.randomBytes(6).toString('hex');
  const assets = fs.readdirSync(path.join(pdir, 'assets'))
    .map(f => `- assets/${f} (${(fs.statSync(path.join(pdir, 'assets', f)).size / 1e6).toFixed(1)} MB)`)
    .join('\n') || '(none)';
  const prompt = `You are DivineCut Cloud, an autonomous video-editing agent on a
Linux VPS (8 cores, no GPU), cwd ${pdir}. Tools on PATH: ffmpeg, whisper
(CPU — prefer --model tiny.en), yt-dlp, python3, ImageMagick may be absent.
Installed skills define your methodology — use whichever applies:
cut-video (tighten: silences/fillers/retakes; whisper+silencedetect path, do
NOT install conda/MFA), find-broll, clipify (long video -> 9:16 social clips,
face-crop, captions), add-zooms (transcript-driven punch-zooms), color-correct
(named looks).
Project assets:\n${assets}\n\nUSER INSTRUCTION:\n${instruction}\n
Rules: work to completion autonomously; deliverables go in out/ ; never delete
assets/ ; intermediates in work/ ; big sources: make a 1080p proxy first.
When done print one line per deliverable exactly as OUTPUT: out/<file> then a
short summary (durations, cuts, choices).`;
  const log = fs.createWriteStream(path.join(JOBS_DIR, id + '.log'));
  const proc = spawn('claude', ['-p', prompt,
      '--allowedTools', 'Bash Read Write Edit Glob Grep WebFetch WebSearch',
      '--add-dir', ROOT], {
    cwd: pdir,
    env: { ...process.env,
      PATH: `/opt/divinecut/venv/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
  });
  proc.stdout.pipe(log, { end: false });
  proc.stderr.pipe(log, { end: false });
  jobs[id] = { proc, pdir, done: false, exit: null, started: Date.now() };
  proc.on('close', code => {
    jobs[id].done = true; jobs[id].exit = code;
    log.end(`\n[JOB ${code === 0 ? 'DONE' : 'FAILED ' + code}]`);
  });
  res.json({ id });
});

app.get('/api/job/:id', (req, res) => {
  const j = jobs[req.params.id];
  const lp = path.join(JOBS_DIR, safe(req.params.id) + '.log');
  if (!j && !fs.existsSync(lp)) return res.status(404).json({ error: 'unknown job' });
  const logText = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : '';
  res.json({ done: j ? j.done : true, exit: j ? j.exit : null,
    seconds: j ? Math.round((Date.now() - j.started) / 1000) : null,
    log: logText.slice(-5000),
    outputs: [...logText.matchAll(/^OUTPUT:\s*(\S+)/gm)].map(m => m[1]) });
});

app.post('/api/job/:id/stop', (req, res) => {
  const j = jobs[req.params.id];
  if (j && !j.done) { j.proc.kill('SIGTERM'); return res.json({ ok: true }); }
  res.json({ ok: false });
});

app.get('/api/file', (req, res) => {
  const q = String(req.query.p || '');
  const p = path.resolve(PROJECTS, safe(req.query.project) || 'default', q);
  if (!p.startsWith(PROJECTS) || !fs.existsSync(p) || fs.statSync(p).isDirectory())
    return res.status(404).end();
  res.sendFile(p);
});

app.use(express.static(path.join(ROOT, 'web')));
app.listen(PORT, '127.0.0.1', () =>
  console.log(`DivineCut Cloud on 127.0.0.1:${PORT}`));
EOSERVER

# 5) The web console
cat > web/index.html <<'EOWEB'
<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DivineCut Cloud</title><style>
:root{color-scheme:dark}
body{margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;background:#0d0d16;color:#e8e8f0}
header{padding:18px 24px;background:#14141f;border-bottom:1px solid #26263a;display:flex;gap:14px;align-items:center}
h1{font-size:17px;margin:0}h1 b{color:#ffd23c}
main{max-width:900px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:18px}
.card{background:#14141f;border:1px solid #26263a;border-radius:12px;padding:16px}
input,textarea,button{font:inherit;border-radius:8px;border:1px solid #33334d;background:#0d0d16;color:#e8e8f0;padding:9px 12px}
textarea{width:100%;box-sizing:border-box;min-height:70px;resize:vertical}
button{background:#ffd23c;color:#111;border:0;font-weight:700;cursor:pointer}
button:disabled{opacity:.5}
#log{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;background:#0a0a12;border-radius:8px;padding:12px;max-height:320px;overflow:auto}
.asset,.out{font:13px ui-monospace,monospace;color:#a8b0d0}
video{max-width:100%;border-radius:8px;margin-top:8px}
progress{width:100%}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
a{color:#ffd23c}
</style></head><body>
<header><h1>⚡ <b>DivineCut</b> Cloud — agentic video editor</h1>
<span id="status" style="font-size:12px;color:#8a90b0">connecting…</span></header>
<main>
<div class="card"><div class="row">
  <input id="project" placeholder="project name" value="default" style="width:160px"/>
  <input type="file" id="file" accept="video/*,audio/*"/>
  <button id="up">Upload</button></div>
  <progress id="prog" max="100" value="0" style="display:none"></progress>
  <div id="assets" class="asset"></div></div>
<div class="card">
  <textarea id="instr" placeholder="Tell the editor what to do… e.g. 'tighten this ruthlessly (cut-video)' · 'make three 9:16 clips of the best moments (clipify)' · 'add punch-zooms' · 'grade it teal-orange'"></textarea>
  <div class="row" style="margin-top:8px"><button id="run">Run agent</button>
  <button id="stop" style="background:#444;color:#eee;display:none">Stop</button>
  <span id="jstate" style="font-size:12px;color:#8a90b0"></span></div>
  <div id="log" style="display:none"></div>
  <div id="outs"></div></div>
</main><script>
const $=id=>document.getElementById(id);
let TOKEN=localStorage.getItem('dcc_token');
while(!TOKEN){TOKEN=prompt('Paste the DivineCut Cloud token (ssh hostinger-vps "cat /opt/divinecut/.token")');if(TOKEN)localStorage.setItem('dcc_token',TOKEN.trim());}
const H={'Authorization':'Bearer '+TOKEN};
const HJ={...H,'Content-Type':'application/json'};
async function api(p,o={}){const r=await fetch(p,{...o,headers:{...(o.headers||{}),...(o.body&&typeof o.body==='string'?HJ:H)}});if(r.status===401){localStorage.removeItem('dcc_token');location.reload();}return r.json();}
async function refreshAssets(){const a=await api('/api/assets?project='+encodeURIComponent($('project').value));$('assets').innerHTML=a.length?('📼 '+a.map(x=>`${x.name} (${(x.size/1e6).toFixed(1)}MB)`).join(' · ')):'no assets yet';}
api('/api/health').then(h=>{$('status').textContent='agent online · skills: '+h.skills.join(', ');refreshAssets();}).catch(()=>$('status').textContent='offline');
$('project').onchange=refreshAssets;
$('up').onclick=()=>{const f=$('file').files[0];if(!f)return alert('pick a file');
 const x=new XMLHttpRequest();x.open('POST','/api/upload?project='+encodeURIComponent($('project').value)+'&name='+encodeURIComponent(f.name));
 x.setRequestHeader('Authorization','Bearer '+TOKEN);
 $('prog').style.display='block';
 x.upload.onprogress=e=>{$('prog').value=100*e.loaded/e.total};
 x.onload=()=>{$('prog').style.display='none';refreshAssets();};
 x.send(f);};
let job=null,timer=null;
$('run').onclick=async()=>{const instr=$('instr').value.trim();if(!instr)return;
 const r=await api('/api/agent',{method:'POST',body:JSON.stringify({instruction:instr,project:$('project').value})});
 job=r.id;$('run').disabled=true;$('stop').style.display='';$('log').style.display='block';$('outs').innerHTML='';
 timer=setInterval(poll,3000);};
$('stop').onclick=()=>api('/api/job/'+job+'/stop',{method:'POST'});
async function poll(){const s=await api('/api/job/'+job);
 $('log').textContent=s.log;$('log').scrollTop=1e9;
 $('jstate').textContent=s.done?('finished'+(s.exit?` (exit ${s.exit})`:'')):('running '+s.seconds+'s');
 if(s.done){clearInterval(timer);$('run').disabled=false;$('stop').style.display='none';
  const P=encodeURIComponent($('project').value);
  $('outs').innerHTML=s.outputs.map(o=>{const u='/api/file?project='+P+'&p='+encodeURIComponent(o);
   const isVid=/\.(mp4|mov|webm)$/i.test(o);
   return `<div class="out">🎬 <a href="${u}&t=${TOKEN}" download>${o}</a>${isVid?`<br/><video controls preload="metadata" src="${u}"></video>`:''}</div>`;}).join('');
  // token-in-query not supported server-side; use fetch->blob for downloads
  document.querySelectorAll('#outs a').forEach(a=>{a.onclick=async e=>{e.preventDefault();
   const r=await fetch(a.href.split('&t=')[0],{headers:H});const b=await r.blob();
   const u=URL.createObjectURL(b);const l=document.createElement('a');l.href=u;l.download=a.textContent.split('/').pop();l.click();};});
  document.querySelectorAll('#outs video').forEach(async v=>{const r=await fetch(v.getAttribute('src'),{headers:H});v.src=URL.createObjectURL(await r.blob());});
 }}
</script></body></html>
EOWEB

# 6) PM2 service (env from .env)
set -a; . ./.env; set +a
pm2 delete divinecut 2>/dev/null || true
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" pm2 start server.js --name divinecut --time
pm2 save >/dev/null
sleep 2
TOKEN=$(cat .token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/health
echo
echo "════════════════════════════════════════════════"
echo "DivineCut Cloud is UP on the VPS (localhost:3010)"
echo "Access from your Mac:"
echo "  ssh -N -L 3010:localhost:3010 hostinger-vps  &"
echo "  open http://localhost:3010"
echo "Token (paste when the page asks): $TOKEN"
echo "════════════════════════════════════════════════"
