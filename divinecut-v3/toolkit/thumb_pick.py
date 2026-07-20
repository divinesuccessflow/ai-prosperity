#!/usr/bin/env python3
"""Pick the best thumbnail frames from a video (sharp, bright, expressive).

    python3 thumb_pick.py --video clip.mp4 --out-dir out/thumbs [--n 4]

Samples ~40 frames, scores each on sharpness (Laplacian variance), exposure
(mean brightness sweet spot), and colorfulness; saves the top N as
thumb_01.png … plus a contact sheet grid.png for quick human pick.
"""
import argparse
import os
import subprocess
import tempfile

from PIL import Image, ImageFilter, ImageStat


def score(img):
    g = img.convert("L")
    lap = g.filter(ImageFilter.Kernel((3, 3), (0, 1, 0, 1, -4, 1, 0, 1, 0), 1, 0))
    sharp = ImageStat.Stat(lap).var[0]
    bright = ImageStat.Stat(g).mean[0]
    exposure = 1 - abs(bright - 128) / 128
    rgb = ImageStat.Stat(img)
    colorful = (max(rgb.mean[:3]) - min(rgb.mean[:3]))
    return sharp * 0.7 + exposure * 400 + colorful * 6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--n", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    tmp = tempfile.mkdtemp(prefix="thumbs_")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video,
                    "-vf", "fps=1/2,scale=640:-2", os.path.join(tmp, "f_%03d.png")],
                   check=True)
    frames = sorted(os.listdir(tmp))
    scored = []
    for f in frames:
        p = os.path.join(tmp, f)
        try:
            scored.append((score(Image.open(p)), p))
        except Exception:
            pass
    scored.sort(reverse=True)
    top = scored[:a.n]
    for i, (_, p) in enumerate(top, 1):
        Image.open(p).save(os.path.join(a.out_dir, f"thumb_{i:02d}.png"))
    if top:
        w, h = Image.open(top[0][1]).size
        grid = Image.new("RGB", (w * 2, h * ((len(top) + 1) // 2)))
        for i, (_, p) in enumerate(top):
            grid.paste(Image.open(p), ((i % 2) * w, (i // 2) * h))
        grid.save(os.path.join(a.out_dir, "grid.png"))
    print(f"{len(top)} thumbnails -> {a.out_dir} (see grid.png)")


if __name__ == "__main__":
    main()
