---
name: ad-builder
description: >
  Build complete AI video ads (Claymation, cinematic, UGC, product, story style) using the
  ad-studio storyboard pipeline and Higgsfield MCP. Use whenever the user asks to create an
  ad, commercial, promo video, or brand video — e.g. "create a Claymation ad for Brooklyn
  Smiles", "make a 50-second ad with a voiceover", "build an ad for my product". Also trigger
  on "ad-builder", "storyboard video", "ad studio", or any request to turn a business +
  concept into a finished stitched video with voiceover.
---

# Ad Builder

Turn an ad request (business + concept + style + length) into a finished, stitched video ad
with voiceover, using the storyboard method in `ad-studio/`.

## Core Principle

Never generate one long video. Build the ad as a chain of short 5–10 second shots, each
anchored by an approved first frame and last frame, then stitch. Only ever build the next
step from files in `approved/`.

## Before Starting

1. Confirm you have from the user (ask only for what's missing):
   - Business/product name and what it is
   - Ad concept or storyline (if absent, draft one and get approval)
   - Visual style (Claymation, cinematic, UGC, cartoon, etc.)
   - Target length (default 30–50 seconds → 5–8 shots of ~6s)
   - Voiceover: yes/no, tone, and rough script direction
2. Ask: "Do you want approval at every step, or autopilot (I only stop if something is
   risky or unclear)?" Default to autopilot if the user already gave a complete brief.
3. Create the project:
   ```bash
   cd ad-studio && ./tools/create-project.sh <ad-slug>
   ```
   All work happens inside `ad-studio/projects/<ad-slug>/`.

## Pipeline (steps map to the numbered project folders)

### 1. Creative brief → `01-creative-brief/`
Write the brief using `ad-studio/templates/prompt-cards/creative-brief-builder.md`:
premise, emotional arc (e.g. fear → relief → smile for a dental ad), style, length,
voiceover direction, brand facts (name, location, tagline, CTA). Save to `approved/brief.md`.

### 2. References → `02-references/`
Collect or generate anything that must stay consistent: character design, mascot, logo,
setting, product. For stylized ads (Claymation etc.) generate a character/style reference
image first with Higgsfield `generate_image` and lock it here — every later frame prompt
references it.

### 3. Shot list → `03-shot-list/`
Break the storyline into shots (~6s each; a 50s ad ≈ 7–8 shots). For each shot define the
first frame and last frame in one line: `Shot 03: F3 patient in chair, tense -> F4 dentist
smiling, patient relaxed`. Save to `approved/shot-list.md`.

### 4. Image prompts → `04-image-prompts/`
Using `templates/prompt-cards/image-prompt-builder.md`, write a prompt for the first and
last frame of every shot. Start each with a shared style block (e.g. "Claymation stop-motion
style, handcrafted plasticine characters, soft studio lighting…") plus continuity locks
(same character, same outfit, same set, same logo). One file per frame in `approved/`.

### 5. Storyboard frames → `05-storyboard-frames/`
Generate every frame with Higgsfield `generate_image` (pass reference images for identity).
Drafts go in `attempts/`, selected frames in `approved/frames/`, and per-shot anchor pairs in
`approved/shots/shot-NN-name/first-frame.png` + `last-frame.png`. Adjacent shots share a
frame: shot N's last frame is shot N+1's first frame. Do not approve frames that look
"almost right" — they get worse in video.

### 6. Video prompts → `06-video-prompts/`
Using `templates/prompt-cards/video-prompt-builder.md`, write one prompt per shot: motion
description, camera move, duration, and "keep the same character/set/props, end exactly on
the last frame." One file per shot in `approved/`.

### 7. Transition videos → `07-transition-videos/`
Generate each shot with Higgsfield `generate_video` using first-frame + last-frame as
anchors. Use the Seedance model (or call `models_explore(action:'recommend')` to pick the
best model for the style). Review each clip: does it move correctly from first to last frame
without drift? Approved clips go in `approved/` as `shot-NN-name.mp4`.

### 8. Voiceover & stitching → `08-stitching/`
- Write the voiceover script timed to the shots; generate it with Higgsfield
  `generate_audio` (or `create_voice` for a custom voice). Add music if requested.
- Stitch with ffmpeg:
  ```bash
  ffmpeg -f concat -safe 0 -i concat-list.txt -c copy stitched.mp4
  ffmpeg -i stitched.mp4 -i voiceover.mp3 -c:v copy -map 0:v -map 1:a -shortest final.mp4
  ```
- Fix rough seams: trim dead frames, tiny zoom, short crossfade, or cut on motion blur.
  Save stitching notes to `approved/stitching-notes.md`.

### 9. Final output → `09-final-output/`
Export `final-video.mp4`, copy it to `ad-studio/final-outputs/<ad-slug>.mp4`, and send it to
the user with SendUserFile. Summarize: shots, length, model used, and where every asset lives.

## Rules

- Drafts → `attempts/`, locked → `approved/`, rejected → `disapproved/` (keep them; they
  show what to avoid).
- In approval mode, ask the step's approval question before moving on (see
  `ad-studio/docs/approval-gates.md`).
- If Higgsfield MCP tools aren't loaded, load them with ToolSearch first. If Higgsfield is
  unavailable, still produce steps 1–4 (brief, references list, shot list, all prompts) so
  the user can generate elsewhere, and say so plainly.
