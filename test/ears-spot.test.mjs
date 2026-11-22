// Names by sound (engines/ears-spot.js; owner, 22 Nov 2026: "Match place names by sound… Ask when unsure"): the name finder on
// made-up sounds and San Miguel's names, and the rules that decide between answering, asking and leaving the words' answer alone.
// The real model on a Danish voice's "Is Estoril open?" is checked in ears.test.mjs (the worker) and mapsma/test/page5-names.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildNameSpotter, soundChoice, ONE_PLACE, ONE_PLACE_LOOSE, subjectOf, SOUND_RULES } from "../engines/ears-spot.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const vocab = json("engines/ears/vocab.json");
const BLANK = vocab["<pad>"], V = Object.keys(vocab).length;
const lexicon = json("packs/dist/mx-sma/ears-lexicon-en.json"), names = json("packs/dist/mx-sma/ears-names.json").names;

// Frames that say these sounds (each held two frames, a blank between), with other sounds before and after: the best sound at log 0,
// the rest far below.
function frames(sounds) {
  const seq = [];
  for (const s of sounds) { seq.push(vocab[s], vocab[s], BLANK); }
  const lp = new Float32Array(seq.length * V).fill(-30);
  seq.forEach((id, t) => { lp[t * V + id] = 0; });
  return { lp, n: seq.length };
}

test("San Miguel's names file: every place, with its other spoken forms; nearly all can be looked for by sound", () => {
  assert.equal(names.length, 100);
  assert.deepEqual(names.find((n) => n.id === "50"), { id: "50", name: "La Cabra Iluminada", alts: ["la cabra"] });
  const spotter = buildNameSpotter(names, lexicon, vocab);
  assert.ok(spotter.names >= 99, `${spotter.names} of 100 names have sounds`);
});

test("a name said inside other sounds is found, and costs least", () => {
  const spotter = buildNameSpotter(names, lexicon, vocab);
  // "is ... open" in made-up sounds around Estoril's Spanish reading
  const f = frames(["ɪ", "z", "e", "s", "t", "o", "ɾ", "i", "l", "oʊ", "p", "ə", "n"]);
  const top = spotter.spot(f.lp, f.n, V, BLANK);
  assert.equal(top.length, 5);
  assert.equal(top[0].name, "Estoril");
  assert.ok(top[0].perSound < 0.1 && top[1].perSound > 1, JSON.stringify(top.slice(0, 2)));
  assert.ok(top[0].start > 0 && top[0].end < f.n, "the name is placed inside the recording");
});

test("the shape of a question about one place, in both languages", () => {
  for (const s of ["is it open", "is a stroll open", "the estan when is it open", "where is johnnys piano bar", "esta abierta la azotea", "a que hora abre estoril", "donde esta casa europa", "estoril esta abierto"])
    assert.ok(ONE_PLACE.test(s), s);
  for (const s of ["is there a cafe open", "que esta abierto el martes", "find four restaurants in centro", "what music venues are open now", "hay tacos"])
    assert.ok(!ONE_PLACE.test(s), s);
});

test("the rules: a clear winner answers, close names are asked about, list questions keep their answer", () => {
  const list = (...xs) => xs.map(([id, perSound]) => ({ id, perSound }));
  // the Danish voice's "Is Estoril open?", heard "is it open": Estoril by 1.3 per sound
  assert.deepEqual(soundChoice("is it open", { named: null }, list(["67", 2.03], ["58", 3.3])), { pick: "67", ask: [], keep: false });
  // close: ask between them, at most three, those within a point of the best
  assert.deepEqual(soundChoice("is kan", { named: null }, list(["51", 2.17], ["46", 3.01], ["X16", 3.18], ["72", 3.25])), { pick: null, ask: ["51", "46"], keep: false });
  // a question about a kind of place shaped like one about a place: the list stays, the names are offered under it
  assert.deepEqual(soundChoice("where is the best mezcal bar in town", { named: null, cats: ["share"] }, list(["46", 2.83], ["1", 3.9])), { pick: null, ask: ["46"], keep: true });
  // nothing near: the words' answer
  assert.deepEqual(soundChoice("is it open", { named: null }, list(["1", 3.4], ["2", 3.5])), { pick: null, ask: [], keep: false });
  // not about one place: the sounds stay out of it, unless a name is very clear (in practice one learned from the visitor) and
  // nothing else was asked
  assert.deepEqual(soundChoice("what music venues are open now", { named: null, wantsList: true }, list(["X21", 1.0], ["2", 3.5])), { pick: null, ask: [], keep: false });
  assert.deepEqual(soundChoice("say cost on to me sin si se o", { named: null }, list(["22", 1.3], ["1", 2.8])), { pick: null, ask: [], keep: false });
  assert.deepEqual(soundChoice("say cost on to me sin si se o", { named: null }, list(["22", 0.48], ["1", 2.79])), { pick: "22", ask: [], keep: false });
  assert.deepEqual(soundChoice("is anything open near me", { named: null, near: true }, list(["X21", 1.0], ["2", 3.5])), { pick: null, ask: [], keep: false });
  // the words named a place: kept, unless the sounds clearly say another (then both are offered); not on the Spanish page
  assert.deepEqual(soundChoice("is la parada open", { named: { id: "53" } }, list(["53", 0.6], ["2", 3])), { pick: null, ask: [], keep: false });
  assert.deepEqual(soundChoice("is lavanda open", { named: { id: "2" } }, list(["53", 1.0], ["9", 2.4], ["2", 2.9])), { pick: null, ask: ["53", "2"], keep: false });
  assert.deepEqual(soundChoice("is lavanda open", { named: { id: "2" } }, list(["53", 1.0], ["2", 2.9]), { override: false }), { pick: null, ask: [], keep: false });
  // spot results as [id, perSound] pairs work the same
  assert.deepEqual(soundChoice("is it open", { named: null }, [["67", 2.03], ["58", 3.3]]).pick, "67");
  assert.equal(SOUND_RULES.accept, 2.5);
});

// the owner's own recordings (22 Nov 2026): "X, when is it open?" written "… when is el", "Is X open?" written "X open"
test("the loose shapes from a real voice, and questions about a kind of place or a where", () => {
  const list = (...xs) => xs.map(([id, perSound]) => ({ id, perSound }));
  for (const t of ["um an when is el", "hi lucas when is el", "cava when is it", "y olas and a when", "say open", "el been open", "cava can open"]) assert.ok(ONE_PLACE_LOOSE.test(t), t);
  for (const t of ["what is open", "anything open", "is there a cafe open", "show me all the places open"]) assert.ok(!ONE_PLACE_LOOSE.test(t), t);
  assert.deepEqual(soundChoice("hi lucas when is el", { named: null }, list(["X17", 1.3], ["42", 2.5])), { pick: "X17", ask: [], keep: false });
  assert.deepEqual(soundChoice("pisco open", { named: null, topics: ["peruvian"] }, list(["70", 1.3], ["1", 2.5])), { pick: null, ask: [], keep: false }, "short, with a subject: the list");
  assert.ok(!ONE_PLACE.test("where is a quality steak restaurant") && !ONE_PLACE.test("where's an italian place"), "a kind of place, not a name");
  assert.ok(ONE_PLACE.test("where is johnnys piano bar") && ONE_PLACE.test("is a stroll open"));
  // a street or a hotel is where to look: the list stays, names are only offered under it
  assert.deepEqual(soundChoice("esta sea live aqua please", { named: null, hotel: { en: "Live Aqua" } }, list(["67", 1.0], ["38", 2.5])), { pick: null, ask: ["67"], keep: true });
  assert.deepEqual(soundChoice("is it open on mesones", { named: null, street: { key: "mesones" } }, list(["67", 1.0], ["38", 2.5])), { pick: null, ask: ["67"], keep: true });
});

test("a request with a subject: a kind of food, an area, near me, a list", () => {
  assert.equal(subjectOf({ cats: ["mex"] }), true);
  assert.equal(subjectOf({ topics: ["tacos"] }), true);
  assert.equal(subjectOf({ topics: [], cats: null, area: null }), false);
  assert.equal(subjectOf(null), false);
});

// Learning from picks (owner, 22 Nov 2026: "build option 1"): the sounds heard where a name fits become one more reading of it.
test("a name learned from a pick: how it sounded becomes a reading, and the same sounds then cost almost nothing", () => {
  const spotter = buildNameSpotter(names, lexicon, vocab);
  // "Estoril" said as "a stroll": ə s t ɹ oʊ l, between other sounds
  const f = frames(["ɪ", "z", "ə", "s", "t", "ɹ", "oʊ", "l", "oʊ", "p", "ə", "n"]);
  const before = spotter.spot(f.lp, f.n, V, BLANK).find((x) => x.id === "67");
  const heard = spotter.heardAs(f.lp, f.n, V, BLANK, "67");
  assert.ok(heard.length >= 3 && heard.includes("ɹ"), JSON.stringify(heard));
  assert.equal(spotter.learn("67", heard), true);
  const after = spotter.spot(f.lp, f.n, V, BLANK)[0];
  assert.equal(after.id, "67");
  assert.ok(after.perSound < 0.1 && after.perSound < before.perSound, `${before.perSound} → ${after.perSound}`);
  assert.deepEqual(spotter.learned(), [{ id: "67", phones: heard }]);
  // unusable readings are refused; at most three per name are kept; forget drops them all
  assert.equal(spotter.learn("67", ["s"]), false, "too short");
  assert.equal(spotter.learn("67", ["s", "t", "nope"]), false, "a sound the ears do not know");
  assert.equal(spotter.learn("nowhere", ["s", "t", "o"]), false, "no such place");
  for (const extra of [["e", "s", "t", "o"], ["e", "s", "t", "u"], ["a", "s", "t", "o"]]) spotter.learn("67", extra);
  assert.equal(spotter.learned().filter((r) => r.id === "67").length, 3);
  spotter.forget();
  assert.deepEqual(spotter.learned(), []);
  assert.ok(Math.abs(spotter.spot(f.lp, f.n, V, BLANK).find((x) => x.id === "67").perSound - before.perSound) < 1e-9, "as before");
});
