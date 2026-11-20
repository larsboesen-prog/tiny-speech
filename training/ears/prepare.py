"""Speech for the tiny ears to learn from: Mexican and Latin American Spanish first, some English (README.md here).

No transcripts are needed: the teacher (teach.py) labels every clip with the sounds it hears, and the student learns to hear
the same. So any clean speech counts; what matters is many speakers, Mexican accents and phone-like conditions.

python prepare.py --out WORK [--sets ciempiess_light,latam_co,... | all] [--hours SET=H ...] [--local manifest.jsonl ...]
  → WORK/audio/<set>/<id>.flac (16 kHz mono) and WORK/manifest.jsonl ({id, set, lang, seconds, audio, split, text}; audio paths
    relative to WORK, so WORK can be packed in one session and unpacked in another)
Resumes: a shard already converted is skipped. --local adds clips already on disk (e.g. the Piper requests: synth_piper.py).
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf

# name: (repository, revision, shard prefix, language, default hours, licence) — all on Hugging Face, parquet with audio bytes
SETS = {
    "ciempiess_light": ("ciempiess/ciempiess_light", "3d6afb2b3b8dd00ad8f5b1288fe4c18f5882faaa", "ciempiess_light/", "es", 18, "CC BY-SA 4.0"),
    "ciempiess_balance": ("ciempiess/ciempiess_balance", "e48eac011954e3e08c2dbf64bb95d609677b386f", "ciempiess_balance/", "es", 18, "CC BY-SA 4.0"),
    "ciempiess_fem": ("ciempiess/ciempiess_fem", "e49f428d174bd49002d7569e77c5d5fe73c671d6", "ciempiess_fem/", "es", 18, "CC BY-SA 4.0"),
    "latam_co": ("ylacombe/google-colombian-spanish", "18c187b1bfa6f5ada649e4886d02744ea9acafa2", "", "es", 8, "CC BY-SA 4.0"),
    "latam_ar": ("ylacombe/google-argentinian-spanish", "a7e9786e3930b57ae95d38859106e4b50444f943", "", "es", 8, "CC BY-SA 4.0"),
    "latam_cl": ("ylacombe/google-chilean-spanish", "082619e99a37715ab8db45b0bc8188ba98a80130", "", "es", 8, "CC BY-SA 4.0"),
    "librispeech": ("openslr/librispeech_asr", "71cacbfb7e2354c4226d01e70d77d5fca3d04ba1", "all/train.clean.100/", "en", 25, "CC BY 4.0"),
}
DEFAULT = ["ciempiess_light", "ciempiess_balance", "ciempiess_fem", "latam_co", "latam_ar", "latam_cl", "librispeech"]
MAX_SECONDS = 30.0


def relative(path, base):
    """inside WORK: relative to it (the folder can move); elsewhere: as given"""
    p = Path(path).resolve()
    try:
        return str(p.relative_to(base))
    except ValueError:
        return str(p)


def load_manifest(path):
    """rows with absolute audio paths, wherever the manifest's folder now is"""
    path = Path(path)
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    for r in rows:
        if not Path(r["audio"]).is_absolute():
            r["audio"] = str((path.parent / r["audio"]).resolve())
    return rows


def split_of(uid):
    """about 1 clip in 100 is kept apart to check the student against the teacher on clips it never learned from"""
    return "dev" if int(hashlib.sha256(("ears1" + uid).encode()).hexdigest()[:8], 16) % 100 == 0 else "train"


def to16k(wave, rate):
    from scipy.signal import resample_poly
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    if rate != 16000:
        g = math.gcd(int(rate), 16000)
        wave = resample_poly(wave, 16000 // g, int(rate) // g)
    return wave.astype("float32")


def shards(repo, revision, prefix):
    from huggingface_hub import list_repo_files
    return sorted(f for f in list_repo_files(repo, repo_type="dataset", revision=revision) if f.startswith(prefix) and f.endswith(".parquet"))


def convert(name, out, hours, limit_shards=None, max_clips=None):
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    repo, revision, prefix, lang, _, _ = SETS[name]
    folder = out / "audio" / name
    folder.mkdir(parents=True, exist_ok=True)
    have = 0.0
    rows = []
    files = shards(repo, revision, prefix)
    # spread over speakers: take shards in an order mixed by a hash, not the first ones only (women before men, etc.)
    files.sort(key=lambda f: hashlib.sha256(f.encode()).hexdigest())
    for f in files[:limit_shards]:
        if have >= hours * 3600:
            break
        done = folder / (hashlib.sha256(f.encode()).hexdigest()[:12] + ".jsonl")
        if done.exists():
            part = [json.loads(l) for l in done.read_text(encoding="utf-8").splitlines() if l.strip()]
        else:
            path = hf_hub_download(repo, f, repo_type="dataset", revision=revision)
            part = []
            table = pq.ParquetFile(path)
            for g in range(table.num_row_groups):
                if max_clips and len(part) >= max_clips:
                    break
                batch = table.read_row_group(g).to_pylist()
                for i, row in enumerate(batch):
                    audio = row.get("audio") or {}
                    if not audio.get("bytes"):
                        continue
                    try:
                        wave, rate = sf.read(io.BytesIO(audio["bytes"]), dtype="float32")
                    except Exception:  # noqa: BLE001 (a clip the reader cannot open is skipped)
                        continue
                    wave = to16k(wave, rate)
                    seconds = len(wave) / 16000
                    if seconds < 0.8 or seconds > MAX_SECONDS or float(np.abs(wave).max()) < 1e-3:
                        continue
                    base = row.get("audio_id") or row.get("id") or Path(audio.get("path") or f"{g}_{i}").stem
                    uid = f"{name}_{hashlib.sha256((f + str(base) + str(g) + str(i)).encode()).hexdigest()[:12]}"
                    sf.write(folder / f"{uid}.flac", wave, 16000, subtype="PCM_16")
                    text = row.get("normalized_text") or row.get("text") or ""
                    part.append({"id": uid, "set": name, "lang": lang, "seconds": round(seconds, 2), "audio": f"audio/{name}/{uid}.flac",
                                 "speaker": str(row.get("speaker_id", "")), "split": split_of(uid), "text": text})
            done.write_text("".join(json.dumps(r) + "\n" for r in part), encoding="utf-8")
            blob = Path(path).resolve()  # the parquet is not needed once converted (disk is short on free machines):
            Path(path).unlink(missing_ok=True)  # the cache's link and the file it points to
            blob.unlink(missing_ok=True)
        rows += part
        have += sum(r["seconds"] for r in part)
        print(json.dumps({"set": name, "shard": f, "clips": len(part), "hours_so_far": round(have / 3600, 2)}), flush=True)
    return rows


def local(path, out):
    rows = []
    out = Path(out).resolve()
    for l in Path(path).read_text(encoding="utf-8").splitlines():
        if not l.strip():
            continue
        r = json.loads(l)
        if r.get("split", "train") != "train":
            continue  # never learn from a dev or test clip: the probe measures on the requests' dev split, the speakers' test on test
        rows.append({"id": r["id"], "set": r.get("engine") or Path(path).parent.name, "lang": r.get("lang", "es"), "seconds": r.get("seconds"),
                     "audio": relative(r["audio"], out), "speaker": r.get("voice") or r.get("speaker", ""), "split": split_of(r["id"]), "text": r.get("text", "")})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sets", default=",".join(DEFAULT), help="comma list, or 'all', or 'none'")
    parser.add_argument("--hours", nargs="*", default=[], help="SET=HOURS caps, e.g. librispeech=10")
    parser.add_argument("--limit-shards", type=int, help="only the first N shards of each set (a quick try)")
    parser.add_argument("--max-clips", type=int, help="at most about N clips from each shard (a quick try)")
    parser.add_argument("--local", nargs="*", default=[], type=Path, help="manifests of clips already on disk")
    args = parser.parse_args()
    caps = {k: float(v) for k, v in (h.split("=") for h in args.hours)}
    names = list(SETS) if args.sets == "all" else [] if args.sets == "none" else [s for s in args.sets.split(",") if s]
    rows = []
    for name in names:
        rows += convert(name, args.out, caps.get(name, SETS[name][4]), args.limit_shards, args.max_clips)
    for path in args.local:
        rows += local(path, args.out)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    by = {}
    for r in rows:
        by.setdefault(r["set"], [0, 0.0])
        by[r["set"]][0] += 1
        by[r["set"]][1] += r["seconds"] / 3600
    print(json.dumps({"clips": len(rows), "hours": round(sum(r["seconds"] for r in rows) / 3600, 1),
                      "by_set": {k: [n, round(h, 1)] for k, (n, h) in by.items()}, "dev": sum(r["split"] == "dev" for r in rows)}))


if __name__ == "__main__":
    main()
