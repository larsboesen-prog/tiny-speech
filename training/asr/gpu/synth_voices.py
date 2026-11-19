"""Synthetic voices, part 2 (GPU): many made-up speakers read the train and dev utterances. Qwen3-TTS VoiceDesign (Apache-2.0)
designs each voice from a description (training/asr/voices.json: age, gender, region, manner), one reference clip each; Qwen3-TTS
Base then reads in that voice. None is a real person's voice. Optionally Chatterbox Multilingual (MIT) reads too, from the same
references, for a second engine's sound.

python synth_voices.py --text training/asr/text/utterances.jsonl --voices training/asr/voices.json --out work/synth/qwen [--per-text 1] [--chatterbox]

Output: references/<voice>.wav, audio/<id>.flac (16 kHz), manifest.jsonl. Resumable (skips clips already written).
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

DESIGN, BASE = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
LANGUAGE = {"es": "Spanish", "en": "English"}


def to16k(wave, rate):
    import librosa
    wave = np.asarray(wave, dtype="float32")
    return librosa.resample(wave, orig_sr=rate, target_sr=16000) if rate != 16000 else wave


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--text", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--per-text", type=int, default=1)
    parser.add_argument("--chatterbox", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--seed", type=int, default=5)
    args = parser.parse_args()
    from qwen_tts import Qwen3TTSModel

    voices = json.loads(args.voices.read_text(encoding="utf-8"))["voices"]
    refs = args.out / "references"
    refs.mkdir(parents=True, exist_ok=True)
    # 1. the voices: one designed reference clip each (skipped when it exists)
    todo = [v for v in voices if not (refs / f"{v['id']}.wav").exists()]
    if todo:
        design = Qwen3TTSModel.from_pretrained(DESIGN, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        if not hasattr(design, "generate_voice_design"):
            raise SystemExit("this qwen-tts has no generate_voice_design: check its README for the VoiceDesign call and change this line")
        for v in todo:
            torch.manual_seed(v["seed"])
            waves, rate = design.generate_voice_design(text=[v["text"]], language=[LANGUAGE[v["lang"]]], instruct=[v["description"]])
            w = np.asarray(waves[0], dtype="float32")
            sf.write(refs / f"{v['id']}.wav", w * (0.95 / (np.max(np.abs(w)) or 1)), rate, subtype="PCM_16")
            print(json.dumps({"voice": v["id"], "seconds": round(len(w) / rate, 1)}), flush=True)
        del design
        torch.cuda.empty_cache()

    # 2. the clips: each utterance read by --per-text voices of its language
    rows = [json.loads(line) for line in args.text.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [r for r in rows if r["split"] in ("train", "dev")][:args.limit]
    rng = random.Random(args.seed)
    audio = args.out / "audio"
    audio.mkdir(exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done = {json.loads(line)["id"] for line in manifest.read_text().splitlines()} if manifest.exists() else set()
    jobs = []
    for r in rows:
        lang = "en" if r["lang"] == "en" else "es"
        pool = [v for v in voices if v["lang"] == lang]
        for v in rng.sample(pool, min(args.per_text, len(pool))):
            uid = f"{r['id']}-{v['id']}"
            if uid not in done:
                jobs.append((uid, r, v))
    base = Qwen3TTSModel.from_pretrained(BASE, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    prompts = {v["id"]: base.create_voice_clone_prompt(ref_audio=str(refs / f"{v['id']}.wav"), ref_text=v["text"], x_vector_only_mode=False)[0] for v in voices}
    cbox = None
    if args.chatterbox:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        cbox = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
    with manifest.open("a", encoding="utf-8") as out:
        for k in range(0, len(jobs), 8):
            batch = jobs[k:k + 8]
            waves, rate = base.generate_voice_clone(text=[r["text"] for _, r, _ in batch], language=[LANGUAGE["en" if r["lang"] == "en" else "es"] for _, r, _ in batch],
                                                   voice_clone_prompt=[prompts[v["id"]] for _, _, v in batch], max_new_tokens=500)
            readings = [("qwen", w, rate, job) for w, job in zip(waves, batch)]
            if cbox is not None:  # a second reading by another engine, from the same reference
                for job in batch:
                    uid, r, v = job
                    try:
                        w = cbox.generate(r["text"], language_id="en" if r["lang"] == "en" else "es", audio_prompt_path=str(refs / f"{v['id']}.wav"))
                        readings.append(("chatterbox", w.squeeze().cpu().numpy(), cbox.sr, job))
                    except Exception as error:  # an engine that fails a sentence is skipped, not the run
                        print(json.dumps({"chatterbox_failed": uid, "error": str(error)[:120]}), flush=True)
            for engine, wave, sr, (uid, r, v) in readings:
                uid = uid if engine == "qwen" else uid + "-cb"
                w = to16k(wave, sr)
                peak = float(np.max(np.abs(w))) or 1.0
                path = audio / f"{uid}.flac"
                sf.write(path, w * (0.9 / peak), 16000, subtype="PCM_16")
                out.write(json.dumps({"id": uid, "text": r["text"], "lang": r["lang"], "split": r["split"], "category": r["category"], "names": r["names"],
                                      "source": "synthetic", "engine": engine, "voice": v["id"], "audio": str(path.resolve()), "seconds": round(len(w) / 16000, 2)},
                                     ensure_ascii=False) + "\n")
            if k % 400 == 0:
                print(json.dumps({"done": k + len(batch), "of": len(jobs)}), flush=True)
    print(json.dumps({"clips": len(jobs), "manifest": str(manifest)}))


if __name__ == "__main__":
    main()
