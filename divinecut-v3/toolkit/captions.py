#!/usr/bin/env python3
"""Word-timed caption burner + SRT/VTT export, with style presets.

    python3 captions.py --video in.mp4 --words words.json --out captioned.mp4 \
        [--style bold|karaoke|minimal|brand] [--srt out.srt] [--vtt out.vtt]

words.json = [{"word": "Hello", "start": 0.31, "end": 0.52}, ...]
(whisper --word_timestamps True json: use segments[].words; this script also
accepts a raw whisper json and flattens it.)

Styles:
  bold    — Hormozi-style: big bold white, dark pill, current card only
  karaoke — Opus-style: card shown, current WORD highlighted yellow
  minimal — small clean lower-third, no pill
  brand   — like bold but colors/font from /opt/divinecut/brand_kit.json

This ffmpeg has NO drawtext/subtitles filter — cards are PIL PNGs composited
with overlay+enable. Karaoke renders one PNG per word-state (still cheap for
<=60s clips; for long videos prefer style bold).
"""
import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = next((p for p in [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf"] if os.path.exists(p)), None)

MAX_WORDS, MAX_SECS, LEAD_IN = 6, 3.2, 0.05


def load_words(path):
    d = json.load(open(path))
    if isinstance(d, dict) and "segments" in d:
        w = [dict(word=x["word"].strip(), start=x["start"], end=x["end"])
             for s in d["segments"] for x in s.get("words", [])]
    else:
        w = d
    return [x for x in w if x["word"]]


def group(words):
    cards, cur = [], []
    for w in words:
        if cur and (len(cur) >= MAX_WORDS or w["end"] - cur[0]["start"] > MAX_SECS
                    or w["start"] - cur[-1]["end"] > 1.0):
            cards.append(cur)
            cur = []
        cur.append(w)
    if cur:
        cards.append(cur)
    return cards


def style_conf(name):
    conf = dict(size=64, fill=(255, 255, 255), hi=(255, 210, 60), pill=(0, 0, 0, 175),
                pad=26, ypos=0.78, font=FONT_BOLD)
    if name == "minimal":
        conf.update(size=44, pill=(0, 0, 0, 0), ypos=0.84)
    if name == "brand":
        try:
            bk = json.load(open("/opt/divinecut/brand_kit.json"))
            conf["fill"] = tuple(bk.get("caption_color", [255, 255, 255]))
            conf["hi"] = tuple(bk.get("highlight_color", [255, 210, 60]))
            if os.path.exists(bk.get("font_bold", "")):
                conf["font"] = bk["font_bold"]
        except Exception:
            pass
    return conf


def render_png(text_words, hi_index, conf, vw, path):
    font = ImageFont.truetype(conf["font"], conf["size"])
    probe = Image.new("RGBA", (8, 8))
    dr = ImageDraw.Draw(probe)
    words = [w["word"] for w in text_words]
    # wrap into <=2 lines fitting 86% of width
    maxw = int(vw * 0.86)
    lines, cur = [], []
    for i, w in enumerate(words):
        trial = " ".join([x for x in cur + [w]])
        if cur and dr.textlength(trial, font=font) > maxw:
            lines.append(cur)
            cur = []
        cur.append(w)
    lines.append(cur)
    line_h = conf["size"] + 14
    W = min(vw, maxw + 2 * conf["pad"])
    H = line_h * len(lines) + 2 * conf["pad"]
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if conf["pill"][3] > 0:
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=18, fill=conf["pill"])
    idx = 0
    y = conf["pad"]
    for line in lines:
        line_text = " ".join(line)
        x = (W - d.textlength(line_text, font=font)) / 2
        for w in line:
            color = conf["hi"] if idx == hi_index else conf["fill"]
            d.text((x + 2, y + 2), w, font=font, fill=(0, 0, 0, 220))
            d.text((x, y), w, font=font, fill=color)
            x += d.textlength(w + " ", font=font)
            idx += 1
        y += line_h
    img.save(path)
    return W, H


def fmt_ts(t, vtt=False):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    sep = "." if vtt else ","
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def write_subs(cards, srt, vtt):
    if srt:
        with open(srt, "w") as f:
            for i, c in enumerate(cards, 1):
                f.write(f"{i}\n{fmt_ts(c[0]['start'])} --> {fmt_ts(c[-1]['end'])}\n"
                        f"{' '.join(w['word'] for w in c)}\n\n")
    if vtt:
        with open(vtt, "w") as f:
            f.write("WEBVTT\n\n")
            for c in cards:
                f.write(f"{fmt_ts(c[0]['start'], 1)} --> {fmt_ts(c[-1]['end'], 1)}\n"
                        f"{' '.join(w['word'] for w in c)}\n\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--words", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--style", default="bold",
                    choices=["bold", "karaoke", "minimal", "brand"])
    ap.add_argument("--srt")
    ap.add_argument("--vtt")
    a = ap.parse_args()

    r = subprocess.run(["ffprobe", "-v", "quiet", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height", "-of", "csv=p=0",
                        a.video], capture_output=True, text=True, check=True)
    vw, vh = map(int, r.stdout.strip().split(","))
    conf = style_conf(a.style)
    words = load_words(a.words)
    cards = group(words)
    write_subs(cards, a.srt, a.vtt)

    tmp = tempfile.mkdtemp(prefix="caps_")
    overlays = []  # (png, t0, t1)
    for ci, c in enumerate(cards):
        t0 = max(0, c[0]["start"] - LEAD_IN)
        t1 = c[-1]["end"] + 0.20
        if a.style == "karaoke":
            for wi, w in enumerate(c):
                p = os.path.join(tmp, f"c{ci:03d}_{wi:02d}.png")
                render_png(c, wi, conf, vw, p)
                s = max(0, w["start"] - LEAD_IN) if wi else t0
                e = c[wi + 1]["start"] if wi + 1 < len(c) else t1
                overlays.append((p, s, e))
        else:
            p = os.path.join(tmp, f"c{ci:03d}.png")
            render_png(c, -1, conf, vw, p)
            overlays.append((p, t0, t1))

    parts, cur = [], "[0:v]"
    lines = []
    for i, (png, t0, t1) in enumerate(overlays):
        nxt = f"[v{i}]"
        lines.append(f"movie={png}[p{i}];{cur}[p{i}]overlay="
                     f"(W-w)/2:H*{conf['ypos']}-h/2:enable='between(t,{t0:.3f},{t1:.3f})'{nxt};")
        cur = nxt
    script = os.path.join(tmp, "filter.txt")
    open(script, "w").write("".join(lines)[:-1].replace(cur, "[vout]")
                            if lines else "[0:v]null[vout]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video,
                    "-filter_complex_script", script, "-map", "[vout]", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "19",
                    "-pix_fmt", "yuv420p", "-c:a", "copy", a.out], check=True)
    print(f"captioned -> {a.out} ({len(cards)} cards, style={a.style})"
          + (f", srt={a.srt}" if a.srt else ""))


if __name__ == "__main__":
    main()
