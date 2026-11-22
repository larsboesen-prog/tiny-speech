// Names found before / after names-by-sound, on recorded questions (owner, 22 Nov 2026: "record 30 to 50 place names once in my own
// voice. Use those recordings as a test set, not for training. Report 'names found before / after' on that set").
//
//   NODE_PATH=/opt/node-tools/node_modules node tools/names-test.mjs <recordings.json> [--lang en|es] [--out report.json]
//
// recordings.json: what record-names/ saves ({names: [{id, name, prompt, wav (base64 16 kHz WAV)}]}). Each question is heard exactly as
// /page5 hears it: the ears in Chromium through browser/asr-worker.js (the newest model, the page's word list leaning to --lang, the
// city's names to find by sound). Then, for each: BEFORE = the place the reader finds in the written words (what /page5 answered until
// now); AFTER = with the names by sound (engines/ears-spot.js soundChoice, as /page5 uses it): the place answered, or the names offered
// as buttons. The WAV files go to training/names-test/ (gitignored: the owner's voice stays out of the repository).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startServer } from "../test/harness/server.mjs";
import { soundChoice } from "../engines/ears-spot.js";
import { loadCore } from "../test/golden/mapsma.mjs";
import { createAsker, nowAt } from "../domains/places/ask.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))[0];
if (!file) { console.error("usage: node tools/names-test.mjs <recordings.json> [--lang en|es] [--out report.json]"); process.exit(2); }
const lang = opt("--lang", "en"), out = opt("--out", null);
const rec = JSON.parse(readFileSync(file, "utf8"));
const clips = rec.names || rec.clips || [];
const dir = `training/names-test/${(rec.made || "set").replace(/[^0-9a-z-]/gi, "")}-${lang}/`;
mkdirSync(ROOT + dir, { recursive: true });
clips.forEach((c, i) => writeFileSync(ROOT + dir + `${String(i).padStart(2, "0")}-${c.id}.wav`, Buffer.from(c.wav, "base64")));

// hear them all in Chromium, as the page does
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.error("needs Playwright (NODE_PATH=/opt/node-tools/node_modules)"); process.exit(2); }
const model = readdirSync(ROOT + "engines/ears").filter((f) => /^ears-int8.*\.onnx$/.test(f)).sort().pop();
const web = await startServer();
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const url = `/tiny-speech/asr-worker.js?v=names-test&libs=t-names&ears=/engines/ears/${model}&lexicon=/packs/mx-sma/ears-lexicon-${lang}.json&names=/packs/mx-sma/ears-names.json`;
const steps = [{ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" }];
clips.forEach((c, i) => steps.push({ send: { type: "transcribe", reqId: i + 1, model: "tiny-ears", audio: { wav: `/${dir}${String(i).padStart(2, "0")}-${c.id}.wav` } } }, { wait: "text" }));
const page = await (await browser.newContext()).newPage();
await page.goto(`http://localhost:${web.port}/harness/harness.html`);
const r = await page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 600000 }), [url, steps]);
await browser.close(); web.server.close();
const texts = r.posted.filter((m) => m && m.type === "text");
if (texts.length !== clips.length || texts.some((m) => m.error)) { console.error("the worker failed:", JSON.stringify(r.posted.filter((m) => m && (m.error || m.type === "__onerror")).slice(0, 3))); process.exit(1); }

// before and after, with the reader /page5's answers come from (tiny-speech's copy, the same rules: test/golden)
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
const nameOf = Object.fromEntries(pack.places.map((p) => [p.id, p.name]));
const rows = clips.map((c, i) => {
  const heard = texts[i].text, spot = texts[i].spot || [], q = asker.read(heard, now);
  const before = q.named ? q.named.id : null;
  const ch = soundChoice(heard, q, spot, { override: lang === "en" });
  const after = ch.pick || (ch.ask.length && !ch.keep ? null : before);
  return { id: c.id, name: c.name, said: c.prompt, heard, before, after, offered: ch.ask, top: spot.slice(0, 3).map((s) => `${s.name} ${s.perSound}`) };
});
const n = rows.length, count = (f) => rows.filter(f).length;
const sum = {
  clips: n,
  before: { found: count((x) => x.before === x.id), wrong: count((x) => x.before && x.before !== x.id) },
  after: { found: count((x) => x.after === x.id), offered: count((x) => x.after !== x.id && x.offered.includes(x.id)), wrong: count((x) => x.after && x.after !== x.id) },
};
console.log(`${n} recorded names, the ${lang === "es" ? "Spanish" : "English"} page:`);
console.log(`  names found before: ${sum.before.found} of ${n} (${(100 * sum.before.found / n).toFixed(1)}%), a wrong place ${sum.before.wrong}`);
console.log(`  names found after:  ${sum.after.found} of ${n} (${(100 * sum.after.found / n).toFixed(1)}%), a wrong place ${sum.after.wrong}; offered as a button ${sum.after.offered} more`);
console.log(`  found or one tap away: ${sum.after.found + sum.after.offered} of ${n}`);
for (const x of rows) {
  const mark = x.after === x.id ? (x.before === x.id ? "=" : "+") : x.offered.includes(x.id) ? "?" : x.after ? "x" : "-";
  console.log(`  ${mark} ${x.said.padEnd(36)} heard "${x.heard}"${x.after && x.after !== x.id ? ` → ${nameOf[x.after]}` : ""}${mark === "?" ? ` (offered: ${x.offered.map((id) => nameOf[id]).join(", ")})` : ""}`);
}
if (out) writeFileSync(out, JSON.stringify({ ...sum, lang, model, rows }, null, 1));
