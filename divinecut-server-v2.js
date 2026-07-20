const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = '/opt/divinecut';
const TOKEN = fs.readFileSync(path.join(ROOT, '.token'), 'utf8').trim();
const PROJECTS = path.join(ROOT, 'projects');
const JOBS_DIR = path.join(ROOT, 'jobs');
const RULES = path.join(ROOT, 'QUALITY_RULES.md');
const PORT = 3010;
const MAX_FIX_CYCLES = 2;
const app = express();
const jobs = {};

const safe = s => String(s || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);

function projectDir(name) {
  const d = path.join(PROJECTS, safe(name) || 'default');
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(d, 'out'), { recursive: true });
  fs.mkdirSync(path.join(d, 'review'), { recursive: true });
  const link = path.join(d, '.claude');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, '.claude'), link);
  return d;
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
ffmpeg (NO drawtext/subtitles filter — burn text via PIL PNG overlays),
whisper (--model tiny.en on 16kHz mono wav), yt-dlp, python3.
Installed skills define methodology: cut-video, find-broll, clipify,
add-zooms, color-correct. FIRST read /opt/divinecut/QUALITY_RULES.md and
obey every rule in it. You are a ONE-SHOT process: never background long
steps or "schedule wakeups" — run whisper/ffmpeg in the FOREGROUND and wait.
Deliverables go in out/, intermediates in work/, never delete assets/.`;

function producerPrompt(instruction, pdir) {
  return `You are DivineCut's PRODUCER agent, cwd ${pdir}.
${COMMON}

Project assets:
${listAssets(pdir)}

USER INSTRUCTION:
${instruction}

Work to completion. When finished print one line per deliverable exactly as
OUTPUT: out/<file> plus a short summary. A REVIEWER agent will inspect your
work frame-by-frame afterward — sloppy geometry, stretch, missing grade or
captions WILL bounce back to you.`;
}

function reviewerPrompt(instruction, pdir) {
  return `You are DivineCut's REVIEWER agent — an adversarial QC editor, cwd ${pdir}.
${COMMON}

The producer just finished this user instruction:
${instruction}

Inspect EVERY file in out/ (ignore *_raw.*):
1. ffprobe each: resolution, SAR must be 1:1, duration sane, audio present.
2. For each video extract 3 frames (start/middle/end) into review/frames/
   and VIEW each one with the Read tool. Check: natural face proportions
   (no stretch), color grade applied (not flat camera-raw), captions
   present+readable+not covering the chin, no letterbox bars, no artifacts.
3. Check the auto-reject list in QUALITY_RULES.md line by line.
4. Write review/REVIEW.md: per-file table of checks + findings.
Your FINAL message must end with exactly one line:
VERDICT: PASS
or
VERDICT: FAIL
followed (on FAIL) by a numbered list of specific, fixable findings
(file, timestamp/frame, what is wrong, what correct looks like).
You never fix anything yourself. Be strict: a stretched face, missing
grade, or unreadable caption is always FAIL.`;
}

function fixerPrompt(instruction, findings, pdir) {
  return `You are DivineCut's FIXER agent, cwd ${pdir}.
${COMMON}

Original user instruction:
${instruction}

The REVIEWER failed the current out/ deliverables with these findings:
${findings}

Fix ONLY what the findings call out, reusing work/ intermediates (never redo
whisper or the proxy). Overwrite the files in out/. When finished print
OUTPUT: lines for every deliverable and note what you changed per finding.`;
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
      const fail = /VERDICT:\s*FAIL/i.test(rv.tail);
      job.verdicts.push(pass ? 'PASS' : fail ? 'FAIL' : 'UNCLEAR');
      if (pass) break;
      if (cycle === MAX_FIX_CYCLES) break;
      const findings = rv.tail.split(/VERDICT:\s*FAIL/i).pop().slice(0, 4000)
        || rv.tail.slice(-4000);
      job.phase = `fixing (round ${cycle + 1})`;
      await runClaude(job, `fix-${cycle + 1}`, fixerPrompt(instruction, findings, job.pdir));
    }
    job.phase = 'done';
  } catch (e) {
    job.phase = 'error';
    fs.appendFileSync(job.logPath, `\n[PIPELINE ERROR] ${e}\n`);
  } finally {
    job.done = true;
    fs.appendFileSync(job.logPath,
      `\n[JOB ${job.verdicts.includes('PASS') ? 'DONE — review PASSED' :
        'DONE — review did NOT pass (' + job.verdicts.join(',') + ')'}]\n`);
  }
}

app.use('/api', (req, res, next) => {
  if ((req.headers.authorization || '') === 'Bearer ' + TOKEN) return next();
  res.status(401).json({ error: 'bad token' });
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_q, r) => r.json({
  agent: true, pipeline: 'produce→review→fix (max ' + MAX_FIX_CYCLES + ' cycles)',
  skills: fs.readdirSync(path.join(ROOT, '.claude', 'skills')) }));

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
  res.json(fs.readdirSync(d).map(f => ({ name: f,
    size: fs.statSync(path.join(d, f)).size,
    mtime: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime));
});

app.post('/api/agent', (req, res) => {
  const { instruction, project } = req.body || {};
  if (!instruction) return res.status(400).json({ error: 'instruction required' });
  const pdir = projectDir(project);
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, pdir, phase: 'queued', verdicts: [], done: false,
    stopped: false, started: Date.now(),
    logPath: path.join(JOBS_DIR, id + '.log') };
  jobs[id] = job;
  runJob(job, instruction);
  res.json({ id });
});

app.get('/api/job/:id', (req, res) => {
  const j = jobs[req.params.id];
  const lp = path.join(JOBS_DIR, safe(req.params.id) + '.log');
  if (!j && !fs.existsSync(lp)) return res.status(404).json({ error: 'unknown job' });
  const logText = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : '';
  res.json({ done: j ? j.done : true,
    phase: j ? j.phase : 'done',
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
  fs.appendFileSync(RULES,
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
  console.log(`DivineCut Cloud v2 (produce→review→fix) on 127.0.0.1:${PORT}`));
