# RESUME — DivineCut + session state (saved 2026-07-20)

## ⏭️ NEXT ACTIONS (in order)
1. **Deploy DivineCut v3** (user runs): `bash ~/.openclaw/workspace/ai-prosperity/divinecut-v3/deploy.sh`
   — installs toolkit, presets, watch-folder, Telegram delivery, versioning; runs VPS smoke tests.
2. **Redispatch the stretch-fix re-render** (as v3 job, project `default`): the 5 reels
   out/clip1-5.mp4 are STRETCHED (square crop scaled to 9:16). Previous fix job
   877ed84600ed died on omega Cloudflare 524 (retryable). Under v3 use
   multi_aspect.py geometry; reviewer will frame-check.
3. **DT platform keys**: /opt/divine-ai/KEYS.registry Anthropic/OpusMax/ClaudeOpus keys
   ALL EXPIRED (7/2–7/17) → production agents likely failing model calls. Offered fix:
   put the working omega key into registry + run sync-keys.sh — AWAITING user go.
4. Optional: clear ~5GB intermediates in VPS projects/default/work/ once clips approved.

## DivineCut Cloud (VPS /opt/divinecut, PM2 `divinecut`, 127.0.0.1:3010)
- Access: `ssh -N -L 3010:localhost:3010 hostinger-vps &` → http://localhost:3010
- Token: `ssh hostinger-vps "cat /opt/divinecut/.token"` (console asks once)
- Model: Opus 4.8, ANTHROPIC_BASE_URL=https://omega.kesarcloud.in (BARE, no /v1),
  env in /opt/divinecut/.env (key user-supplied in-session 2026-07-19)
- v2 live: produce → adversarial review (frame inspection, VERDICT) → fix (≤2 cycles),
  QUALITY_RULES.md rulebook + feedback endpoint, outputs browser, --max-turns 300,
  foreground-only rule (one-shot claude -p kills backgrounded whisper)
- v3 built+tested locally in divinecut-v3/ (toolkit 7 scripts, PRESETS.json,
  TOOLKIT.md pipeline, TASTE.md b-roll profile, brand_kit.json, server.js v3
  with watch-folder /opt/divinecut/inbox, Telegram notify via .env.telegram
  auto-discovery, versions/ archiving) — NOT yet deployed.
- Proven run: 684MB 2h Zoom → 5 reels (project `default`); copies at
  ~/Downloads/divinecut-clips/ on Mac. Known quirks: ffmpeg 6.1.1 no drawtext/
  gboxblur; whisper tiny.en ~1.5h for 2h video on 8 cores.

## Mac local editor
- ai-prosperity repo ~/.openclaw/workspace/ai-prosperity, served by LaunchAgent
  com.divinesuccessflow.ai-prosperity on localhost:3000 (KeepAlive+RunAtLoad).
- Reference skills cloned at ~/.openclaw/workspace/{b-roll-finder,cut-video}.

## Factory fleet (all cron-driven, survives restart; tabs do NOT)
- 8 Mac factories + Forge (711 blueprints, 10/day shift 12:00 IST, vault
  catalog.json 20 assets as of 7/19) + comedy (Divine Roast Report, 11:30 IST,
  2 episodes live) — details in memory divine-factory-fleet.
- After restart relaunch resident tabs: `bash ~/.openclaw/workspace/factories/launch_tabs.sh`
  (AppleWindowTabbingMode=always is set → new windows open as tabs) + one tab each
  for comedy/ and forge/ (cd + claude "Read AGENT.md…").
- 2026-07-19 morning failures were expired CLI auth (fixed by /login); consider
  auth-failure Telegram alert in factorylib.ask_claude (proposed, not built).

## Credentials map (locations only)
- Comedy YouTube: factories/comedy/tokens/comedy.json (+ client_secret.json, divine-roast-report GCP project)
- Music/Slokas YouTube: faceless-factory/music/tokens/*.json
- DivineCut: /opt/divinecut/.env + .token (+ optional .env.telegram)
- DT platform: /opt/divine-ai/KEYS.registry (EXPIRED — see next actions)

## Restart checklist
1. `dsf` alias → VPS health + claude --resume
2. `bash ~/.openclaw/workspace/factories/launch_tabs.sh` → factory tabs
3. Tunnel + open DivineCut console if editing video
4. Continue NEXT ACTIONS above.
