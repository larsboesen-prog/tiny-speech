#!/usr/bin/env bash
# One-time setup for the speech-recognition fine-tune on a rented GPU machine (can be the same machine as the voice run).
#   bash tiny-speech/training/asr/gpu/setup.sh
set -euo pipefail
TS="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="${WORK:-$HOME/tsw-asr}"
WHISPER_REVISION=169d4a4341b33bc18d8881c4b69c2e104e1cc0af     # openai/whisper-tiny (onnx-community/whisper-tiny's source)
PIPER_REVISION=04ca88f5685ca5253c701af3687e155b113bd512       # rhasspy/piper-voices
mkdir -p "$WORK/zips" "$WORK/piper" "$WORK/heard"
cd "$WORK"
[ -d venv ] || python3 -m venv venv
"$WORK/venv/bin/pip" install -q -U pip wheel
"$WORK/venv/bin/pip" install -q "transformers==4.57.3" "qwen-tts==0.1.1" accelerate "optimum[onnxruntime]" onnx faster-whisper jiwer num2words \
  librosa soundfile scipy piper-tts huggingface_hub
if [ "${CHATTERBOX:-0}" = 1 ]; then "$WORK/venv/bin/pip" install -q chatterbox-tts || echo "note: chatterbox-tts did not install; the run goes on without it"; fi
"$WORK/venv/bin/python" - <<EOF
from huggingface_hub import hf_hub_download, snapshot_download
snapshot_download("openai/whisper-tiny", revision="$WHISPER_REVISION")
for v in ("es/es_MX/claude/high/es_MX-claude-high", "es/es_MX/ald/medium/es_MX-ald-medium"):
    for ext in (".onnx", ".onnx.json"):
        p = hf_hub_download("rhasspy/piper-voices", v + ext, revision="$PIPER_REVISION")
        import shutil, os; shutil.copy(p, os.path.join("$WORK/piper", os.path.basename(v) + ext))
snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-Base")
snapshot_download("Systran/faster-whisper-large-v3")
print("models ready")
EOF
nvidia-smi --query-gpu=name,memory.total --format=csv
echo "Ready. Recordings (zips from the recording page's ?set=asr) go in $WORK/zips. Then: bash $TS/training/asr/gpu/run.sh sample"
