"""The ears probe: how well can "sounds + a city's word list" hear restaurant requests? (README.md here)

A large sound recognizer (facebook/wav2vec2-lv-60-espeak-cv-ft: Spanish and English sounds, already used to align the voice)
gives each 20 ms frame's sound probabilities; a matcher keeps only paths that spell words of the word list (lexicon.mjs:
the training-split requests and San Miguel's pack, Spanish and English sounds), scored by a small model of which word follows
which. This is an upper bound for an 8-10 MB recognizer of the same design: the sound model here is 300M parameters.

python probe.py --manifest clips.jsonl --split dev --lexicon lexicon.json --out heard.jsonl [--lm 0.5 --bonus 0 --beam 256 --prune 10]
"""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

MODEL, REVISION = "facebook/wav2vec2-lv-60-espeak-cv-ft", "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"
HARD = {"β": "b", "ð": "d", "ɣ": "ɡ", "ʝ": "j"}  # the recognizer may hear a soft b/d/g/y as a hard one


def emissions(rows, cache, onnx=None):
    import librosa
    cache.mkdir(parents=True, exist_ok=True)
    todo = [r for r in rows if not (cache / f"{r['id']}.npy").exists()]
    if todo and onnx:  # the tiny ears (training/ears/): same frames, same sounds as the teacher
        import onnxruntime as ort
        session = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        for r in todo:
            wave, rate = sf.read(r["audio"], dtype="float32")
            if rate != 16000:
                wave = librosa.resample(wave, orig_sr=rate, target_sr=16000)
            wave = (wave / (float(np.abs(wave).max()) or 1.0) * 0.9).astype("float32")[None]
            np.save(cache / f"{r['id']}.npy", session.run(None, {"audio": wave})[0][0].astype("float32"))
    elif todo:
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, revision=REVISION)
        model = Wav2Vec2ForCTC.from_pretrained(MODEL, revision=REVISION).eval()
        for r in todo:
            wave, rate = sf.read(r["audio"], dtype="float32")
            if rate != 16000:
                wave = librosa.resample(wave, orig_sr=rate, target_sr=16000)
            with torch.no_grad():
                logits = model(fe(wave, sampling_rate=16000, return_tensors="pt").input_values).logits[0]
            np.save(cache / f"{r['id']}.npy", torch.log_softmax(logits, -1).numpy().astype("float32"))
    return {r["id"]: np.load(cache / f"{r['id']}.npy") for r in rows}


class Lexicon:
    def __init__(self, data, vocab, rules=None, cost=2.0):
        """rules: sound confusions [[said, heard or null], ...] (confusions.py); each adds, per word, the pronunciations with
        one such change, at `cost` (log points) each time the matcher uses one"""
        self.children, self.ends, self.missing = [{}], [[]], defaultdict(int)
        for word, prons in data["words"].items():
            seen = set()
            for p in prons:
                for variant in (p["phones"], [HARD.get(x, x) for x in p["phones"]]):
                    ids = []
                    for ph in variant:
                        if ph not in vocab:
                            self.missing[ph] += 1
                            ids = None
                            break
                        ids.append(vocab[ph])
                    if ids and tuple(ids) not in seen:
                        seen.add(tuple(ids))
                        self.add(ids, word, p.get("cost", 0.0))  # a reading can cost (the page's other language)
            for p in prons if rules else []:
                for said, heard in rules:
                    for i, ph in enumerate(p["phones"]):
                        if ph != said:
                            continue
                        changed = p["phones"][:i] + ([heard] if heard else []) + p["phones"][i + 1:]
                        if changed and all(x in vocab for x in changed) and tuple(vocab[x] for x in changed) not in seen:
                            seen.add(tuple(vocab[x] for x in changed))
                            self.add([vocab[x] for x in changed], word, cost)
        # which word follows which: interpolated bigram over the training sentences
        self.uni = data["unigrams"]
        self.total = sum(self.uni.values())
        self.big = defaultdict(dict)
        for k, n in data["bigrams"].items():
            a, b = k.split(" ")
            self.big[a][b] = n
        self.size = len(self.uni) + 1

    def add(self, ids, word, cost=0.0):
        node = 0
        for t in ids:
            if t not in self.children[node]:
                self.children[node][t] = len(self.children)
                self.children.append({})
                self.ends.append([])
            node = self.children[node][t]
        same = [k for k, (w, c) in enumerate(self.ends[node]) if w == word]
        if not same:
            self.ends[node].append((word, cost))
        elif cost < self.ends[node][same[0]][1]:
            self.ends[node][same[0]] = (word, cost)

    def logp(self, prev, word, alpha=2.0):
        uni = (self.uni.get(word, 0) + 1) / (self.total + self.size)
        follow = self.big.get(prev, {})
        n = sum(follow.values()) if follow else 0
        return math.log((follow.get(word, 0) + alpha * uni) / (n + alpha))


def lse(a, b):
    if a == -math.inf:
        return b
    if b == -math.inf:
        return a
    m = max(a, b)
    return m + math.log(math.exp(a - m) + math.exp(b - m))


def decode(lp, lex, blank, lm=1.0, bonus=0.0, beam=48, prune=8.0):
    """CTC prefix beam search, only along the word list's paths; a word ends without a frame of its own (no boundary token)."""
    NEG = -math.inf
    # state: (words, node, last token) -> [p_blank, p_not_blank, lm score]
    beams = {((), 0, -1): [0.0, NEG, 0.0]}
    for t in range(lp.shape[0]):
        row = lp[t]
        top = row.max()
        cands = [int(c) for c in np.nonzero(row > top - prune)[0] if c != blank]
        nxt = defaultdict(lambda: [NEG, NEG, 0.0])
        for (words, node, last), (pb, pnb, lms) in beams.items():
            total = lse(pb, pnb)
            s = nxt[(words, node, last)]
            s[2] = lms
            s[0] = lse(s[0], total + row[blank])          # a blank
            if last >= 0 and node != 0:
                s[1] = lse(s[1], pnb + row[last])          # the same sound held
            for c in cands:
                child = lex.children[node].get(c)
                if child is None:
                    continue
                n = nxt[(words, child, c)]
                n[2] = lms
                n[1] = lse(n[1], (pb if c == last else total) + row[c])
        # a word may end here: close it (the next sound starts the next word)
        for (words, node, last), (pb, pnb, lms) in list(nxt.items()):
            for w, cost in lex.ends[node]:
                prev = words[-1] if words else "<s>"
                k = (words + (w,), 0, last)
                c = nxt[k]
                c[2] = lms + lm * lex.logp(prev, w) + bonus - cost
                c[0], c[1] = lse(c[0], pb), lse(c[1], pnb)
        beams = dict(sorted(nxt.items(), key=lambda kv: -(lse(kv[1][0], kv[1][1]) + kv[1][2]))[:beam])
    best, words = -math.inf, ()
    for (ws, node, last), (pb, pnb, lms) in beams.items():
        if node != 0 or not ws:
            continue
        score = lse(pb, pnb) + lms + lm * lex.logp(ws[-1], "</s>")
        if score > best:
            best, words = score, ws
    if not words:  # no path ended on a whole word: keep the words the best path had finished (an empty answer helps no one)
        for (ws, node, last), (pb, pnb, lms) in beams.items():
            score = lse(pb, pnb) + lms
            if ws and score > best:
                best, words = score, ws
    return " ".join(words)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", default="dev")
    parser.add_argument("--lexicon", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path("probe-emissions"))
    parser.add_argument("--lm", type=float, nargs="+", default=[0.5])
    parser.add_argument("--bonus", type=float, nargs="+", default=[0.0])
    parser.add_argument("--beam", type=int, default=256, help="paths kept per frame (48 at first; 256 understood more, 512 no more)")
    parser.add_argument("--prune", type=float, default=10.0, help="sounds tried per frame: within this many log points of the best")
    parser.add_argument("--first", type=int, help="Only the first N clips (to choose settings on, apart from the rest)")
    parser.add_argument("--rules", type=Path, help="sound confusions to allow (confusions.py), each use costing --rule-cost")
    parser.add_argument("--rule-cost", type=float, default=2.0)
    parser.add_argument("--onnx", type=Path, help="hear with this model instead (the tiny ears' ears-int8.onnx); use its own --cache")
    args = parser.parse_args()
    from huggingface_hub import hf_hub_download
    vocab = json.loads(Path(hf_hub_download(MODEL, "vocab.json", revision=REVISION)).read_text(encoding="utf-8"))
    rows = [json.loads(l) for l in args.manifest.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r.get("split") == args.split][: args.first]
    rules = json.loads(args.rules.read_text(encoding="utf-8"))["rules"] if args.rules else None
    lex = Lexicon(json.loads(args.lexicon.read_text(encoding="utf-8")), vocab, rules, args.rule_cost)
    em = emissions(rows, args.cache, args.onnx)
    print(json.dumps({"clips": len(rows), "trie_nodes": len(lex.children), "sounds_not_in_recognizer": dict(lex.missing)}), flush=True)
    for lm in args.lm:
        for bonus in args.bonus:
            out = [{"id": r["id"], "lang": r["lang"], "text": r["text"], "heard": decode(em[r["id"]], lex, vocab["<pad>"], lm, bonus, args.beam, args.prune)} for r in rows]
            path = args.out.with_name(f"{args.out.stem}-lm{lm}-b{bonus}{args.out.suffix}")
            path.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out), encoding="utf-8")
            print(json.dumps({"lm": lm, "bonus": bonus, "out": str(path)}), flush=True)


if __name__ == "__main__":
    main()
