"""The real speakers' recordings, general speech, and the check that every transcript matches its audio.

python data.py human   --zips work/zips-asr --out work/human            the recording page's ?set=asr zips → manifest
python data.py fleurs  --out work/fleurs [--train 3000 --test 300]     FLEURS es_419 and en_us (CC BY 4.0): general speech
python data.py verify  --inputs a.jsonl b.jsonl … --out work/verified   Whisper large-v3 hears every clip; mismatches are set aside

human: one row a take, 16 kHz FLAC, with the speaker's code and details. Split by speaker AND by sentence: about one speaker
in five is a test speaker (all their takes go to test), and every take of a test sentence goes to test whoever read it, so
the test measures new voices and new sentences.
verify (verified transcripts): synthetic clips are kept when large-v3 hears at most 25% of words differently (a TTS slip
otherwise); a speaker's read sentence at most 40% (a misread is set aside for a person to check: review.jsonl); a sentence in
their own words at most 30% against the typed transcript.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import re
import tarfile
import unicodedata
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf

FLEURS = ("google/fleurs", "70bb2e84b976b7e960aa89f1c648e09c59f894dd")


def write16k(wave, rate, path):
    from scipy.signal import resample_poly
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    if rate != 16000:
        g = math.gcd(rate, 16000)
        wave = resample_poly(wave, 16000 // g, rate // g)
    peak = float(np.max(np.abs(wave))) or 1.0
    sf.write(path, (wave * (0.9 / peak)).astype("float32"), 16000, subtype="PCM_16")
    return round(len(wave) / 16000, 2)


def human(args):
    audio = args.out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(args.zips.glob("*.zip")):
        with zipfile.ZipFile(path) as z:
            info = json.loads(z.read("info.json"))
            if info.get("set") != "asr":
                print(json.dumps({"skipped": path.name, "why": "not the speech-recognition set"}))
                continue
            speaker, details = info.get("speaker") or path.stem, info.get("speakerInfo") or {}
            test_speaker = int(hashlib.sha256(("asr-speaker1" + speaker).encode()).hexdigest()[:8], 16) % 5 == 0
            for row in csv.DictReader(io.StringIO(z.read("metadata.csv").decode("utf-8")), delimiter="|"):
                if set(filter(None, row["flags"].split(" "))) & {"clipped", "silent", "cut-off"}:
                    continue
                wave, rate = sf.read(io.BytesIO(z.read(f"wavs/{row['id']}.wav")), dtype="float32")
                uid = f"h_{speaker}_{row['id']}"
                seconds = write16k(wave, rate, audio / f"{uid}.flac")
                kind = row.get("kind") or "read"
                rows.append({"id": uid, "text": row["text"], "prompt": row.get("prompt") or row["text"], "lang": row["lang"], "kind": kind,
                             "split": "test" if test_speaker or kind == "test" else "train", "source": "human", "speaker": speaker,
                             **{k: details.get(k, "") for k in ("age", "gender", "region", "device")}, "audio": str((audio / f"{uid}.flac").resolve()), "seconds": seconds})
    (args.out / "manifest.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    speakers = sorted({r["speaker"] for r in rows})
    print(json.dumps({"takes": len(rows), "speakers": len(speakers), "hours": round(sum(r["seconds"] for r in rows) / 3600, 2),
                      "test_takes": sum(r["split"] == "test" for r in rows)}))


def fleurs(args):
    from huggingface_hub import hf_hub_download
    out = []
    for lang, code in (("es", "es_419"), ("en", "en_us")):
        for split, take in (("train", args.train), ("test", args.test)):
            tsv = hf_hub_download(FLEURS[0], f"data/{code}/{split}.tsv", repo_type="dataset", revision=FLEURS[1])
            rows = list(csv.reader(open(tsv, encoding="utf-8"), delimiter="\t"))[:take]
            wanted = {r[1]: r[2] for r in rows}
            tar = hf_hub_download(FLEURS[0], f"data/{code}/audio/{split}.tar.gz", repo_type="dataset", revision=FLEURS[1])
            folder = args.out / code / split
            folder.mkdir(parents=True, exist_ok=True)
            with tarfile.open(tar) as t:
                for member in t:
                    name = Path(member.name).name
                    if name in wanted and member.isfile():
                        wave, rate = sf.read(io.BytesIO(t.extractfile(member).read()), dtype="float32")
                        path = folder / (name[:-4] + ".flac")
                        seconds = write16k(wave, rate, path)
                        out.append({"id": f"fleurs_{code}_{name[:-4]}", "text": wanted[name], "lang": lang, "split": split, "source": "general",
                                    "audio": str(path.resolve()), "seconds": seconds})
    for split in ("train", "test"):
        (args.out / f"{split}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out if r["split"] == split), encoding="utf-8")
    print(json.dumps({"clips": len(out), "hours": round(sum(r["seconds"] for r in out) / 3600, 2)}))


def normal(text, lang):
    from num2words import num2words
    text = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang=lang) + " ", text.lower())
    text = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", text)).strip()


def verify(args):
    from faster_whisper import WhisperModel
    from jiwer import wer
    asr = WhisperModel("large-v3", device="cuda", compute_type="float16")
    args.out.mkdir(parents=True, exist_ok=True)
    kept = {"synthetic": [], "human-train": [], "human-test": []}
    review = []
    for path in args.inputs:
        if not Path(path).exists():
            print(json.dumps({"skipped": str(path)}))
            continue
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            lang = "en" if r["lang"] == "en" else "es"
            segments, _ = asr.transcribe(r["audio"], language=lang, beam_size=5, condition_on_previous_text=False)
            heard = " ".join(s.text.strip() for s in segments)
            error = float(wer(normal(r["text"], lang), normal(heard, lang) or "<empty>"))
            limit = 0.25 if r["source"] == "synthetic" else 0.3 if r.get("kind") == "scenario" else 0.4
            r = {**r, "large_v3": heard, "large_v3_wer": round(error, 3)}
            if error > limit:
                review.append(r)
                continue
            if r["source"] == "synthetic":
                kept["synthetic"].append(r)
            else:
                kept["human-test" if r["split"] == "test" else "human-train"].append(r)
    for name, rows in kept.items():
        (args.out / f"{name}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    (args.out / "review.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in review), encoding="utf-8")
    summary = {k: {"clips": len(v), "hours": round(sum(r.get("seconds", 0) for r in v) / 3600, 2)} for k, v in kept.items()}
    summary["set_aside"] = len(review)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("what", choices=("human", "fleurs", "verify"))
    parser.add_argument("--zips", type=Path)
    parser.add_argument("--inputs", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--train", type=int, default=3000)
    parser.add_argument("--test", type=int, default=300)
    args = parser.parse_args()
    {"human": human, "fleurs": fleurs, "verify": verify}[args.what](args)


if __name__ == "__main__":
    main()
