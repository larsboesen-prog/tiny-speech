// The recording page (training/record/) in Chromium with a fake microphone: it records a take, checks it, keeps it in IndexedDB
// and downloads a session as a zip that Python's zipfile reads (the GPU pipeline opens it with Python).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./harness/server.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: skipped */ }
const skip = chromium ? false : "Playwright is not installed";

function wav(pieces, rate = 48000) {
  const n = Math.round(pieces.reduce((s, [sec]) => s + sec, 0) * rate), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  let at = 0;
  for (const [sec, amp] of pieces) for (let i = 0; i < Math.round(sec * rate); i++, at++) buf.writeInt16LE(Math.round(amp * 32767 * Math.sin((2 * Math.PI * 220 * at) / rate)), 44 + at * 2);
  return buf;
}

let web, browser, page, errors, dir;
before(async () => {
  if (skip) return;
  web = await startServer();
  dir = mkdtempSync(join(tmpdir(), "tiny-speech-rec-"));
  writeFileSync(join(dir, "mic.wav"), wav([[0.5, 0], [1.5, 0.3], [1, 0]]));
  browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(dir, "mic.wav")}`, "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ permissions: ["microphone"] });
  page = await context.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:${web.port}/training/record/index.html`);
  await page.waitForFunction(() => window.recorder);
});
after(async () => { await browser?.close(); web?.server.close(); });

test("the take is trimmed and checked", { skip }, async () => {
  const r = await page.evaluate(() => {
    const rate = 48000, x = new Float32Array(rate * 3);
    for (let i = rate; i < rate * 2; i++) x[i] = 0.3 * Math.sin(i / 10);
    const ok = window.recorder.analyse(x, rate, { noiseDb: -90, expected: 1.2 });
    const loud = x.map((v) => Math.max(-1, Math.min(1, v * 5)));
    const early = new Float32Array(rate * 2); for (let i = 0; i < rate; i++) early[i] = 0.3 * Math.sin(i / 10);
    return { ok: [ok.seconds, ok.flags, ok.peakDb], clipped: window.recorder.analyse(loud, rate, { noiseDb: -90 }).flags,
      early: window.recorder.analyse(early, rate, { noiseDb: -90 }).flags, silent: window.recorder.analyse(new Float32Array(rate), rate, { noiseDb: -90 }).flags,
      short: window.recorder.analyse(x, rate, { noiseDb: -90, expected: 5 }).flags };
  });
  assert.deepEqual(r.ok, [1.6, [], -10.5], "one second of sound and 0.3 s each side");
  assert.ok(r.clipped.includes("clipped"));
  assert.ok(r.early.includes("started-early"));
  assert.deepEqual(r.silent, ["silent"]);
  assert.ok(r.short.includes("short"));
});

test("records, keeps and downloads a session that Python can open", { skip }, async () => {
  assert.equal(await page.isDisabled("#start"), true, "no microphone before the consent box is ticked");
  await page.check("#consent");
  await page.click("#start");
  await page.waitForSelector("#studio:not([hidden])");
  assert.match(await page.textContent("#sentence"), /Investigadores desarrollan/);
  await page.evaluate(() => { window.recorder.state.noiseDb = -90; });
  await page.keyboard.press("Space");
  await page.waitForTimeout(3200);
  await page.keyboard.press("Space");
  assert.match(await page.textContent("#status"), /level -?\d/);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.recorder.kept() === 1);
  assert.match(await page.textContent("#progress"), /^1 of 125 kept/);
  assert.match(await page.textContent("#sentence"), /concluye nuestro resumen/, "on to the next sentence");
  await page.reload();
  await page.waitForFunction(() => window.recorder);
  assert.equal(await page.evaluate(() => window.recorder.kept()), 1, "kept across a reload");
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await window.recorder.sessionZip(1)).arrayBuffer())]);
  const file = join(dir, "session1.zip");
  writeFileSync(file, Buffer.from(bytes));
  const out = JSON.parse(execFileSync("python3", ["-I", "-c", `
import zipfile, json, wave, sys
z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip()
w = wave.open(z.open("wavs/es-news-00001.wav") if "wavs/es-news-00001.wav" in z.namelist() else z.open([n for n in z.namelist() if n.endswith(".wav")][0]))
print(json.dumps({"bad": bad, "names": z.namelist(), "csv": z.read("metadata.csv").decode().splitlines(), "info": json.loads(z.read("info.json")),
  "wav": [w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()]}))`, file]).toString());
  assert.equal(out.bad, null, "every CRC matches");
  assert.equal(out.names.length, 3);
  assert.equal(out.csv[0], "id|lang|text|seconds|peak_db|snr_db|flags|kind|prompt");
  assert.match(out.csv[1], /^es-[a-z]+-\d{5}\|es\|Investigadores desarrollan/);
  assert.equal(out.info.consent.ticked, true, "the consent tick, remembered across the reload");
  assert.equal(out.info.settings.echoCancellation, false);
  assert.deepEqual(out.wav.slice(0, 2), [1, 2], "mono, 16-bit");
  assert.ok(out.wav[3] > out.wav[2] * 0.8, "at least the tone's length");
  assert.deepEqual(errors, []);
});

test("the speech-recognition set: its own packet, speaker details, and a card said in one's own words with its transcript", { skip }, async () => {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const p = await context.newPage();
  await p.goto(`http://localhost:${web.port}/training/record/index.html?set=asr&packet=2`);
  await p.waitForFunction(() => window.recorder);
  assert.equal(await p.evaluate(() => window.recorder.set), "asr");
  assert.equal(await p.isVisible("#speakerInfo"), true);
  assert.match(await p.getAttribute("#consentLink", "href"), /CONSENT-ASR\.md$/);
  await p.fill("#speaker", "H02");
  await p.selectOption("#age", "30–44");
  await p.fill("#region", "Guanajuato");
  await p.check("#consent");
  await p.click("#start");
  await p.waitForSelector("#studio:not([hidden])");
  const first = await p.evaluate(() => window.recorder.list.find((r) => r.session === "2"));
  assert.equal(await p.textContent("#sentence"), first.text, "packet 2 from the start");
  // go to the packet's first card
  const card = await p.evaluate(() => window.recorder.list.filter((r) => r.session === "2").findIndex((r) => r.why === "scenario"));
  await p.evaluate((i) => { window.recorder.state.index = i; window.recorder.state.noiseDb = -90; }, card);
  await p.click("#skip"); await p.click("#back");
  assert.equal(await p.isVisible("#saidBox"), true, "a card asks for what was said");
  await p.click("#rec"); await p.waitForTimeout(2500); await p.click("#rec");
  await p.click("#keep");
  assert.match(await p.textContent("#status"), /Type what was said first/);
  await p.fill("#said", "Oye, ¿dónde puedo cenar por el centro con mis amigos, algo barato?");
  await p.click("#keep");
  await p.waitForFunction(() => window.recorder.kept() === 1);
  const bytes = await p.evaluate(async () => [...new Uint8Array(await (await window.recorder.sessionZip("2")).arrayBuffer())]);
  const file = join(dir, "asr-packet2.zip");
  writeFileSync(file, Buffer.from(bytes));
  const out = JSON.parse(execFileSync("python3", ["-I", "-c", `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({"info": json.loads(z.read("info.json")), "csv": z.read("metadata.csv").decode().splitlines()}))`, file]).toString());
  assert.equal(out.info.set, "asr");
  assert.equal(out.info.speaker, "H02");
  assert.equal(out.info.speakerInfo.region, "Guanajuato");
  assert.equal(out.info.consent.form, "CONSENT-ASR.md");
  assert.equal(out.csv[0], "id|lang|text|seconds|peak_db|snr_db|flags|kind|prompt");
  const [, , text, , , , , kind, prompt] = out.csv[1].split("|");
  assert.deepEqual([text, kind], ["Oye, ¿dónde puedo cenar por el centro con mis amigos, algo barato?", "scenario"]);
  assert.ok(prompt.startsWith("Pide") || prompt.startsWith("Pregunta") || prompt.startsWith("Primero") || prompt.startsWith("Cambia") || prompt.startsWith("Di "), prompt);
  assert.equal(await p.evaluate(async () => (await window.recorder.allClips()).length), 1, "its own storage, apart from the voice set");
  await context.close();
});
