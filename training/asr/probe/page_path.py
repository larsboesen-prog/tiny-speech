"""The ears' frames as /page5 hears a clip: played by the phone at 48 kHz, then browser/listen.js to16k (the mean of each 3 samples),
peak-normalised as engines/asr-ears.js does. python page_path.py manifest.jsonl CACHE_DIR ears-int8.onnx"""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf, librosa, onnxruntime as ort
manifest, cache, onnx = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
cache.mkdir(parents=True, exist_ok=True)
s = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"])
rows = [json.loads(l) for l in open(manifest)]
for r in rows:
    out = cache / f"{r['id']}.npy"
    if out.exists(): continue
    w, rate = sf.read(r["audio"], dtype="float32")
    if w.ndim > 1: w = w.mean(1)
    w48 = librosa.resample(w, orig_sr=rate, target_sr=48000)
    n = len(w48) // 3
    w16 = w48[: n * 3].reshape(n, 3).mean(1)
    w16 = (w16 / (float(np.abs(w16).max()) or 1.0) * 0.9).astype("float32")[None]
    np.save(out, s.run(None, {"audio": w16})[0][0].astype("float32"))
print(len(rows), "done")
