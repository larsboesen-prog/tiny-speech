// Live check, not part of `npm test`: the check page with the real libraries and models from the network (transformers.js,
// Whisper, Pyodide, onnxruntime-web, tiny-voca), in headless Chromium. For each voice (the ONNX + Pyodide worker the sites use,
// and the plain-JS worker) it runs the round trip: the voice says a sentence, Whisper writes it back, the words are compared.
// Run: npm run test:live -- path/to/dizione.zip   (the ONNX worker's phonemizer source, e.g. from mapsma.com/page5/tinyvoca/;
// needs cdn.jsdelivr.net, huggingface.co and its file host; the plain-JS voice needs `npm run fetch:voice` first)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startServer } from "../harness/server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SENTENCES = [
  { model: "onnx-community/whisper-tiny.en|", text: "La Azotea is open until ten tonight. Bocaciega closes at eleven." },
  { model: "onnx-community/whisper-tiny.en|", text: "Find three restaurants in Centro that are open now." },
  { model: "onnx-community/whisper-tiny|es", lang: "es", text: "¿Qué restaurantes están abiertos esta noche en el centro?" },
  { model: "onnx-community/whisper-tiny|es", lang: "es", text: "Aquí tienes cuatro lugares abiertos para cenar hoy. La Azotea, abierta hasta la medianoche." },
  { model: "onnx-community/whisper-tiny|es", lang: "es", text: "Sí. Bocaciega está abierto ahora, hasta las diez de la noche." },
];
const VOICES = [["ONNX + Pyodide (the sites today)", ""], ["plain JS", "&voice=js&model=/vendor/tiny-voca/tiny-voca-js.gguf"]];

if (!process.argv[2]) { console.error("give the path of a real dizione.zip (see the top of this file)"); process.exit(2); }
const web = await startServer({ dizione: readFileSync(process.argv[2]) });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1) + " s";

async function voiceRun(name, extra) {
  console.log(`\n=== voice: ${name}`);
  await page.goto(`http://localhost:${web.port}/tiny-speech/check.html?site=live-test${extra}`);
  await page.waitForFunction(() => window.tinySpeechCheck);
  await page.selectOption("#model", SENTENCES[0].model);
  await page.click("#loadAsr");
  await page.click("#loadVoice");
  await page.waitForSelector("#heard .ok, #heard .bad", { timeout: 300000 });
  console.log(`[${secs()}] speech to text: ${(await page.textContent("#heard")).trim()}`);
  await page.waitForFunction(() => /Voice ready|bad/.test(document.querySelector("#spoken").innerHTML), null, { timeout: 300000 });
  console.log(`[${secs()}] voice: ${(await page.textContent("#spoken")).trim()}`);
  for (const { model, text, lang = "en" } of SENTENCES) {
    await page.selectOption("#sayLang", lang);
    if ((await page.inputValue("#model")) !== model) {
      await page.selectOption("#model", model);  // the page reloads the model on a change
      await page.waitForFunction((m) => document.querySelector("#heard").textContent.includes("Ready: " + m.split("|")[0]), model, { timeout: 300000 });
    }
    await page.fill("#say", text);
    const r = await page.evaluate(() => window.tinySpeechCheck.roundTrip());
    console.log(`[${secs()}] ${model} (read as ${lang})\n  said:  ${text}\n  heard: ${r.heard ?? r.error}\n  words heard: ${Math.round((r.score || 0) * 100)}%  · voice ${r.spokeMs} ms for ${r.seconds?.toFixed(1)} s of audio · speech to text ${r.runMs} ms`);
  }
}

try {
  for (const [name, extra] of VOICES) await voiceRun(name, extra);
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  web.server.close();
}
