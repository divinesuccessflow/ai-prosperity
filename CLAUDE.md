# ai-prosperity

## Ad Studio (AI video ads)

`ad-studio/` contains a storyboard-based AI ad building system (installed from
Samin12/ai-storyboard-video-starter). When the user asks to create an ad, commercial, or
promo video, use the `ad-builder` skill (`.claude/skills/ad-builder/SKILL.md`). Ad projects
live in `ad-studio/projects/`, one numbered-step folder per ad; finished videos go in
`ad-studio/final-outputs/`. Video/image/audio generation runs through Higgsfield MCP;
stitching uses ffmpeg.
