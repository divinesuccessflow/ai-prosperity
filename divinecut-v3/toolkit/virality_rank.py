#!/usr/bin/env python3
"""Rank candidate reel windows by hook strength, not just topical relevance.

    python3 virality_rank.py --whisper-json audio.json [--window 45] [--top 8]

Scores sliding transcript windows on: hook openers, numbers/money, questions,
contrast/negation drama, emotion words, second-person address, list markers,
and speech density. Prints top windows as JSON:
  [{"start":..,"end":..,"score":..,"hook":"first 12 words.."}, ...]
The agent then eyeballs the top candidates against the transcript before
cutting — this ranks, it does not decide.
"""
import argparse
import json
import re

HOOK = re.compile(r"\b(nobody|no one|everyone|secret|truth|mistake|stop|never|"
                  r"always|why|how|what if|imagine|here's|the problem|most people|"
                  r"biggest|worst|best|instantly|actually|shocking|free)\b", re.I)
MONEY = re.compile(r"(\$|₹|€|\b\d{2,}\b|%|crore|lakh|million|billion|[0-9]+x)\b", re.I)
QUESTION = re.compile(r"\?")
CONTRAST = re.compile(r"\b(but|instead|however|not because|the real|versus|vs)\b", re.I)
EMOTION = re.compile(r"\b(love|hate|fear|crazy|insane|unbelievable|angry|excited|"
                     r"broke|rich|failed|won|lost|dead|alive|dream)\b", re.I)
YOU = re.compile(r"\b(you|your)\b", re.I)
LIST = re.compile(r"\b(first|second|third|number one|three things|five ways|step)\b", re.I)


def words_from(path):
    d = json.load(open(path))
    return [dict(word=w["word"].strip(), start=w["start"], end=w["end"])
            for s in d["segments"] for w in s.get("words", [])]


def score(text, dur, n_words):
    s = 0.0
    s += 3.0 * len(HOOK.findall(text[:180]))       # hooks near the top weigh most
    s += 1.2 * len(HOOK.findall(text[180:]))
    s += 1.5 * len(MONEY.findall(text))
    s += 2.0 * len(QUESTION.findall(text[:120]))
    s += 1.0 * len(CONTRAST.findall(text))
    s += 1.0 * len(EMOTION.findall(text))
    s += 0.4 * len(YOU.findall(text))
    s += 1.2 * len(LIST.findall(text))
    wps = n_words / max(dur, 1)
    if wps > 2.2:
        s += 2          # dense, energetic speech
    if wps < 1.2:
        s -= 2          # dead air heavy
    return round(s, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--whisper-json", required=True)
    ap.add_argument("--window", type=float, default=45)
    ap.add_argument("--step", type=float, default=15)
    ap.add_argument("--top", type=int, default=8)
    a = ap.parse_args()

    words = words_from(a.whisper_json)
    if not words:
        print("[]")
        return
    end = words[-1]["end"]
    out = []
    t = 0.0
    while t + a.window <= end + a.step:
        win = [w for w in words if t <= w["start"] < t + a.window]
        if len(win) > 20:
            text = " ".join(w["word"] for w in win)
            out.append(dict(start=round(win[0]["start"], 2),
                            end=round(min(win[-1]["end"], t + a.window), 2),
                            score=score(text, a.window, len(win)),
                            hook=" ".join(w["word"] for w in win[:12])))
        t += a.step
    out.sort(key=lambda x: -x["score"])
    # drop windows overlapping a higher-scored pick by >50%
    picked = []
    for c in out:
        if all(min(c["end"], p["end"]) - max(c["start"], p["start"])
               < 0.5 * a.window for p in picked):
            picked.append(c)
        if len(picked) >= a.top:
            break
    print(json.dumps(picked, indent=1))


if __name__ == "__main__":
    main()
