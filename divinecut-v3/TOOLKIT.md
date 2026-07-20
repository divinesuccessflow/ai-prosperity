# DivineCut Toolkit — tested primitives. USE THESE, don't improvise ffmpeg.

All at /opt/divinecut/toolkit/, run with the venv python:
`PY=/opt/divinecut/venv/bin/python3` (has PIL + google api libs).
System python3 works for scripts without PIL.

| Task | Command |
|---|---|
| Voice enhancement (denoise→de-ess→compress→-14LUFS) | `$PY toolkit/enhance_audio.py --in raw.mp4 --out clean.mp4 [--strength light\|normal\|strong]` |
| Music bed with auto-ducking | `$PY toolkit/music_duck.py --video clip.mp4 --music /opt/divinecut/music/<bed>.mp3 --out mixed.mp4` |
| Burn captions + export SRT/VTT | `$PY toolkit/captions.py --video clip.mp4 --words words.json --out capped.mp4 --style bold\|karaoke\|minimal\|brand --srt clip.srt` |
| Cut window → 9:16/1:1/16:9, graded, faded | `$PY toolkit/multi_aspect.py --video proxy.mp4 --start S --end E --face-x X --out-base out/clip1 --formats 9x16,1x1 --grade` |
| Rank best reel moments by hook strength | `$PY toolkit/virality_rank.py --whisper-json audio.json --window 45 --top 8` |
| Pick thumbnail frames | `$PY toolkit/thumb_pick.py --video out/clip1_9x16.mp4 --out-dir out/thumbs` |
| Publish to YouTube (token required in tokens/) | `$PY toolkit/publish_youtube.py --token tokens/<ch>.json --video out/clip.mp4 --title "..."` |

## Standard reel pipeline (the "podcast-reel-pack" preset)
1. Proxy if big: `ffmpeg -y -i src -vf scale=1920:-2 -c:v libx264 -preset fast -crf 20 -c:a aac work/proxy_1080p.mp4`
2. `ffmpeg -i work/proxy_1080p.mp4 -vn -ac 1 -ar 16000 work/audio.wav`
3. `whisper work/audio.wav --model tiny.en --word_timestamps True --output_format json --output_dir work/` (FOREGROUND — takes 20-40min on 2h video)
4. `$PY toolkit/enhance_audio.py --in work/proxy_1080p.mp4 --out work/proxy_clean.mp4`
5. `$PY toolkit/virality_rank.py --whisper-json work/audio.json --top 8` → read the
   hooks, sanity-check against the transcript, choose the N best non-overlapping.
6. Per clip: find face-x (extract 1 frame, view it, estimate face center x),
   then `$PY toolkit/multi_aspect.py --video work/proxy_clean.mp4 --start S --end E --face-x X --out-base out/clipN --formats 9x16 --grade`
7. Per-clip words: slice audio.json words to [S,E], shift by -S, save clipN_words.json,
   then `$PY toolkit/captions.py --video out/clipN_9x16.mp4 --words clipN_words.json --out out/clipN.mp4 --style bold --srt out/clipN.srt` and delete the uncaptioned intermediate.
8. `$PY toolkit/thumb_pick.py --video out/clip1.mp4 --out-dir out/thumbs`
9. Write out/TITLES.md: per clip — 2 title options, 1-line description, 8 hashtags.

## Tightening (cut-video skill) and b-roll (find-broll skill)
Follow the skills. Timing from whisper words + silencedetect (NO conda/MFA).
B-roll taste profile: /opt/divinecut/TASTE.md — obey its bans absolutely.

## Music library
/opt/divinecut/music/ — royalty-free beds. If empty and the user asked for
music, say so in the summary instead of sourcing random copyrighted audio.
