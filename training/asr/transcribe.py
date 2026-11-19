"""What a Whisper model hears: one line per clip, {id, lang, text (what was said), heard}, for tools/asr-eval.mjs.

python transcribe.py --manifest clips.jsonl --model openai/whisper-tiny --out heard.jsonl [--prompt-file hint-mx-sma-es.txt] [--limit N]

The model is the stock one (openai/whisper-tiny: what the sites' onnx-community/whisper-tiny was converted from) or a fine-tuned
folder. The language is set from each clip's (Spanish for es and mixed, as the page does), and --prompt-file sends the same
name hint the page sends (training/asr/hint-mx-sma-*.txt, made by core/pack/hint.js within 220 tokens).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch


def load(path):
    import librosa
    wave, rate = sf.read(path, dtype="float32")
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    return librosa.resample(wave, orig_sr=rate, target_sr=16000) if rate != 16000 else wave


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--split", help="Only clips of this split")
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    processor = WhisperProcessor.from_pretrained(args.model)
    model = WhisperForConditionalGeneration.from_pretrained(args.model).to(args.device).eval()
    rows = [json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.split:
        rows = [r for r in rows if r.get("split") == args.split]
    rows = rows[:args.limit]
    prompt = args.prompt_file.read_text(encoding="utf-8").strip() if args.prompt_file else None
    prompt_ids = torch.tensor(processor.get_prompt_ids(prompt)).to(args.device) if prompt else None
    out = []
    for lang in ("es", "en"):
        mine = [r for r in rows if (r["lang"] == "en") == (lang == "en")]
        for k in range(0, len(mine), args.batch):
            batch = mine[k:k + args.batch]
            feats = processor([load(r["audio"]) for r in batch], sampling_rate=16000, return_tensors="pt").input_features.to(args.device)
            with torch.no_grad():
                ids = model.generate(feats, language=lang, task="transcribe", prompt_ids=prompt_ids, max_new_tokens=120)
            for r, text in zip(batch, processor.batch_decode(ids, skip_special_tokens=True)):
                text = text.strip()
                if prompt and text.startswith(prompt):
                    text = text[len(prompt):].strip()
                out.append({"id": r["id"], "lang": r["lang"], "text": r["text"], "heard": text, "voice": r.get("voice"), "source": r.get("source")})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    print(json.dumps({"clips": len(out), "model": args.model, "prompt": bool(prompt), "out": str(args.out)}))


if __name__ == "__main__":
    main()
