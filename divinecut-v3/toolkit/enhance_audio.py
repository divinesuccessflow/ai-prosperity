#!/usr/bin/env python3
"""Podcast-grade voice enhancement chain. Deterministic, one command.

    python3 enhance_audio.py --in noisy.mp4 --out clean.mp4 [--strength light|normal|strong]

Chain: highpass 80Hz -> denoise (afftdn, strength-scaled) -> de-esser ->
compressor (podcast voice) -> loudnorm -14 LUFS. Video stream is copied.
Works on audio-only files too (wav/mp3 in -> wav out).
"""
import argparse
import subprocess
import sys

NR = {"light": 9, "normal": 15, "strong": 24}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--strength", default="normal", choices=list(NR))
    a = ap.parse_args()

    af = (
        f"highpass=f=80,"
        f"afftdn=nr={NR[a.strength]}:nf=-28:tn=1,"
        f"deesser=i=0.32,"
        f"acompressor=threshold=-19dB:ratio=3:attack=6:release=140:makeup=3,"
        f"loudnorm=I=-14:TP=-1.5:LRA=9"
    )
    audio_only = a.dst.lower().endswith((".wav", ".mp3", ".m4a", ".flac"))
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", a.src, "-af", af]
    if audio_only:
        cmd += [a.dst]
    else:
        cmd += ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", a.dst]
    subprocess.run(cmd, check=True)
    print(f"enhanced -> {a.dst} (strength={a.strength})")


if __name__ == "__main__":
    sys.exit(main())
