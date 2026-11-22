"""Stand-in voices reading English questions (22 Nov 2026, "Restaurants, streets and hotels" in README.md here): five non-native
Piper voices (Danish, German, Swedish, French, Belgian Dutch), two native ones, and with --more three more (Italian, Polish, Brazilian
Portuguese). They read English by their own language's spelling rules, which is further from English than a real accent.

python voices_synth.py OUT_DIR list-questions.json [--more]      → OUT_DIR/manifest.jsonl, OUT_DIR/audio/*.flac
Then page_path.py (the ears' frames as /page5 hears them) and list_eval.mjs."""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf, librosa
from huggingface_hub import hf_hub_download
from piper import PiperVoice, SynthesisConfig
OUT = Path(sys.argv[1]); texts = json.loads(Path(sys.argv[2]).read_text()); MORE = "--more" in sys.argv
VOICES = {"da_DK-talesyntese-medium": "da/da_DK/talesyntese/medium", "de_DE-thorsten-medium": "de/de_DE/thorsten/medium",
          "sv_SE-nst-medium": "sv/sv_SE/nst/medium", "fr_FR-siwis-medium": "fr/fr_FR/siwis/medium", "nl_BE-nathalie-medium": "nl/nl_BE/nathalie/medium",
          "en_US-ryan-high": "en/en_US/ryan/high", "en_GB-alan-medium": "en/en_GB/alan/medium"}
if MORE: VOICES.update({"it_IT-paola-medium": "it/it_IT/paola/medium", "pl_PL-gosia-medium": "pl/pl_PL/gosia/medium", "pt_BR-faber-medium": "pt/pt_BR/faber/medium"})
voices = {n: PiperVoice.load(hf_hub_download("rhasspy/piper-voices", f"{p}/{n}.onnx")) for n, p in VOICES.items() if hf_hub_download("rhasspy/piper-voices", f"{p}/{n}.onnx.json")}
(OUT / "audio").mkdir(parents=True, exist_ok=True)
with open(OUT / "manifest.jsonl", "w") as f:
    for i, text in enumerate(texts):
        for v, voice in voices.items():
            ch = list(voice.synthesize(text, syn_config=SynthesisConfig(length_scale=1.0, noise_scale=0.6, noise_w_scale=0.7)))
            w = librosa.resample(np.concatenate([c.audio_float_array for c in ch]).astype("float32"), orig_sr=ch[0].sample_rate, target_sr=16000)
            w = np.concatenate([np.zeros(2400), w * (0.7 / (np.abs(w).max() or 1)), np.zeros(4000)]).astype("float32")
            uid = f"{Path(sys.argv[2]).stem}-{i:02d}-{v}"
            sf.write(OUT / "audio" / f"{uid}.flac", w, 16000, subtype="PCM_16")
            f.write(json.dumps({"id": uid, "n": i, "text": text, "lang": "en", "voice": v, "accent": v.split("-")[0], "audio": str((OUT / "audio" / f"{uid}.flac").resolve())}, ensure_ascii=False) + "\n")
print(len(texts) * len(voices), "clips")
