// Place names found by sound (owner, 22 Nov 2026: "Match place names by sound. After the ear writes its guess, compare it to the list of
// place names and take the nearest by sound, even when the spelling is off ('a story', 'es to real' → Estoril). No retraining.").
// The ears hear sounds every 20 ms, then the matcher (ears-match.js) chooses words; when a name is said with an accent the matcher may
// choose other words ("the están"), and the written words no longer say which name it was. So names are looked for in the SOUNDS:
// for every place name, the best place in the recording where its sounds could have been said, the rest of the recording heard as it
// was. The cost is how much worse that is than hearing the recording freely: a name that was said costs little, one that was not
// costs a lot. Readings come from the same word list as the matcher (each word's Spanish and English sounds), so a new city needs
// nothing more. No dependencies; runs where the ears run (a worker, a page, Node).

const HARD = { "β": "b", "ð": "d", "ɣ": "ɡ", "ʝ": "j" };  // as ears-match.js: a soft b/d/g/y may be heard hard
// …and b/d/g without voice, as p/t/k (the owner's 80 recorded questions, 22 Nov 2026: "Birria" heard "p i r i a", "Bocaciega" "p o k e…":
// Danish, German, Dutch speakers say them so). Only for the names looked for by sound, not for the words.
const DEVOICE = { b: "p", d: "t", "ɡ": "k" };
// …and a written v said as v, a glide as a full vowel ("Agavia" heard "k a v i a" from the owner, not "aɣaβja")
const SOFT = { "β": "v", j: "i" };
const EXTRA_MIN = 5;  // sounds: the extra readings only for names at least this long
const NEG = -Infinity;
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s) => (fold(s).match(/[a-z0-9ñ']+/g) || []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);

/**
 * names: [{id, name, alts?: [other names]}]; lexicon: the city's word list (its `words`: word → [{lang, phones}]); vocab: the ears'
 * {sound: id}. A name whose words are not all in the list is left out (the list is built from the same pack, so that is rare).
 * Returns {spot(lp, frames, V, blank, top = 5) → [{id, name, cost, perSound, start, end}] best first, size}. A few milliseconds per
 * question (12–22 ms for 100 places on one core in Node).
 */
export function buildNameSpotter(names, lexicon, vocab, { maxReadings = 6, devoice = true, extraCost = 0 } = {}) {
  // a reading as written and with soft sounds heard hard; with `all` also without voice, and as v and i (devoice)
  const variants = (ph, all) => {
    const out = [];
    for (const base of all && devoice ? [ph, ph.map((x) => SOFT[x] ?? x)] : [ph]) {
      const hard = base.map((x) => HARD[x] ?? x);
      out.push(base, hard);
      if (all && devoice) out.push(hard.map((x) => DEVOICE[x] ?? x));
    }
    return out.filter((v, i) => out.findIndex((u) => u.join(" ") === v.join(" ")) === i);
  };
  const lookup = (w) => lexicon.words[w] || lexicon.words[fold(w)] || Object.entries(lexicon.words).find(([k]) => fold(k) === w)?.[1] || null;
  // {id, name, seq: Int32Array of sound ids, extra}: the readings as written first; the extra ones (without voice, v, i) are searched
  // only for the names that came closest with those (spot), which keeps the search near its old time
  const entries = [];
  for (const n of names) {
    const forms = [n.name, ...(n.alts || [])];
    const seen = new Set();
    for (const all of [false, true]) for (const form of forms) {
      const ws = words(form);
      if (!ws.length) continue;
      let readings = [[]];
      let ok = true;
      for (const w of ws) {
        const prons = lookup(w);
        if (!prons) { ok = false; break; }
        const next = [];
        for (const r of readings) for (const p of prons) for (const v of variants(p.phones, all)) next.push([...r, ...v]);
        readings = next.slice(0, maxReadings * (all ? 4 : 2));
      }
      if (!ok) continue;
      for (const r of readings) {
        if (r.some((x) => !(x in vocab))) continue;
        const key = r.join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        if (all && r.length < EXTRA_MIN) continue;  // short names said another way look like everyday words (Bennu as "p e n u": "open")
        entries.push({ id: n.id, name: n.name, seq: Int32Array.from(r.map((x) => vocab[x])), extra: all });
      }
    }
  }
  const SECOND = 20;  // the names whose extra readings are searched too

  /** The name sounds' best placement (Viterbi, CTC with blanks, free start and end), as the cost over hearing every frame freely. */
  // The search runs on a compact copy of the frames: only the sounds some name uses (and the blank), so a frame's row stays in the cache
  // (82 → about half the time for 1,900 readings).
  let used = null;  // sound id → column, made on the first search (learn() may add sounds: then remade)
  const columns = () => {
    const ids = new Set(); for (const e of entries) for (const x of e.seq) ids.add(x);
    used = { ids: [...ids], col: new Map([...ids].map((x, i) => [x, i])) };
    for (const e of entries) e.lab = null;
  };
  function costOf(E, frames, U, blank, e, best) {
    const seq = e.seq, L = seq.length, S = 2 * L + 1;
    if (!e.lab) { e.lab = new Int32Array(S); for (let s = 0; s < S; s++) e.lab[s] = s % 2 === 0 ? blank : used.col.get(seq[(s - 1) >> 1]); }
    const lab = e.lab;
    let prev = new Float64Array(S).fill(NEG), cur = new Float64Array(S);
    let prevStart = new Int32Array(S), curStart = new Int32Array(S);
    let before = 0, after = NEG, afterStart = 0, afterEnd = 0;
    for (let t = 0; t < frames; t++) {
      const o = t * U;
      for (let s = 0; s < S; s++) {
        let v = prev[s], st = prevStart[s];
        if (s > 0 && prev[s - 1] > v) { v = prev[s - 1]; st = prevStart[s - 1]; }
        if (s > 1 && lab[s] !== blank && lab[s] !== lab[s - 2] && prev[s - 2] > v) { v = prev[s - 2]; st = prevStart[s - 2]; }
        if (s < 2 && before > v) { v = before; st = t; }  // the name starts here
        cur[s] = v === NEG ? NEG : v + E[o + lab[s]];
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

  // the frames as the search reads them: best[t] (the frame heard freely) and E (the used sounds' columns, the blank last)
  function compact(lp, frames, V, blank) {
    if (!used || entries.some((e) => !e.lab && e.seq.some((x) => !used.col.has(x)))) columns();
    const U = used.ids.length + 1, E = new Float32Array(frames * U), best = new Float64Array(frames);
    for (let t = 0; t < frames; t++) {
      const o = t * V; let m = NEG;
      for (let c = 0; c < V; c++) if (lp[o + c] > m) m = lp[o + c];
      best[t] = m;
      for (let k = 0; k < U - 1; k++) E[t * U + k] = lp[o + used.ids[k]];
      E[t * U + U - 1] = lp[o + blank];
    }
    return { E, U, best, b: U - 1 };
  }

  function spot(lp, frames, V, blank, top = 5) {
    const { E, U, best, b } = compact(lp, frames, V, blank);
    const byId = new Map();
    const run = (e) => {
      const r = costOf(E, frames, U, b, e, best);
      const perSound = r.cost / e.seq.length + (e.extra ? extraCost : 0);  // a voiceless or v/i reading wins only when it fits clearly better
      const had = byId.get(e.id);
      if (!had || perSound < had.perSound) byId.set(e.id, { id: e.id, name: e.name, cost: r.cost, perSound, start: r.start, end: r.end });
    };
    for (const e of entries) if (!e.extra) run(e);
    const near = new Set([...byId.values()].sort((a, b) => a.perSound - b.perSound).slice(0, SECOND).map((x) => x.id));
    for (const e of entries) if (e.extra && near.has(e.id)) run(e);
    return [...byId.values()].sort((a, b) => a.perSound - b.perSound).slice(0, top);
  }

  // ---------- learning a visitor's way of saying a name (owner, 22 Nov 2026: "build option 1": the phone remembers the taps) ----------
  // When the visitor picks a name after "Did you mean", the sounds the ears heard where that name fits best become one more reading of
  // it, on that device only. Next time the same way of saying it costs little, so the name is answered instead of asked about.
  const symbols = Object.fromEntries(Object.entries(vocab).map(([k, v]) => [v, k]));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const MAX_LEARNED = 3;  // per name: the latest three ways
  /** The sounds heard where name `id` fits best: the frames of its best placement read freely (each frame's best sound, repeats and
   * blanks dropped), as sound symbols. [] when the name cannot be placed. */
  function heardAs(lp, frames, V, blank, id) {
    const { E, U, best, b } = compact(lp, frames, V, blank);
    let at = null;
    for (const e of entries) {
      if (e.id !== id || e.learned) continue;
      const r = costOf(E, frames, U, b, e, best), perSound = r.cost / e.seq.length;
      if (!at || perSound < at.perSound) at = { perSound, start: r.start, end: r.end };
    }
    if (!at) return [];
    const out = [];
    let prev = -1;
    for (let t = at.start; t < at.end; t++) {
      let c = 0, m = NEG; const o = t * V;
      for (let k = 0; k < V; k++) if (lp[o + k] > m) { m = lp[o + k]; c = k; }
      if (c !== prev && c !== blank) out.push(symbols[c]);
      prev = c;
    }
    return out;
  }
  /** Adds a reading (sound symbols, as heardAs gives them) for name `id`; false when it is unusable (too short or long, unknown). */
  function learn(id, phones) {
    if (!nameOf.has(id) || !Array.isArray(phones) || phones.length < 3 || phones.length > 24 || phones.some((x) => !(x in vocab))) return false;
    const key = phones.join(" ");
    if (entries.some((e) => e.id === id && e.key === key)) return true;
    entries.push({ id, name: nameOf.get(id), seq: Int32Array.from(phones.map((x) => vocab[x])), learned: true, key });
    const mine = entries.filter((e) => e.id === id && e.learned);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_LEARNED))) entries.splice(entries.indexOf(old), 1);
    return true;
  }
  /** Forgets every learned reading. */
  function forget() { for (let i = entries.length - 1; i >= 0; i--) if (entries[i].learned) entries.splice(i, 1); }
  const learned = () => entries.filter((e) => e.learned).map((e) => ({ id: e.id, phones: e.key.split(" ") }));
  return { spot, heardAs, learn, forget, learned, get size() { return entries.length; }, names: new Set(entries.map((e) => e.id)).size };
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
  strong: 1.0,     // a question not shaped like one about a place: answer about a name at most this per sound…
  strongGap: 1.5,  // …this far ahead of the next (in practice only a name learned from the visitor gets this close)
  // a short question (at most `short` words) that is mostly a name: a name this clear answers even when the words do not look like a
  // question about a place, or picked up a stray food word ("pisco open" → Peruvian food; the owner's "Is Birria Xalisco open?")
  short: 3, shortClear: 0.6, shortGap: 1.2,  // (5 words, 1.0, 1.0 picked "The Restaurant" for "what vegan restaurant is open")
  clear: 1.0, clearGap: 1.0,  // the words named one place, the sounds another this clearly: ask between the two, any page
};
const foldText = (s) => fold(s).replace(/[^a-z0-9ñ' ]+/g, " ").replace(/\s+/g, " ").trim();
// The shape of a question about one place: "Is X open?", "When does X close?", "Where is X?", "X, when is it open?", "¿Está abierto X?",
// "¿A qué hora abre X?" — not "Is there…", "¿Qué está abierto…?" (a list).
export const ONE_PLACE = /^(is|does|when does|when is|what time does|what time is|how late is|how late does|until when is|where is|where's|tell me about|how about|what about|esta|a que hora|cuando abre|cuando cierra|donde esta|que tal)\b(?! (there|anything|anywhere|any|something|somewhere|hay)\b)(?<!^where is(?= (a|an|some)\b))(?<!^where's(?= (a|an|some)\b))|\b(when is it open|is it open|what time does it|a que hora abre)\b|(?<!que )\besta abiert[oa]\b/;
// …and as the ears write the owner's own voice (22 Nov 2026, 80 recorded questions): "X, when is it open?" as "… when is el", "… when is
// it", "… a when"; "Is X open?" as "X open" ("say open", "cava open"). The short one counts only when nothing else is asked ("tacos open"
// is a list).
export const ONE_PLACE_LOOSE = /\bwhen(?: is(?: it| el| he)?)?$|^(?!(?:what|whats|what s|anything|everything|who|which|where|is there|are there|any|hay|que)\b)(?:\S+ ){1,3}open(?: now)?$/;
/** Whether the reader's request asks for something besides a place's name (a kind of food, an area, near me, a list…). */
export const subjectOf = (q) => !!(q && (q.cats || q.area || q.centro || q.street || q.hotel || q.near || q.nearSight || q.asks || q.wantsList || (q.topics && q.topics.length) || q.collection || q.meal || q.susan));
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
    if (top.id === named) return none;
    const mine = list.find((s) => s.id === named), worse = mine ? mine.perSound - top.perSound : Infinity;
    // the sounds clearly say another name: ask between the two (English page); or, any page, a very clear one ("is la colmena a pho"
    // for the owner's "Is La Cabra Iluminada open?": La Cabra Iluminada 0.22 per sound)
    if ((override && top.perSound <= rules.accept && worse >= rules.override) || (top.perSound <= (rules.namedClear ?? rules.clear) && worse >= rules.clearGap)) return { pick: null, ask: [top.id, named], keep: false };
    return none;
  }
  if (q && (q.plural || q.near)) return none;
  const t = foldText(text);
  if (!ONE_PLACE.test(t) && !(ONE_PLACE_LOOSE.test(t) && !subjectOf(q))) {  // not shaped like a question about a place: only a very clear name
    const where = q && (q.street || q.hotel || q.nearSight || q.area || q.centro);
    if (!where && t.split(" ").length <= rules.short && top.perSound <= rules.shortClear && gap >= rules.shortGap) return { pick: top.id, ask: [], keep: false };
    return rules.strong && !subjectOf(q) && top.perSound <= rules.strong && gap >= rules.strongGap ? { pick: top.id, ask: [], keep: false } : none;
  }
  // a street or a hotel is where to look ("restaurants near Live Aqua"): its list stays, the names are only offered under it
  if (top.perSound <= rules.accept && gap >= rules.gap && !(q && (q.street || q.hotel))) return { pick: top.id, ask: [], keep: false };
  if (top.perSound <= rules.askBelow) return { pick: null, ask: list.filter((s) => s.perSound <= top.perSound + rules.window).slice(0, 3).map((s) => s.id), keep: subjectOf(q) };
  return none;
}
