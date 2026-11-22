// Streets (owner, 22 Nov 2026: "show me restaurants on Umarán" failed: "Seems restaurants and street names fail"). A place's street is the
// first part of its address ("Umarán 8, Zona Centro" → Umarán), so a city's streets come from its data, with no list to keep. A question
// names a street after "on", "along", "calle", "en la calle", or before "street": "restaurants on Umarán", "¿qué hay en la calle Mesones?".
// The street's words are then not a place's name ("Umarán" is also Café Umarán). /page5 has its own copy of these rules (page5/read.js).

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The street of an address: {key (folded words), name (as written)} or null ("In the campo north of town", "Near km 3"). */
export function streetOf(address) {
  let s = String(address || '').split(/[,(]/)[0].trim();
  s = s.replace(/^calz\.?\s+/i, 'Calzada ').replace(/^(calle|c\.)\s+/i, '');
  s = s.replace(/\s+(s\/n\b.*|no\.?\s*\d.*|#\s*\d.*|\d.*)$/i, '').trim();  // the number, and anything after it
  const key = fold(s).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (key.length < 4 || /^(in the|near|colonia|mercado|km)\b/.test(key)) return null;
  return { key, name: s };
}

/** entries: [{id, address}] → {streets: [{key, name, ids}], byId: Map(id → key), re} (re finds a street in a folded question). */
export function streetIndex(entries) {
  const streets = new Map(), byId = new Map();
  for (const { id, address } of entries) {
    const st = streetOf(address);
    if (!st) continue;
    byId.set(id, st.key);
    if (!streets.has(st.key)) streets.set(st.key, { key: st.key, name: st.name, ids: [] });
    streets.get(st.key).ids.push(id);
  }
  const keys = [...streets.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/ /g, '\\s+'));
  const alt = keys.join('|');
  const re = keys.length ? new RegExp(`(?:^|\\s)(?:(?:on|along|in|at|off|en|sobre|por)\\s+(?:the\\s+)?(?:la\\s+)?(?:calle\\s+|street\\s+|avenida\\s+)?|(?:calle|street|avenida)\\s+)(${alt})(?:\\s+(?:street|st|calle|avenue))?(?=\\s|$)|(?:^|\\s)(${alt})\\s+street(?=\\s|$)`) : null;
  return { streets: [...streets.values()], byId, re };
}

/** The street a folded question names: {key, name, masked (the question with the street's words as §)} or null. */
export function findStreet(s, index) {
  if (!index || !index.re) return null;
  const m = index.re.exec(s);
  if (!m) return null;
  const key = (m[1] || m[2]).replace(/\s+/g, ' ');
  const st = index.streets.find((x) => x.key === key);
  const at = m.index + m[0].indexOf(m[1] || m[2]), len = (m[1] || m[2]).length;
  return { key, name: st ? st.name : key, masked: s.slice(0, at) + s.slice(at, at + len).replace(/\S+/g, '§') + s.slice(at + len) };
}
