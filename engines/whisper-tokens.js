// Whisper's tokenizer, counting only (plan step B9): how many tokens a name hint costs, at build time, from the model's own
// tokenizer.json (byte-level BPE, as GPT-2's). The worker encodes the hint the same way (" " + text, no special tokens) and
// Whisper reads at most 223 prompt tokens, so the hint builder (core/pack/hint.js) needs the real count, not a guess.
// Usage: const bpe = createBpe(JSON.parse(tokenizerJsonText)); bpe.count(" " + hint)

// GPT-2's split of text into pieces before merging (letters, numbers, other marks, spaces), as tokenizer.json's ByteLevel says.
const PIECES = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// Bytes as the printable characters the vocabulary is written in (GPT-2's bytes_to_unicode).
const BYTE_CHARS = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const out = new Array(256);
  let extra = 0;
  for (let b = 0; b < 256; b++) out[b] = keep.includes(b) ? String.fromCharCode(b) : String.fromCharCode(256 + extra++);
  return out;
})();

export function createBpe(tokenizer) {
  const model = tokenizer.model;
  if (model?.type !== "BPE") throw new Error("not a BPE tokenizer");
  const vocab = model.vocab;
  const rank = new Map(model.merges.map((m, i) => [Array.isArray(m) ? m.join(" ") : m, i]));
  const memo = new Map();
  const encoder = new TextEncoder();

  function merge(word) {
    if (memo.has(word)) return memo.get(word);
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = rank.get(parts[i] + " " + parts[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      const pair = parts[best] + parts[best + 1];
      const next = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] + parts[i + 1] === pair && rank.get(parts[i] + " " + parts[i + 1]) === bestRank) { next.push(pair); i++; }
        else next.push(parts[i]);
      }
      parts = next;
    }
    memo.set(word, parts);
    return parts;
  }

  function encode(text) {
    const ids = [];
    for (const piece of String(text).match(PIECES) || []) {
      const word = [...encoder.encode(piece)].map((b) => BYTE_CHARS[b]).join("");
      for (const part of merge(word)) {
        const id = vocab[part];
        if (id === undefined) throw new Error(`no token for ${JSON.stringify(part)}`);
        ids.push(id);
      }
    }
    return ids;
  }
  return { encode, count: (text) => encode(text).length };
}
