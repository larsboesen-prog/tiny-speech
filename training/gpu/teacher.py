"""The teacher voice reads training/data/teacher.jsonl in the speaker's voice, in Spanish and English. Cloud only (a GPU).

python teacher.py --data training/data --references work/recorded/references --out work/teacher [--sample 20] [--deadline-file f]

Upstream tiny-voca's recipe (scripts/generate_audio.py), for one speaker and two languages: Qwen3-TTS 1.7B Base copies the
voice from the speaker's own reference clips (one per language), batches of eight, Whisper small (multilingual) screening
at 15% normalized word error with the language checked too, one retry, peak 0.95, FLAC at 24 kHz. Resumable: every clip
is recorded in a SQLite file; run the same command again. --sample N reads only the N shortest sentences of each language
and copies them to listen/, for a person to hear the accent before the full run (about a dollar of GPU time).
Output: audio/<id>.flac, manifest.jsonl (accepted clips, in the form tiny_voca.prepare reads), review.jsonl (rejected).
"""
import argparse
import json
import math
import os
import re
import shutil
import sqlite3
import time
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
ASR = "small"
BATCH = 8
LANGUAGE = {"es": "Spanish", "en": "English"}


def normal(text, lang):
    """Lowercase, no accents or punctuation, numbers as words: so '9' and 'nueve' compare equal."""
    from num2words import num2words
    text = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang=lang) + " ", text.lower())
    text = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", text)).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sample", type=int)
    parser.add_argument("--deadline-file", type=Path)
    parser.add_argument("--deadline-margin", type=float, default=600)
    parser.add_argument("--seed", type=int, default=20261120)
    args = parser.parse_args()
    from faster_whisper import WhisperModel
    from jiwer import wer
    from qwen_tts import Qwen3TTSModel

    audio = args.out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.out / "state.sqlite")
    db.execute("CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY, status TEXT, attempts INTEGER, payload TEXT)")
    db.commit()
    rows = [json.loads(line) for line in (args.data / "teacher.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rows.sort(key=lambda r: (r["lang"], len(r["text"]), r["id"]))
    if args.sample:
        rows = [r for lang in ("es", "en") for r in [x for x in rows if x["lang"] == lang][:args.sample]]

    def out_of_time():
        if (args.out / "STOP").exists():
            return True
        if not args.deadline_file:
            return False
        try:
            return time.time() >= json.loads(args.deadline_file.read_text())["deadline"] - args.deadline_margin
        except (OSError, ValueError, KeyError):
            return False

    model = Qwen3TTSModel.from_pretrained(MODEL, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    prompts = {lang: model.create_voice_clone_prompt(ref_audio=str(args.references / f"{lang}.wav"),
                                                     ref_text=(args.references / f"{lang}.txt").read_text(encoding="utf-8").strip(),
                                                     x_vector_only_mode=False)[0] for lang in ("es", "en")}
    asr = WhisperModel(ASR, device="cuda", compute_type="float16")
    started = time.time()

    def judge(batch, waves, rate, attempt, seed):
        records = []
        for row, wave in zip(batch, waves):
            w = np.asarray(wave, dtype="float32")
            duration, peak, reasons = len(w) / rate, float(np.max(np.abs(w))) if len(w) else 0.0, []
            words = len(row["text"].split())
            if not np.isfinite(w).all() or peak < 1e-5:
                reasons.append("invalid_or_silent_audio")
            if duration < 0.5 or duration > 30:
                reasons.append("duration")
            if duration > 0 and not 0.7 <= words / duration <= 6:
                reasons.append("speaking_rate")
            transcript, error, heard = "", 1.0, ""
            if not reasons:
                w16 = torch.from_numpy(w)
                if rate != 16000:
                    import torchaudio.functional as F
                    w16 = F.resample(w16, rate, 16000)
                segments, info = asr.transcribe(w16.numpy(), beam_size=3, condition_on_previous_text=False)
                transcript, heard = " ".join(s.text.strip() for s in segments), info.language
                error = wer(normal(row["text"], row["lang"]), normal(transcript, row["lang"]) or "<empty>")
                if heard != row["lang"]:
                    reasons.append(f"language_{heard}")
                if error > 0.15:
                    reasons.append("asr_mismatch")
            if np.isfinite(w).all() and peak > 0:
                if rate != 24000:
                    import torchaudio.functional as F
                    w = F.resample(torch.from_numpy(w), rate, 24000).numpy()
                sf.write(audio / f"{row['id']}.flac", w * (0.95 / max(peak, 1e-9)), 24000, subtype="PCM_16")
            payload = {"id": "t_" + row["id"], "text": row["text"], "voice_id": row["voice"], "lang": row["lang"], "source": "teacher",
                       "teacher_model": MODEL, "text_source": row["source"], "audio": str((audio / f"{row['id']}.flac").resolve()),
                       "duration_seconds": round(duration, 3), "generation_seed": seed, "attempt": attempt,
                       "asr_transcript": transcript, "asr_language": heard, "normalized_wer": round(float(error), 4), "review_reasons": reasons}
            records.append((row["id"], "review" if reasons else "accepted", attempt, json.dumps(payload, ensure_ascii=False)))
        db.executemany("INSERT INTO clips(id, status, attempts, payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                       "status=excluded.status, attempts=excluded.attempts, payload=excluded.payload", records)
        db.commit()

    def generate(batch, attempt, seed):
        torch.manual_seed(seed)
        try:
            waves, rate = model.generate_voice_clone(text=[r["text"] for r in batch], language=[LANGUAGE[r["lang"]] for r in batch],
                                                     voice_clone_prompt=[prompts[r["lang"]] for r in batch], max_new_tokens=600)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            if len(batch) == 1:
                raise
            half = len(batch) // 2
            generate(batch[:half], attempt, seed)
            generate(batch[half:], attempt, seed + 50000)
            return
        judge(batch, waves, rate, attempt, seed)

    stopped = False
    for attempt in (1, 2):
        done = {uid: (status, n) for uid, status, n in db.execute("SELECT id, status, attempts FROM clips")}
        pending = [r for r in rows if (attempt == 1 and r["id"] not in done)
                   or (attempt == 2 and r["id"] in done and done[r["id"]][0] == "review" and done[r["id"]][1] < 2)]
        size = BATCH if attempt == 1 else 1
        for k in range(0, len(pending), size):
            if out_of_time():
                stopped = True
                break
            batch = pending[k:k + size]
            if len({r["lang"] for r in batch}) > 1:  # one language a batch
                for lang in ("es", "en"):
                    part = [r for r in batch if r["lang"] == lang]
                    if part:
                        generate(part, attempt, args.seed + k + attempt * 100000)
            else:
                generate(batch, attempt, args.seed + k + attempt * 100000)
            if k // size % 25 == 0:
                counts = dict(db.execute("SELECT status, count(*) FROM clips GROUP BY status").fetchall())
                print(json.dumps({"attempt": attempt, "done": k + len(batch), "of": len(pending), "counts": counts,
                                  "minutes": round((time.time() - started) / 60, 1)}), flush=True)
        if stopped:
            break

    accepted = [json.loads(p) for (p,) in db.execute("SELECT payload FROM clips WHERE status='accepted'")]
    review = [json.loads(p) for (p,) in db.execute("SELECT payload FROM clips WHERE status='review'")]
    wanted = {r["id"] for r in rows}
    accepted = [a for a in accepted if a["id"][2:] in wanted]
    (args.out / "manifest.jsonl").write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in accepted), encoding="utf-8")
    (args.out / "review.jsonl").write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in review), encoding="utf-8")
    if args.sample:
        listen = args.out / "listen"
        listen.mkdir(exist_ok=True)
        for a in accepted + review:
            shutil.copy(a["audio"], listen / Path(a["audio"]).name)
    summary = {"accepted": len(accepted), "review": len(review), "hours": round(sum(a["duration_seconds"] for a in accepted) / 3600, 3),
               "by_language": {lang: sum(a["lang"] == lang for a in accepted) for lang in ("es", "en")},
               "wrong_language": sum(any(x.startswith("language_") for x in r["review_reasons"]) for r in review),
               "stopped_early": stopped, "minutes": round((time.time() - started) / 60, 1)}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
