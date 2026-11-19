// The bilingual voice's plumbing, before any GPU time: its vocabulary and Spanish tokens (engines/bilingual.js), the GGUF tool
// (tools/voice-gguf.mjs: it rebuilds the released file byte for byte, grows it to the bilingual vocabulary without changing
// English, and packs a trained dump), and the training data (tools/voice-data.mjs) the GPU pipeline reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { SYMBOLS, ID, spanishTokens, isBilingual, INIT, PAUSES, VOWELS } from "../engines/bilingual.js";
import { SYMBOLS as ENGLISH } from "../vendor/tiny-voca/js/dizione/symbols.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = ROOT + "vendor/tiny-voca/tiny-voca-js.gguf";
const skip = existsSync(BASE) ? false : "the model file is not here (npm run fetch:voice)";
const skipOrig = skip || (existsSync(ROOT + "vendor/tiny-voca/tiny-voca-orig.gguf") ? false : "the float32 file is not here (npm run fetch:voice-orig)");
const read = (f) => readFileSync(ROOT + f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const shown = (t) => t.symbols.map((s, i) => (t.stress[i] ? "ˈ" : "") + s).join(" ");

test("the vocabulary keeps every released id and adds Spanish after them", () => {
  assert.equal(SYMBOLS.length, 87);
  assert.deepEqual(SYMBOLS.slice(0, 76), ENGLISH);
  assert.deepEqual(SYMBOLS.slice(76), ["a", "e", "o", "u", "β", "ɣ", "x", "ʝ", "ɲ", "r", "<es>"]);
  for (const s of SYMBOLS.slice(76)) assert.ok(INIT[s]?.every((x) => ID.get(x) < 76), `${s} starts from released rows`);
  assert.ok(PAUSES.has("<es>") && !VOWELS.has("<es>") && VOWELS.has("a") && !VOWELS.has("x"));
  assert.ok(isBilingual(Object.fromEntries(SYMBOLS.map((s, i) => [s, i]))));
  assert.ok(!isBilingual(Object.fromEntries(ENGLISH.map((s, i) => [s, i]))));
});

test("Spanish sentences become <es> tokens in Mexican Spanish's sounds", () => {
  const t = spanishTokens("¿Dónde hay tacos al pastor cerca del Jardín? Son las 9.");
  assert.equal(shown(t), "<bos> <es> d ˈo n d e <sp> ˈa j <sp> t ˈa k o s <sp> a l <sp> p a s t ˈo ɾ <sp> s ˈe ɾ k a <sp> d e l <sp> x a ɾ ð ˈi n ? " +
    "s ˈo n <sp> l a s <sp> n w ˈe β e . <eos>");
  assert.deepEqual(t.unknown, []);
  const city = { names: ["Luna Rooftop"], english: ["rooftop"] };
  const named = spanishTokens("Luna Rooftop abre ahorita.", { city, english: () => [["ɹ", 0], ["uː", 1], ["f", 0], ["t", 0], ["ɑː", 0], ["p", 0]] });
  assert.equal(shown(named), "<bos> <es> l ˈu n a <sp> ɹ ˈuː f t ɑː p <sp> ˈa β ɾ e <sp> a o ɾ ˈi t a . <eos>", "an English word inside a name, in English");
  assert.equal(shown(spanishTokens("Hola!!", {})), "<bos> <es> ˈo l a ! <eos>", "a repeated mark once");
});

test("the GGUF tool rebuilds the released voice byte for byte, and grows it without changing English", { skip: skipOrig }, async () => {
  const { writeJsGGUF, released, origBytes, bilingualInit, fromDump } = await import("../tools/voice-gguf.mjs");
  const { readGGUF } = await import("../vendor/tiny-voca/js/tiny-voca.js");
  const { createVoice } = await import("../engines/tinyvoca-js.js");
  const baseBytes = readFileSync(BASE), base = readGGUF(new Uint8Array(baseBytes).buffer);
  const rel = released(await origBytes());
  assert.equal(Buffer.compare(writeJsGGUF(base, { tensors: rel.tensors }), baseBytes), 0, "same bytes as tiny-voca-js.gguf");

  const init = bilingualInit(rel, { like: "M2" });
  const bytes = writeJsGGUF(base, init);
  const [en, bi] = [await createVoice(new Uint8Array(baseBytes).buffer), await createVoice(new Uint8Array(bytes).buffer)];
  assert.deepEqual(bi.voices, ["F2", "M2", "MX1"]);
  assert.equal(bi.bilingual, true);
  const text = "Tacos Don Tomás is open until eleven tonight.";
  const [a, b] = [en.speak(text, { voice: "M2" })[0], bi.speak(text, { voice: "M2" })[0]];
  assert.equal(a.phonemes, b.phonemes);
  assert.ok(a.audio.length === b.audio.length && a.audio.every((x, i) => x === b.audio[i]), "English: the same samples");
  const es = bi.speak("¿Dónde hay tacos al pastor cerca del Jardín?", { lang: "es" })[0];
  assert.match(es.phonemes, /^<es> d ˈo n d e/);
  assert.ok(es.audio.length > 24000 && es.audio.every(Number.isFinite), "Spanish runs (untrained: the gates decide when it may be used)");

  // a trained model comes back from the GPU as training/gpu/dump.py writes it; packing it gives the same file when nothing changed
  const dir = mkdtempSync(join(tmpdir(), "tiny-speech-dump-"));
  let offset = 0;
  const index = [], parts = [];
  for (const [name, t] of Object.entries(init.tensors)) { index.push({ name: name.slice(6), shape: t.shape, offset }); parts.push(Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength)); offset += t.data.length; }
  writeFileSync(join(dir, "tensors.json"), JSON.stringify({ tensors: index, values: offset }));
  writeFileSync(join(dir, "tensors.f32"), Buffer.concat(parts));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ model: init.config.model, step: 1234, frontend: { fingerprint: "table" } }));
  const packed = fromDump(dir, init);
  assert.equal(packed.config.step, 1234);
  assert.equal(packed.config.bilingual.trained, true);
  const again = readGGUF(new Uint8Array(writeJsGGUF(base, packed)).buffer), first = readGGUF(new Uint8Array(bytes).buffer);
  for (const [name, t] of Object.entries(first.tensors)) assert.ok(again.tensors[name].data.every((x, i) => x === t.data[i]), name);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ model: { ...init.config.model, vocab_size: 76 }, step: 1 }));
  assert.throws(() => fromDump(dir, init), /not the bilingual configuration/);
});

test("the training data: every text has its tokens, the held-out sentences are never trained on", () => {
  const spec = JSON.parse(readFileSync(ROOT + "training/data/symbols.json", "utf8"));
  assert.deepEqual(spec.symbols, SYMBOLS, "symbols.json is the page's vocabulary (re-run tools/voice-data.mjs)");
  const table = new Map(read("training/data/phonemes.jsonl").map((r) => [r.text, r]));
  const key = (t) => t.normalize("NFKC").replace(/\s+/g, " ").trim();
  const teacher = read("training/data/teacher.jsonl"), holdout = read("training/data/holdout.jsonl"), originals = read("training/data/originals.jsonl");
  const recorded = JSON.parse(readFileSync(ROOT + "training/record/sentences.json", "utf8"));
  for (const r of [...teacher, ...holdout, ...originals, ...recorded]) assert.ok(table.has(key(r.text)), `no tokens for ${r.id}`);
  for (const r of table.values()) {
    const s = r.symbols.split(" ");
    assert.ok(s.every((x) => ID.has(x)) && s.length === r.stress.length && s[0] === "<bos>" && s.at(-1) === "<eos>", r.text);
    assert.equal(s[1] === "<es>", r.lang === "es", r.text);
  }
  const heldOut = new Set(holdout.map((r) => key(r.text)));
  assert.ok(![...teacher, ...recorded].some((r) => heldOut.has(key(r.text))), "a held-out sentence is in the training data");
  assert.deepEqual([holdout.filter((r) => r.lang === "es").length, holdout.filter((r) => r.lang === "en").length], [200, 200]);
  assert.ok(teacher.every((r) => r.voice === "MX1") && originals.every((r) => ["F2", "M2"].includes(r.speaker)));
  const sha = createHash("sha256").update(readFileSync(ROOT + "training/data/phonemes.jsonl")).digest("hex");
  assert.match(sha, /^[0-9a-f]{64}$/);
});
