"""The tiny-ears run on Kaggle (a free CPU session for the data, the GPU allowance for the rest), Colab or any GPU machine.
README.md here.

python run.py --mode MODE --work WORK --out OUT [--hours H] [--data-from DIR] [...]
  smoke  CPU, minutes: every stage on a few clips (checks the platform before spending GPU time)
  data   CPU, free on Kaggle: setup, synth, prepare, phones, pack  → OUT/data (the speech, packed in a few files)
  train  GPU: setup, unpack (from --data-from: the data session's output), gpucheck, teach, train, export
  all    one GPU session does everything (Colab, a rented machine)
python run.py --stage NAME ...   one stage

Stages (each runs once: a finished stage leaves OUT/done.<stage>, so running again resumes):
  setup     Python packages, the teacher (1.2 GB), Piper's two Mexican voices
  synth     Piper reads the restaurant requests' training sentences (in-domain speech; CPU)
  prepare   downloads and converts the speech sets, with transcripts (prepare.py)
  phones    the Spanish transcripts as sounds (phones.mjs), so the student also learns what was really said
  pack      WORK's speech into a few tar files in OUT/data (a Kaggle output keeps few large files well)
  unpack    those files back into WORK
  gpucheck  2–4 minutes on a few clips with the GPU: half precision, the teacher, training steps, export (fails early, cheaply)
  teach     the teacher labels every clip (teach.py)
  train     the student learns, until the session's budget minus --reserve-minutes (train.py)
  export    the 8-bit ONNX file and its gates (export.py) → OUT/onnx/ears-int8.onnx
--hours: the session's whole budget from its first start (Kaggle's GPU allowance; its sessions stop at 12 hours).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TS = HERE.parents[1]
PIPER_REVISION = "04ca88f5685ca5253c701af3687e155b113bd512"
PIPER = ("es/es_MX/claude/high/es_MX-claude-high", "es/es_MX/ald/medium/es_MX-ald-medium")
TEACHER = ("facebook/wav2vec2-lv-60-espeak-cv-ft", "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4")
PY = sys.executable
MODES = {
    "smoke": ["setup", "synth", "prepare", "phones", "teach", "train", "export"],
    "data": ["setup", "synth", "prepare", "phones", "pack"],
    "train": ["setup", "unpack", "gpucheck", "teach", "train", "export"],
    "all": ["setup", "synth", "prepare", "phones", "teach", "train", "export"],
}


def sh(*cmd, cwd=HERE):
    print("$", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, cwd=cwd)


def deadline(args):
    f = args.out / "deadline.json"
    if not f.exists():
        f.write_text(json.dumps({"deadline": time.time() + args.hours * 3600, "started": time.strftime("%Y-%m-%d %H:%M:%S")}))
    return json.loads(f.read_text())["deadline"]


def vocab_file():
    from huggingface_hub import hf_hub_download
    return hf_hub_download(TEACHER[0], "vocab.json", revision=TEACHER[1])


def setup(args):
    sh(PY, "-m", "pip", "install", "-q", "transformers==4.57.3", "soundfile", "scipy", "librosa", "onnx", "onnxruntime",
       "onnxscript", "huggingface_hub", "pyarrow", "piper-tts", "nodejs-wheel-binaries")
    code = f"""
from huggingface_hub import hf_hub_download, snapshot_download
import shutil, os
snapshot_download("{TEACHER[0]}", revision="{TEACHER[1]}")
os.makedirs("{args.work}/piper", exist_ok=True)
for v in {PIPER!r}:
    for ext in (".onnx", ".onnx.json"):
        p = hf_hub_download("rhasspy/piper-voices", v + ext, revision="{PIPER_REVISION}")
        shutil.copy(p, os.path.join("{args.work}/piper", os.path.basename(v) + ext))
print("models ready")
"""
    sh(PY, "-c", code)


def synth(args):
    sh(PY, TS / "training/asr/synth_piper.py", "--text", TS / "training/asr/text/utterances.jsonl", "--voices", args.work / "piper",
       "--out", args.work / "synth/piper", *(["--limit", 30] if args.mode == "smoke" else []), cwd=TS / "training/asr")


def prepare(args):
    local = [args.work / "synth/piper/manifest.jsonl"] if (args.work / "synth/piper/manifest.jsonl").exists() else []
    small = ["--sets", "ciempiess_light,latam_co,librispeech", "--limit-shards", "1", "--max-clips", "60"] if args.mode == "smoke" else ["--sets", args.sets]
    sh(PY, HERE / "prepare.py", "--out", args.work, *small, "--hours", *args.hours_per_set, *(["--local", *local] if local else []))


def phones(args):
    node = [shutil.which("node")] if shutil.which("node") else [PY, "-m", "nodejs_wheel"]  # pip's nodejs-wheel-binaries
    sh(*node, HERE / "phones.mjs", args.work / "manifest.jsonl", vocab_file(), args.work / "phones.jsonl")


def pack(args):
    data = args.out / "data"
    data.mkdir(parents=True, exist_ok=True)
    parts = [p for p in sorted((args.work / "audio").iterdir()) if p.is_dir()] + ([args.work / "synth"] if (args.work / "synth").exists() else [])
    for p in parts:
        name = p.relative_to(args.work).as_posix().replace("/", "__")
        with tarfile.open(data / f"{name}.tar", "w") as t:  # FLAC is already compressed
            t.add(p, arcname=p.relative_to(args.work).as_posix())
        print(json.dumps({"packed": name, "mb": round((data / f"{name}.tar").stat().st_size / 1e6)}), flush=True)
    for f in ("manifest.jsonl", "phones.jsonl"):
        shutil.copy(args.work / f, data / f)


def unpack(args):
    src = Path(args.data_from)
    for t in sorted(src.glob("*.tar")):
        with tarfile.open(t) as tar:
            tar.extractall(args.work, filter="data")
        print(json.dumps({"unpacked": t.name}), flush=True)
    for f in ("manifest.jsonl", "phones.jsonl"):
        shutil.copy(src / f, args.work / f)


def gpucheck(args):
    import torch
    assert torch.cuda.is_available(), "no GPU in this session"
    rows = [json.loads(l) for l in (args.work / "manifest.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    few = [r for r in rows if r["split"] == "train"][:40] + [r for r in rows if r["split"] == "dev"][:8]
    chk = args.work / "check"
    chk.mkdir(exist_ok=True)
    for r in few:  # the check manifest sits elsewhere: give it absolute audio paths
        r["audio"] = str((args.work / r["audio"]).resolve()) if not Path(r["audio"]).is_absolute() else r["audio"]
    (chk / "manifest.jsonl").write_text("".join(json.dumps(r) + "\n" for r in few))
    sh(PY, HERE / "teach.py", "--manifest", chk / "manifest.jsonl", "--out", chk / "labels")
    sh(PY, HERE / "train.py", "--manifest", chk / "manifest.jsonl", "--labels", chk / "labels", "--out", chk / "train", "--phones", args.work / "phones.jsonl",
       "--vocab", vocab_file(), "--hours", "0.05", "--max-steps", "8", "--batch-seconds", "60", "--workers", "2")
    sh(PY, HERE / "export.py", "--checkpoint", chk / "train/last.pt", "--out", chk / "onnx", "--manifest", chk / "manifest.jsonl", "--labels", chk / "labels", "--clips", "4")
    print(json.dumps({"gpucheck": "passed", "gpu": torch.cuda.get_device_name(0)}), flush=True)


def teach(args):
    # leave time to train: at least 2 h of a long session, 30% of a short one
    (args.out / "teach-deadline.json").write_text(json.dumps({"deadline": deadline(args) - min(2 * 3600, 0.3 * args.hours * 3600)}))
    sh(PY, HERE / "teach.py", "--manifest", args.work / "manifest.jsonl", "--out", args.work / "labels",
       "--batch-seconds", args.teach_batch_seconds, "--deadline-file", args.out / "teach-deadline.json",
       *(["--limit", 150] if args.mode == "smoke" else []))
    return "partial" if not (args.work / "labels/complete").exists() else True  # stopped by its deadline: train on what is labelled


def train(args):
    left = (deadline(args) - time.time()) / 3600 - args.reserve_minutes / 60
    hours = min(args.train_hours or left, left)
    if hours < 0.05:
        print(json.dumps({"train": "no time left in this session"}))
        return False
    sh(PY, HERE / "train.py", "--manifest", args.work / "manifest.jsonl", "--labels", args.work / "labels", "--out", args.out / "train",
       "--phones", args.work / "phones.jsonl", "--vocab", vocab_file(), "--hours", f"{hours:.3f}", "--batch-seconds", args.batch_seconds,
       *(["--max-steps", 20, "--batch-seconds", 40, "--check-minutes", 0] if args.mode == "smoke" else []),
       *(["--workers", args.workers] if args.workers is not None else []))
    return True


def export(args):
    best = args.out / "train/best.pt"
    sh(PY, HERE / "export.py", "--checkpoint", best if best.exists() else args.out / "train/last.pt", "--out", args.out / "onnx",
       "--manifest", args.work / "manifest.jsonl", "--labels", args.work / "labels")


STAGES = {"setup": setup, "synth": synth, "prepare": prepare, "phones": phones, "pack": pack, "unpack": unpack, "gpucheck": gpucheck,
          "teach": teach, "train": train, "export": export}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=list(MODES), default="all")
    parser.add_argument("--stage", choices=list(STAGES), help="only this stage")
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--data-from", help="train mode: the folder with the data session's packed speech")
    parser.add_argument("--hours", type=float, default=11.0, help="the session's whole budget")
    parser.add_argument("--reserve-minutes", type=float, default=20.0, help="kept after training for export and saving")
    parser.add_argument("--train-hours", type=float, help="at most this much training (default: all the time left)")
    parser.add_argument("--sets", default="ciempiess_light,ciempiess_balance,ciempiess_fem,latam_co,latam_ar,latam_cl,librispeech")
    parser.add_argument("--hours-per-set", nargs="*", default=[])
    parser.add_argument("--batch-seconds", type=float, default=320.0)
    parser.add_argument("--teach-batch-seconds", type=float, default=240.0)
    parser.add_argument("--workers", type=int)
    args = parser.parse_args()
    args.work, args.out = args.work.resolve(), args.out.resolve()
    args.work.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # some networks block the Xet host; plain downloads always work
    deadline(args)
    for name in [args.stage] if args.stage else MODES[args.mode]:
        marker = args.out / f"done.{name}"
        if not args.stage and marker.exists():
            print(f"== {name}: done before", flush=True)
            continue
        print(f"== {name} ({time.strftime('%H:%M:%S')}, {round((deadline(args) - time.time()) / 3600, 2)} h left)", flush=True)
        result = STAGES[name](args)
        if result is False:
            break
        if result != "partial":
            marker.touch()
    print(json.dumps({"hours_left": round((deadline(args) - time.time()) / 3600, 2), "out": str(args.out)}), flush=True)


if __name__ == "__main__":
    main()
