// Spanish spelling → tiny-voca's sounds (plan step B7). wordPhones is MapSMA's spanishPhones (spanish.js, 17 Nov 2026), unchanged
// except that its hand-written readings now come from the city pack (lexicon.readings); sentencePhones is new: whole Spanish
// sentences, with numbers said as Spanish words and the English words of a sentence (from the pack) left to the English phonemizer.
// The sounds are tiny-voca's 59 American-English phones, so Spanish comes out with an American accent until the voice is
// trained on Spanish (step 5); what Mexican Spanish does differently is in mx.json.
// tiny-voca's phones (dizione/symbols.py, 59 American-English phones): nothing else may be used.
export const PHONES = new Set(['p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ', 'l', 'ɹ', 'j', 'w', 'tʃ', 'dʒ', 'ɾ', 'ʔ',
  'ə', 'ɐ', 'ɚ', 'ᵻ', 'ɪ', 'i', 'iː', 'ɛ', 'æ', 'ʌ', 'ɑː', 'ɔ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'ɔɪ', 'oʊ', 'aʊ', 'iə', 'oː',
  'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɪɹ', 'ɛɹ', 'ʊɹ', 'aɪɚ', 'aɪə', 'əl', 'n̩']);

// Spanish words said without stress (articles, prepositions, "y", the "San" and "Don" before a name).
const UNSTRESSED = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'y', 'san', 'don']);
const VOWELS = new Set(['ə', 'ɐ', 'ɚ', 'ᵻ', 'ɪ', 'i', 'iː', 'ɛ', 'æ', 'ʌ', 'ɑː', 'ɔ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'ɔɪ', 'oʊ', 'aʊ', 'iə', 'oː',
  'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɪɹ', 'ɛɹ', 'ʊɹ', 'aɪɚ', 'aɪə', 'əl', 'n̩']);
// As the phonemizer checks it: every phone in the inventory, stress marks on vowels only (it refuses the whole word otherwise).
const valid = (ph) => !!ph && ph.split(' ').every((u) => { const s = /^[ˈˌ]/.test(u), p = s ? u.slice(1) : u; return PHONES.has(p) && (!s || VOWELS.has(p)); });
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isVowel = (c) => /[aeiouáéíóúü]/.test(c);
const STRONG = /[aeoáéíóú]/;  // a, e, o and any accented vowel make their own syllable

// One Spanish word -> the voice's phones with stress marks ("ɑː s oʊ t ˈeɪ ɑː"), or null when there is nothing to say.
export function wordPhones(word, { readings = {} } = {}) {
  const w = String(word || '').toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  if (!w) return null;
  const hand = readings[fold(w)];  // a reading the city pack wrote by hand (French, Italian, Nahuatl names)
  if (hand) return valid(hand.phones || hand) ? (hand.phones || hand) : null;
  // letters -> sound units: {c: consonant phone} or {v: vowel letter, acc: accented}
  const u = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i], n = w[i + 1] || '', n2 = w[i + 2] || '';
    if (c === 'c' && n === 'h') { u.push({ c: 'tʃ' }); i++; continue; }
    if (c === 'l' && n === 'l') { u.push({ c: 'j' }); i++; continue; }
    if (c === 'r' && n === 'r') { u.push({ c: 'ɾ' }); i++; continue; }
    if (c === 'q' && n === 'u') { u.push({ c: 'k' }); i++; continue; }
    if (c === 'g' && n === 'u' && /[eéií]/.test(n2)) { u.push({ c: 'ɡ' }); i++; continue; }
    if (c === 'g' && n === 'ü') { u.push({ c: 'ɡ' }, { c: 'w' }); i++; continue; }
    if (c === 'h') { if (n === 'i' && isVowel(n2)) { u.push({ c: 'j' }); i++; } continue; }  // h is silent; "hie" is "ye" (Hierba)
    if (isVowel(c)) { u.push({ v: fold(c), acc: /[áéíóú]/.test(c) }); continue; }
    if (c === 'y') { u.push(isVowel(n) ? { c: 'j' } : { v: 'i', y: true }); continue; }
    if (c === 'ñ') { u.push({ c: 'n' }, { c: 'j' }); continue; }
    if (c === 'c') { u.push({ c: /[eéiíy]/.test(n) ? 's' : 'k' }); continue; }
    if (c === 'g') { u.push({ c: /[eéiíy]/.test(n) ? 'h' : 'ɡ' }); continue; }
    if (c === 'j') { u.push({ c: 'h' }); continue; }
    if (c === 'x') { u.push(...(i === 0 ? [{ c: 'h' }] : [{ c: 'k' }, { c: 's' }])); continue; }  // Xalisco: as in México
    if (c === 'z') { u.push({ c: 's' }); continue; }
    if (c === 'v' || c === 'b') { u.push({ c: 'b' }); continue; }
    if (c === 'r') { u.push({ c: 'ɾ' }); continue; }
    if (c === 'k' || c === 'w') { u.push({ c }); continue; }
    if ('dfjlmnpst'.includes(c)) { u.push({ c }); continue; }
  }
  // the same consonant twice (Sautto, Giovanni) is said once
  const units = u.filter((x, k) => !(x.c && u[k - 1] && u[k - 1].c === x.c));
  // vowels -> syllable nuclei: a weak i or u next to another vowel is a glide (j, w), two strong vowels are two syllables
  const out = [];  // items: {c} or {nucleus: true, v, on: 'j'|'w'|'', off: 'i'|'u'|''}
  for (let k = 0; k < units.length;) {
    if (units[k].c) { out.push(units[k]); k++; continue; }
    let run = [];
    while (k < units.length && units[k].v) run.push(units[k++]);
    while (run.length) {
      const [a, b, c2] = run;
      const weak = (x) => x && !STRONG.test(x.acc ? 'á' : x.v);
      if (b && weak(a) && !weak(b)) {  // ie, ua, io...: a glide, then the vowel (and maybe an offglide: "iai")
        const off = c2 && weak(c2) ? c2.v : '';
        out.push({ nucleus: true, v: b.v, acc: b.acc, on: a.v === 'u' ? 'w' : 'j', off });
        run = run.slice(off ? 3 : 2);
      } else if (b && !weak(a) && weak(b)) {  // ai, ei, oi, au...: a falling diphthong
        out.push({ nucleus: true, v: a.v, acc: a.acc, on: '', off: b.v });
        run = run.slice(2);
      } else if (b && weak(a) && weak(b)) {  // ui, iu: the second is the vowel
        out.push({ nucleus: true, v: b.v, acc: b.acc, on: a.v === 'u' ? 'w' : 'j', off: '' });
        run = run.slice(2);
      } else {
        out.push({ nucleus: true, v: a.v, acc: a.acc, on: '', off: '' });
        run = run.slice(1);
      }
    }
  }
  const nuclei = out.map((x, k) => (x.nucleus ? k : -1)).filter((k) => k >= 0);
  if (!nuclei.length) return null;
  // stress: the accented vowel; else the last but one syllable when the word ends in a vowel, n or s; else the last
  let stressed = nuclei.find((k) => out[k].acc);
  if (stressed == null) stressed = /[aeiouns]$/.test(fold(w)) && !/y$/.test(w) && nuclei.length > 1 ? nuclei[nuclei.length - 2] : nuclei[nuclei.length - 1];
  if (UNSTRESSED.has(fold(w))) stressed = -1;
  const phones = [];
  const isOnset = (a, b) => b && /^[ɾl]$/.test(b.c || '') && /^[pbtdkɡf]$/.test(a.c || '');  // pr, bl, tr...: both start the next syllable
  out.forEach((x, k) => {
    if (x.nucleus) {
      if (x.on) phones.push(x.on);
      const mark = k === stressed ? 'ˈ' : '';
      const next = out[k + 1], after = out[k + 2];
      // e in a closed syllable (Mezcal, Vergel, el) sounds as in "bed", else as in "day"
      const closed = next && next.c && (!after || after.c) && !isOnset(next, after);
      const diph = { ai: 'aɪ', ei: 'eɪ', oi: 'ɔɪ', au: 'aʊ', ou: 'oʊ' }[x.v + x.off];
      if (diph) phones.push(mark + diph);
      else {
        phones.push(mark + (x.v === 'a' ? 'ɑː' : x.v === 'e' ? (closed ? 'ɛ' : 'eɪ') : x.v === 'i' ? 'i' : x.v === 'o' ? 'oʊ' : 'uː'));
        if (x.off) phones.push(x.off === 'u' ? 'w' : 'j');
      }
      return;
    }
    const prev = out[k - 1], next = out[k + 1];
    let p = x.c;
    if (p === 'd') p = !prev || /^[nl]$/.test(prev.c || '') ? 'd' : 'ð';  // soft d between vowels and at the end (Parada, Jardín)
    if (p === 'n' && next && /^[kɡ]$/.test(next.c || '')) p = 'ŋ';      // Rinconcito: "ng" before k and g
    phones.push(p);
  });
  const said = phones.join(' ');
  return valid(said) ? said : null;
}


/** Every Spanish word of the given names → its phones, keyed as the voice sees the word (MapSMA's spanishLexicon). */
export function lexiconFor(names, { english = [], readings = {} } = {}) {
  const ENGLISH = new Set(english.map(fold));
  const out = {};
  for (const name of names) {
    for (const raw of String(name).split(/[\s&,·/-]+/)) {
      const key = fold(raw).replace(/'/g, '').replace(/[^a-z]/g, '');
      if (!key || key.length < 2 || ENGLISH.has(key) || out[key]) continue;  // a single letter is spelled out by the phonemizer anyway
      const ph = wordPhones(raw.replace(/'/g, ''), { readings });
      if (ph) out[key] = ph;
    }
  }
  return out;
}

// ---------- numbers said in Spanish ----------
const ONES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = { 30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa' };
const HUNDREDS = { 1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos', 6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos' };

/** A whole number as Spanish words: 21 → "veintiuno" ("veintiuna" with fem), 350 → "trescientos cincuenta", 2026 → "dos mil veintiséis". */
export function numberWordsEs(n, { fem = false } = {}) {
  n = Math.floor(Math.abs(n));
  const f = (w) => (fem ? w.replace(/uno$/, 'una').replace(/^veintiún$/, 'veintiuna') : w);
  if (n < 30) return f(ONES[n]);
  if (n < 100) { const t = Math.floor(n / 10) * 10, u = n % 10; return u ? `${TENS[t]} y ${f(ONES[u])}` : TENS[t]; }
  if (n < 1000) { if (n === 100) return 'cien'; const h = Math.floor(n / 100), r = n % 100; return r ? `${HUNDREDS[h]} ${numberWordsEs(r, { fem })}` : HUNDREDS[h]; }
  if (n < 1e6) { const k = Math.floor(n / 1000), r = n % 1000; const head = k === 1 ? 'mil' : `${numberWordsEs(k).replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')} mil`; return r ? `${head} ${numberWordsEs(r, { fem })}` : head; }
  return String(n);
}

/**
 * A Spanish sentence → pieces for the voice: {word, phones} for Spanish words, {word, lang: "en"} for English words inside a
 * place's name (the pack's `english` list, applied only within the names given: "Don Taco Tequila" keeps its English, "tacos de
 * mariscos" does not), {mark} for punctuation. Numbers are said as words first (feminine after "la", "las": "la una").
 * `bad` lists the words that gave no valid phones (none should).
 */
// In a sentence, the small words are said without stress (MapSMA's list above was for names); written accents keep theirs
// ("cómo", "dónde", "más").
const SMALL = new Set(('a al con en por para que un unos unas se me te lo le les nos su sus mi mis tu tus o u e ni sin hasta desde ' +
  'como cuando donde pero si mas').split(' '));
const unstressed = (word, phones) => (phones && SMALL.has(fold(word)) && fold(word) === word.toLowerCase() ? phones.replace(/ˈ/g, '') : phones);

export function sentencePhones(text, { english = [], readings = {}, names = [] } = {}) {
  const ENGLISH = new Set(english.map(fold));
  const words = String(text).replace(/[¿¡"“”«»()]/g, ' ').replace(/&/g, ' y ')
    .replace(/(\d+)[.,](\d+)/g, (m, a, b) => `${a} punto ${b}`)
    .match(/[\p{L}\p{N}']+|[.,;:!?…—]/gu) || [];
  // the words that belong to a place's name in this sentence
  const key = (w) => fold(w).replace(/'/g, '');
  const inName = new Set();
  const seq = words.map(key);
  for (const name of names) {
    const nw = (String(name).replace(/&/g, ' y ').match(/[\p{L}\p{N}']+/gu) || []).map(key);
    if (!nw.length) continue;
    for (let i = 0; i + nw.length <= seq.length; i++) if (nw.every((w, k) => seq[i + k] === w)) for (let k = 0; k < nw.length; k++) inName.add(i + k);
  }
  const pieces = [], bad = [];
  words.forEach((w, i) => {
    if (/^[.,;:!?…—]$/.test(w)) { pieces.push({ mark: w }); return; }
    if (/^\d+$/.test(w)) {
      const prev = fold(words[i - 1] || '');
      const said = numberWordsEs(+w, { fem: prev === 'la' || prev === 'las' });
      for (const part of said.split(' ')) pieces.push({ word: part, phones: wordPhones(part, { readings }) });
      return;
    }
    if (inName.has(i) && ENGLISH.has(key(w))) { pieces.push({ word: w, lang: 'en' }); return; }
    const phones = unstressed(w, wordPhones(w.replace(/'/g, ''), { readings }));
    if (!phones) bad.push(w);
    pieces.push({ word: w, phones });
  });
  return { pieces, bad };
}
