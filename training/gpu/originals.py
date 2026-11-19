"""tiny-voca's own F2 and M2 English clips (its dataset's batch 2, CC BY 4.0), listed in training/data/originals.jsonl, mixed
into training so the voice keeps the released model's English. Downloads the batch-2 shards (about 800 MB) at a pinned
revision and writes the listed clips as 24 kHz FLAC with a manifest in the form tiny_voca.prepare reads.

python originals.py --data training/data --out work/originals
"""
import argparse
import io
import json
from pathlib import Path

import soundfile as sf

REPO, REVISION, SHARDS = "n4ze3m/tiny-voca", "63b6b89622e984d7c7a0799ca4b4c443dd5f48b2", 16


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    wanted = {r["id"]: r for r in map(json.loads, (args.data / "originals.jsonl").read_text(encoding="utf-8").splitlines()) if r}
    audio = args.out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    rows = []
    for k in range(SHARDS):
        path = hf_hub_download(REPO, f"batch2/data/train-{k:05d}-of-{SHARDS:05d}.parquet", repo_type="dataset", revision=REVISION)
        table = pq.read_table(path, columns=["id", "voice_id", "text", "audio"])
        for row in table.to_pylist():
            if row["id"] not in wanted:
                continue
            wave, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
            if rate != 24000:
                raise SystemExit(f"{row['id']}: {rate} Hz, expected 24000")
            out = audio / f"{row['id']}.flac"
            sf.write(out, wave, rate, subtype="PCM_16")
            rows.append({"id": "o_" + row["id"], "text": row["text"], "voice_id": row["voice_id"], "lang": "en", "source": "tiny-voca dataset",
                         "audio": str(out.resolve()), "duration_seconds": round(len(wave) / rate, 3)})
    missing = sorted(set(wanted) - {r["id"][2:] for r in rows})
    (args.out / "manifest.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    summary = {"clips": len(rows), "missing": len(missing), "hours": round(sum(r["duration_seconds"] for r in rows) / 3600, 3)}
    (args.out / "summary.json").write_text(json.dumps({**summary, "missing_ids": missing[:50]}, indent=2))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
