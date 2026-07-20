# DivineCut Quality Rules — every agent reads this first

## Geometry (violations are automatic FAIL)
- NEVER change the aspect ratio of any pixel. Stretching a face is the worst
  possible failure.
- 9:16 from a 16:9 source: crop a 608x1080 face-centered window, then uniform
  scale to 1080x1920 (aspect preserved, full-bleed). NO square-crop-stretch,
  NO letterbox bars unless the user asks.
- Verify SAR=1:1 with ffprobe on every deliverable.
- Face position: eyes in the top third, chin never touching caption zone.

## Color grade (default ON for every deliverable)
- Clean modern podcast grade: eq=contrast=1.06:saturation=1.18:brightness=0.01
  plus slight teal shadows / warm midtones (colorbalance or curves).
- Subtle — if it looks like an Instagram filter, dial back 50%.
- Skip only if the user explicitly says "no grading".

## Captions
- Word-timed groups of <=6 words, <=3.2s per card, 0.05s lead-in.
- Lower-third dark translucent pill, bold white text, never covering the chin.
- Rendered as PIL PNG overlays (this ffmpeg has NO drawtext/subtitles filter).

## Transitions & pacing
- 0.25s fade-in from black + 0.25s fade-out (video AND audio) on every clip.
- Sub-segments inside a clip join with clean hard cuts; no flash frames,
  no <1s slivers of talking head between cutaways (connect them).

## Audio
- -14 LUFS target loudness (loudnorm), no clipped peaks, AAC 192k.

## Auto-reject checklist (reviewer walks this line by line)
1. Stretched or squashed faces (compare eye-width to face-height ratio)
2. Burned-in captions/watermarks from the source
3. Flat ungraded footage when grading was expected
4. Missing or unreadable captions; captions covering mouth/chin
5. Letterboxing or blur-edge framing errors nobody asked for
6. Silent video track or missing audio
7. Black/frozen frames at start or end (beyond the intentional fade)
8. Wrong resolution or SAR != 1:1

## Performance discipline
- 4K/HEVC/>500MB source -> make a 1080p proxy FIRST, work from it.
- whisper: --model tiny.en on 16kHz mono wav extracted from the proxy.
- Long steps run in the FOREGROUND — never backgrounded, never "wakeups".
- First failure -> switch method; second failure -> flag and move on.

## User taste feedback (appended over time — obey like law)
