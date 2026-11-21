"""English restaurant requests for the tiny ears (training/ears/README.md, 21 Nov 2026: the ears heard no English request in their
first training, and understood 67% of English ones against 87.5% of Spanish). Piper's many-speaker English voices read the English
and mixed sentences of the requests' TRAINING split, each several times by different speakers, speeds and styles:
  en_US-libritts_r-medium (904 speakers, LibriTTS-R, CC BY 4.0) and en_GB-vctk-medium (109 speakers of many accents, VCTK, CC BY 4.0).
Spanish names and dishes inside the sentences come out as English speakers say them, as the owner does.

python synth_piper_en.py --text text/utterances.jsonl --voices DIR --out OUT [--readings 10] [--limit N] [--workers 4]
Output: OUT/audio/*.flac (16 kHz), OUT/manifest.jsonl rows {id, text, lang, read_as: "en", split: "train", voice, speaker, audio, seconds}.
The dev and test sentences are never read (the English test set, ../asr/probe/synth_en_test.py, is made of them).
"""
import argparse
import hashlib
import json
import random
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

VOICES = {"en_US-libritts_r-medium": 0.7, "en_GB-vctk-medium": 0.3}  # share of the readings


def split_of(text):
    n = int(hashlib.sha256(("asr-split1" + text.lower()).encode()).hexdigest()[:8], 16) % 100
    return "test" if n < 10 else "dev" if n < 15 else "train"


VOICE = {}


def read(job):
    import numpy as np
    import soundfile as sf
    import librosa
    from piper import PiperVoice, SynthesisConfig
    voices_dir, out, row, k = job
    rng = random.Random(f"{row['id']}-{k}")
    name = rng.choices(list(VOICES), weights=list(VOICES.values()))[0]
    if name not in VOICE:
        VOICE[name] = PiperVoice.load(str(Path(voices_dir) / f"{name}.onnx"))
    voice = VOICE[name]
    speaker = rng.randrange(voice.config.num_speakers)
    speed = round(rng.uniform(0.85, 1.2), 2)
    uid = f"piper_en_{hashlib.sha256(f'{row['id']}-{k}'.encode()).hexdigest()[:12]}"
    chunks = list(voice.synthesize(row["text"], syn_config=SynthesisConfig(speaker_id=speaker, length_scale=1 / speed,
                                                                            noise_scale=rng.uniform(0.5, 0.8), noise_w_scale=rng.uniform(0.6, 0.9))))
    wave = np.concatenate([c.audio_float_array for c in chunks]).astype("float32")
    wave = librosa.resample(wave, orig_sr=chunks[0].sample_rate, target_sr=16000)
    peak = float(np.max(np.abs(wave))) or 1.0
    wave = np.concatenate([np.zeros(int(rng.uniform(0.05, 0.3) * 16000)), wave * (rng.uniform(0.3, 0.9) / peak),
                           np.zeros(int(rng.uniform(0.1, 0.4) * 16000))]).astype("float32")
    path = Path(out) / "audio" / f"{uid}.flac"
    sf.write(path, wave, 16000, subtype="PCM_16")
    return {"id": uid, "text": row["text"], "lang": row["lang"], "read_as": "en", "split": "train", "category": row.get("category"),
            "source": "synthetic", "engine": "piper_en", "voice": f"{name}#{speaker}", "speed": speed, "audio": str(path.resolve()),
            "seconds": round(len(wave) / 16000, 2)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--text", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--readings", type=int, default=10)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    rows = [json.loads(l) for l in args.text.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r["lang"] in ("en", "mixed") and (r.get("split") or split_of(r["text"])) == "train"][: args.limit]
    (args.out / "audio").mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done = {json.loads(l)["id"] for l in manifest.read_text(encoding="utf-8").splitlines() if l.strip()} if manifest.exists() else set()
    jobs = [(str(args.voices), str(args.out), r, k) for r in rows for k in range(args.readings)]
    jobs = [j for j in jobs if f"piper_en_{hashlib.sha256(f'{j[2]['id']}-{j[3]}'.encode()).hexdigest()[:12]}" not in done]
    seconds = 0.0
    with open(manifest, "a", encoding="utf-8") as f, ProcessPoolExecutor(args.workers) as pool:
        for n, rec in enumerate(pool.map(read, jobs, chunksize=8), 1):
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            seconds += rec["seconds"]
            if n % 500 == 0:
                f.flush()
                print(json.dumps({"read": n, "of": len(jobs), "hours": round(seconds / 3600, 2)}), flush=True)
    print(json.dumps({"sentences": len(rows), "clips": len(jobs) + len(done), "new_hours": round(seconds / 3600, 2), "manifest": str(manifest)}), flush=True)


if __name__ == "__main__":
    main()
