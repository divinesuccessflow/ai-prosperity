#!/usr/bin/env python3
"""Cut one time-window into 9:16, 1:1 and 16:9 renders — aspect NEVER distorted.

    python3 multi_aspect.py --video proxy.mp4 --start 123.5 --end 168.0 \
        --face-x 960 --out-base out/clip1 [--formats 9x16,1x1,16x9] [--grade]

face-x = x-coordinate (in source pixels) of the speaker's face center.
9:16: crop 608x1080 at face-x -> scale 1080x1920
1:1 : crop 1080x1080 at face-x -> keep 1080x1080
16:9: full frame passthrough (scaled 1920x1080)
--grade applies the house grade (contrast/sat + teal-warm balance).
All renders: 0.25s fade in/out (video+audio), H.264 CRF19, AAC 192k.
"""
import argparse
import subprocess

GRADE = ("eq=contrast=1.06:saturation=1.18:brightness=0.01,"
         "colorbalance=rs=-0.03:bs=0.03:rm=0.02")


def crop_x(face_x, crop_w, src_w=1920):
    return max(0, min(src_w - crop_w, int(face_x - crop_w / 2)))


def render(src, t0, t1, vf, dst, grade):
    d = t1 - t0
    chain = [vf] if vf else []
    if grade:
        chain.append(GRADE)
    chain.append(f"fade=t=in:d=0.25,fade=t=out:st={d - 0.25:.3f}:d=0.25")
    af = f"afade=t=in:d=0.25,afade=t=out:st={d - 0.25:.3f}:d=0.25"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.3f}",
                    "-t", f"{d:.3f}", "-i", src,
                    "-vf", ",".join(chain), "-af", af,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "19",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart", dst], check=True)
    print(f"  {dst}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--face-x", type=float, default=960)
    ap.add_argument("--out-base", required=True)
    ap.add_argument("--formats", default="9x16")
    ap.add_argument("--grade", action="store_true")
    a = ap.parse_args()

    fmts = a.formats.split(",")
    if "9x16" in fmts:
        x = crop_x(a.face_x, 608)
        render(a.video, a.start, a.end,
               f"crop=608:1080:{x}:0,scale=1080:1920:flags=lanczos,setsar=1",
               f"{a.out_base}_9x16.mp4", a.grade)
    if "1x1" in fmts:
        x = crop_x(a.face_x, 1080)
        render(a.video, a.start, a.end,
               f"crop=1080:1080:{x}:0,setsar=1",
               f"{a.out_base}_1x1.mp4", a.grade)
    if "16x9" in fmts:
        render(a.video, a.start, a.end, "scale=1920:1080:flags=lanczos,setsar=1",
               f"{a.out_base}_16x9.mp4", a.grade)


if __name__ == "__main__":
    main()
