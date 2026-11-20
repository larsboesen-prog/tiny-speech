"""Which sounds does the recognizer hear wrong? Learned from clips whose words are known, to give the word list the
pronunciations the recognizer actually hears (probe.py --rules). README.md here.

python confusions.py --manifest clips.jsonl --split dev --first 72 --lexicon lexicon.json --cache <emissions> --out rules.json
  [--top 10 --min-count 3]
For each clip: the recognizer's best sounds (frame by frame) against the sounds of what was said (the word list's Spanish
pronunciations), aligned; every substitution (r heard as ɾ) and every dropped sound (l not heard) is counted. The most
frequent become rules. Use only clips you will not report on (the tuning half), and redo it for each recognizer (the
tiny ears will have their own confusions).
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np


def best_sounds(lp, inv, blank):
    out, last = [], -1
    for x in lp.argmax(-1).tolist():
        if x != last and x != blank:
            out.append(inv[x])
        last = x
    return out


def align(ref, hyp):
    """Levenshtein alignment: [(said, heard)] with None for nothing"""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0], d[0, :] = np.arange(n + 1), np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    pairs, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            pairs.append((ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            pairs.append((ref[i - 1], None))
            i -= 1
        else:
            pairs.append((None, hyp[j - 1]))
            j -= 1
    return pairs[::-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", default="dev")
    parser.add_argument("--first", type=int, required=True, help="the clips to learn from (the rest are for measuring)")
    parser.add_argument("--lexicon", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True, help="the recognizer's saved outputs (probe.py --cache)")
    parser.add_argument("--vocab", type=Path, help="the recognizer's vocab.json (default: the teacher's)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--min-count", type=int, default=3)
    args = parser.parse_args()
    if args.vocab:
        vocab = json.loads(args.vocab.read_text(encoding="utf-8"))
    else:
        from huggingface_hub import hf_hub_download
        from probe import MODEL, REVISION
        vocab = json.loads(Path(hf_hub_download(MODEL, "vocab.json", revision=REVISION)).read_text(encoding="utf-8"))
    inv = {v: k for k, v in vocab.items()}
    words = json.loads(args.lexicon.read_text(encoding="utf-8"))["words"]
    rows = [json.loads(l) for l in args.manifest.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r.get("split") == args.split][: args.first]
    said, ops, used = Counter(), Counter(), 0
    for r in rows:
        ref = []
        for w in re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", r["text"].lower()):
            pron = next((p["phones"] for p in words.get(w, []) if p["lang"] == "es"), None)
            if pron is None:
                ref = None
                break
            ref += pron
        if not ref:
            continue
        used += 1
        hyp = best_sounds(np.load(args.cache / f"{r['id']}.npy"), inv, vocab["<pad>"])
        for a, b in align(ref, hyp):
            if a is not None:
                said[a] += 1
                if a != b:
                    ops[(a, b)] += 1
    top = [(a, b, n) for (a, b), n in ops.most_common() if n >= args.min_count][: args.top]
    out = {"clips": used, "rules": [[a, b] for a, b, _ in top],
           "counts": [{"said": a, "heard": b or "(nothing)", "times": n, "of": said[a]} for a, b, n in top]}
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
