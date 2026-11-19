"""Joins the three sources (the speaker's recordings, the teacher's clips, tiny-voca's English clips) into the train /
validation / test inputs that tiny_voca.prepare reads, one JSONL per split.

python manifest.py --inputs work/recorded/manifest.jsonl work/teacher/manifest.jsonl work/originals/manifest.jsonl --out work/inputs

A split is chosen per sentence (by a hash of its text), never per clip, because the annotator refuses the same sentence in two
splits: about 3% validation and 2% test. Rows whose text is not in the phoneme table are dropped and listed.
"""
import argparse
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path


def key(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def split_of(text):
    n = int(hashlib.sha256(("split1" + key(text)).encode()).hexdigest()[:8], 16) % 100
    return "validation" if n < 3 else "test" if n < 5 else "train"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--table", type=Path, default=Path(os.environ.get("TINY_VOCA_PHONEME_TABLE", "training/data/phonemes.jsonl")))
    args = parser.parse_args()
    table = {key(json.loads(line)["text"]) for line in args.table.read_text(encoding="utf-8").splitlines() if line.strip()}
    out = {"train": [], "validation": [], "test": []}
    missing, seen = [], set()
    for path in args.inputs:
        if not path.exists():
            print(f"skipped (not made): {path}")
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if key(row["text"]) not in table:
                missing.append(row["id"])
                continue
            if row["id"] in seen:
                raise SystemExit(f"id used twice: {row['id']}")
            seen.add(row["id"])
            split = split_of(row["text"])
            out[split].append({"id": row["id"], "text": row["text"], "voice_id": row["voice_id"], "split": split, "audio": row["audio"],
                               "lang": row.get("lang"), "source": row.get("source")})
    args.out.mkdir(parents=True, exist_ok=True)
    for split, rows in out.items():
        (args.out / f"{split}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    count = lambda rows, f: {k: sum(1 for r in rows if r[f] == k) for k in sorted({r[f] for r in rows})}
    summary = {split: {"rows": len(rows), "voices": count(rows, "voice_id"), "sources": count(rows, "source")} for split, rows in out.items()}
    summary["not_in_table"] = len(missing)
    (args.out / "summary.json").write_text(json.dumps({**summary, "not_in_table_ids": missing[:50]}, indent=2))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
