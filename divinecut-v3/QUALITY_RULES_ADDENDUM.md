
## v3 additions (toolkit era)

### Toolkit mandate
- For enhancement, captions, multi-aspect cuts, ranking, thumbnails and
  publishing, USE /opt/divinecut/toolkit/* (see TOOLKIT.md). Hand-rolled
  ffmpeg for these jobs is a review finding unless the toolkit genuinely
  cannot do it (say why in the summary).

### Audio (default ON for every deliverable)
- Voice chain via toolkit/enhance_audio.py (denoise → de-ess → compress →
  loudnorm -14 LUFS). Reviewer spot-checks loudness.
- Music beds only from /opt/divinecut/music/ via music_duck.py — never
  sourced from random copyrighted uploads.

### Deliverable completeness
- Reel/short jobs ship per clip: the .mp4, a .srt, and (when the preset asks)
  thumbnails + TITLES.md entries. A missing promised file = FAIL.

### Versioning
- The server archives previous out/ into versions/<timestamp>/ at each new
  job. Never write into versions/ yourself; never delete it.

### Moment selection
- Use toolkit/virality_rank.py for candidates, then JUDGE against the
  transcript (rank ≠ decision). A clip must be self-contained: no dangling
  "as I said earlier", no mid-sentence start.
