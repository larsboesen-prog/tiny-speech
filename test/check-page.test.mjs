// The check page (browser/check.html) in Chromium, with the stand-in libraries: it loads both workers, teaches names, runs the
// round trip, and records from a fake microphone fed a WAV (quiet, a tone, quiet), which must end by itself on the pause.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./harness/server.mjs";
import { installFakes } from "./harness/fakes.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: skipped */ }
const skip = chromium ? false : "Playwright is not installed";

function wav(pieces, rate = 48000) {
  const n = Math.round(pieces.reduce((s, [sec]) => s + sec, 0) * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  let at = 0;
  for (const [sec, amp] of pieces) {
    for (let i = 0; i < Math.round(sec * rate); i++, at++) buf.writeInt16LE(Math.round(amp * 32767 * Math.sin((2 * Math.PI * 300 * at) / rate)), 44 + at * 2);
  }
  return buf;
}

let web, browser, page, errors;
before(async () => {
  if (skip) return;
  web = await startServer();
  const dir = mkdtempSync(join(tmpdir(), "tiny-speech-mic-"));
  const file = join(dir, "question.wav");
  writeFileSync(file, wav([[0.6, 0], [1.2, 0.25], [2.5, 0]]));
  browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${file}%noloop`, "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  await installFakes(context, {});
  page = await context.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:${web.port}/tiny-speech/check.html?site=mapsma&dizione=/page5/tinyvoca/dizione.zip&packs=/packs/`);
});
after(async () => { await browser?.close(); web?.server.close(); });

test("the page names the core and the site", { skip }, async () => {
  await page.waitForFunction(() => window.tinySpeechCheck);
  assert.match(await page.textContent("#about"), /tiny-speech 0\.3\.0 · site: mapsma · voice: tiny-voca ONNX \+ Pyodide, dizione: \/page5\/tinyvoca\/dizione\.zip/);
});

test("both workers load, and the voice is taught the names", { skip }, async () => {
  await page.click("#loadAsr");
  await page.waitForSelector("#heard .ok");
  assert.match(await page.textContent("#heard"), /Ready: onnx-community\/whisper-tiny\.en \(tiny-speech 0\.3\.0/);
  await page.click("#teachBtn");
  await page.click("#loadVoice");
  await page.waitForFunction(() => /Voice ready|Taught/.test(document.querySelector("#spoken").textContent));
  await page.waitForFunction(() => /"type":"taught","words":2/.test(document.querySelector("#log").textContent));
  await page.click("#phones");
  await page.waitForFunction(() => /Phones:/.test(document.querySelector("#spoken").textContent));
});

test("round trip: the voice's audio reaches speech to text", { skip }, async () => {
  const result = await page.evaluate(() => window.tinySpeechCheck.roundTrip());
  assert.ok(!result.error, result.error);
  assert.ok(result.seconds > 0, "audio was made");
  assert.match(result.heard, /what is open tonight \d+/, "the stand-in model heard the audio");
  assert.ok(Number.isFinite(result.firstSoundMs) && result.firstSoundMs >= 0, "the time to the voice's first sound");
});

test("the city pack's load time, the voice's first sound and the memory are shown (plan step B11)", { skip }, async () => {
  const first = await page.evaluate(() => window.tinySpeechCheck.loadPack());
  const again = await page.evaluate(() => window.tinySpeechCheck.loadPack());
  assert.deepEqual([first.city, first.from, again.from], ["mx-sma", "network", "device"], "the site's city, then from this device");
  assert.ok(first.places >= 96 && first.ms >= 0);
  const shown = await page.textContent("#timings");
  assert.match(shown, /City pack mx-sma 2026-\d\d-\d\d\.[0-9a-f]{6}: \d+ places, from the network, in \d+ ms\./);
  assert.match(shown, /from this device, in \d+ ms\./);
  assert.match(shown, /Voice: first sound after \d+ ms\./);
  assert.match(shown, /Memory: \d+ MB used of the page's JavaScript heap/, "Chromium reports its heap");
});

test("recording from the microphone ends by itself on the pause", { skip }, async () => {
  await page.click("#mic");
  await page.waitForFunction(() => /speech started/.test(document.querySelector("#log").textContent), null, { timeout: 8000 });
  await page.waitForFunction(() => /recording ended/.test(document.querySelector("#log").textContent), null, { timeout: 10000 });
  const log = await page.textContent("#log");
  assert.match(log, /recording ended \{"why":"pause"/, "ended by the 0.7 s pause, not the timer");
  assert.match(log, /"via":"AudioWorklet"/);
  await page.waitForFunction(() => /what is open tonight/.test(document.querySelector("#heard").textContent), null, { timeout: 8000 });
  assert.match(await page.textContent("#heard"), /s of speech · waited \d+ ms/);
});

test("no errors on the page", { skip }, async () => {
  assert.deepEqual(errors, []);
});
