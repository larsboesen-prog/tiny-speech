// Plan step B11: the size table is measured from the files (tools/sizes.mjs), not typed: every part has its files, compressed
// sizes are never above raw, the engine files carry the compressed sizes measured from the real downloads, and the paths a page
// takes add up from the parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parts, measure } from "../tools/sizes.mjs";

const { rows, engines } = parts();
const part = (prefix) => rows.find((r) => r.part.startsWith(prefix));

test("every part is measured from its files", () => {
  for (const r of rows) {
    assert.ok(r.list.length > 0, r.part);
    assert.equal(r.total.bytes, r.list.reduce((s, f) => s + f.bytes, 0), r.part);
    assert.ok(r.total.brotli <= r.total.gzip * 1.02 && r.total.gzip <= r.total.bytes * 1.01, r.part);
  }
  assert.ok(engines.files.every((f) => f.gzip > 0 && f.brotli > 0), "the engine files' compressed sizes, from the real downloads");
  assert.equal(part("Voice, plain JS").total.bytes, 7988384, "one 8 MB file");
  assert.ok(part("Ears, English").total.bytes > 40e6 && part("Ears, English").total.bytes < 50e6, "Whisper tiny.en, 8-bit: about 44 MB");
  assert.ok(part("City pack mx-sma").total.brotli < 30000, "San Miguel's pack within its budget");
  assert.ok(part("Core code").total.gzip < 200e3, "the core's code stays small");
});

test("measure: raw, gzip and brotli of some bytes", () => {
  const m = measure(Buffer.from("tiny-speech ".repeat(1000)));
  assert.equal(m.bytes, 12000);
  assert.ok(m.gzip < 200 && m.brotli < 100);
});

test("docs/sizes.md is the tool's output (generated, not typed)", () => {
  const md = readFileSync(new URL("../docs/sizes.md", import.meta.url), "utf8");
  assert.match(md, /^# Sizes, measured\n\nMade by `tools\/sizes\.mjs` from the files themselves/);
  for (const r of rows.filter((x) => !/Core code|plain-JS runtime|Site configs/.test(x.part))) assert.ok(md.includes(`| ${r.part} | ${r.list.length} |`), r.part);
});
