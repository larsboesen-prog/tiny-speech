"""Synthetic voices, part 1: Piper's two Mexican Spanish voices read the train and dev utterances (never test), on a CPU.

python synth_piper.py --text training/asr/text/utterances.jsonl --voices <folder with es_MX-*.onnx> --out work/synth/piper [--limit N]

Voices (rhasspy/piper-voices, revision 04ca88f): es_MX-claude-high (dataset Apache-2.0) and es_MX-ald-medium (dataset Unlicense;
base model CC0). Each utterance is read twice, by either voice, at a random speed (0.85–1.2) and, half the time, a pitch
moved by up to two semitones: more speakers than two voices. Spanish and mixed utterances only (English gets English voices
on the GPU). Output: 16 kHz mono FLAC (what Whisper hears) and manifest.jsonl.
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import soundfile as sf

VOICES = {"es_MX-claude-high": "3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0",
          "es_MX-ald-medium": "6ca4b9bc22b3fa19792c212822186fa0f34cb73c1bdced6be83e4038aa946e10"}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--text", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--readings", type=int, default=2)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    import hashlib
    import librosa
    from piper import PiperVoice, SynthesisConfig

    for name, digest in VOICES.items():
        got = hashlib.sha256((args.voices / f"{name}.onnx").read_bytes()).hexdigest()
        if got != digest:
            raise SystemExit(f"{name}.onnx: sha256 {got}, expected {digest}")
    voices = {name: PiperVoice.load(str(args.voices / f"{name}.onnx")) for name in VOICES}
    rows = [json.loads(line) for line in args.text.read_text(encoding="utf-8").splitlines() if line.strip()]
    for r in rows:  # the split by sentence, as tools/asr-text.mjs gives it (for a file still being written)
        if "split" not in r:
            n = int(hashlib.sha256(("asr-split1" + r["text"].lower()).encode()).hexdigest()[:8], 16) % 100
            r["split"] = "test" if n < 10 else "dev" if n < 15 else "train"
    rows = [r for r in rows if r["split"] in ("train", "dev") and r["lang"] in ("es", "mixed")][:args.limit]
    rng = random.Random(args.seed)
    audio = args.out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done = {json.loads(line)["id"] for line in manifest.read_text().splitlines()} if manifest.exists() else set()
    with manifest.open("a", encoding="utf-8") as out:
        for k, row in enumerate(rows):
            for reading in range(args.readings):
                uid = f"{row['id']}-p{reading}"
                if uid in done:
                    continue
                name = rng.choice(sorted(voices))
                speed = round(rng.uniform(0.85, 1.2), 2)
                semitones = round(rng.uniform(-2, 2), 1) if rng.random() < 0.5 else 0.0
                chunks = list(voices[name].synthesize(row["text"], syn_config=SynthesisConfig(length_scale=1 / speed, noise_scale=rng.uniform(0.5, 0.8), noise_w_scale=rng.uniform(0.6, 0.9))))
                wave = np.concatenate([c.audio_float_array for c in chunks]).astype("float32")
                rate = chunks[0].sample_rate
                wave = librosa.resample(wave, orig_sr=rate, target_sr=16000)
                if semitones:
                    wave = librosa.effects.pitch_shift(wave, sr=16000, n_steps=semitones)
                peak = float(np.max(np.abs(wave))) or 1.0
                wave = np.concatenate([np.zeros(int(0.15 * 16000)), wave * (rng.uniform(0.3, 0.9) / peak), np.zeros(int(0.25 * 16000))]).astype("float32")
                path = audio / f"{uid}.flac"
                sf.write(path, wave, 16000, subtype="PCM_16")
                out.write(json.dumps({"id": uid, "text": row["text"], "lang": row["lang"], "split": row["split"], "category": row["category"],
                                      "names": row["names"], "source": "synthetic", "engine": "piper", "voice": name, "speed": speed,
                                      "semitones": semitones, "audio": str(path.resolve()), "seconds": round(len(wave) / 16000, 2)}, ensure_ascii=False) + "\n")
            if k % 200 == 0:
                print(json.dumps({"done": k, "of": len(rows)}), flush=True)
    print(json.dumps({"utterances": len(rows), "manifest": str(manifest)}))


if __name__ == "__main__":
    main()
