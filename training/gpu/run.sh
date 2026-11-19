#!/usr/bin/env bash
# The bilingual voice, from the speaker's recordings to a trained checkpoint and its gates (training/gpu/README.md).
#   bash run.sh sample   recordings → reference clips → the teacher reads 20 sentences a language → listen, then decide
#   bash run.sh all      everything (resumes where it stopped: each finished stage leaves done.<stage> in $WORK)
#   bash run.sh gates    only the gates, again
# Settings (environment): WORK (~/tsw), LIKE (M2 or F2: which released voice the new speaker starts from; the closer to the
# speaker, the better), STEPS (30000), LR (1.5e-4), HOURS (10: the whole run stops cleanly by then, whatever it has done).
set -euo pipefail
TS="$(cd "$(dirname "$0")/../.." && pwd)"
GPU="$TS/training/gpu"
WORK="${WORK:-$HOME/tsw}"
LIKE="${LIKE:-M2}"
STEPS="${STEPS:-30000}"
LR="${LR:-1.5e-4}"
HOURS="${HOURS:-10}"
PY="$WORK/venv/bin/python"
export TINY_VOCA_FRONTEND=table TINY_VOCA_PHONEME_TABLE="$TS/training/data/phonemes.jsonl"
cd "$WORK"
[ -f deadline.json ] || echo "{\"deadline\": $(( $(date +%s) + HOURS * 3600 ))}" > deadline.json

stage() {  # stage <name> <command…>: run once; its output in log.<name>
  local name=$1; shift
  if [ -f "done.$name" ]; then echo "== $name: done before"; return; fi
  echo "== $name ($(date -u +%H:%M) UTC)"
  "$@" 2>&1 | tee "log.$name"
  touch "done.$name"
}

recordings() { "$PY" "$GPU/recordings.py" --zips zips --sentences "$TS/training/record/sentences.json" --out recorded; }
sample() { (cd "$GPU" && "$PY" teacher.py --data "$TS/training/data" --references "$WORK/recorded/references" --out "$WORK/teacher-sample" --sample 20); }
teacher() { (cd "$GPU" && "$PY" teacher.py --data "$TS/training/data" --references "$WORK/recorded/references" --out "$WORK/teacher" --deadline-file "$WORK/deadline.json"); }
originals() { "$PY" "$GPU/originals.py" --data "$TS/training/data" --out originals; }
manifest() { "$PY" "$GPU/manifest.py" --inputs recorded/manifest.jsonl teacher/manifest.jsonl originals/manifest.jsonl --out inputs; }
init() { "$PY" "$GPU/init_checkpoint.py" --released tiny-voca.pt --symbols "$TS/training/data/symbols.json" --like "$LIKE" --out init.pt --config config.json; }
prepare() { for split in train validation test; do "$PY" -m tiny_voca.prepare --inputs "inputs/$split.jsonl" --output features --split "$split" --config config.json --resume; done; }
annotate() { "$PY" -m tiny_voca.annotate --features features --output annotations --config config.json --device cuda --resume \
  --dataset-revision "tiny-speech-$(git -C "$TS" rev-parse --short HEAD 2>/dev/null || echo local)"; }
train() {
  local common=(--train annotations/train.jsonl --validation annotations/validation.jsonl --output runs/bilingual --config config.json
    --steps "$STEPS" --learning-rate "$LR" --gan-start 4000 --gan-ratio 0.7 --teacher-final 0 --max-seconds 86400 --deadline-file deadline.json)
  if [ -f runs/bilingual/last.pt ]; then
    local reached
    reached=$("$PY" -c "import torch; print(torch.load('runs/bilingual/last.pt', map_location='cpu', weights_only=True)['step'])")
    if [ "$reached" -ge "$STEPS" ]; then echo "training already reached step $reached"; return; fi
    "$PY" -m tiny_voca.train "${common[@]}" --resume runs/bilingual/last.pt
  else "$PY" -m tiny_voca.train "${common[@]}" --init-from init.pt --new-data; fi
}
dump() { "$PY" "$GPU/dump.py" --checkpoint runs/bilingual/inference.pt --out dump; }
gates() { (cd "$GPU" && "$PY" gates.py --checkpoint "$WORK/runs/bilingual/inference.pt" --data "$TS/training/data" --out "$WORK/gates"); }
bundle() {
  tar czf result.tar.gz dump gates/gates.json gates/heard.jsonl gates/listen runs/bilingual/inference.pt runs/bilingual/config.json \
    runs/bilingual/recipe.json runs/bilingual/metrics.jsonl $(ls */summary.json 2>/dev/null) annotations/annotations.json log.*
  echo "Download $WORK/result.tar.gz ($(du -h result.tar.gz | cut -f1)) and stop the machine."
}

case "${1:-}" in
  sample)
    stage recordings recordings
    stage sample sample
    echo "Listen to $WORK/teacher-sample/listen/ (and read teacher-sample/summary.json). If the voice sounds like the speaker,"
    echo "Mexican in Spanish: bash $0 all.  If not, stop here: about a dollar spent."
    ;;
  all)
    stage recordings recordings
    stage teacher teacher
    stage originals originals
    stage manifest manifest
    stage init init
    stage prepare prepare
    stage annotate annotate
    stage train train
    stage dump dump
    stage gates gates
    bundle
    ;;
  gates)
    rm -f done.gates
    stage gates gates
    ;;
  *) echo "usage: bash $0 sample | all | gates"; exit 1 ;;
esac
