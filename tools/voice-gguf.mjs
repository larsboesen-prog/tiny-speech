// The bilingual voice as one GGUF file the page can load (engines/tinyvoca-js.js). Two uses:
//   node tools/voice-gguf.mjs init [--like M2] [--out vendor/tiny-voca/tiny-voca-bilingual-init.gguf]
//       the released model with the bilingual vocabulary (engines/bilingual.js) and a new speaker MX1, untrained: each new row
//       starts from its nearest English rows. It speaks English exactly as the released model does; its Spanish is untrained.
//       For testing the page, the runtime and this tool before any GPU time is spent.
//   node tools/voice-gguf.mjs pack <dump folder> [--out vendor/tiny-voca/tiny-voca-bilingual.gguf]
//       a trained model, from training/gpu/dump.py's tensors.json, tensors.f32 and config.json.
// Both write the released plain-JS file's layout (upstream js/pack.mjs): the phonemizer files and g2p tensors of the released
// tiny-voca-js.gguf, the model's tensors from the float32 source, the large matrices (".blocks.") at 8 bits in 32-weight blocks.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readGGUF } from "../vendor/tiny-voca/js/tiny-voca.js";
import { MODEL } from "../engines/tinyvoca-js.js";
import { SYMBOLS, INIT, SPEAKER } from "../engines/bilingual.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The released float32 file the plain-JS file was packed from (Hugging Face, same revision as MODEL). */
export const ORIG = { revision: MODEL.revision, path: "gguf/tiny-voca-orig.gguf", bytes: 23568000,
  sha256: "6940a20162d7e6a31141ad42aaa552b4fdb5182edeff9402e5ffaf66adfd72a0" };
export const ORIG_URL = `https://huggingface.co/n4ze3m/tiny-voca/resolve/${ORIG.revision}/${ORIG.path}`;
export const ORIG_FILE = ROOT + "vendor/tiny-voca/tiny-voca-orig.gguf";
export const BASE_FILE = ROOT + "vendor/tiny-voca/tiny-voca-js.gguf";
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** The float32 file, downloaded once and checked. */
export async function origBytes() {
  if (existsSync(ORIG_FILE) && sha(readFileSync(ORIG_FILE)) === ORIG.sha256) return readFileSync(ORIG_FILE);
  const r = await fetch(ORIG_URL);
  if (!r.ok) throw new Error(`${ORIG_URL}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (sha(bytes) !== ORIG.sha256) throw new Error("tiny-voca-orig.gguf does not match its SHA-256");
  writeFileSync(ORIG_FILE, bytes);
  return bytes;
}
const gguf = (bytes) => readGGUF(new Uint8Array(bytes).buffer.slice(bytes.byteOffset ?? 0, (bytes.byteOffset ?? 0) + bytes.length));

// ---------- writing (the layout of upstream js/pack.mjs) ----------
const enc = new TextEncoder();
const u32 = (n) => new Uint8Array(new Uint32Array([n]).buffer);
const i32 = (n) => new Uint8Array(new Int32Array([n]).buffer);
const u64 = (n) => new Uint8Array(new BigUint64Array([BigInt(n)]).buffer);
const i64 = (n) => new Uint8Array(new BigInt64Array([BigInt(n)]).buffer);
const str = (text) => { const b = enc.encode(text); return [u64(b.length), b]; };
const padded = (size) => Math.ceil(size / 32) * 32;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
/** float32 → IEEE half, rounding to nearest even (what DataView.setFloat16 does; Node 22 has no setFloat16). */
export function toHalf(x) {
  F32[0] = x;
  const b = U32[0], sign = (b >>> 16) & 0x8000, exp = (b >>> 23) & 0xff;
  let mant = b & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e, rem = mant & ((1 << shift) - 1), mid = 1 << (shift - 1);
    let h = mant >> shift;
    if (rem > mid || (rem === mid && (h & 1))) h++;
    return sign | h;
  }
  let h = sign | (e << 10) | (mant >> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++;
  return h;
}
function eightBit(data) {  // Q8_0, as upstream pack.mjs
  const bytes = new Uint8Array(Math.ceil(data.length / 32) * 34), view = new DataView(bytes.buffer);
  for (let block = 0; block * 32 < data.length; block++) {
    const values = data.subarray(block * 32, block * 32 + 32);
    const scale = Math.fround(values.reduce((top, w) => Math.max(top, Math.abs(w)), 0) / 127), inverse = scale ? Math.fround(1 / scale) : 0;
    view.setUint16(block * 34, toHalf(scale), true);
    values.forEach((w, i) => { const code = Math.fround(w * inverse); view.setInt8(block * 34 + 2 + i, Math.sign(code) * Math.round(Math.abs(code))); });
  }
  return bytes;
}

/**
 * A plain-JS GGUF: `base` is the released plain-JS file (read), `tensors` {name: {shape, data: Float32Array}} replaces the model's,
 * `config` (if given) replaces config.json. Keys are kept in the base's order; the tensor name/rank/shape lists are written afresh.
 */
export function writeJsGGUF(base, { tensors, config }) {
  const files = config ? { ...base.files, "config.json": enc.encode(JSON.stringify(config)) } : base.files;
  const names = Object.keys(files), offsets = names.reduce((list, n) => [...list, list.at(-1) + files[n].length], [0]);
  const all = Object.entries(base.tensors).map(([name, t]) => [name, tensors[name] ?? t]);
  for (const name of Object.keys(tensors)) if (!base.tensors[name]) throw new Error(`${name} is not a tensor of the model`);
  const infos = [], blobs = [];
  let offset = 0;
  for (const [name, { shape, data, type = 0 }] of all) {
    const large = shape.length === 2 && name.includes(".blocks.");
    let bytes;
    if (type === 0) bytes = large ? eightBit(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else throw new Error(`${name}: only float32 tensors can be written (start from the float32 file)`);
    infos.push(...str(name), u32(shape.length), ...[...shape].reverse().map(u64), u32(large ? 8 : 0), u64(offset));
    blobs.push(bytes, new Uint8Array(padded(bytes.length) - bytes.length));
    offset += padded(bytes.length);
  }
  const list = (key, inner, values, one) => [...str(key), u32(9), u32(inner), u64(values.length), ...values.flatMap(one)];
  const kv = [];
  let count = 0;
  for (const [key, bytes] of Object.entries(base.keys)) {
    if (key.startsWith("audiocpp.embedded_files.")) continue;
    count++;
    if (key === "audiocpp.tensor_names") kv.push(...list(key, 8, all.map(([n]) => n), str));
    else if (key === "audiocpp.tensor_ranks") kv.push(...list(key, 5, all.map(([, t]) => t.shape.length), (n) => [i32(n)]));
    else if (key === "audiocpp.tensor_shapes") kv.push(...list(key, 11, all.flatMap(([, t]) => t.shape), (n) => [i64(n)]));
    else kv.push(bytes);
  }
  const header = [u32(0x46554747), u32(3), u64(all.length), u64(count + 3), ...kv,
    ...str("audiocpp.embedded_files.names"), u32(9), u32(8), u64(names.length), ...names.flatMap(str),
    ...str("audiocpp.embedded_files.offsets"), u32(9), u32(10), u64(offsets.length), ...offsets.map(u64),
    ...str("audiocpp.embedded_files.data"), u32(9), u32(0), u64(offsets.at(-1)), ...names.map((n) => files[n]), ...infos];
  const size = header.reduce((s, p) => s + p.length, 0);
  return Buffer.concat([...header, new Uint8Array(padded(size) - size), ...blobs]);
}

/** The released model's float32 tensors (model/*) and its config.json. */
export function released(orig) {
  const f = gguf(orig);
  const tensors = Object.fromEntries(Object.entries(f.tensors).filter(([n]) => n.startsWith("model/")).map(([n, t]) => [n, { shape: t.shape, data: Float32Array.from(t.data) }]));
  return { tensors, config: JSON.parse(new TextDecoder().decode(f.files["config.json"])) };
}

/** The released model grown to the bilingual vocabulary and a third speaker, untrained (see the top of this file). */
export function bilingualInit({ tensors, config }, { like = "M2" } = {}) {
  const width = config.model.channels, old = config.model.vocab_size, vocab = config.vocab;
  if (old !== 76 || SYMBOLS.slice(0, 76).some((s, i) => vocab[s] !== i)) throw new Error("not the released 76-symbol model");
  const rows = (t, n, fill) => {
    const out = new Float32Array(n * width);
    out.set(t.data);
    fill(out);
    return { shape: [n, width], data: out };
  };
  const tok = tensors["model/tokens.weight"];
  const grown = {
    ...tensors,
    "model/tokens.weight": rows(tok, SYMBOLS.length, (out) => {
      SYMBOLS.slice(76).forEach((s, k) => {
        const from = INIT[s].map((x) => vocab[x]);
        for (let i = 0; i < width; i++) out[(76 + k) * width + i] = from.reduce((sum, r) => sum + tok.data[r * width + i], 0) / from.length;
      });
    }),
  };
  const speaker = config.model.speakers.indexOf(like);
  if (speaker < 0) throw new Error(`no speaker ${like}`);
  for (const name of ["model/voices.weight", "model/frame_voices.weight"]) {
    const t = tensors[name];
    grown[name] = rows(t, t.shape[0] + 1, (out) => out.set(t.data.subarray(speaker * width, (speaker + 1) * width), t.shape[0] * width));
  }
  const cfg = JSON.parse(JSON.stringify(config));
  cfg.model.vocab_size = SYMBOLS.length;
  cfg.model.speakers = [...config.model.speakers, SPEAKER];
  cfg.vocab = Object.fromEntries(SYMBOLS.map((s, i) => [s, i]));
  cfg.voices = { ...(config.voices || {}), [SPEAKER]: { like, note: "tiny-speech bilingual: English and Mexican Spanish" } };
  cfg.bilingual = { symbols: SYMBOLS.length, init: INIT, trained: false };
  return { tensors: grown, config: cfg };
}

/**
 * A trained model from training/gpu/dump.py: {tensors, config}. The page's config.json is the untrained bilingual one's
 * (`init`, from bilingualInit) with the trained configuration and step; every tensor must keep the init model's shape.
 */
export function fromDump(dir, init) {
  const index = JSON.parse(readFileSync(dir + "/tensors.json", "utf8")), raw = readFileSync(dir + "/tensors.f32");
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  if (all.length !== index.values) throw new Error("tensors.f32 does not hold the values tensors.json lists");
  const tensors = Object.fromEntries(index.tensors.map((t) => ["model/" + t.name, { shape: t.shape, data: all.slice(t.offset, t.offset + t.shape.reduce((a, b) => a * b, 1)) }]));
  for (const [name, t] of Object.entries(init.tensors)) {
    if (!tensors[name]) throw new Error(`the trained model has no ${name}`);
    if (tensors[name].shape.join() !== t.shape.join()) throw new Error(`${name}: shape ${tensors[name].shape} where the page expects ${t.shape}`);
  }
  const dump = JSON.parse(readFileSync(dir + "/config.json", "utf8"));
  if (dump.model.vocab_size !== SYMBOLS.length || dump.model.speakers.join() !== init.config.model.speakers.join()) throw new Error("not the bilingual configuration");
  const config = { ...init.config, model: dump.model, step: dump.step,
    bilingual: { ...init.config.bilingual, trained: true, frontend: dump.frontend?.fingerprint ?? null, annotation: dump.annotation ?? null } };
  return { tensors, config };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, dir] = process.argv.slice(2);
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const base = gguf(readFileSync(BASE_FILE));
  let model, out;
  if (mode === "init") { model = bilingualInit(released(await origBytes()), { like: arg("--like", "M2") }); out = arg("--out", ROOT + "vendor/tiny-voca/tiny-voca-bilingual-init.gguf"); }
  else if (mode === "pack" && dir) { model = fromDump(dir, bilingualInit(released(await origBytes()), { like: arg("--like", "M2") })); out = arg("--out", ROOT + "vendor/tiny-voca/tiny-voca-bilingual.gguf"); }
  else { console.error("usage: node tools/voice-gguf.mjs init [--like M2] [--out file] | pack <dump folder> [--out file]"); process.exit(1); }
  const bytes = writeJsGGUF(base, model);
  writeFileSync(out, bytes);
  console.log(`${out}: ${bytes.length} bytes, sha256 ${sha(bytes)}; ${model.config.model.vocab_size} symbols, voices ${model.config.model.speakers.join(", ")}`);
}
