"""Stand-in accented speech for names by sound (22 Nov 2026): foreign-language Piper voices (Danish, German, Swedish, French,
Belgian Dutch) and two English controls read "Is X open?" and "X, when is it open?" for the 40 names of record-names/names.json.
Not the owner's voice: a first measure before their recordings (record-names/, tools/names-test.mjs).

python accent_synth.py OUT_DIR ../../../record-names/names.json   (needs piper-tts, librosa, soundfile, huggingface_hub)
Then page_path.py (the ears' frames as /page5 hears them) and names_eval.mjs (before / after)."""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf, librosa
from huggingface_hub import hf_hub_download
from piper import PiperVoice, SynthesisConfig
SP = Path(sys.argv[1]); names = json.loads(Path(sys.argv[2]).read_text())["names"]
VOICES = {"da_DK-talesyntese-medium": "da/da_DK/talesyntese/medium", "de_DE-thorsten-medium": "de/de_DE/thorsten/medium",
          "sv_SE-nst-medium": "sv/sv_SE/nst/medium", "fr_FR-siwis-medium": "fr/fr_FR/siwis/medium", "nl_BE-nathalie-medium": "nl/nl_BE/nathalie/medium",
          "en_US-ryan-high": "en/en_US/ryan/high", "en_GB-alan-medium": "en/en_GB/alan/medium"}
voices = {}
for n, p in VOICES.items():
    try: hf_hub_download("rhasspy/piper-voices", f"{p}/{n}.onnx.json"); voices[n] = PiperVoice.load(hf_hub_download("rhasspy/piper-voices", f"{p}/{n}.onnx"))
    except Exception as e: print("skip", n, e)
out = SP / "acc"; (out / "audio").mkdir(parents=True, exist_ok=True)
with open(out / "manifest.jsonl", "w") as f:
    for i, nm in enumerate(names):
        for t, text in enumerate([nm["prompt"], f"{nm['name']}, when is it open?"]):
            for v, voice in voices.items():
                ch = list(voice.synthesize(text, syn_config=SynthesisConfig(length_scale=1.0, noise_scale=0.6, noise_w_scale=0.7)))
                w = librosa.resample(np.concatenate([c.audio_float_array for c in ch]).astype("float32"), orig_sr=ch[0].sample_rate, target_sr=16000)
                w = np.concatenate([np.zeros(2400), w * (0.7 / (np.abs(w).max() or 1)), np.zeros(4000)]).astype("float32")
                uid = f"acc-{nm['id']}-{t}-{v}"
                sf.write(out / "audio" / f"{uid}.flac", w, 16000, subtype="PCM_16")
                f.write(json.dumps({"id": uid, "place": nm["id"], "name": nm["name"], "text": text, "lang": "en", "split": "acc", "voice": v,
                                    "accent": v.split("-")[0], "audio": str((out / "audio" / f"{uid}.flac").resolve())}, ensure_ascii=False) + "\n")
print("voices", list(voices))
