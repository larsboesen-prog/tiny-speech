// MapSMA /page5: Spanish names said the Spanish way by the tiny-voca voice (Lars, 17 Nov 2026: "How can we pronounce names better in
// Spanish using tiny voca?"). tiny-voca reads English: its phonemizer (dizione) guesses an unknown word's sounds from English spelling,
// so "Tostévere" came out as "Toast of Ear". Spanish spelling is regular, so each word of a place name is turned into the voice's own
// sounds here by Spanish rules (pure vowels, tapped r, soft d, j and x as h, ll as y, ñ as ny, Spanish stress) and taught to the
// phonemizer when the voice starts (dizione's add_overrides, in tinyvoca-worker.js). English words in names stay English.

// tiny-voca's phones (dizione/symbols.py, 59 American-English phones): nothing else may be used.
export const PHONES = new Set(['p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ', 'l', 'ɹ', 'j', 'w', 'tʃ', 'dʒ', 'ɾ', 'ʔ',
  'ə', 'ɐ', 'ɚ', 'ᵻ', 'ɪ', 'i', 'iː', 'ɛ', 'æ', 'ʌ', 'ɑː', 'ɔ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'ɔɪ', 'oʊ', 'aʊ', 'iə', 'oː',
  'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɪɹ', 'ɛɹ', 'ʊɹ', 'aɪɚ', 'aɪə', 'əl', 'n̩']);

// Words in place names that are English (or best left to the voice's English): Inside Café, Geek & Coffee, Andy's Taco Cart...
const ENGLISH = new Set(['the', 'restaurant', 'inside', 'geek', 'coffee', 'and', 'fish', 'cart', 'rooftop', 'market', 'andy', 'andys', 'maple',
  'sushi', 'taco', 'tacos', 'tequila', 'baja', 'torrart', 'tamales']);
// Spanish words said without stress (articles, prepositions, "y", the "San" and "Don" before a name).
const UNSTRESSED = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'y', 'san', 'don']);
// Not Spanish: written by hand, in the voice's phones.
const BY_HAND = {
  jacques: 'ʒ ˈɑː k',                // French
  giovanni: 'dʒ oʊ v ˈɑː n i',        // Italian
  chope: 'ʃ ˈɑː p',                  // La Chope: French "chope", a beer mug
};

const VOWELS = new Set(['ə', 'ɐ', 'ɚ', 'ᵻ', 'ɪ', 'i', 'iː', 'ɛ', 'æ', 'ʌ', 'ɑː', 'ɔ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'eɪ', 'aɪ', 'ɔɪ', 'oʊ', 'aʊ', 'iə', 'oː',
  'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɪɹ', 'ɛɹ', 'ʊɹ', 'aɪɚ', 'aɪə', 'əl', 'n̩']);
// As the phonemizer checks it: every phone in the inventory, stress marks on vowels only (it refuses the whole word otherwise).
const valid = (ph) => !!ph && ph.split(' ').every((u) => { const s = /^[ˈˌ]/.test(u), p = s ? u.slice(1) : u; return PHONES.has(p) && (!s || VOWELS.has(p)); });
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isVowel = (c) => /[aeiouáéíóúü]/.test(c);
const STRONG = /[aeoáéíóú]/;  // a, e, o and any accented vowel make their own syllable

// One Spanish word -> the voice's phones with stress marks ("ɑː s oʊ t ˈeɪ ɑː"), or null when there is nothing to say.
export function spanishPhones(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  if (!w) return null;
  if (BY_HAND[fold(w)]) return valid(BY_HAND[fold(w)]) ? BY_HAND[fold(w)] : null;
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

// Every Spanish word of the given names -> its phones, keyed the way the voice sees the word (no accents, no apostrophes: sayName in
// ask.js), for tiny-voca's phonemizer.
export function spanishLexicon(names) {
  const out = {};
  for (const name of names) {
    for (const raw of String(name).split(/[\s&,·/-]+/)) {
      const key = fold(raw).replace(/'/g, '').replace(/[^a-z]/g, '');
      if (!key || key.length < 2 || ENGLISH.has(key) || out[key]) continue;  // a single letter is spelled out by the phonemizer anyway
      const ph = spanishPhones(raw.replace(/'/g, ''));
      if (ph) out[key] = ph;
    }
  }
  return out;
}
