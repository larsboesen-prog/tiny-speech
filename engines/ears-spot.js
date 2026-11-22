// Place names found by sound (owner, 22 Nov 2026: "Match place names by sound. After the ear writes its guess, compare it to the list of
// place names and take the nearest by sound, even when the spelling is off ('a story', 'es to real' → Estoril). No retraining.").
// The ears hear sounds every 20 ms, then the matcher (ears-match.js) chooses words; when a name is said with an accent the matcher may
// choose other words ("the están"), and the written words no longer say which name it was. So names are looked for in the SOUNDS:
// for every place name, the best place in the recording where its sounds could have been said, the rest of the recording heard as it
// was. The cost is how much worse that is than hearing the recording freely: a name that was said costs little, one that was not
// costs a lot. Readings come from the same word list as the matcher (each word's Spanish and English sounds), so a new city needs
// nothing more. No dependencies; runs where the ears run (a worker, a page, Node).

const HARD = { "β": "b", "ð": "d", "ɣ": "ɡ", "ʝ": "j" };  // as ears-match.js: a soft b/d/g/y may be heard hard
const NEG = -Infinity;
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s) => (fold(s).match(/[a-z0-9ñ']+/g) || []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);

/**
 * names: [{id, name, alts?: [other names]}]; lexicon: the city's word list (its `words`: word → [{lang, phones}]); vocab: the ears'
 * {sound: id}. A name whose words are not all in the list is left out (the list is built from the same pack, so that is rare).
 * Returns {spot(lp, frames, V, blank, top = 5) → [{id, name, cost, perSound, start, end}] best first, size}. A few milliseconds per
 * question (12–22 ms for 100 places on one core in Node).
 */
export function buildNameSpotter(names, lexicon, vocab, { maxReadings = 6 } = {}) {
  const lookup = (w) => lexicon.words[w] || lexicon.words[fold(w)] || Object.entries(lexicon.words).find(([k]) => fold(k) === w)?.[1] || null;
  const entries = [];  // {id, name, seq: Int32Array of sound ids}
  for (const n of names) {
    const forms = [n.name, ...(n.alts || [])];
    const seen = new Set();
    for (const form of forms) {
      const ws = words(form);
      if (!ws.length) continue;
      let readings = [[]];
      let ok = true;
      for (const w of ws) {
        const prons = lookup(w);
        if (!prons) { ok = false; break; }
        const next = [];
        for (const r of readings) for (const p of prons) for (const v of [p.phones, p.phones.map((x) => HARD[x] ?? x)]) next.push([...r, ...v]);
        readings = next.slice(0, maxReadings * 2);
      }
      if (!ok) continue;
      for (const r of readings.slice(0, maxReadings * 2)) {
        if (r.some((x) => !(x in vocab))) continue;
        const key = r.join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ id: n.id, name: n.name, seq: Int32Array.from(r.map((x) => vocab[x])) });
      }
    }
  }

  /** The name sounds' best placement (Viterbi, CTC with blanks, free start and end), as the cost over hearing every frame freely. */
  function costOf(lp, frames, V, blank, seq, best) {
    const L = seq.length, S = 2 * L + 1;
    const lab = new Int32Array(S);
    for (let s = 0; s < S; s++) lab[s] = s % 2 === 0 ? blank : seq[(s - 1) >> 1];
    let prev = new Float64Array(S).fill(NEG), cur = new Float64Array(S);
    let prevStart = new Int32Array(S), curStart = new Int32Array(S);
    let before = 0, after = NEG, afterStart = 0, afterEnd = 0;
    for (let t = 0; t < frames; t++) {
      const o = t * V;
      for (let s = 0; s < S; s++) {
        let v = prev[s], st = prevStart[s];
        if (s > 0 && prev[s - 1] > v) { v = prev[s - 1]; st = prevStart[s - 1]; }
        if (s > 1 && lab[s] !== blank && lab[s] !== lab[s - 2] && prev[s - 2] > v) { v = prev[s - 2]; st = prevStart[s - 2]; }
        if (s < 2 && before > v) { v = before; st = t; }  // the name starts here
        cur[s] = v === NEG ? NEG : v + lp[o + lab[s]];
        curStart[s] = st;
      }
      const done = Math.max(prev[S - 1], prev[S - 2]);  // the name ended at t-1: the rest is heard freely
      if (done > after) { after = done; afterStart = prev[S - 1] >= prev[S - 2] ? prevStart[S - 1] : prevStart[S - 2]; afterEnd = t; }
      after = after === NEG ? NEG : after + best[t];
      before += best[t];
      [prev, cur] = [cur, prev];
      [prevStart, curStart] = [curStart, prevStart];
    }
    const end = Math.max(prev[S - 1], prev[S - 2]);
    let total = after, start = afterStart, stop = afterEnd;
    if (end > total) { total = end; start = prev[S - 1] >= prev[S - 2] ? prevStart[S - 1] : prevStart[S - 2]; stop = frames; }
    return { cost: before - total, start, end: stop };
  }

  function spot(lp, frames, V, blank, top = 5) {
    const best = new Float64Array(frames);
    for (let t = 0; t < frames; t++) { let m = NEG; const o = t * V; for (let c = 0; c < V; c++) if (lp[o + c] > m) m = lp[o + c]; best[t] = m; }
    const byId = new Map();
    for (const e of entries) {
      const r = costOf(lp, frames, V, blank, e.seq, best);
      const perSound = r.cost / e.seq.length;
      const had = byId.get(e.id);
      if (!had || perSound < had.perSound) byId.set(e.id, { id: e.id, name: e.name, cost: r.cost, perSound, start: r.start, end: r.end });
    }
    return [...byId.values()].sort((a, b) => a.perSound - b.perSound).slice(0, top);
  }
  return { spot, size: entries.length, names: new Set(entries.map((e) => e.id)).size };
}

// ---------- what to do with it: answer about the name, ask, or leave the words' answer alone ----------
// Measured 22 Nov 2026 (training/asr/probe/README.md, "Names by sound") with the live ears on 560 accented stand-in clips (five
// non-native English voices and two native ones, each saying 40 names in "Is X open?" and "X, when is it open?", heard through the
// page's own 48 → 16 kHz path) and 659 ordinary English and Spanish questions: of 2,880 settings, those that add no wrong answer on
// either set; `accept` then raised from 2.25 to 2.5 (the same answers on both sets) to leave room for real microphones, which score
// a little higher (the Danish "Is Estoril open?" 2.1 from the file, 2.2 through Chromium's fake microphone).
// Accented: names found 370 → 402 of 560, 81 more offered as buttons, a wrong place 14 → 10 (Danish voice 31 → 37 of 80, 19 more
// offered). Ordinary English: 94 → 101 of 114 names, wrong 1 → 1, an extra "Or did you mean" row under 4 of 177 answers. Spanish:
// 72 → 73 of 96, wrong 3 → 3, no extra rows.
export const SOUND_RULES = {
  accept: 2.5,     // answer about the name the sounds found when it costs at most this per sound…
  gap: 1.0,        // …and the next name costs at least this much more
  askBelow: 3.0,   // otherwise offer the names ("Did you mean …?") when the best costs at most this…
  window: 1.0,     // …those within this of the best, at most three
  override: 1.5,   // the words named a place but the sounds clearly say another (this much better): ask between the two (English page)
};
const foldText = (s) => fold(s).replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
// The shape of a question about one place: "Is X open?", "When does X close?", "Where is X?", "X, when is it open?", "¿Está abierto X?",
// "¿A qué hora abre X?" — not "Is there…", "¿Qué está abierto…?" (a list).
export const ONE_PLACE = /^(is|does|when does|when is|what time does|what time is|how late is|how late does|until when is|where is|where's|tell me about|how about|what about|esta|a que hora|cuando abre|cuando cierra|donde esta|que tal)\b(?! (there|anything|anywhere|any|something|somewhere|hay)\b)|\b(when is it open|is it open|what time does it|a que hora abre)\b|(?<!que )\besta abiert[oa]\b/;
/** Whether the reader's request asks for something besides a place's name (a kind of food, an area, near me, a list…). */
export const subjectOf = (q) => !!(q && (q.cats || q.area || q.centro || q.near || q.nearSight || q.asks || q.wantsList || (q.topics && q.topics.length) || q.collection || q.meal || q.susan));
/**
 * text: the heard words; q: the reader's request for them ({named, plural, near, cats, …}); spot: spot()'s list (or [[id, perSound]]).
 * Returns {pick: id | null, ask: [ids], keep: bool}: pick = answer about that place; ask = offer these names as buttons (keep = keep
 * the words' own answer and add the buttons under it, when the question asks for more than a name); neither = the words' answer.
 * The sounds speak only when the words named no place in a question about one place (or, with override, named one the sounds
 * clearly contradict).
 */
export function soundChoice(text, q, spot, { rules = SOUND_RULES, override = true } = {}) {
  const list = (spot || []).map((s) => (Array.isArray(s) ? { id: s[0], perSound: s[1] } : s));
  const none = { pick: null, ask: [], keep: false };
  if (!list.length) return none;
  const [top, second] = list, gap = second ? second.perSound - top.perSound : Infinity;
  const named = q && q.named ? q.named.id : null;
  if (named) {
    if (!override || top.id === named || top.perSound > rules.accept) return none;
    const mine = list.find((s) => s.id === named);
    return !mine || mine.perSound - top.perSound >= rules.override ? { pick: null, ask: [top.id, named], keep: false } : none;
  }
  if (!ONE_PLACE.test(foldText(text)) || (q && (q.plural || q.near))) return none;
  if (top.perSound <= rules.accept && gap >= rules.gap) return { pick: top.id, ask: [], keep: false };
  if (top.perSound <= rules.askBelow) return { pick: null, ask: list.filter((s) => s.perSound <= top.perSound + rules.window).slice(0, 3).map((s) => s.id), keep: subjectOf(q) };
  return none;
}
