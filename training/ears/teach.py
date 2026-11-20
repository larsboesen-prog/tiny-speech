"""The teacher labels every clip: for each 20 ms frame, its K likeliest sounds and their log-probabilities (README.md here).

The teacher is the probe's recognizer (facebook/wav2vec2-lv-60-espeak-cv-ft, 300M parameters, pinned). The student learns
to give the same answers, frame by frame, so it hears the same sounds with 40 times fewer parameters.

python teach.py --manifest WORK/manifest.jsonl --out WORK/labels [--k 8 --batch-seconds 240 --deadline-file F]
  → WORK/labels/shard-NNNNN.{idx,logp}.npy (frames × K: uint16 sound ids, float16 log-probabilities) and .json (ids, offsets)
Resumes: finished shards are kept.
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

TEACHER, REVISION = "facebook/wav2vec2-lv-60-espeak-cv-ft", "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"
SHARD = 2000


def frames(samples):
    return (samples - 400) // 320 + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--k", type=int, default=8)
    parser.add_argument("--batch-seconds", type=float, default=240.0, help="audio per batch, padded (GPU memory)")
    parser.add_argument("--deadline-file", type=Path, help="stop cleanly (shards are whole) after this time")
    parser.add_argument("--limit", type=int, help="only the first N clips (a quick try)")
    args = parser.parse_args()
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    rows = [json.loads(l) for l in args.manifest.read_text(encoding="utf-8").splitlines() if l.strip()][: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    fe = Wav2Vec2FeatureExtractor.from_pretrained(TEACHER, revision=REVISION)
    model = Wav2Vec2ForCTC.from_pretrained(TEACHER, revision=REVISION).eval().to(device)
    if device == "cuda":
        model = model.half()
    deadline = json.loads(args.deadline_file.read_text())["deadline"] if args.deadline_file and args.deadline_file.exists() else None
    t0, done_seconds = time.time(), 0.0
    for s in range(0, len(rows), SHARD):
        name = args.out / f"shard-{s // SHARD:05d}"
        if Path(f"{name}.json").exists():
            continue
        if deadline and time.time() > deadline:
            print(json.dumps({"stopped": "deadline", "at_shard": s // SHARD}), flush=True)
            break
        part = sorted(rows[s: s + SHARD], key=lambda r: r["seconds"])
        out = {}
        i = 0
        while i < len(part):
            j = i
            while j < len(part) and (j - i + 1) * part[j]["seconds"] <= args.batch_seconds:
                j += 1
            j = max(j, i + 1)
            waves = [sf.read(r["audio"], dtype="float32")[0] for r in part[i:j]]
            inputs = fe(waves, sampling_rate=16000, return_tensors="pt", padding=True, return_attention_mask=True)
            with torch.no_grad():
                values = inputs.input_values.to(device)
                logits = model(values.half() if device == "cuda" else values, attention_mask=inputs.attention_mask.to(device)).logits.float()
                logp = torch.log_softmax(logits, -1)
                top, idx = logp.topk(args.k, dim=-1)
            for r, w, tp, ix in zip(part[i:j], waves, top.cpu().numpy(), idx.cpu().numpy()):
                n = frames(len(w))
                out[r["id"]] = (ix[:n].astype(np.uint16), tp[:n].astype(np.float16))
                done_seconds += r["seconds"]
            i = j
        ids = [r["id"] for r in rows[s: s + SHARD] if r["id"] in out]
        lengths = [len(out[k][0]) for k in ids]
        np.save(f"{name}.idx.npy", np.concatenate([out[k][0] for k in ids]) if ids else np.zeros((0, args.k), np.uint16))
        np.save(f"{name}.logp.npy", np.concatenate([out[k][1] for k in ids]) if ids else np.zeros((0, args.k), np.float16))
        Path(f"{name}.json").write_text(json.dumps({"ids": ids, "offsets": np.cumsum([0] + lengths).tolist(), "k": args.k,
                                                     "teacher": f"{TEACHER}@{REVISION}"}))
        speed = done_seconds / max(1e-6, time.time() - t0)
        print(json.dumps({"shard": s // SHARD, "clips": len(ids), "x_realtime": round(speed, 1)}), flush=True)


if __name__ == "__main__":
    main()
