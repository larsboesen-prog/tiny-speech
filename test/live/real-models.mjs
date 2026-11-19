// Live check, not part of `npm test`: the check page with the real libraries and models from the network
// (transformers.js, Whisper, Pyodide, onnxruntime-web, tiny-voca from Hugging Face), in headless Chromium.
// It loads both workers, runs the round trip (tiny-voca speaks, Whisper listens) and prints what it heard.
// Run: npm run test:live -- path/to/dizione.zip   (the real phonemizer source, e.g. from mapsma.com/page5/tinyvoca/;
// needs cdn.jsdelivr.net, huggingface.co and its file host reachable)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startServer } from "../harness/server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SENTENCES = [
  { model: "onnx-community/whisper-tiny.en|", text: "La Azotea is open until ten tonight. Bocaciega closes at eleven." },
  { model: "onnx-community/whisper-tiny.en|", text: "Find three restaurants in Centro that are open now." },
  { model: "onnx-community/whisper-tiny|es", text: "¿Qué restaurantes están abiertos esta noche en el centro?" },
];

if (!process.argv[2]) { console.error("give the path of a real dizione.zip (see the top of this file)"); process.exit(2); }
const web = await startServer({ dizione: readFileSync(process.argv[2]) });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1) + " s";
try {
  await page.goto(`http://localhost:${web.port}/tiny-speech/check.html?site=live-test`);
  await page.waitForFunction(() => window.tinySpeechCheck);
  await page.selectOption("#model", SENTENCES[0].model);
  await page.click("#loadAsr");
  await page.click("#loadVoice");
  await page.waitForSelector("#heard .ok, #heard .bad", { timeout: 300000 });
  console.log(`[${secs()}] speech to text: ${(await page.textContent("#heard")).trim()}`);
  await page.waitForFunction(() => /Voice ready|bad/.test(document.querySelector("#spoken").innerHTML), null, { timeout: 300000 });
  console.log(`[${secs()}] voice: ${(await page.textContent("#spoken")).trim()}`);
  for (const { model, text } of SENTENCES) {
    if ((await page.inputValue("#model")) !== model) {
      await page.selectOption("#model", model);  // the page reloads the model on a change
      await page.waitForFunction((m) => document.querySelector("#heard").textContent.includes("Ready: " + m.split("|")[0]), model, { timeout: 300000 });
    }
    await page.fill("#say", text);
    const r = await page.evaluate(() => window.tinySpeechCheck.roundTrip());
    console.log(`[${secs()}] ${model}\n  said:  ${text}\n  heard: ${r.heard ?? r.error}\n  words heard: ${Math.round((r.score || 0) * 100)}%  · voice ${r.spokeMs} ms for ${r.seconds?.toFixed(1)} s of audio · speech to text ${r.runMs} ms`);
  }
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  web.server.close();
}
