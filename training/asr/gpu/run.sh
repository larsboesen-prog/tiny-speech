#!/usr/bin/env bash
# The speech-recognition fine-tune, from text and recordings to an 8-bit model the sites can load (training/asr/README.md).
#   bash run.sh sample   the made-up voices' references and a few clips each → listen before the full run
#   bash run.sh all      everything (resumes where it stopped: each finished stage leaves done.<stage> in $WORK)
# Settings (environment): WORK (~/tsw-asr), STEPS (4000), PER_TEXT (1: made-up voices per sentence), CHATTERBOX (0 or 1).
set -euo pipefail
TS="$(cd "$(dirname "$0")/../../.." && pwd)"
ASR="$TS/training/asr"
WORK="${WORK:-$HOME/tsw-asr}"
STEPS="${STEPS:-4000}"
PER_TEXT="${PER_TEXT:-1}"
PY="$WORK/venv/bin/python"
cd "$WORK"
stage() { local name=$1; shift; if [ -f "done.$name" ]; then echo "== $name: done before"; return; fi
  echo "== $name ($(date -u +%H:%M) UTC)"; "$@" 2>&1 | tee "log.$name"; touch "done.$name"; }

piper() { "$PY" "$ASR/synth_piper.py" --text "$ASR/text/utterances.jsonl" --voices piper --out synth/piper; }
voices_sample() { "$PY" "$ASR/gpu/synth_voices.py" --text "$ASR/text/utterances.jsonl" --voices "$ASR/voices.json" --out synth/sample --limit 60; }
voices() { "$PY" "$ASR/gpu/synth_voices.py" --text "$ASR/text/utterances.jsonl" --voices "$ASR/voices.json" --out synth/qwen --per-text "$PER_TEXT" \
  $([ "${CHATTERBOX:-0}" = 1 ] && echo --chatterbox); }
human() { if ls zips/*.zip >/dev/null 2>&1; then "$PY" "$ASR/gpu/data.py" human --zips zips --out human; else echo "no recordings yet in $WORK/zips: synthetic only"; fi; }
fleurs() { "$PY" "$ASR/gpu/data.py" fleurs --out fleurs; }
verify() { "$PY" "$ASR/gpu/data.py" verify --inputs synth/piper/manifest.jsonl synth/qwen/manifest.jsonl human/manifest.jsonl --out verified; }
dev() { "$PY" - <<'EOF'
import json
rows = [json.loads(l) for l in open("verified/synthetic.jsonl", encoding="utf-8")]
open("verified/synthetic-train.jsonl", "w", encoding="utf-8").writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows if r["split"] == "train")
open("verified/synthetic-dev.jsonl", "w", encoding="utf-8").writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows if r["split"] == "dev")
EOF
}
hear() {  # hear <model> <tag>: every test set, with and without the page's name hint
  for set in verified/human-test.jsonl verified/synthetic-dev.jsonl fleurs/test.jsonl; do
    [ -s "$set" ] || continue
    local name; name=$(basename "$set" .jsonl)
    "$PY" "$ASR/transcribe.py" --manifest "$set" --model "$1" --out "heard/$2-$name.jsonl"
    "$PY" "$ASR/transcribe.py" --manifest "$set" --model "$1" --out "heard/$2-$name-hint.jsonl" --prompt-file "$ASR/hint-mx-sma-es.txt"
  done
}
finetune() { "$PY" "$ASR/gpu/finetune.py" --synthetic verified/synthetic-train.jsonl --human verified/human-train.jsonl --general fleurs/train.jsonl \
  --hint "$ASR/hint-mx-sma-es.txt" --out model --steps "$STEPS"; }
export_onnx() { "$PY" "$ASR/gpu/export.py" --model model/final --out model-onnx --check verified/synthetic-dev.jsonl; }
bundle() {
  tar czf asr-result.tar.gz model-onnx/*.json model-onnx/*.txt model-onnx/onnx heard model/mix.json verified/summary.json verified/review.jsonl \
    $(ls human/manifest.jsonl 2>/dev/null) log.*
  echo "Download $WORK/asr-result.tar.gz ($(du -h asr-result.tar.gz | cut -f1)) and stop the machine."
}

case "${1:-}" in
  sample)
    stage voices_sample voices_sample
    echo "Listen to $WORK/synth/sample/references/ and a few of synth/sample/audio/: Mexican, varied, natural? Then: bash $0 all"
    ;;
  all)
    stage piper piper
    stage voices voices
    stage human human
    stage fleurs fleurs
    stage verify verify
    stage dev dev
    stage baseline hear openai/whisper-tiny stock
    stage finetune finetune
    stage export export_onnx
    stage evaluate hear model/final tuned
    bundle
    ;;
  *) echo "usage: bash $0 sample | all"; exit 1 ;;
esac
