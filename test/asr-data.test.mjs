// The speech-recognition dataset (training/asr/): the written requests, the speakers' packets, the made-up voices, and the
// measure (tools/asr-eval.mjs) that decides whether a fine-tuned recognizer may replace the sites' Whisper tiny.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { norm, evaluate } from "../tools/asr-eval.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// the split is a rule on the sentence (tools/asr-text.mjs writes it at the end; a file still being written lacks it)
const ruled = (t) => { const n = parseInt(createHash("sha256").update("asr-split1" + t.toLowerCase()).digest("hex").slice(0, 8), 16) % 100; return n < 10 ? "test" : n < 15 ? "dev" : "train"; };
const rows = readFileSync(ROOT + "training/asr/text/utterances.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => ({ ...r, split: r.split || ruled(r.text) }));
const prompts = JSON.parse(readFileSync(ROOT + "training/asr/prompts.json", "utf8"));

test("the written requests: said as spoken, Mexican Spanish first, split by sentence", () => {
  assert.ok(rows.length >= 1000);
  assert.ok(rows.every((r) => !/\d/.test(r.text)), "numbers in words");
  assert.ok(rows.every((r) => r.split === ruled(r.text)), "the split is the rule's");
  assert.equal(new Set(rows.map((r) => r.text.toLowerCase())).size, rows.length, "no sentence twice");
  assert.ok(rows.filter((r) => r.lang === "es").length > rows.length / 2);
  for (const c of ["requests", "corrections", "followups"]) assert.ok(rows.some((r) => r.category === c), c);
  assert.ok(!rows.some((r) => r.lang !== "en" && /\b(vosotros|habéis|ordenador|zumo|vale)\b/i.test(r.text)), "no Spain-only Spanish");
});

test("the speakers' packets: each training sentence read by one speaker, test sentences only from the test split", () => {
  const split = new Map(rows.map((r) => [r.id, r.split]));
  const reads = prompts.filter((p) => p.why === "read");
  assert.ok(reads.every((p) => split.get(p.id) === "train"));
  assert.equal(new Set(reads.map((p) => p.id)).size, reads.length, "a training sentence in one packet only");
  assert.ok(prompts.filter((p) => p.why === "test").every((p) => split.get(p.id) === "test"));
  for (const packet of new Set(prompts.map((p) => p.session))) {
    const mine = prompts.filter((p) => p.session === packet);
    assert.equal(mine.filter((p) => p.why === "scenario").length, 6, `packet ${packet}: six cards`);
    assert.ok(mine.filter((p) => p.why === "test").length === 12);
  }
  assert.ok(prompts.every((p) => p.lang !== "en"), "native Mexican speakers: Spanish and mixed");
});

test("the made-up voices: Mexican Spanish ones from many places and ages, and English ones; none a real person", () => {
  const { voices } = JSON.parse(readFileSync(ROOT + "training/asr/voices.json", "utf8"));
  const es = voices.filter((v) => v.lang === "es");
  assert.ok(es.length >= 20 && voices.length - es.length >= 4);
  assert.equal(new Set(voices.map((v) => v.id)).size, voices.length);
  assert.ok(es.every((v) => /Mexican/i.test(v.description)));
  assert.ok(new Set(es.map((v) => v.id.split("-")[1])).size === 2, "women and men");
});

test("the measure: words, places found and understanding, from what was heard", async () => {
  assert.equal(norm("¿Qué onda? ¡Unas CHELAS!"), "que onda unas chelas");
  const said = [
    { lang: "es", text: "¿Está abierta La Azotea ahorita?" },
    { lang: "es", text: "Unos tacos al pastor cerca del centro" },
  ];
  const perfect = await evaluate(said.map((r) => ({ ...r, heard: r.text })));
  assert.deepEqual([perfect.wer, perfect.names.found, perfect.names.sentences, perfect.understood], [0, 1, 1, 1]);
  const poor = await evaluate([{ ...said[0], heard: "esta abierta la sotea ahorita" }, { ...said[1], heard: "unos ratos al pastor cerca del centro" }]);
  assert.ok(poor.wer > 0 && poor.wer < 0.5);
  assert.equal(poor.names.found, 1, "a near miss of a name is still found by sound");
  assert.ok(poor.understood < 1, "tacos misheard: not understood as said");
});
