# Ad Studio — AI Storyboard Ad Builder

Build AI video ads like a director: one short controlled shot at a time.

This system is installed from [Samin12/ai-storyboard-video-starter](https://github.com/Samin12/ai-storyboard-video-starter)
and wired into this repo as a Claude skill (`.claude/skills/ad-builder/`) so you can say things like:

> "Create a Claymation ad for a dental service in Brooklyn called Brooklyn Smiles.
> Someone goes to the dentist, they're scared, voiceover on it, about 50 seconds.
> Use Higgsfield MCP with the Seedance model and stitch the whole thing together."

…and Claude runs the full pipeline below.

## The Method

Instead of asking an AI video model for one long video:

1. Write a creative brief.
2. Collect references (logo, product, character, style).
3. Break the ad into short shots.
4. Generate the first and last frame of each shot (storyboard frames).
5. Generate short video clips between those locked frames.
6. Generate the voiceover / music.
7. Stitch clips + audio together with ffmpeg.

## Folder Map

```text
ad-studio/
  templates/
    project-template/     copy this to start a new ad project
    prompt-cards/         reusable prompts for briefs, image prompts, video prompts, stitching
  tools/
    create-project.sh     ./tools/create-project.sh my-ad-name  -> creates projects/my-ad-name
  docs/                   workflow, approval gates, reference types, stitching notes
  projects/               your ad projects live here (one folder per ad)
  final-outputs/          finished ads, easy to find
```

Every project uses numbered steps `01-creative-brief` through `09-final-output`.

## The One Rule

Every step has three folders:

```text
attempts/      rough drafts go here
approved/      locked files go here
disapproved/   rejected files go here
```

Only build the next step from files in `approved/`. That is how the project stays consistent.

## Quick Start

```bash
cd ad-studio
./tools/create-project.sh brooklyn-smiles-claymation
```

Then ask Claude to run the ad-builder skill for that project, or just describe
the ad you want — the skill handles project creation too.

## Generation Tools

The process is tool-agnostic, but this repo is wired for **Higgsfield MCP**:

- Storyboard frames: `generate_image` (use reference images for identity/product locks)
- Shot clips: `generate_video` (Seedance or whichever model `models_explore` recommends), first/last frame as anchors
- Voiceover & music: `generate_audio` / `create_voice`
- Stitching: `ffmpeg` (concat, crossfades, audio mix)
