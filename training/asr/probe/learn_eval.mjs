// Learning names from picks (22 Nov 2026; README.md here, "Learning from picks"), simulated on the accented stand-in clips: each voice
// asks "Is X open?" (take 1) for the 40 names; where /page5 would offer the right name as a button, the visitor taps it and the phone
// learns how that name sounded (engines/ears-spot.js heardAs → learn). Then the same voice asks "X, when is it open?" (take 2): names
// found with and without what was learned. And the ordinary questions (the controls) with that voice's learned readings in place:
// any new wrong answer or extra "Did you mean"?
//
//   node training/asr/probe/learn_eval.mjs acc/res-page.jsonl acc/cache-page en/res-spot.jsonl:en/cache-v3,cov/res-spot-en.jsonl:cov/cache-v3 [--all]
//
// --all: learn from every take 1 the page did not answer right (as if the visitor also corrected the ones not offered): an upper bound.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TS = fileURLToPath(new URL("../../../", import.meta.url));
const { buildNameSpotter, soundChoice, SOUND_RULES } = await import(TS + "engines/ears-spot.js");
const RULES = { ...SOUND_RULES, ...JSON.parse(process.env.RULES || "{}") };
const { loadCore } = await import(TS + "test/golden/mapsma.mjs");
const { createAsker, nowAt } = await import(TS + "domains/places/ask.js");

const args = process.argv.slice(2), pos = args.filter((a) => !a.startsWith("--")), all = args.includes("--all");
const [accRes, accCache, controls] = pos;
const { pack } = await loadCore();
const asker = createAsker({ pack, random: () => 0.5 });
const now = nowAt(pack.tz, new Date("2026-11-21T20:00:00-06:00"));
const vocab = JSON.parse(readFileSync(TS + "engines/ears/vocab.json", "utf8")), V = Object.keys(vocab).length, blank = vocab["<pad>"];
const lexData = JSON.parse(readFileSync(TS + "packs/dist/mx-sma/ears-lexicon-en.json", "utf8"));
const names = JSON.parse(readFileSync(TS + "packs/dist/mx-sma/ears-names.json", "utf8")).names;
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
const full = pack.places.filter((p) => p.name.length >= 8).map((p) => [p.id, fold(p.name)]);
const npy = (f) => { const b = readFileSync(f), hl = b.readUInt16LE(8), header = b.slice(10, 10 + hl).toString(), shape = header.match(/\((\d+), (\d+)\)/);
  return { lp: new Float32Array(b.buffer.slice(b.byteOffset + 10 + hl, b.byteOffset + b.length)), frames: +shape[1] }; };
const load = (res, cache) => readFileSync(res, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => existsSync(`${cache}/${r.id}.npy`)).map((r) => ({ ...r, cache }));

// what the page does with one clip, given the spotter: {answer, offered}
function decide(r, spotter) {
  const { lp, frames } = npy(`${r.cache}/${r.id}.npy`);
  const q = asker.read(r.heard, now), spot = spotter.spot(lp, frames, V, blank, 5);
  const c = soundChoice(r.heard, q, spot, { rules: RULES });
  return { answer: c.pick || (c.ask.length && !c.keep ? null : q.named?.id || null), offered: c.ask, lp, frames };
}
const acc = load(accRes, accCache);
const ctrl = controls.split(",").flatMap((x) => { const [res, cache] = x.split(":"); return load(res, cache); })
  .map((r) => ({ ...r, expected: r.expected || (full.find(([, n]) => fold(r.text).includes(n)) || [])[0] || null }));

const base = buildNameSpotter(names, lexData, vocab);
const ctrlBase = ctrl.map((r) => decide(r, base).answer);
const tot = { learned: 0, n2: 0, before2: 0, after2: 0, offered2b: 0, offered2a: 0, wrong2b: 0, wrong2a: 0, ctrlWrong: 0, ctrlExtra: 0, ctrlLost: 0 };
console.log(`learning from ${all ? "every take 1 not answered right" : "taps (take 1 offered the right name)"}; testing take 2 ("X, when is it open?")`);
for (const voice of [...new Set(acc.map((r) => r.voice))]) {
  const sp = buildNameSpotter(names, lexData, vocab);
  let learned = 0;
  for (const r of acc.filter((x) => x.voice === voice && x.id.includes("-0-"))) {
    const d = decide(r, base);
    if (d.answer === r.expected) continue;
    if (!all && !d.offered.includes(r.expected)) continue;
    learned += sp.learn(r.expected, sp.heardAs(d.lp, d.frames, V, blank, r.expected)) ? 1 : 0;
  }
  const t2 = acc.filter((x) => x.voice === voice && x.id.includes("-1-"));
  const b = t2.map((r) => decide(r, base)), a = t2.map((r) => decide(r, sp));
  const s = { n: t2.length, before: b.filter((d, i) => d.answer === t2[i].expected).length, after: a.filter((d, i) => d.answer === t2[i].expected).length,
    offB: b.filter((d, i) => d.answer !== t2[i].expected && d.offered.includes(t2[i].expected)).length,
    offA: a.filter((d, i) => d.answer !== t2[i].expected && d.offered.includes(t2[i].expected)).length,
    wrongB: b.filter((d, i) => d.answer && d.answer !== t2[i].expected).length, wrongA: a.filter((d, i) => d.answer && d.answer !== t2[i].expected).length };
  // the ordinary questions with this voice's learned readings
  let cw = 0, cx = 0, cl = 0;
  ctrl.forEach((r, i) => { const d = decide(r, sp); if (d.answer && d.answer !== r.expected && d.answer !== ctrlBase[i]) cw++; if (!r.expected && d.offered.length && !decide(r, base).offered.length) cx++; if (ctrlBase[i] === r.expected && r.expected && d.answer !== r.expected) cl++; });
  console.log(`  ${voice.padEnd(26)} learned ${String(learned).padStart(2)} | take 2: found ${s.before} → ${s.after} of ${s.n}, offered ${s.offB} → ${s.offA}, wrong ${s.wrongB} → ${s.wrongA} | controls: new wrong ${cw}, new "Did you mean" ${cx}, lost ${cl}`);
  Object.assign(tot, { learned: tot.learned + learned, n2: tot.n2 + s.n, before2: tot.before2 + s.before, after2: tot.after2 + s.after, offered2b: tot.offered2b + s.offB, offered2a: tot.offered2a + s.offA,
    wrong2b: tot.wrong2b + s.wrongB, wrong2a: tot.wrong2a + s.wrongA, ctrlWrong: tot.ctrlWrong + cw, ctrlExtra: tot.ctrlExtra + cx, ctrlLost: tot.ctrlLost + cl });
}
console.log(`  all: learned ${tot.learned}; take 2 found ${tot.before2} → ${tot.after2} of ${tot.n2}, offered ${tot.offered2b} → ${tot.offered2a}, wrong ${tot.wrong2b} → ${tot.wrong2a}; controls (${ctrl.length} × voices): new wrong ${tot.ctrlWrong}, new "Did you mean" ${tot.ctrlExtra}, lost ${tot.ctrlLost}`);
