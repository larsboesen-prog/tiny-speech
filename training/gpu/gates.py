"""The gates before Spanish answers may switch to the trained voice (training/RECIPE.md section 7), the measured ones:
the trained voice reads the 400 held-out app sentences (training/data/holdout.jsonl, never trained on) as MX1, and Whisper
small (multilingual) writes down what it hears. Passing: at least 90% of the words heard right in each language, and the
language heard as the one spoken. Also writes 20 sentences a language as WAV for the owner's listening test, and what
Whisper heard, for the names gate (tools/voice-gates.mjs: does the reader find the right place from it?).

TINY_VOCA_FRONTEND=table TINY_VOCA_PHONEME_TABLE=training/data/phonemes.jsonl python gates.py --checkpoint runs/bilingual/inference.pt --data training/data --out work/gates
"""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from teacher import normal


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--voice", default="MX1")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--listen", type=int, default=20)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    from jiwer import wer
    from tiny_voca.infer import limit_peak, load_model, speak

    model = load_model(args.checkpoint, args.device)
    asr = WhisperModel("small", device="cuda" if args.device.startswith("cuda") else "cpu", compute_type="float16" if args.device.startswith("cuda") else "int8")
    rows = [json.loads(line) for line in (args.data / "holdout.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    listen = args.out / "listen"
    listen.mkdir(parents=True, exist_ok=True)
    results, refs, hyps = [], {"es": [], "en": []}, {"es": [], "en": []}
    with torch.no_grad():
        for k, row in enumerate(rows):
            wave, _, _ = speak(model, row["text"], args.voice, seed=k)
            wave = limit_peak(wave).numpy().astype("float32")
            import torchaudio.functional as F
            w16 = F.resample(torch.from_numpy(wave), 24000, 16000).numpy()
            segments, info = asr.transcribe(w16, beam_size=5, condition_on_previous_text=False, temperature=0.0)
            heard = " ".join(s.text.strip() for s in segments)
            ref, hyp = normal(row["text"], row["lang"]), normal(heard, row["lang"]) or "<empty>"
            refs[row["lang"]].append(ref)
            hyps[row["lang"]].append(hyp)
            results.append({"id": row["id"], "lang": row["lang"], "text": row["text"], "heard": heard, "heard_language": info.language,
                            "wer": round(float(wer(ref, hyp)), 4), "seconds": round(len(wave) / 24000, 2)})
            if sum(r["lang"] == row["lang"] for r in results) <= args.listen:
                sf.write(listen / f"{row['lang']}-{row['id']}.wav", wave, 24000, subtype="PCM_16")
    summary = {}
    for lang in ("es", "en"):
        mine = [r for r in results if r["lang"] == lang]
        accuracy = 1 - float(wer(refs[lang], hyps[lang]))
        summary[lang] = {"sentences": len(mine), "words_heard_right": round(accuracy, 4), "language_right": round(sum(r["heard_language"] == lang for r in mine) / max(1, len(mine)), 4),
                         "passes": accuracy >= 0.9}
    summary["voice"], summary["checkpoint"] = args.voice, str(args.checkpoint)
    (args.out / "heard.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    (args.out / "gates.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
