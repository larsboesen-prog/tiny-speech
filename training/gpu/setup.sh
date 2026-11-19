#!/usr/bin/env bash
# One-time setup on a rented GPU machine (training/gpu/README.md): Ubuntu with an NVIDIA GPU (24 GB, e.g. an RTX 4090), CUDA 12,
# Python 3.10–3.12, about 60 GB of disk. Run from anywhere; everything goes in $WORK (default ~/tsw).
#   bash tiny-speech/training/gpu/setup.sh
set -euo pipefail
TS="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$HOME/tsw}"
UPSTREAM_COMMIT=42024af9cf7fb8a9fba2836247fd3aa6d9acb712      # github.com/n4ze3m/tiny-voca, read and patched for this
MODEL_REVISION=1e73262226dbf4ef02e9df277e81aaa1db5ce16c       # huggingface.co/n4ze3m/tiny-voca, the released voice
MODEL_SHA256=ebb22871524c5732520fb1652e6aefcec708a7452e83bdd00adcf6181db5ef70
ALIGNER_REVISION=ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4     # the revision upstream's annotations record
mkdir -p "$WORK/zips"
cd "$WORK"

if ! command -v ffmpeg >/dev/null; then (apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1) || echo "note: could not apt-get ffmpeg (not needed for FLAC/WAV)"; fi
[ -d venv ] || python3 -m venv venv
PIP="$WORK/venv/bin/pip"
PY="$WORK/venv/bin/python"
"$PIP" install -q -U pip wheel

if [ ! -d tiny-voca ]; then git clone -q https://github.com/n4ze3m/tiny-voca.git; fi
git -C tiny-voca checkout -q "$UPSTREAM_COMMIT"
# the versions upstream generated its data with (dataset generation/batch1/requirements.txt), plus screening and the parquet reader
"$PIP" install -q -e "tiny-voca[prepare,annotate,evaluate]" "qwen-tts==0.1.1" "transformers==4.57.3" faster-whisper jiwer num2words pyarrow
grep -q "tiny-speech bilingual" tiny-voca/src/tiny_voca/text.py || "$PY" "$TS/training/gpu/patch_upstream.py" tiny-voca "$TS/training/data/symbols.json"

"$PY" - <<EOF
import hashlib, shutil
from huggingface_hub import hf_hub_download, snapshot_download
path = hf_hub_download("n4ze3m/tiny-voca", "tiny-voca.pt", revision="$MODEL_REVISION")
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
assert digest == "$MODEL_SHA256", f"tiny-voca.pt: sha256 {digest}"
shutil.copy(path, "$WORK/tiny-voca.pt")
snapshot_download("facebook/wav2vec2-lv-60-espeak-cv-ft", revision="$ALIGNER_REVISION")
snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-Base")
snapshot_download("Systran/faster-whisper-small")
print("models ready")
EOF
nvidia-smi --query-gpu=name,memory.total --format=csv
echo "Ready. Put the recording session zips in $WORK/zips, then: bash $TS/training/gpu/run.sh sample"
