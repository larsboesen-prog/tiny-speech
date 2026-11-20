"""The whole tiny-ears run on one free GPU session (Kaggle or Colab) or any GPU machine (README.md here).

python run.py all --work WORK --out OUT [--hours 11] [--sets ...] [--hours-per-set librispeech=10 ...] [--no-synth]
python run.py <stage> ...    one stage: setup, synth, prepare, teach, train, export

Stages, each run once (a finished stage leaves OUT/done.<stage>; run again to resume after a stop):
  setup    Python packages the platform lacks, the teacher (1.2 GB) and Piper's two Mexican voices
  synth    Piper reads the restaurant requests' training sentences (in-domain speech; CPU, about 15 minutes)
  prepare  downloads and converts the speech sets (prepare.py)
  teach    the teacher labels every clip (teach.py)
  train    the student learns, until the time left minus 40 minutes for the rest (train.py)
  export   the 8-bit ONNX file and its gates (export.py) → OUT/onnx/ears-int8.onnx
WORK holds the audio and labels (large, can be thrown away); OUT holds what to keep (checkpoints, the ONNX files, logs).
--hours: the whole session's budget from the first start (Kaggle stops a session at 12 hours).
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TS = HERE.parents[1]
PIPER_REVISION = "04ca88f5685ca5253c701af3687e155b113bd512"
PIPER = ("es/es_MX/claude/high/es_MX-claude-high", "es/es_MX/ald/medium/es_MX-ald-medium")
PY = sys.executable


def sh(*cmd, cwd=HERE):
    print("$", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, cwd=cwd)


def deadline(args):
    f = args.out / "deadline.json"
    if not f.exists():
        f.write_text(json.dumps({"deadline": time.time() + args.hours * 3600, "started": time.strftime("%Y-%m-%d %H:%M:%S")}))
    return json.loads(f.read_text())["deadline"]


def setup(args):
    sh(PY, "-m", "pip", "install", "-q", "transformers==4.57.3", "soundfile", "scipy", "librosa", "onnx", "onnxruntime",
       "onnxscript", "huggingface_hub", "pyarrow", "piper-tts")
    code = f"""
from huggingface_hub import hf_hub_download, snapshot_download
import shutil, os
snapshot_download("facebook/wav2vec2-lv-60-espeak-cv-ft", revision="ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4")
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
       "--out", args.work / "synth/piper", cwd=TS / "training/asr")


def prepare(args):
    local = [args.work / "synth/piper/manifest.jsonl"] if (args.work / "synth/piper/manifest.jsonl").exists() else []
    sh(PY, HERE / "prepare.py", "--out", args.work, "--sets", args.sets, "--hours", *args.hours_per_set,
       *(["--local", *local] if local else []), *(["--limit-shards", args.limit_shards] if args.limit_shards else []))


def teach(args):
    (args.out / "teach-deadline.json").write_text(json.dumps({"deadline": deadline(args) - 3 * 3600}))  # leave time to train
    sh(PY, HERE / "teach.py", "--manifest", args.work / "manifest.jsonl", "--out", args.work / "labels",
       "--batch-seconds", args.teach_batch_seconds, "--deadline-file", args.out / "teach-deadline.json")


def train(args):
    left = (deadline(args) - time.time()) / 3600 - 40 / 60
    hours = min(args.train_hours or left, left)
    if hours < 0.25:
        print(json.dumps({"train": "no time left in this session; run again in a new session to resume"}))
        return False
    sh(PY, HERE / "train.py", "--manifest", args.work / "manifest.jsonl", "--labels", args.work / "labels", "--out", args.out / "train",
       "--hours", f"{hours:.3f}", "--batch-seconds", args.batch_seconds, *(["--max-steps", args.max_steps] if args.max_steps else []),
       *(["--workers", args.workers] if args.workers is not None else []))
    return True


def export(args):
    best = args.out / "train/best.pt"
    sh(PY, HERE / "export.py", "--checkpoint", best if best.exists() else args.out / "train/last.pt", "--out", args.out / "onnx",
       "--manifest", args.work / "manifest.jsonl", "--labels", args.work / "labels")


STAGES = {"setup": setup, "synth": synth, "prepare": prepare, "teach": teach, "train": train, "export": export}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stage", choices=["all", *STAGES])
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--hours", type=float, default=11.0, help="the session's whole budget")
    parser.add_argument("--train-hours", type=float, help="at most this much training (default: all the time left)")
    parser.add_argument("--sets", default="ciempiess_light,ciempiess_balance,ciempiess_fem,latam_co,latam_ar,latam_cl,librispeech")
    parser.add_argument("--hours-per-set", nargs="*", default=[])
    parser.add_argument("--limit-shards", type=int)
    parser.add_argument("--no-synth", action="store_true")
    parser.add_argument("--batch-seconds", type=float, default=320.0)
    parser.add_argument("--teach-batch-seconds", type=float, default=240.0)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--workers", type=int)
    args = parser.parse_args()
    args.work, args.out = args.work.resolve(), args.out.resolve()
    args.work.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # some networks block the Xet host; plain downloads always work
    deadline(args)
    stages = list(STAGES) if args.stage == "all" else [args.stage]
    if args.no_synth and "synth" in stages:
        stages.remove("synth")
    for name in stages:
        marker = args.out / f"done.{name}"
        if args.stage == "all" and marker.exists():
            print(f"== {name}: done before", flush=True)
            continue
        print(f"== {name} ({time.strftime('%H:%M:%S')})", flush=True)
        if STAGES[name](args) is False:
            break
        marker.touch()
    print(json.dumps({"hours_left": round((deadline(args) - time.time()) / 3600, 2), "out": str(args.out)}), flush=True)


if __name__ == "__main__":
    main()
