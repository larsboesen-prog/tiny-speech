// Names found before / after names-by-sound, and after learning from picks, on recorded questions (owner, 22 Nov 2026: "record 30 to
// 50 place names once in my own voice. Use those recordings as a test set, not for training. Report 'names found before / after' on
// that set"; then "build option 1 and add the second take").
//
//   NODE_PATH=/opt/node-tools/node_modules node tools/names-test.mjs <recordings.json> [--lang en|es] [--out report.json]
//
// recordings.json: what record-names/ saves ({names: [{id, name, take (1, 2 or 3: the other places once), prompt, wav (base64 16 kHz WAV)}]}). Each question is
// heard exactly as /page5 hears it: the ears in Chromium through browser/asr-worker.js (the newest model, the page's word list leaning
// to --lang, the city's names to find by sound). For each: BEFORE = the place the reader finds in the written words (what /page5
// answered until update 5); AFTER = with the names by sound (engines/ears-spot.js soundChoice, as /page5 uses it): the place answered,
// or the names offered as buttons. LEARNING (when there are second takes): a fresh worker hears each first take where the right name
// was offered as a button and learns it as /page5 does on a tap ({type: "learn"}), then hears the second takes; and once more learning
// from every first take not answered right (as if each were corrected): the most learning can give.
// The WAV files go to training/names-test/ (gitignored: the owner's voice stays out of the repository).
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
const clips = (rec.names || rec.clips || []).map((c, i) => ({ ...c, take: c.take || 1, wavPath: null, i }));
const dir = `training/names-test/${(rec.made || "set").replace(/[^0-9a-z-]/gi, "")}-${lang}/`;
mkdirSync(ROOT + dir, { recursive: true });
for (const c of clips) { c.wavPath = `/${dir}${String(c.i).padStart(2, "0")}-${c.id}-${c.take}.wav`; writeFileSync(ROOT + c.wavPath.slice(1), Buffer.from(c.wav, "base64")); }

// the ears in Chromium, as the page has them; `steps` as test/harness/harness.html runs them
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.error("needs Playwright (NODE_PATH=/opt/node-tools/node_modules)"); process.exit(2); }
const model = readdirSync(ROOT + "engines/ears").filter((f) => /^ears-int8.*\.onnx$/.test(f)).sort().pop();
const web = await startServer();
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
const url = `/tiny-speech/asr-worker.js?v=names-test&libs=t-names&ears=/engines/ears/${model}&lexicon=/packs/mx-sma/ears-lexicon-${lang}.json&names=/packs/mx-sma/ears-names.json`;
const hear = (c) => [{ send: { type: "transcribe", reqId: c.i + 1, model: "tiny-ears", audio: { wav: c.wavPath } } }, { wait: "text" }];
async function run(steps) {  // a fresh worker each time: nothing learned carries over
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const r = await page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 900000 }), [url, [{ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" }, ...steps]]);
  await page.context().close();
  const texts = r.posted.filter((m) => m && m.type === "text");
  if (texts.some((m) => m.error) || r.posted.some((m) => m && m.type === "__onerror")) { console.error("the worker failed:", JSON.stringify(r.posted.filter((m) => m && (m.error || m.type === "__onerror")).slice(0, 3))); process.exit(1); }
  return { texts: new Map(texts.map((m) => [m.reqId - 1, m])), learned: r.posted.filter((m) => m && m.type === "learned") };
}

// before and after, with the reader /page5's answers come from (tiny-speech's copy, the same rules: test/golden)
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
const nameOf = Object.fromEntries(pack.places.map((p) => [p.id, p.name]));
function judge(c, m) {
  const heard = m.text, spot = m.spot || [], q = asker.read(heard, now);
  const before = q.named ? q.named.id : null;
  const ch = soundChoice(heard, q, spot, { override: lang === "en" });
  const after = ch.pick || (ch.ask.length && !ch.keep ? null : before);
  return { id: c.id, take: c.take, name: c.name, said: c.prompt, heard, before, after, offered: ch.ask, top: spot.slice(0, 3).map((s) => `${s.name} ${s.perSound}`) };
}
const first = await run(clips.flatMap(hear));
const rows = clips.map((c) => judge(c, first.texts.get(c.i)));
const tally = (xs) => ({ n: xs.length, before: xs.filter((x) => x.before === x.id).length, wrongBefore: xs.filter((x) => x.before && x.before !== x.id).length,
  after: xs.filter((x) => x.after === x.id).length, offered: xs.filter((x) => x.after !== x.id && x.offered.includes(x.id)).length, wrong: xs.filter((x) => x.after && x.after !== x.id).length });
const sum = { all: tally(rows), take1: tally(rows.filter((x) => x.take === 1)), take2: tally(rows.filter((x) => x.take === 2)), take3: tally(rows.filter((x) => x.take === 3)) };
const line = (t) => `names found before ${t.before} of ${t.n} (${(100 * t.before / t.n).toFixed(0)}%), after ${t.after} (${(100 * t.after / t.n).toFixed(0)}%), ${t.offered} more as a button; a wrong place ${t.wrongBefore} → ${t.wrong}`;
console.log(`${rows.length} recorded questions, the ${lang === "es" ? "Spanish" : "English"} page:`);
console.log(`  all:     ${line(sum.all)}`);
if (sum.take2.n) { console.log(`  take 1:  ${line(sum.take1)}`); console.log(`  take 2:  ${line(sum.take2)}`); }
if (sum.take3.n) console.log(`  take 3 (the other places, never looked at while tuning):  ${line(sum.take3)}`);

// learning from picks: the second takes after learning from the first
const second = clips.filter((c) => c.take === 2);
if (second.length) {
  const firstOf = new Map(clips.filter((c) => c.take === 1).map((c) => [c.id, c]));
  for (const [label, teach] of [["learned from picks (the right name was a button)", (x) => x.after !== x.id && x.offered.includes(x.id)],
    ["learned from every first take not answered right", (x) => x.after !== x.id]]) {
    const taught = rows.filter((x) => x.take === 1 && teach(x)).map((x) => firstOf.get(x.id));
    const r = await run([...taught.flatMap((c) => [...hear(c), { send: { type: "learn", heardId: "last", id: c.id } }, { wait: "learned" }]), ...second.flatMap(hear)]);
    const after = second.map((c) => judge(c, r.texts.get(c.i))), t = tally(after);
    sum[label.startsWith("learned from picks") ? "learnPicks" : "learnAll"] = { learned: r.learned.filter((m) => m.phones).length, ...t };
    console.log(`  take 2 ${label}: ${r.learned.filter((m) => m.phones).length} names learned → found ${t.after} of ${t.n} (was ${sum.take2.after}), ${t.offered} more as a button (was ${sum.take2.offered}); a wrong place ${t.wrong} (was ${sum.take2.wrong})`);
    if (label.startsWith("learned from picks")) after.forEach((x, k) => { rows.find((y) => y.take === 2 && y.id === x.id).afterLearning = x.after; });
  }
}
await browser.close(); web.server.close();
for (const x of rows) {
  const mark = x.after === x.id ? (x.before === x.id ? "=" : "+") : x.offered.includes(x.id) ? "?" : x.after ? "x" : "-";
  const learnt = x.afterLearning === undefined ? "" : x.afterLearning === x.id && x.after !== x.id ? "  [after learning: found]" : "";
  console.log(`  ${mark} ${x.said.padEnd(36)} heard "${x.heard}"${x.after && x.after !== x.id ? ` → ${nameOf[x.after]}` : ""}${mark === "?" ? ` (offered: ${x.offered.map((id) => nameOf[id]).join(", ")})` : ""}${learnt}`);
}
if (out) writeFileSync(out, JSON.stringify({ ...sum, lang, model, rows }, null, 1));
