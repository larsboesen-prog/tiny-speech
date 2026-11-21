# English held-out requests (test + dev split, 67) read by three English Piper voices the ears never heard (en_US lessac, en_US ryan,
# en_GB alan): python synth_en_test.py <tiny-speech dir> <out dir> → out/manifest.jsonl (split "en"), out/audio/*.flac. Then
# probe.py --manifest out/manifest.jsonl --split en --onnx ... and node tools/asr-eval.mjs (training/ears/README.md, 21 Nov 2026).
import hashlib, json, sys
from pathlib import Path
import numpy as np, soundfile as sf, librosa
from huggingface_hub import hf_hub_download
from piper import PiperVoice, SynthesisConfig
ROOT, OUT = Path(sys.argv[1]), Path(sys.argv[2])
VOICES = {"en_US-lessac-medium": "en/en_US/lessac/medium", "en_US-ryan-high": "en/en_US/ryan/high", "en_GB-alan-medium": "en/en_GB/alan/medium"}
def split(t):
    n = int(hashlib.sha256(("asr-split1" + t.lower()).encode()).hexdigest()[:8], 16) % 100
    return "test" if n < 10 else "dev" if n < 15 else "train"
rows = [json.loads(l) for l in (ROOT / "training/asr/text/utterances.jsonl").read_text().splitlines() if l.strip()]
rows = [r for r in rows if r["lang"] == "en" and (r.get("split") or split(r["text"])) in ("test", "dev")]
voices = {}
for name, path in VOICES.items():
    onnx = hf_hub_download("rhasspy/piper-voices", f"{path}/{name}.onnx"); hf_hub_download("rhasspy/piper-voices", f"{path}/{name}.onnx.json")
    voices[name] = PiperVoice.load(onnx)
(OUT / "audio").mkdir(parents=True, exist_ok=True)
with open(OUT / "manifest.jsonl", "w") as f:
    for r in rows:
        for k, name in enumerate(VOICES):
            chunks = list(voices[name].synthesize(r["text"], syn_config=SynthesisConfig(length_scale=1.0, noise_scale=0.6, noise_w_scale=0.7)))
            wave = librosa.resample(np.concatenate([c.audio_float_array for c in chunks]).astype("float32"), orig_sr=chunks[0].sample_rate, target_sr=16000)
            wave = np.concatenate([np.zeros(2400), wave * (0.7 / (np.abs(wave).max() or 1)), np.zeros(4000)]).astype("float32")
            uid = f"{r['id']}-{name}"
            sf.write(OUT / "audio" / f"{uid}.flac", wave, 16000, subtype="PCM_16")
            f.write(json.dumps({"id": uid, "text": r["text"], "lang": "en", "split": "en", "names": r.get("names", []), "voice": name,
                                "audio": str((OUT / "audio" / f"{uid}.flac").resolve())}, ensure_ascii=False) + "\n")
print(len(rows), "sentences x", len(VOICES), "voices")
