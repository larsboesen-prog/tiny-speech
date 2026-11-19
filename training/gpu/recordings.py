"""The speaker's recordings (training/record/, one zip per session) → 24 kHz clips the trainer reads, and the reference clips the
teacher copies the voice from.

python recordings.py --zips <folder of session zips> --sentences training/record/sentences.json --out work/recorded

Keeps a take unless the page flagged it clipped, silent, cut off, much shorter or longer than expected (a misread); quiet or
noisy takes are kept (the screening after alignment drops bad ones). Each kept take: resampled to 24 kHz, mono, peak 0.95,
FLAC 16-bit. Writes manifest.jsonl (rows tiny_voca.prepare reads, voice MX1, source "recorded") and references/{es,en}.wav
+ .txt: the calm reference sentences, joined to about 12–18 seconds per language.
"""
import argparse
import csv
import io
import json
import math
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

RATE = 24000
DROP = {"clipped", "silent", "cut-off", "short", "long"}


def to24k(wave, rate):
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    if rate != RATE:
        g = math.gcd(rate, RATE)
        wave = resample_poly(wave, RATE // g, rate // g)
    peak = float(np.max(np.abs(wave))) if len(wave) else 0.0
    return (wave * (0.95 / peak) if peak > 0 else wave).astype("float32")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zips", type=Path, required=True)
    parser.add_argument("--sentences", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--speaker", default="MX1")
    args = parser.parse_args()
    planned = {r["id"]: r for r in json.loads(args.sentences.read_text(encoding="utf-8"))}
    audio = args.out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    takes, dropped, info = {}, [], []
    for path in sorted(args.zips.glob("*.zip")):
        with zipfile.ZipFile(path) as z:
            info.append(json.loads(z.read("info.json")))
            for row in csv.DictReader(io.StringIO(z.read("metadata.csv").decode("utf-8")), delimiter="|"):
                flags = set(filter(None, row["flags"].split(" ")))
                if flags & DROP or row["id"] not in planned:
                    dropped.append({"id": row["id"], "flags": sorted(flags), "zip": path.name})
                    continue
                wave, rate = sf.read(io.BytesIO(z.read(f"wavs/{row['id']}.wav")), dtype="float32")
                takes[row["id"]] = (to24k(wave, rate), row)  # a later zip's take replaces an earlier one
    rows = []
    for uid, (wave, row) in sorted(takes.items(), key=lambda x: planned[x[0]]["n"]):
        if not 0.5 <= len(wave) / RATE <= 30:
            dropped.append({"id": uid, "flags": ["length"], "zip": ""})
            continue
        sf.write(audio / f"rec_{uid}.flac", wave, RATE, subtype="PCM_16")
        rows.append({"id": f"rec_{uid}", "text": planned[uid]["text"], "voice_id": args.speaker, "lang": planned[uid]["lang"],
                     "audio": str((audio / f"rec_{uid}.flac").resolve()), "source": "recorded", "duration_seconds": round(len(wave) / RATE, 3),
                     "reference": planned[uid]["why"] == "reference"})
    (args.out / "manifest.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    (args.out / "dropped.jsonl").write_text("".join(json.dumps(r) + "\n" for r in dropped), encoding="utf-8")

    # reference clips: the calm sentences first, then the longest others, to 12–18 s per language
    refs = args.out / "references"
    refs.mkdir(exist_ok=True)
    for lang in ("es", "en"):
        pool = [r for r in rows if r["lang"] == lang]
        pool.sort(key=lambda r: (not r["reference"], -r["duration_seconds"]))
        chosen, total = [], 0.0
        for r in pool:
            if total >= 12:
                break
            if total + r["duration_seconds"] <= 18:
                chosen.append(r)
                total += r["duration_seconds"]
        if not chosen:
            raise SystemExit(f"no usable {lang} recording for the reference clip")
        gap = np.zeros(int(0.35 * RATE), dtype="float32")
        waves = [sf.read(r["audio"], dtype="float32")[0] for r in chosen]
        sf.write(refs / f"{lang}.wav", np.concatenate([w for x in waves for w in (x, gap)][:-1]), RATE, subtype="PCM_16")
        (refs / f"{lang}.txt").write_text(" ".join(r["text"] for r in chosen), encoding="utf-8")
    hours = sum(r["duration_seconds"] for r in rows) / 3600
    summary = {"kept": len(rows), "dropped": len(dropped), "hours": round(hours, 3), "es": sum(r["lang"] == "es" for r in rows),
               "en": sum(r["lang"] == "en" for r in rows), "sessions": len(info), "consent": [i.get("consent") for i in info]}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
