"""Designed voices for the bilingual tiny-voca voice (training/RECIPE.md section 4, option 2; owner, 20 Nov 2026: "Designed voice,
start now"; trained on Kaggle). As upstream tiny-voca made its F2 and M2: Qwen3-TTS VoiceDesign speaks a reference paragraph from
a written description of the voice; Qwen3-TTS Base then copies that voice to read any sentence, in Spanish and in English. Here a
few Mexican candidates are designed, each reads the same site sentences in both languages, and Whisper small checks what it
hears; the owner listens and picks one. The pick's reference becomes the teacher's (references/<id>/{es,en}.{wav,txt}, the
layout teacher.py reads; one reference for both languages, so English and Spanish are one voice). Cloud only (a GPU).

python design.py --out OUT [--only M1,F1]
Output: OUT/candidates/<id>/reference.wav, samples/<lang>-<n>.wav, OUT/references/<id>/…, OUT/summary.json.
"""
import argparse
import gc
import json
import re
import shutil
import time
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

DESIGN = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
LANGUAGE = {"es": "Spanish", "en": "English"}
# What the designed voice says: about 12 seconds of everyday Mexican Spanish from the site's world.
REFERENCE = ("¡Hola! Bienvenido a San Miguel de Allende. Si buscas dónde comer, te recomiendo unos tacos al pastor cerca del "
             "Jardín, y luego un mezcal en una terraza con vista a la Parroquia. ¿Te late? Yo te digo qué está abierto.")
CANDIDATES = [
    {"id": "M1", "label": "Warm local guide (man)", "seed": 52001,
     "prompt": "A Mexican man in his mid thirties from Guanajuato, in central Mexico, with a warm, friendly baritone voice. Native "
               "Mexican Spanish with a natural central Mexican accent, never Spanish from Spain. Calm, clear and welcoming, like a "
               "local guide recommending his favourite places to eat."},
    {"id": "M2", "label": "Bright and upbeat (man)", "seed": 52002,
     "prompt": "A young Mexican man in his late twenties from Mexico City, with a bright, clear light baritone voice. Native Mexican "
               "Spanish, natural chilango accent, upbeat and enthusiastic yet natural, crisp articulation, friendly conversation."},
    {"id": "F1", "label": "Warm local guide (woman)", "seed": 52003,
     "prompt": "A Mexican woman in her early thirties from Guanajuato, in central Mexico, with a warm, clear mid-pitched voice. Native "
               "Mexican Spanish with a natural central Mexican accent, never Spanish from Spain. Relaxed, kind and confident, like "
               "a local guide recommending her favourite places."},
    {"id": "F2", "label": "Bright and lively (woman)", "seed": 52004,
     "prompt": "A young Mexican woman in her late twenties from Mexico City, with a bright, clear, slightly higher-pitched voice. "
               "Native Mexican Spanish, natural Mexico City accent, energetic but relaxed, playful warmth, expressive natural "
               "intonation."},
]
# What the site says: its answers, both languages, with San Miguel's names.
SAMPLES = {
    "es": ["Aquí tienes cuatro lugares abiertos para cenar hoy.",
           "La Azotea está abierta hasta la medianoche.",
           "Bocaciega abre a la una de la tarde y cierra a las diez de la noche.",
           "Para desayunar chilaquiles, prueba Lavanda, en el Callejón de Loreto.",
           "Hay música en vivo en Mama Mía esta noche, a partir de las nueve.",
           "¿Quieres que te diga cuáles están abiertos cerca de ti?"],
    "en": ["Here are four places open for dinner tonight.",
           "La Azotea is open until midnight.",
           "Bocaciega opens at one in the afternoon and closes at ten at night."],
}


def normal(text, lang):
    from num2words import num2words
    text = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang=lang) + " ", text.lower())
    text = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", text)).strip()


def good(w):
    w = np.asarray(w, dtype="float32")
    return len(w) > 2400 and np.isfinite(w).all() and float(np.max(np.abs(w))) > 1e-4


def save(path, wave, rate):
    import torchaudio.functional as F
    w = np.asarray(wave, dtype="float32")
    if rate != 24000:
        w = F.resample(torch.from_numpy(w), rate, 24000).numpy()
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, w * (0.95 / max(float(np.max(np.abs(w))), 1e-9)), 24000, subtype="PCM_16")
    return round(len(w) / 24000, 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", help="candidate ids, comma-separated")
    args = parser.parse_args()
    from qwen_tts import Qwen3TTSModel
    from faster_whisper import WhisperModel

    started = time.time()
    cands = [c for c in CANDIDATES if not args.only or c["id"] in args.only.split(",")]
    major = torch.cuda.get_device_capability()[0]
    dtypes = [torch.bfloat16] if major >= 8 else [torch.float16, torch.float32]  # a T4 has no bfloat16: half, or full if half fails
    info = {"gpu": torch.cuda.get_device_name(), "design_model": DESIGN, "base_model": BASE, "reference_text": REFERENCE}

    def load(name):
        for dt in dtypes:
            m = Qwen3TTSModel.from_pretrained(name, device_map="cuda:0", dtype=dt, attn_implementation="sdpa")
            yield m, str(dt).replace("torch.", "")
            del m
            gc.collect()
            torch.cuda.empty_cache()

    # 1. each candidate's voice, designed from its description, reading the reference paragraph
    for model, dt in load(DESIGN):
        ok = True
        for c in cands:
            torch.manual_seed(c["seed"])
            t = time.time()
            waves, rate = model.generate_voice_design(text=REFERENCE, instruct=c["prompt"], language="Spanish", max_new_tokens=1200)
            if not good(waves[0]):
                ok = False
                break
            c["reference_seconds"] = save(args.out / "candidates" / c["id"] / "reference.wav", waves[0], rate)
            c["design_seconds"] = round(time.time() - t, 1)
            print(json.dumps({"designed": c["id"], "dtype": dt, "seconds": c["reference_seconds"], "took": c["design_seconds"]}), flush=True)
        if ok:
            info["design_dtype"] = dt
            break
        model = None  # let go before the next precision loads
    else:
        raise SystemExit("VoiceDesign gave no usable audio in any precision")
    del model  # the T4's 16 GB hold one 1.7B model at a time
    gc.collect()
    torch.cuda.empty_cache()

    # 2. Base copies each designed voice and reads the site's sentences, Spanish and English
    for model, dt in load(BASE):
        ok = True
        for c in cands:
            ref = args.out / "candidates" / c["id"] / "reference.wav"
            prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=REFERENCE, x_vector_only_mode=False)[0]
            c["samples"] = []
            for lang, texts in SAMPLES.items():
                torch.manual_seed(c["seed"] + (1 if lang == "en" else 0))
                t = time.time()
                waves, rate = model.generate_voice_clone(text=texts, language=[LANGUAGE[lang]] * len(texts),
                                                         voice_clone_prompt=[prompt] * len(texts), max_new_tokens=600)
                if not all(good(w) for w in waves):
                    ok = False
                    break
                for n, (text, w) in enumerate(zip(texts, waves), 1):
                    seconds = save(args.out / "candidates" / c["id"] / "samples" / f"{lang}-{n}.wav", w, rate)
                    c["samples"].append({"lang": lang, "n": n, "text": text, "seconds": seconds})
                print(json.dumps({"cloned": c["id"], "lang": lang, "dtype": dt, "took": round(time.time() - t, 1)}), flush=True)
            if not ok:
                break
            # the teacher's references (teacher.py): the designed reference for both languages, so both are one voice
            refs = args.out / "references" / c["id"]
            refs.mkdir(parents=True, exist_ok=True)
            for lang in ("es", "en"):
                shutil.copy(ref, refs / f"{lang}.wav")
                (refs / f"{lang}.txt").write_text(REFERENCE + "\n", encoding="utf-8")
        if ok:
            info["base_dtype"] = dt
            break
        model = None
    else:
        raise SystemExit("Base gave no usable audio in any precision")
    del model
    gc.collect()
    torch.cuda.empty_cache()

    # 3. what Whisper small hears in each sample: the words, and the language
    asr = WhisperModel("small", device="cuda", compute_type="float16")
    check(asr, args.out, cands)
    info["minutes"] = round((time.time() - started) / 60, 1)
    (args.out / "summary.json").write_text(json.dumps({**info, "candidates": cands}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"minutes": info["minutes"], "design_dtype": info["design_dtype"], "base_dtype": info["base_dtype"]}), flush=True)


def check(asr, out, cands):
    """What Whisper small hears in each sample (the words and the language). The audio goes in as numbers, not a file name:
    faster-whisper reads files with PyAV, whose version on Kaggle (Nov 2026) refuses faster-whisper's arguments."""
    import torchaudio.functional as F
    from jiwer import wer
    for c in cands:
        for s in c["samples"]:
            w, rate = sf.read(out / "candidates" / c["id"] / "samples" / f"{s['lang']}-{s['n']}.wav", dtype="float32")
            w16 = F.resample(torch.from_numpy(w), rate, 16000).numpy()
            segments, got = asr.transcribe(w16, beam_size=3)
            heard = " ".join(x.text.strip() for x in segments)
            s.update({"heard": heard, "heard_language": got.language,
                      "wer": round(float(wer(normal(s["text"], s["lang"]), normal(heard, s["lang"]) or "<empty>")), 3)})
        for lang in ("es", "en"):
            mine = [s for s in c["samples"] if s["lang"] == lang]
            c[f"wer_{lang}"] = round(sum(s["wer"] for s in mine) / len(mine), 3)
            c[f"language_right_{lang}"] = sum(s["heard_language"] == lang for s in mine)
        print(json.dumps({"candidate": c["id"], "wer_es": c["wer_es"], "wer_en": c["wer_en"]}), flush=True)


if __name__ == "__main__":
    main()
