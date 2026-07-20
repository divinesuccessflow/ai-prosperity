const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ROOT = '/opt/divinecut';
const TOKEN = fs.readFileSync(path.join(ROOT, '.token'), 'utf8').trim();
const PROJECTS = path.join(ROOT, 'projects');
const JOBS_DIR = path.join(ROOT, 'jobs');
const INBOX = path.join(ROOT, 'inbox');
const PORT = 3010;
const MAX_FIX_CYCLES = 2;
const app = express();
const jobs = {};

for (const d of [PROJECTS, JOBS_DIR, INBOX, path.join(ROOT, 'music'),
                 path.join(ROOT, 'tokens'), path.join(ROOT, 'fonts')])
  fs.mkdirSync(d, { recursive: true });

const safe = s => String(s || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);

function loadPresets() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'PRESETS.json'), 'utf8')); }
  catch { return {}; }
}

function telegram(text) {
  let cfg;
  try {
    cfg = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.telegram'), 'utf8')
      .split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2)));
  } catch { return; }
  if (!cfg.TELEGRAM_BOT || !cfg.TELEGRAM_CHAT) return;
  const body = JSON.stringify({ chat_id: cfg.TELEGRAM_CHAT,
    text: text.slice(0, 4000), disable_web_page_preview: true });
  execFile('curl', ['-s', '-m', '15', '-X', 'POST',
    `https://api.telegram.org/bot${cfg.TELEGRAM_BOT}/sendMessage`,
    '-H', 'Content-Type: application/json', '-d', body], () => {});
}

function projectDir(name) {
  const d = path.join(PROJECTS, safe(name) || 'default');
  for (const s of ['assets', 'out', 'review', 'versions'])
    fs.mkdirSync(path.join(d, s), { recursive: true });
  const link = path.join(d, '.claude');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, '.claude'), link);
  return d;
}

function archiveOutputs(pdir) {
  const out = path.join(pdir, 'out');
  const files = fs.readdirSync(out).filter(f => !f.startsWith('.'));
  if (!files.length) return;
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const dest = path.join(pdir, 'versions', ts);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.renameSync(path.join(out, f), path.join(dest, f));
}

function listAssets(pdir) {
  return fs.readdirSync(path.join(pdir, 'assets'))
    .map(f => `- assets/${f} (${(fs.statSync(path.join(pdir, 'assets', f)).size / 1e6).toFixed(1)} MB)`)
    .join('\n') || '(none)';
}

function runClaude(job, phase, prompt) {
  return new Promise(resolve => {
    const log = fs.createWriteStream(job.logPath, { flags: 'a' });
    log.write(`\n\n═══════ PHASE: ${phase.toUpperCase()} (${new Date().toISOString()}) ═══════\n`);
    let tail = '';
    const proc = spawn('claude', ['-p', prompt, '--max-turns', '300',
      '--allowedTools', 'Bash Read Write Edit Glob Grep WebFetch WebSearch',
      '--add-dir', ROOT], {
      cwd: job.pdir,
      env: { ...process.env,
        PATH: `/opt/divinecut/venv/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
    });
    job.proc = proc;
    proc.stdout.on('data', d => { tail = (tail + d).slice(-12000); log.write(d); });
    proc.stderr.on('data', d => log.write(d));
    proc.on('close', code => { log.end(); resolve({ code, tail }); });
  });
}

const COMMON = `You have full shell access on a Linux VPS (8 cores, no GPU):
ffmpeg (NO drawtext/subtitles filter), whisper, yt-dlp, python3, and the
venv python /opt/divinecut/venv/bin/python3 (has PIL + google api client).
FIRST read /opt/divinecut/QUALITY_RULES.md, THEN /opt/divinecut/TOOLKIT.md —
the toolkit scripts are tested primitives; USE them instead of improvising
(enhance_audio, music_duck, captions, multi_aspect, virality_rank,
thumb_pick, publish_youtube). Skills installed: cut-video, find-broll
(taste profile /opt/divinecut/TASTE.md), clipify, add-zooms, color-correct.
You are a ONE-SHOT process: never background long steps or schedule wakeups —
run whisper/ffmpeg in the FOREGROUND and wait. Deliverables in out/,
intermediates in work/, never delete assets/.`;

function producerPrompt(instruction, pdir) {
  return `You are DivineCut's PRODUCER agent, cwd ${pdir}.
${COMMON}

Project assets:
${listAssets(pdir)}

USER INSTRUCTION:
${instruction}

Work to completion. When finished print one line per deliverable exactly as
OUTPUT: out/<file> plus a short summary. An adversarial REVIEWER will inspect
frames of your work — stretch, missing grade/captions/fades, or missing
promised deliverables (srt, thumbs, TITLES.md) WILL bounce back to you.`;
}

function reviewerPrompt(instruction, pdir) {
  return `You are DivineCut's REVIEWER agent — adversarial QC, cwd ${pdir}.
${COMMON}

The producer just finished this instruction:
${instruction}

Review:
1. Completeness — list every deliverable the instruction promises (clips,
   srt/vtt, thumbnails, TITLES.md, formats). Missing item = FAIL.
2. ffprobe every video in out/ (ignore versions/): SAR must be 1:1,
   resolution correct for the format, audio present, duration sane.
3. Extract 3 frames (start/middle/end) of each video into review/frames/ and
   VIEW each with Read: natural face proportions (NO stretch), grade applied,
   captions readable and not covering the chin, fades present at start/end.
4. Audio spot-check: measure integrated loudness of one clip
   (ffmpeg loudnorm print_format or astats) — should be near -14 LUFS.
5. Walk QUALITY_RULES.md auto-reject list line by line.
6. Write review/REVIEW.md with a per-file check table.
End your FINAL message with exactly:
VERDICT: PASS
or VERDICT: FAIL followed by numbered, specific, fixable findings.
Never fix anything yourself. Be strict.`;
}

function fixerPrompt(instruction, findings, pdir) {
  return `You are DivineCut's FIXER agent, cwd ${pdir}.
${COMMON}

Original instruction:
${instruction}

REVIEWER findings to fix (fix ONLY these, reuse work/ intermediates, never
redo whisper or the proxy):
${findings}

Overwrite the files in out/. When finished print OUTPUT: lines for every
deliverable and what changed per finding.`;
}

async function runJob(job, instruction) {
  try {
    job.phase = 'producing';
    await runClaude(job, 'produce', producerPrompt(instruction, job.pdir));
    for (let cycle = 0; cycle <= MAX_FIX_CYCLES; cycle++) {
      if (job.stopped) break;
      job.phase = `reviewing (round ${cycle + 1})`;
      const rv = await runClaude(job, `review-${cycle + 1}`, reviewerPrompt(instruction, job.pdir));
      const pass = /VERDICT:\s*PASS/i.test(rv.tail);
      job.verdicts.push(pass ? 'PASS' : /VERDICT:\s*FAIL/i.test(rv.tail) ? 'FAIL' : 'UNCLEAR');
      if (pass) break;
      if (cycle === MAX_FIX_CYCLES) break;
      const findings = (rv.tail.split(/VERDICT:\s*FAIL/i).pop() || rv.tail).slice(0, 4000);
      job.phase = `fixing (round ${cycle + 1})`;
      await runClaude(job, `fix-${cycle + 1}`, fixerPrompt(instruction, findings, job.pdir));
    }
    job.phase = 'done';
  } catch (e) {
    job.phase = 'error';
    fs.appendFileSync(job.logPath, `\n[PIPELINE ERROR] ${e}\n`);
  } finally {
    job.done = true;
    const passed = job.verdicts.includes('PASS');
    fs.appendFileSync(job.logPath, `\n[JOB DONE — review ${passed ? 'PASSED' : 'NOT PASSED (' + job.verdicts.join(',') + ')'}]\n`);
    const logText = fs.readFileSync(job.logPath, 'utf8');
    const outs = [...logText.matchAll(/^OUTPUT:\s*(\S+)/gm)].map(m => m[1])
      .filter((v, i, a) => a.indexOf(v) === i);
    telegram(`🎬 DivineCut job ${job.id} finished — review ${passed ? '✅ PASSED' : '⚠️ ' + job.verdicts.join(',')}\nProject: ${path.basename(job.pdir)}\n` +
      (outs.length ? 'Files:\n' + outs.map(o => '• ' + o).join('\n') : 'No OUTPUT lines — check the log.') +
      `\nConsole: http://localhost:3010 (tunnel)`);
  }
}

function startJob(project, instruction) {
  const pdir = projectDir(project);
  archiveOutputs(pdir);
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, pdir, phase: 'queued', verdicts: [], done: false,
    stopped: false, started: Date.now(),
    logPath: path.join(JOBS_DIR, id + '.log') };
  jobs[id] = job;
  runJob(job, instruction);
  return id;
}

// ── Watch folder: drop a video into /opt/divinecut/inbox → auto reel pack ──
const inboxSizes = {};
setInterval(() => {
  try {
    for (const f of fs.readdirSync(INBOX)) {
      if (!/\.(mp4|mov|mkv|webm|m4v)$/i.test(f)) continue;
      const p = path.join(INBOX, f);
      const size = fs.statSync(p).size;
      if (inboxSizes[f] === size) {           // settled since last tick
        const proj = 'inbox-' + safe(f).replace(/\.[^.]+$/, '').slice(0, 40);
        const pdir = projectDir(proj);
        fs.renameSync(p, path.join(pdir, 'assets', safe(f)));
        delete inboxSizes[f];
        const preset = loadPresets()['podcast-reel-pack'];
        if (preset) {
          const id = startJob(proj, preset.instruction);
          telegram(`📥 DivineCut watch-folder picked up ${f} → project ${proj}, job ${id} (podcast-reel-pack)`);
        }
      } else inboxSizes[f] = size;
    }
  } catch { /* inbox scan is best-effort */ }
}, 30000);

app.use('/api', (req, res, next) => {
  if ((req.headers.authorization || '') === 'Bearer ' + TOKEN) return next();
  res.status(401).json({ error: 'bad token' });
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_q, r) => r.json({
  agent: true, pipeline: `produce→review→fix (≤${MAX_FIX_CYCLES} fix cycles)`,
  presets: Object.keys(loadPresets()),
  telegram: fs.existsSync(path.join(ROOT, '.env.telegram')),
  skills: fs.readdirSync(path.join(ROOT, '.claude', 'skills')) }));

app.get('/api/presets', (_q, r) => r.json(loadPresets()));

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

app.get('/api/outputs', (req, res) => {
  const d = path.join(projectDir(req.query.project), 'out');
  res.json(fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isFile())
    .map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size,
                 mtime: fs.statSync(path.join(d, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime));
});

app.get('/api/versions', (req, res) => {
  const d = path.join(projectDir(req.query.project), 'versions');
  res.json(fs.readdirSync(d).sort().reverse().map(v => ({
    version: v, files: fs.readdirSync(path.join(d, v)) })));
});

app.post('/api/agent', (req, res) => {
  const { instruction, preset, project } = req.body || {};
  let instr = instruction;
  if (preset) {
    const p = loadPresets()[preset];
    if (!p) return res.status(400).json({ error: 'unknown preset' });
    instr = p.instruction + (instruction ? `\nAdditional user notes: ${instruction}` : '');
  }
  if (!instr) return res.status(400).json({ error: 'instruction or preset required' });
  res.json({ id: startJob(project, instr) });
});

app.get('/api/job/:id', (req, res) => {
  const j = jobs[req.params.id];
  const lp = path.join(JOBS_DIR, safe(req.params.id) + '.log');
  if (!j && !fs.existsSync(lp)) return res.status(404).json({ error: 'unknown job' });
  const logText = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : '';
  res.json({ done: j ? j.done : true, phase: j ? j.phase : 'done',
    verdicts: j ? j.verdicts : [],
    seconds: j ? Math.round((Date.now() - j.started) / 1000) : null,
    log: logText.slice(-5000),
    outputs: [...logText.matchAll(/^OUTPUT:\s*(\S+)/gm)].map(m => m[1])
      .filter((v, i, a) => a.indexOf(v) === i) });
});

app.post('/api/job/:id/stop', (req, res) => {
  const j = jobs[req.params.id];
  if (j && !j.done) { j.stopped = true; if (j.proc) j.proc.kill('SIGTERM');
    return res.json({ ok: true }); }
  res.json({ ok: false });
});

app.post('/api/feedback', (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  fs.appendFileSync(path.join(ROOT, 'QUALITY_RULES.md'),
    `\n- [user feedback ${new Date().toISOString().slice(0, 10)}] ${String(text).slice(0, 500)}`);
  res.json({ ok: true });
});

app.get('/api/file', (req, res) => {
  const p = path.resolve(PROJECTS, safe(req.query.project) || 'default',
    String(req.query.p || ''));
  if (!p.startsWith(PROJECTS) || !fs.existsSync(p) || fs.statSync(p).isDirectory())
    return res.status(404).end();
  res.sendFile(p);
});

app.use(express.static(path.join(ROOT, 'web')));
app.listen(PORT, '127.0.0.1', () =>
  console.log(`DivineCut Cloud v3 on 127.0.0.1:${PORT}`));
