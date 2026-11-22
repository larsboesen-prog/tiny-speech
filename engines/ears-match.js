// The tiny ears' matcher (plan step B16): the sounds a recognizer heard, frame by frame, matched to a city's word list. A port of
// training/asr/probe/probe.py's Lexicon and decode, line for line, so the browser gives what the probe measured (20 Nov 2026: held-out
// synthetic Mexican requests understood 80.6% with the 8.9 MB ears; test/ears-match.test.mjs checks the two agree word for word).
//
// A CTC prefix beam search that only follows the word list's paths (a trie of each word's sounds), scored by a small model of which
// word follows which (an interpolated bigram over the training sentences). A word ends without a frame of its own. Runs in a worker,
// in a page or in Node; no dependencies.

const HARD = { "β": "b", "ð": "d", "ɣ": "ɡ", "ʝ": "j" };  // the recognizer may hear a soft b/d/g/y as a hard one
const NEG = -Infinity;

/**
 * The word list as a trie of sound ids. data: {words: {word: [{lang, phones: [...]}, ...]}, unigrams: {w: n}, bigrams: {"a b": n}}
 * (tools/ears-lexicon.mjs, the probe's lexicon.mjs); vocab: the recognizer's {sound: id} (its vocab.json).
 */
export function buildLexicon(data, vocab) {
  const children = [new Map()], ends = [[]], missing = {};
  const add = (ids, word, cost = 0) => {
    let node = 0;
    for (const t of ids) {
      let next = children[node].get(t);
      if (next === undefined) { next = children.length; children[node].set(t, next); children.push(new Map()); ends.push([]); }
      node = next;
    }
    const same = ends[node].findIndex(([w]) => w === word);
    if (same < 0) ends[node].push([word, cost]);
    else if (cost < ends[node][same][1]) ends[node][same] = [word, cost];
  };
  for (const [word, prons] of Object.entries(data.words)) {
    const seen = new Set();
    for (const p of prons) {
      for (const variant of [p.phones, p.phones.map((x) => HARD[x] ?? x)]) {
        let ids = [];
        for (const ph of variant) {
          if (!(ph in vocab)) { missing[ph] = (missing[ph] || 0) + 1; ids = null; break; }
          ids.push(vocab[ph]);
        }
        if (ids && ids.length && !seen.has(ids.join(","))) { seen.add(ids.join(",")); add(ids, word, p.cost || 0); }  // a reading can cost (the page's other language)
      }
    }
  }
  const uni = data.unigrams, big = new Map();
  let total = 0;
  for (const n of Object.values(uni)) total += n;
  for (const [k, n] of Object.entries(data.bigrams)) {
    const [a, b] = k.split(" ");
    if (!big.has(a)) big.set(a, new Map());
    big.get(a).set(b, n);
  }
  const follows = new Map();  // prev -> total count after it
  for (const [a, m] of big) { let s = 0; for (const n of m.values()) s += n; follows.set(a, s); }
  const size = Object.keys(uni).length + 1;
  const logp = (prev, word, alpha = 2.0) => {
    const u = ((uni[word] || 0) + 1) / (total + size);
    const f = big.get(prev), n = f ? follows.get(prev) : 0;
    return Math.log((((f && f.get(word)) || 0) + alpha * u) / (n + alpha));
  };
  return { children, ends, missing, logp, words: Object.keys(data.words).length };
}

function lse(a, b) {
  if (a === NEG) return b;
  if (b === NEG) return a;
  const m = a > b ? a : b;
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

/**
 * The words heard. lp: log-probabilities, frames × V, row by row (a Float32Array or plain array); blank: the blank sound's id.
 * Settings as the probe measured them best: lm 0.5, bonus 0, beam 256 paths, sounds within 10 log points of the frame's best.
 */
export function decode(lp, frames, V, lex, blank, { lm = 0.5, bonus = 0, beam = 256, prune = 10 } = {}) {
  // a path: words so far, trie node, last sound -> [p_blank, p_not_blank, lm score]; keys keep insertion order like Python's dict
  let beams = new Map([[key([], 0, -1), { words: [], node: 0, last: -1, s: [0, NEG, 0] }]]);
  for (let t = 0; t < frames; t++) {
    const o = t * V;
    let top = -Infinity;
    for (let c = 0; c < V; c++) if (lp[o + c] > top) top = lp[o + c];
    const limit = Math.fround(top - prune);  // NumPy compares in float32
    const cands = [];
    for (let c = 0; c < V; c++) if (lp[o + c] > limit && c !== blank) cands.push(c);
    const nxt = new Map();
    const get = (words, node, last) => {
      const k = key(words, node, last);
      let e = nxt.get(k);
      if (!e) { e = { words, node, last, s: [NEG, NEG, 0] }; nxt.set(k, e); }
      return e.s;
    };
    for (const { words, node, last, s: [pb, pnb, lms] } of beams.values()) {
      const total = lse(pb, pnb);
      const s = get(words, node, last);
      s[2] = lms;
      s[0] = lse(s[0], total + lp[o + blank]);              // a blank
      if (last >= 0 && node !== 0) s[1] = lse(s[1], pnb + lp[o + last]);  // the same sound held
      const kids = lex.children[node];
      for (const c of cands) {
        const child = kids.get(c);
        if (child === undefined) continue;
        const n = get(words, child, c);
        n[2] = lms;
        n[1] = lse(n[1], (c === last ? pb : total) + lp[o + c]);
      }
    }
    // a word may end here: close it (the next sound starts the next word)
    for (const { words, node, last, s: [pb, pnb, lms] } of [...nxt.values()]) {
      for (const [w, cost] of lex.ends[node]) {
        const prev = words.length ? words[words.length - 1] : "<s>";
        const c = get([...words, w], 0, last);
        c[2] = lms + lm * lex.logp(prev, w) + bonus - cost;
        c[0] = lse(c[0], pb); c[1] = lse(c[1], pnb);
      }
    }
    const scored = [...nxt.entries()].map((e) => [e, lse(e[1].s[0], e[1].s[1]) + e[1].s[2]]);
    scored.sort((a, b) => (a[1] === b[1] ? 0 : b[1] > a[1] ? 1 : -1));  // best first; equal scores keep their order (Python's sorted)
    beams = new Map(scored.slice(0, beam).map(([e]) => e));
  }
  let best = -Infinity, words = [];
  for (const { words: ws, node, s: [pb, pnb, lms] } of beams.values()) {
    if (node !== 0 || !ws.length) continue;
    const score = lse(pb, pnb) + lms + lm * lex.logp(ws[ws.length - 1], "</s>");
    if (score > best) { best = score; words = ws; }
  }
  if (!words.length) {  // no path ended on a whole word: keep the words the best path had finished (an empty answer helps no one)
    for (const { words: ws, s: [pb, pnb, lms] } of beams.values()) {
      const score = lse(pb, pnb) + lms;
      if (ws.length && score > best) { best = score; words = ws; }
    }
  }
  return words.join(" ");
}

const key = (words, node, last) => `${words.join("\u0001")}\u0002${node}\u0002${last}`;
