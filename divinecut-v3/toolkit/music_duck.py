#!/usr/bin/env python3
"""Mix a music bed under the voice with sidechain ducking.

    python3 music_duck.py --video in.mp4 --music bed.mp3 --out mixed.mp4 \
        [--music-db -22] [--duck-db -14]

Music loops/trims to video length, ducks whenever the voice speaks
(sidechaincompress), gentle 1s music fade in/out. Voice is passed through
untouched (enhance first with enhance_audio.py).
Music library: put royalty-free beds in /opt/divinecut/music/ .
"""
import argparse
import subprocess


def dur(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries",
                        "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--music", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--music-db", type=float, default=-22)
    ap.add_argument("--duck-db", type=float, default=-14)
    a = ap.parse_args()

    d = dur(a.video)
    fc = (
        f"[1:a]aloop=loop=-1:size=2e9,atrim=0:{d:.3f},"
        f"volume={a.music_db}dB,afade=t=in:d=1,afade=t=out:st={max(0, d - 1):.3f}:d=1[m];"
        f"[m][0:a]sidechaincompress=threshold=0.02:ratio=8:attack=80:release=600:"
        f"makeup=1[duck];"
        f"[0:a][duck]amix=inputs=2:duration=first:normalize=0[aout]"
    )
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video, "-i", a.music,
                    "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", a.out],
                   check=True)
    print(f"mixed -> {a.out} (bed {a.music_db}dB, ducked)")


if __name__ == "__main__":
    main()
