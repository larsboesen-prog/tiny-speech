// tiny-speech domains/places/ask.js: answering a request about places, for any city.
// MapSMA /page5's ask.js (18 Nov 2026) with every San Miguel value read from the city pack (D6, plan step B3): time zone, centre,
// distances, meal hours, the sights' sentence names, the curated list (Susan York's picks) and how answers name the city. The code is
// MapSMA's except where it reads the pack; the golden tests check its answers to 434 questions at three clocks.
// MapSMA /page5 (Ask by voice, 17 Nov 2026): answers questions about the places on this site in the browser, from the files the
// site already serves (data.js, photos/hours.json, photos/selected.json, susan.js). No server, no AI model: Lars, 17 Nov 2026,
// "Consider having the 80 so restaurant data in text locally so no need to check server".
//
// Three kinds of question (Lars's examples):
//   a list    "Find 4 restaurants in Centro that are open in the next 2 hours"      -> up to N cards, as on /page2
//   one place "Is La Azotea open?"                                                 -> one card, as on /page2/#60
//   Susan     "Surprise me: three restaurants Susan York reviewed that are open now" -> her picks (susan.js), at random
// "4 more" continues the last list. Anything else is searched in the names, areas and descriptions.
//
// The opening-hours rules are the ones on /page2 and /page3 (San Miguel time; Monday = "0"; "13:00–01:00" runs past midnight), and
// "open now" means open now or opening within two hours (Lars: "open now (next 2 hrs)"). A place that closes within 45 minutes does
// not count as open: the cards call that "Closing soon".

// Reading the question (words -> request) lives in read.js; this file answers requests. The same ?v= as index.html's.
import { fold, SOON, parse, TOPIC, dayOff, createReader, compiled } from './read.js';
export { fold, SOON, parse, sound, requestOf } from './read.js';
// Days, numbers and clock times, said: the language packs (they were here until 19 Nov 2026).
import { DAYNAMES, clock, sayTime, sayNum } from '../../lang/en/index.js';
import { DIAS, sayNumEs, sayTimeEs, aTimeEs, showTimeEs } from '../../lang/es/index.js';
import { answerMusic } from '../music/index.js';
export { DAYNAMES, clock, sayTime, sayNum, DIAS, sayNumEs, sayTimeEs, aTimeEs, showTimeEs };

export const EAT = ['bfast', 'mex', 'world', 'street', 'share', 'roof'];

export const MIN_LEFT = 45;       // minutes a place must stay open to count as open
// The centre's radius, how far "near me" may be, walking speed and "recent" for a curated list come from the city pack
// (centre.radiusM, farM, walkMPerMin, collections[].recentDays).
// Metres between two points, and how far a place is, for the voice and for the cards ("about 350 meters away", "350 m · 5 min walk").
export function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180, x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return R * Math.hypot(x, y);
}
const round50 = (m) => Math.max(50, Math.round(m / 50) * 50);
export const sayDist = (m) => (m < 1000 ? `about ${round50(m)} meters away` : `about ${(m / 1000).toFixed(1)} kilometers away`);

// San Miguel's day (Monday = 0) and minute of the day, for a moment (default: now).
export function nowAt(tz, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { d: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), m: (+parts.hour % 24) * 60 + (+parts.minute), date };
}
const toMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
export const ranges = (s) => s.split(', ').map((r) => { const [a, b] = r.split('–'); const s0 = toMin(a); let e = toMin(b); if (e <= s0) e += 1440; return [s0, e]; });

// A time as the cards show it (22:00, 1:00) and as the voice says it (10 p.m., 1 a.m., noon, midnight).
const until = (m) => (((m % 1440) + 1440) % 1440 === 0 ? 'midnight' : clock(m));  // in a sentence: "until midnight", not "until 0:00"

// ---------- Spanish (Lars, 17 Nov 2026: "Yes build that way - with phones output for Spanish and a language switch EN ES") ----------
const deTimeEs = (m) => { const t = sayTimeEs(m); return t.startsWith('el ') ? 'del ' + t.slice(3) : 'de ' + t; };  // "del mediodía", "de la 1 de la tarde"
const rangeEs = (a, b) => `${deTimeEs(a)} ${aTimeEs(b)}`;  // "del mediodía a la medianoche"
const untilEs = (m) => (((m % 1440) + 1440) % 1440 === 0 ? 'medianoche' : clock(m));
export const sayDistEs = (m) => (m < 1000 ? `a unos ${round50(m)} metros` : `a unos ${(m / 1000).toFixed(1)} kilómetros`);
// Walking minutes, and how far a place is on a card, at the city's walking speed (pack: walkMPerMin).
export function distances(perMin) {
  const walkMin = (m) => Math.max(1, Math.round(m / perMin));
  return {
    walkMin,
    walkEs: (m) => (walkMin(m) === 1 ? 'un minuto' : `unos ${walkMin(m)} minutos`),
    showDist: (m) => `${m < 1000 ? round50(m) + ' m' : (m / 1000).toFixed(1) + ' km'} · ${walkMin(m)} min walk`,
    showDistEs: (m) => `${m < 1000 ? round50(m) + ' m' : (m / 1000).toFixed(1) + ' km'} · ${walkMin(m)} min a pie`,
  };
}
const capEs = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stop = (s) => (/[.!?]$/.test(s) ? s : s + '.');
// A name for the voice: no accents or apostrophes inside words (tiny-voca reads English), "&" as "and".
// How a few names are spelled for the voice, which reads English ("Hierba" came out as "here Ba"): the English spelling people use.
const SAY_AS = {};  // was {'Hierba Santa': 'Yerba Santa'}; since 17 Nov the voice is taught Spanish pronunciations (spanish.js) instead
// "y" (and) between two words of a name is written "e" for the voice: alone, "y" is read as the letter ("why"), and the letter "e" is
// read "ee", the sound of the Spanish "y" (Arriba y Abajo).
export const sayName = (s) => String(SAY_AS[s] || s || '').replace(/(\p{L}) y (?=\p{L})/gu, '$1 e ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/(\w)'(?!s\b)(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();

// ---------- the answers ----------
export function createAsker({ pack, shown = (p) => p.other || p.photo, random = Math.random, lang = 'en' }) {
  // The city, from its pack: places as MapSMA's data.js had them, and the tables the code below reads.
  const places = pack.places.map((p) => ({ id: p.id, name: p.name, cat: p.kind, lat: p.lat, lng: p.lng, area: p.area, desc: p.desc || '', acc: p.acc,
    ...(p.other ? { other: true } : {}), photo: !!p.photo, names: p.names, exactName: !!p.exactName, noShort: !!p.noShort }));
  const INFO = Object.fromEntries(pack.places.filter((p) => p.info).map((p) => [p.id, p.info]));
  const HOURS = Object.fromEntries(Object.entries(pack.hours).map(([id, v]) => [id, v.h]));
  const CATS = pack.kinds;
  const ALSO = Object.fromEntries(pack.places.filter((p) => p.alsoKinds).map((p) => [p.id, p.alsoKinds]));
  const FACTS = Object.fromEntries(pack.places.filter((p) => p.facts).map((p) => [p.id, p.facts]));
  const C = (pack.collections || [])[0] || null;  // a curated list (in San Miguel, Susan York's picks); one a pack for now
  const TX = pack.text, CT = C ? C.text : { en: {}, es: {} };
  const LOCALE = { en: `en-${(pack.variety?.en || 'us').toUpperCase()}`, es: `es-${(pack.variety?.es || 'mx').toUpperCase()}` };
  const { walkMin, walkEs, showDist, showDistEs } = distances(pack.walkMPerMin);
  const notCentre = pack.areas.filter((x) => x.notCentre === true).map((x) => new RegExp('^' + x.id, 'i'));
  const areaOf = (id) => pack.areas.find((x) => x.id === id) || { match: [id], in: { en: ` in ${id}`, es: ` en ${id}` } };
  const es = lang === 'es';  // the answers in Spanish (the page's ES switch); the questions are read in either language
  const byId = Object.fromEntries(places.map((p) => [p.id, p]));
  const isSight = (p) => p.cat === 'sights';
  const catsOf = (p) => [p.cat, ...(ALSO[p.id] || [])];
  const jardin = byId[pack.centre.place] || pack.centre.fallback || pack.centre;  // the city's centre
  const dist = (p) => {
    const R = 6371000, rad = Math.PI / 180, x = (p.lng - jardin.lng) * rad * Math.cos(((p.lat + jardin.lat) / 2) * rad), y = (p.lat - jardin.lat) * rad;
    return R * Math.hypot(x, y);
  };
  const inCentro = (p) => dist(p) <= pack.centre.radiusM && !notCentre.some((re) => re.test(p.area));
  // Where distances are measured from: the phone, when it is in or near San Miguel; else the Jardín.
  const origin = (here) => (here && metres(here, jardin) <= pack.farM ? { o: here, mine: true } : { o: jardin, mine: false, far: !!here });
  const picks = Object.fromEntries(((C && C.places) || []).filter((x) => byId[x.id]).map((x) => [x.id, x]));
  const F = (p) => (FACTS && FACTS[p.id]) || {};  // facts.js: cuisine c, dishes d, price p, features f, what it is w, why unusual u
  const textOf = (p) => fold([p.name, p.desc, (picks[p.id] || {}).note, (picks[p.id] || {}).note_es, F(p).w, F(p).w_es, F(p).u].join(' '));
  function topicScore(p, t) {  // how well a place matches a topic: 0 not at all, 1 by its words, 2 a cuisine, dish or feature, 3 its kind or main cuisine
    const f = F(p), c = f.c || [], ft = f.f || [], d = f.d || [];
    let sc = 0;
    if (t.cat && catsOf(p).some((x) => t.cat.includes(x))) sc = t.cs || 3;
    if (t.c) { if (c.length && t.c.includes(c[0])) sc = Math.max(sc, 3); else if (c.some((x) => t.c.includes(x))) sc = Math.max(sc, 2.5); }
    if (t.f && ft.some((x) => t.f.includes(x))) sc = Math.max(sc, t.fs || 2);
    if (t.d && d.some((x) => t.d.some((w) => (' ' + x).includes(' ' + w)))) sc = Math.max(sc, 2);
    if (t.extra) sc = Math.max(sc, t.extra(p, f));
    if (!sc && t.t) { const hay = ' ' + textOf(p).replace(/[^a-z0-9]+/g, ' '); if (t.t.some((w) => hay.includes(' ' + w))) sc = 1; }
    return sc;
  }
  // Cafés are their own kind (Lars, 18 Nov 2026, his screenshot of cafés in an answer at 8:20: "Needs to separate restaurants and cafes so
  // for dinner or lunch not showing coffee places and not always showing by default"): coffee and bakery places, and places whose main
  // food is coffee, bread, sweets, ice cream or breakfast.
  const CAFE_MAIN = ['coffee', 'bakery', 'pastries', 'desserts', 'ice_cream', 'breakfast', 'brunch', 'juice', 'chocolate'];
  const isCafe = (p) => { const c = F(p).c || []; return catsOf(p).includes('bfast') || CAFE_MAIN.includes(c[0]) || (c.includes('coffee') && c.includes('breakfast')); };
  const CAFE_TOPICS = new Set(['coffee', 'bakery', 'croissant', 'desserts', 'icecream', 'chocolate', 'brunch', 'breakfast', 'sandwich', 'healthy', 'wifi',
    'dish:pancakes', 'dish:waffles', 'dish:French toast', 'dish:avocado toast', 'dish:chilaquiles', 'dish:churros', 'dish:crêpes', 'dish:huevos rancheros']);
  // Cafés belong in an answer when the question is about breakfast, coffee, bread or sweets, or asks for a kind of place they can be;
  // never for lunch, dinner, tonight, late night or "restaurants"; and when nothing is asked, only in the morning (5:00-11:30).
  function cafesWanted(q, n) {
    const meal = q.meal || q.mealNow || q.lateMeal;
    if (meal === 'bfast' || meal === 'brunch' || (q.topics || []).some((k) => CAFE_TOPICS.has(k)) || (q.cats || []).includes('bfast')) return true;
    if (meal === 'lunch' || meal === 'dinner' || meal === 'late' || meal === 'tonight' || q.restaurantWord) return false;
    if ((q.topics || []).length || q.unique || q.collection || q.local || q.price) return true;
    return n.m >= 300 && n.m < 690;
  }
  const cheap = (p) => F(p).p === 1;
  const fancy = (p) => (F(p).p || 0) >= 3 || (F(p).c || []).some((x) => x === 'fine_dining' || x === 'tasting_menu');
  const midPrice = (p) => F(p).p != null && F(p).p <= 2;
  // "where do locals eat": cheap Mexican food, or a place whose main cooking is traditional or home-style
  const local = (p) => (cheap(p) && (catsOf(p).some((c) => c === 'mex' || c === 'street') || (F(p).c || []).some((x) => ['mexican', 'traditional_mexican', 'home_style', 'tacos', 'birria', 'street_food'].includes(x))))
    || ['traditional_mexican', 'home_style'].includes((F(p).c || [])[0]);
  // the sights a question can be near ("lunch near the Parroquia"), as a sentence names them
  const SIGHT_NAME = Object.fromEntries(pack.places.filter((p) => p.sentence).map((p) => [p.id, [p.sentence.en, p.sentence.es]]));
  const sightName = (id, l) => (SIGHT_NAME[id] || [byId[id].name, byId[id].name])[l === 'es' ? 1 : 0];

  // The opening spans from yesterday to a week ahead, in minutes from today's midnight in San Miguel (yesterday's late night runs into
  // today), touching spans joined. null when today's hours are not published.
  function spans(id, n) {
    const h = HOURS[id];
    if (!h || h[String(n.d)] === undefined) return null;
    const out = [];
    for (let k = -1; k <= 7; k++) {
      const t = h[String((n.d + k + 7) % 7)];
      if (typeof t === 'string') for (const [a, b] of ranges(t)) out.push([a + 1440 * k, b + 1440 * k]);
    }
    out.sort((a, b) => a[0] - b[0]);
    const joined = [];
    for (const x of out) { const last = joined[joined.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else joined.push([...x]); }
    return joined;
  }
  // Right now: open (until when) or closed (opening when). null when the hours are unknown.
  function avail(id, n) {
    const sp = spans(id, n);
    if (!sp) return null;
    const cur = sp.find(([a, b]) => a <= n.m && n.m < b), next = sp.find(([a]) => a > n.m);
    return { open: !!cur, until: cur ? cur[1] : null, left: cur ? cur[1] - n.m : 0, at: next ? next[0] : null, wait: next ? next[0] - n.m : null, closedToday: HOURS[id][String(n.d)] === null };
  }
  const openNow = (a) => !!a && a.open && a.left >= MIN_LEFT;
  const fits = (a, w) => openNow(a) || (!!a && a.at != null && a.wait <= w);
  // Meals, as in the "When?" menu on /page2: open long enough inside the meal's hours, today or, once they have passed, tomorrow.
  const MEAL_LABEL = { bfast: 'breakfast', brunch: 'brunch', lunch: 'lunch', dinner: 'dinner', late: 'late at night' };
  const MEALS = Object.fromEntries(Object.entries(pack.meals).map(([k, v]) => [k, { label: MEAL_LABEL[k], win: v.win, min: v.min }]));
  const mealTomorrow = (k, n) => k !== 'late' && n.m > MEALS[k].win[1];
  const mealDay = (k, n, off) => (off != null ? off : mealTomorrow(k, n) ? 1 : 0);
  const dayWords = (k, n) => (k === 0 ? 'today' : k === 1 ? 'tomorrow' : `on ${DAYNAMES[(n.d + k) % 7]}`);
  const dayWordsEs = (k, n) => (k === 0 ? 'hoy' : k === 1 ? 'mañana' : `el ${DIAS[(n.d + k) % 7]}`);
  function mealOK(id, k, n, off = null) {
    const sp = spans(id, n);
    if (!sp) return false;
    const o = mealDay(k, n, off) * 1440, [a, b] = MEALS[k].win;
    return sp.some(([s, e]) => Math.min(e, b + o) - Math.max(s, a + o) >= MEALS[k].min);
  }
  function mealSpan(id, k, n, off = null) {  // the opening that covers the meal: {s, e, day, off}
    const sp = spans(id, n);
    if (!sp) return null;
    const dd = mealDay(k, n, off), o = dd * 1440, [a, b] = MEALS[k].win;
    const x = sp.find(([s, e]) => Math.min(e, b + o) - Math.max(s, a + o) >= MEALS[k].min);
    return x ? { s: x[0], e: x[1], day: dayWords(dd, n), off: dd } : null;
  }
  function dayHours(id, n, off) {  // a day's published opening, [[from, to] (minutes)]: [] closed, null not published
    const h = HOURS[id], t = h ? h[String((n.d + off) % 7)] : undefined;
    return t === undefined ? null : t === null ? [] : ranges(t);
  }


  const name = (p) => p.name;
  const pickDate = (id) => picks[id] && new Date(picks[id].date + 'T12:00:00');
  const monthOf = (id) => pickDate(id).toLocaleDateString(LOCALE.en, { month: 'long', year: 'numeric' });
  const wroteEn = (id) => CT.en.wrote.replace('{month}', monthOf(id));
  function nextOpenWords(a, n) {  // "today at 1 p.m.", "tomorrow at noon", "on Thursday at 8 a.m."
    const k = Math.floor(a.at / 1440), t = sayTime(a.at), c = clock(a.at);
    if (k <= 0) return { say: `today at ${t}`, show: `today at ${c}` };
    if (k === 1) return { say: `tomorrow at ${t}`, show: `tomorrow at ${c}` };
    const day = DAYNAMES[(n.d + k) % 7];
    return { say: `on ${day} at ${t}`, show: `on ${day} at ${c}` };
  }

  // One place: is it open, until when, or when does it open.
  function one(p, n, q = {}, here = null) {
    const sname = sayName(name(p));
    const out = { kind: 'one', id: p.id, ids: [p.id], say: [], show: '' };
    const said = (text) => out.say.push({ text: stop(text), id: p.id });
    // what Quiet shows instead of the voice: the same answer, with the times as the cards write them
    const done = () => {
      if (p.other) { out.show += " It's not one of our picks."; said("It's not one of our picks"); }  // an extra place (others.js)
      out.lines = [{ text: out.show, id: p.id }]; if (picks[p.id] && !isSight(p)) out.lines.push({ text: `${wroteEn(p.id)}.`, id: p.id }); return out;
    };
    if (isSight(p)) { out.show = `${p.name} is a sight, not a place to eat.`; said(`${sname} is a sight, not a place to eat. Here it is`); return done(); }
    const off = dayOff(q, n);
    if (off) {  // "Is Bocaciega open tomorrow?", "… on Sunday?"
      const day = (n.d + off) % 7, h = HOURS[p.id], t = h ? h[String(day)] : undefined, tmr = off === 1;
      const dayN = tmr ? 'tomorrow' : DAYNAMES[day], on = tmr ? 'tomorrow' : `on ${DAYNAMES[day]}`;
      if (t === undefined) { out.show = `${p.name}'s hours for ${dayN} aren't published online. Check Google Maps.`; said(`I don't have ${sname}'s hours for ${dayN}. Check Google Maps`); }
      else if (t === null) { out.show = `${p.name} is closed ${on}${tmr ? ` (${DAYNAMES[day]})` : ''}.`; said(`${sname} is closed ${on}`); }
      else {
        const rs = ranges(t);
        out.show = `${tmr ? `Tomorrow (${DAYNAMES[day]})` : `On ${DAYNAMES[day]}`} ${p.name} is open ${rs.map(([a, b]) => `${clock(a)}–${until(b)}`).join(' and ')}.`;
        said(`Yes. ${tmr ? 'Tomorrow' : `On ${DAYNAMES[day]}`} ${sname} is open from ${rs.map(([a, b]) => `${sayTime(a)} to ${sayTime(b)}`).join(', and from ')}`);
      }
      if (picks[p.id]) said(`${wroteEn(p.id)}`);
      return done();
    }
    const a = avail(p.id, n);
    if (q.howFar || q.near) {  // "How far is La Azotea?": the distance first, then whether it is open
      const og = origin(here), m = metres(og.o, p), km = m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
      if (og.mine) { out.show = `${p.name} is ${km} from you, about ${walkMin(m)} min on foot.`; said(`${sname} is ${sayDist(m).replace(' away', '')} from you, about ${walkMin(m)} minutes' walk`); }
      else if (og.far) { out.show = `You don't seem to be in ${TX.en.city} right now. From ${TX.en.centre}, ${p.name} is ${km} away.`; said(`You don't seem to be in ${TX.en.city} right now. From ${TX.en.centre}, ${sname} is ${sayDist(m)}`); }
      else { out.show = `I don't know where you are, so I can't tell how far ${p.name} is.`; said(`I don't know where you are, so I can't tell how far ${sname} is`); }
      if (!a) { out.show += " Its opening hours aren't published online."; said("Its opening hours aren't published online"); }
      else if (openNow(a)) { out.show += ` It's open now, until ${until(a.until)}.`; said(`It's open now, until ${sayTime(a.until)}`); }
      else if (a.open) { out.show += ` It closes soon, at ${until(a.until)}.`; said(`It closes soon, at ${sayTime(a.until)}`); }
      else if (a.at != null) { const w = nextOpenWords(a, n); out.show += ` It's closed now; it opens ${w.show}.`; said(`It's closed now. It opens ${w.say}`); }
      if (picks[p.id]) said(`${wroteEn(p.id)}`);
      return done();
    }
    if (!a) { out.show = `${p.name}'s opening hours aren't published online. Check Google Maps.`; said(`I don't have opening hours for ${sname}. Check Google Maps`); }
    else if (openNow(a)) { out.show = `Yes, ${p.name} is open now, until ${until(a.until)}.`; said(`Yes. ${sname} is open now, until ${sayTime(a.until)}`); }
    else if (a.open) { out.show = `${p.name} is open, but closes soon, at ${until(a.until)}.`; said(`${sname} is open, but it closes soon, at ${sayTime(a.until)}`); }
    else if (a.at != null) {
      const w = nextOpenWords(a, n), why = a.closedToday ? 'closed today' : 'closed right now';
      out.show = `No, ${p.name} is ${why}. It opens ${w.show}.`;
      said(`No. ${sname} is ${why}. It opens ${w.say}`);
    } else { out.show = `No, ${p.name} is closed, and its next opening isn't listed.`; said(`No. ${sname} is closed, and I don't know when it opens next`); }
    if (q.price) priceSay(p, (t) => { out.show += ' ' + t + '.'; said(t); }, false);
    if (picks[p.id]) said(`${wroteEn(p.id)}`);
    return done();
  }
  // "Is Fenicia cheap?": the price as facts.js has it (1 cheap … 4 very expensive)
  function priceSay(p, put, inEs) {
    const v = F(p).p;
    if (v == null) put(inEs ? 'No sé qué tan caro es' : "I don't know its prices");
    else put(inEs ? ['', 'Es de los lugares más baratos de nuestra lista', 'Sus precios son moderados', 'Es de los lugares más caros de nuestra lista', 'Es de los lugares más caros de nuestra lista'][v]
      : ['', "It's one of the cheaper places on our list", 'Its prices are moderate', "It's one of the pricier places on our list", "It's one of the most expensive places on our list"][v]);
  }

  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Several kinds of place before several of one kind: Mexican, world food, a rooftop, a bar... each kind nearest the Jardín first.
  const KIND_ORDER = ['mex', 'world', 'roof', 'share', 'bfast', 'street', 'wine', 'shop'];
  const MORNING_ORDER = ['bfast', 'world', 'mex', 'street', 'share', 'roof', 'wine', 'shop'];  // breakfast: the cafés first
  function mixKinds(rows, order = KIND_ORDER) {
    const byKind = new Map(order.map((k) => [k, []]));
    for (const r of [...rows].sort((x, y) => dist(x.p) - dist(y.p))) (byKind.get(r.p.cat) || byKind.get('shop')).push(r);
    const out = [];
    for (let left = rows.length; left > 0;) for (const k of order) { const r = byKind.get(k).shift(); if (r) { out.push(r); left--; } }
    return out;
  }

  // Several places: filter, rank, and the first `count` of them.
  function list(q, n, here = null) {
    const topics = (q.topics || []).map((k) => TOPIC[k]);
    let pool = places.filter((p) => !isSight(p) && shown(p));
    // a topic looks through every kind of place to eat and drink (and wine shops or wineries when it is about wine); otherwise the kinds asked for
    const want = new Set(topics.length ? [...EAT, ...topics.flatMap((t) => t.pool || [])] : q.cats || EAT);
    if (q.collection) for (const k of C.alsoKinds || []) want.add(k);  // a curated list may include other kinds (wineries)
    pool = pool.filter((p) => catsOf(p).some((c) => want.has(c)));
    if (q.picksOnly || (q.surprise && !topics.length)) pool = pool.filter((p) => !p.other);  // "four we recommend", "surprise me": our picks only
    const base = pool;  // before the where (Centro, an area) and who (Susan, unusual, local) filters
    const og = q.nearSight ? { o: byId[q.nearSight], sight: q.nearSight } : q.near ? origin(here) : null;
    if (q.centro) pool = pool.filter(inCentro);
    if (q.area && !q.nearSight) pool = pool.filter((p) => { const a = fold(p.area + ' ' + ((INFO[p.id] || {}).address || '')); return areaOf(q.area).match.some((w) => a.includes(w)); });  // the Spanish page's areas are in Spanish
    if (q.collection) pool = pool.filter((p) => picks[p.id]);
    if (q.unique) pool = pool.filter((p) => F(p).x);
    if (q.local) pool = pool.filter(local);
    // the topics: every one must match, and their scores order the places. When nothing matches (Lars, 18 Nov 2026: "say here are four we
    // recommend approx what they want when we don't have a clear answer"): a topic the site has nowhere is said so, and its nearest topic
    // (pizza -> Italian food), or else the rest of the question, or else places we recommend, takes its place; a topic the site has, but
    // not there ("rooftops in Guadalupe"), is said so, and the ones elsewhere are shown.
    const score = new Map();
    let miss = null, whereMiss = false, recommend = false;
    if (topics.length) {
      const scoreAll = (ts, from = pool) => {
        const m = new Map();
        for (const p of from) { let sc = 0; for (const t of ts) { const x = topicScore(p, t); if (!x) { sc = 0; break; } sc += x; } if (sc) m.set(p.id, sc); }
        return m;
      };
      let m = scoreAll(topics);
      if (!m.size) {
        const gone = topics.find((t) => !base.some((p) => topicScore(p, t) > 0));
        if (gone) {
          const alt = gone.near ? TOPIC[gone.near] : null, rest = topics.filter((t) => t !== gone);
          miss = { topic: gone, alt };
          if (alt) { m = scoreAll([...rest, alt]); if (!m.size) m = scoreAll([alt]); }
          if (!m.size && rest.length) { m = scoreAll(rest); if (m.size) miss.alt = null; }
          if (!m.size) { m = new Map(pool.filter((p) => !p.other).map((p) => [p.id, 0.5])); miss.alt = null; recommend = true; }
        } else if ((m = scoreAll(topics, base)).size) { whereMiss = true; pool = base; }
      }
      pool = pool.filter((p) => m.has(p.id));
      for (const [id, sc] of m) score.set(id, sc);
    }
    // cafés: only when wanted (if leaving them out leaves nothing, they stay)
    if (!cafesWanted(q, n)) { const f = pool.filter((p) => !isCafe(p)); if (f.length) pool = f; }
    // the price: when nothing is at that price, say so and show the others
    let priceMiss = false;
    if (q.price) {
      const f = pool.filter(q.price === 'low' ? cheap : q.price === 'high' ? fancy : midPrice);
      if (f.length || !pool.length) pool = f; else priceMiss = true;
    }
    // a place whose name says the topic ("Sushi Gami" for sushi) comes first among equally good, equally open places
    const named = (p) => topics.some((t) => t.t && t.t.some((w) => (' ' + fold(p.name) + ' ').includes(' ' + w)));
    let rows = pool.map((p) => ({ p, a: avail(p.id, n), m: og ? metres(og.o, p) : null, s: score.get(p.id) || 0, nb: named(p) ? 1 : 0 }));
    const off = dayOff(q, n);
    if (q.meal) rows = rows.filter((r) => mealOK(r.p.id, q.meal, n, off));
    else if (off != null) rows = rows.filter((r) => (dayHours(r.p.id, n, off) || []).length);  // "open on Sunday"
    if (q.window != null) rows = rows.filter((r) => fits(r.a, q.window));
    const meal = q.meal || q.mealNow || (q.lateMeal === 'tonight' ? 'dinner' : q.lateMeal), morning = meal === 'bfast' || meal === 'brunch';  // breakfast: cafés and breakfast places before the rest
    if (morning) for (const r of rows) if (catsOf(r.p).includes('bfast') || (F(r.p).c || []).some((x) => ['breakfast', 'brunch', 'coffee', 'bakery'].includes(x))) { r.s += 0.5; r.mb = 1; }
    // a meal ("cheap eats", "lunch"): ice cream, coffee, bread and wine after the places that serve meals; for dinner, breakfast places too
    const meals = !morning && (q.eat || meal === 'lunch' || meal === 'dinner');
    const notMeal = ['ice_cream', 'coffee', 'bakery', 'desserts', 'pastries', 'wine', ...(meal === 'dinner' ? ['breakfast', 'brunch'] : [])];
    if (meals) for (const r of rows) if (notMeal.includes((F(r.p).c || [])[0]) || catsOf(r.p).some((c) => c === 'shop' || c === 'wine')) r.s -= 1;
    // a meal still ahead ("dinner tonight" asked in the morning): what is open at this moment does not matter
    const mw = q.meal && MEALS[q.meal] && q.meal !== 'late' ? MEALS[q.meal].win : null;
    const mealAhead = !!mw && !(mealDay(q.meal, n, off) === 0 && n.m >= mw[0] && n.m <= mw[1]);
    const byDate = (x, y) => pickDate(y.p.id) - pickDate(x.p.id);
    const soonest = (x, y) => (x.a && x.a.at != null ? x.a.at : 1e9) - (y.a && y.a.at != null ? y.a.at : 1e9);
    // our picks first, always; the extra places (not our picks) after them, each group ranked on its own (Lars, 18 Nov 2026: "We should
    // call out who we recommend")
    const rank = (rows) => {
      const nowRows = rows.filter((r) => openNow(r.a)), later = rows.filter((r) => !openNow(r.a));
      let ranked;
      if (q.collection) {
        const recent = (r) => n.date - pickDate(r.p.id) <= C.recentDays * 864e5;
        const order = (g) => (q.surprise ? [...shuffle(g.filter(recent)), ...shuffle(g.filter((r) => !recent(r)))] : [...g].sort(byDate));
        ranked = [...order(nowRows), ...order(later)];
      } else if (q.surprise) ranked = [...shuffle(nowRows), ...shuffle(later)];
      else if (og && og.sight) ranked = [...rows].sort((x, y) => (y.mb || 0) - (x.mb || 0) || x.m - y.m);  // near a sight: the nearest first, open or not
      else if (og) { const byM = (x, y) => x.m - y.m; ranked = [...[...nowRows].sort(byM), ...[...later].sort(byM)]; }  // near me: what is open now, the nearest first
      else if (topics.length || q.priciest || q.price || q.local || (meals && q.unique)) {
        // the best match first (the priciest first when asked), then what is open now (nearest the Jardín first), then what opens soonest
        const pr = (r) => (q.priciest ? F(r.p).p || (fancy(r.p) ? 3 : 0) : 0), on = (r) => (mealAhead ? 0 : openNow(r.a));
        ranked = [...rows].sort((x, y) => pr(y) - pr(x) || y.s - x.s || on(y) - on(x) || y.nb - x.nb || (on(x) || mealAhead ? 0 : soonest(x, y)) || dist(x.p) - dist(y.p));
      } else if (meal) {
        // a meal: the places that serve it first, a mix of kinds, nearest the Jardín first; what is open now first only when it is that meal now
        const tiers = [...new Set(rows.map((r) => r.s))].sort((x, y) => y - x);
        const order = morning ? MORNING_ORDER : KIND_ORDER;
        ranked = tiers.flatMap((t) => { const g = rows.filter((r) => r.s === t); return mealAhead ? mixKinds(g, order) : [...mixKinds(g.filter((r) => openNow(r.a)), order), ...g.filter((r) => !openNow(r.a)).sort(soonest)]; });
      } else ranked = [...mixKinds(nowRows), ...[...later].sort(soonest)];
      return ranked;
    };
    const ranked = [...rank(rows.filter((r) => !r.p.other)), ...rank(rows.filter((r) => r.p.other))];
    return { rows: ranked, miss, priceMiss, whereMiss, recommend, pool, origin: og };
  }

  // The topics an answer is about (after a miss, the nearest topic in place of the missing one), and whether they say what kind of food:
  // then each place's name is enough; otherwise each name comes with what it is ("Fenicia, Lebanese food").
  const shownTopics = (q, ranked = {}) => (q.topics || []).map((k) => TOPIC[k]).map((t) => (ranked.miss && ranked.miss.topic === t ? ranked.miss.alt : t)).filter(Boolean);
  const kindAsked = (ts) => ts.some((t) => t.kind === 'cat' || t.kind === 'food');
  const OLD_KIND = { bfast: ['cafés', 'café'], mex: ['Mexican places', 'Mexican place'], world: ['world-food places', 'world-food place'], street: ['street-food places', 'street-food place'], share: ['bars', 'bar'], roof: ['rooftops', 'rooftop'], wine: ['wineries', 'winery'] };
  const oneVerb = (s) => s.replace(/^places\b/, 'place').replace(' that welcome ', ' that welcomes ').replace(' that are ', ' that is ').replace(' that take ', ' that takes ');
  // "cheap places for Mexican food", "rooftops with a view", "places to watch the sunset": [plural, singular]
  // the topics a phrase names: not brunch twice ("places for brunch open for brunch"), not "upscale places for fine dining"
  const phraseTopics = (q, ts) => ts.filter((t) => !((t.k === 'brunch' && q.meal === 'brunch') || (t.k === 'breakfast' && q.meal === 'bfast')));
  const phrasePrice = (q, ts) => (q.priceMiss || (q.price === 'high' && ts.some((t) => t.k === 'fine')) ? null : q.price);
  const ROOF_BARS = { noun: ['rooftop bars', 'rooftop bar'], nounEs: ['bares en azotea', 'bar en azotea', 'm'] };
  const catOf = (ts) => (ts.some((t) => t.k === 'rooftop') && ts.some((t) => t.k === 'bar') ? ROOF_BARS : ts.find((t) => t.noun));
  function kindPhrase(q, ts0) {
    const ts = phraseTopics(q, ts0), cat = catOf(ts), foods = ts.filter((t) => t.kind === 'food'), feats = ts.filter((t) => t.kind === 'feat');
    const price = phrasePrice(q, ts);
    if (!cat && !foods.length && feats.length === 1 && !price && !q.local && !q.unique) return [feats[0].en, oneVerb(feats[0].en)];
    let [pl, sg] = cat ? cat.noun : ['places', 'place'];
    if (q.local) [pl, sg] = ['everyday local places', 'everyday local place'];
    if (q.unique) [pl, sg] = ['unusual places', 'unusual place'];
    const adj = price === 'low' ? 'cheap ' : price === 'high' ? 'upscale ' : price === 'mid' ? 'moderately priced ' : '';
    const trad = foods.find((t) => t.k === 'tradmex'), other = foods.filter((t) => t.k !== 'tradmex');
    const food = foods.length ? ` for ${trad && other.length ? 'traditional ' + other[0].en : (other[0] || trad).en}` : '';
    const withs = feats.map((t) => t.with).join(' and');
    return [adj + pl + food + withs, adj + sg + food + oneVerb(withs)];
  }

  function describe(q, n, og = null, ranked = {}) {  // "in Centro", "near you", what kind of places, "open now or within two hours"
    const where = (q.centro && !(og && og.sight === pack.centre.place) ? TX.en.inCentre : q.area && q.area === compiled(pack).outOfTown ? areaOf(q.area).in.en : q.area && !(og && og.sight) ? areaOf(q.area).in.en : '')
      + (og ? (og.sight ? ` near ${sightName(og.sight)}` : og.mine ? ' near you' : ` near ${TX.en.centre}`) : '');
    const ts = shownTopics(q, ranked);
    let kind = ts.length || q.price || q.local || q.unique ? kindPhrase({ ...q, priceMiss: ranked.priceMiss }, ts) : q.cats && q.cats.length === 1 ? OLD_KIND[q.cats[0]] || null : null;
    if ((q.unclear || ranked.recommend) && (!kind || kind[0] === 'places')) kind = ['places we recommend', 'place we recommend'];
    let when = '', whenShow = '';
    const off = dayOff(q, n);
    if (q.lateMeal) { when = q.lateMeal === 'tonight' ? ' open now' : ` open now for a late ${MEALS[q.lateMeal].label}`; whenShow = when; }
    else if (q.meal) { const dd = mealDay(q.meal, n, off); when = ` open for ${MEALS[q.meal].label}${q.meal === 'late' && off == null ? '' : ' ' + dayWords(dd, n)}`; whenShow = when; }
    else if (off != null) { when = ` open ${dayWords(off, n)}`; whenShow = when; }
    else if (q.window != null) {
      const h = q.window % 60 === 0 ? q.window / 60 : null;
      const span = q.window === SOON ? 'two hours' : h === 1 ? 'hour' : h ? `${sayNum(h)} hours` : `${q.window} minutes`;
      const spanShow = q.window === SOON ? '2 hours' : h === 1 ? 'hour' : h ? `${h} hours` : `${q.window} minutes`;
      when = q.now ? ` open now or within the next ${span}` : ` open in the next ${span}`;
      whenShow = q.now ? ` open now or within the next ${spanShow}` : ` open in the next ${spanShow}`;
    }
    return { where, kind, when, whenShow, ts };
  }

  function listAnswer(q, n, ranked, offset, count) {
    const page = ranked.rows.slice(offset, offset + count), total = ranked.rows.length;
    const og = ranked.origin || null;
    const elsewhere = { ...q, centro: false, area: null, unique: false, local: false, collection: null };  // "rooftops in Guadalupe": none there, the ones elsewhere
    const d = describe(ranked.whereMiss ? elsewhere : q, n, ranked.whereMiss ? null : og, ranked), k = page.length, asked = q.count || 0;  // "only" when a number was asked for
    const out = { kind: 'list', q, ids: page.map((r) => r.p.id), all: ranked.rows.map((r) => r.p.id), offset, count, left: Math.max(0, total - offset - k), say: [], lines: [], show: '', collection: q.collection,
      here: ranked.here || null, dist: og ? Object.fromEntries(page.map((r) => [r.p.id, r.m])) : null, mine: !!(og && og.mine) };
    const said = (text, id) => out.say.push({ text: stop(text.replace(/\s+/g, ' ').trim()), id });
    const line = (text, id) => out.lines.push({ text, id });  // what Quiet shows instead of the voice
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const labels = !kindAsked(d.ts), lab = (r) => (labels ? (q.unique && F(r.p).u) || F(r.p).w || '' : '');  // what each place is, when the question did not say
    const both = (text) => { said(text); line(text + '.'); };
    const notes = [], note = (text) => { both(text); notes.push(text + '.'); };  // what could not be found also leads the written answer
    if (offset === 0 && ranked.miss) note(`I couldn't find ${ranked.miss.topic.en || ranked.miss.topic.noun[0]} on this site's list`);
    if (offset === 0 && ranked.priceMiss) note(`I don't know of any ${{ low: 'cheap', high: 'upscale', mid: 'moderately priced' }[q.price]} ones, so here are all of them`);
    if (offset === 0 && ranked.whereMiss) { const d0 = describe(q, n, og, {}); note(`I found no ${(d0.kind || ['places'])[0]}${d0.where}`); }
    if (offset === 0 && q.unclear) note("I'm not sure what you're looking for");
    if (og && !og.mine && !og.sight && offset === 0) both(og.far ? `You don't seem to be in ${TX.en.city} right now, so I measured from ${TX.en.centre}` : `I don't know where you are, so I measured from ${TX.en.centre}`);  // "near me" without a location in San Miguel
    if (q.local && offset === 0 && k) both(TX.en.localClaim);
    if (!k) {
      if (offset > 0) { out.show = 'That was all of them.'; said('That was all of them'); line(out.show); return out; }
      if (ranked.miss && !ranked.pool.length) { out.show = out.lines.map((l) => l.text).join(' '); return out; }  // "I couldn't find Indian food" says it all
      const among = q.collection ? ` among ${CT.en.picks}` : '';
      if (d.kind && !q.collection) {  // "None of the places that are good with children is open for breakfast tomorrow."
        const none = d.when ? `None of the ${d.kind[0]}${d.where} is${d.when}` : `I found no ${d.kind[0]}${d.where}`;
        out.show = (d.when ? `None of the ${d.kind[0]}${d.where} is${d.whenShow}` : none) + '.'; said(none);
      } else {
        out.show = `Nothing${d.where}${among}${d.whenShow ? ' is' + d.whenShow : ' matches'}.`;
        said(`I found nothing${d.where}${among}${d.when ? ' that is' + d.when : ''}`);
      }
      line(out.show);
      if (notes.length) out.show = notes.join(' ') + ' ' + out.show;
      // when the time rules everything out: the first of them to open
      if (d.when) {
        const firsts = ranked.pool.map((p) => ({ p, a: avail(p.id, n) })).filter((r) => r.a && r.a.at != null).sort((x, y) => x.a.at - y.a.at);
        if (firsts.length) { const f = firsts[0], w = nextOpenWords(f.a, n); out.ids = [f.p.id]; said(`The first to open is ${sayName(f.p.name)}, ${w.say}`, f.p.id); out.show += ` The first to open is ${f.p.name}, ${w.show}.`; line(`The first to open is ${f.p.name}, ${w.show}.`); }
      }
      return out;
    }
    // "four places in Centro", "three of Susan York's recent picks", "two of our favourite places for Peruvian food"
    const allRecent = page.every((r) => !picks[r.p.id] || n.date - pickDate(r.p.id) <= C.recentDays * 864e5);
    const [pl, sg] = d.kind || ['places', 'place'], thing = k === 1 ? sg : pl;
    // our picks and the extra places (not our picks) on this page: each extra place is said so, or the whole page when it has only those
    const ours = page.filter((r) => !r.p.other).length, theirs = k - ours, NP = [', not one of our picks', 'not our pick · '];
    out.mixed = !!(ours && theirs);
    const fav = q.best && !q.collection && !theirs;  // every place here is a favourite: "the best Italian" gets "our favourite places for Italian food"
    const subject = (num) => (q.collection ? `${num} of ${allRecent ? CT.en.recentPicks : CT.en.picks}` : fav ? `${num} of our favourite ${pl}` : `${num} ${thing}`) + d.where;
    const that = d.when ? ` that ${k === 1 ? 'is' : 'are'}${d.when}` : '';
    const order = q.priciest && k > 1 ? ', the most expensive first' : '';
    if (offset > 0) said(`${cap(sayNum(k))} more ${q.collection ? `of ${CT.en.picks}${d.where}` : `${thing}${d.where}`}${that}`);
    else if (k < asked) said(`I found only ${subject(sayNum(k))}${that}${order}`);
    else if (q.surprise) said(`Here's a surprise: ${subject(sayNum(k))}${that}`);
    else said(`Here ${k === 1 ? 'is' : 'are'} ${subject(sayNum(k))}${that}${order}`);
    if (!ours && theirs) said(theirs === 1 ? "It's not one of our picks" : "They're not our picks");
    const num = offset > 0 ? `${k} more` : k < asked ? `Only ${k}` : String(k);
    const what = fav && offset === 0 && !(k < asked) ? `${num} of our favourite ${pl}` : `${num} ${thing}`;
    out.show = cap(`${q.collection ? `${num} of ${allRecent ? CT.en.recentPicks : CT.en.picks}${d.where}${d.whenShow ? ',' : ''}` : `${what}${d.where}`}${d.whenShow}${offset === 0 ? order : ''}.`);
    if (!ours && theirs) out.show += theirs === 1 ? ' Not one of our picks.' : ' Not our picks.';
    line(out.show);
    if (notes.length) out.show = notes.join(' ') + ' ' + out.show;
    const off = dayOff(q, n);
    for (const r of page) {
      const nm = sayName(r.p.name), a = r.a, meal = q.meal && mealSpan(r.p.id, q.meal, n, off);
      const far = r.m != null ? { say: `, ${sayDist(r.m)}`, show: `${showDist(r.m)} · ` } : { say: '', show: '' };  // near me: how far
      const l = lab(r), mk = ours && r.p.other, ls = (l ? `, ${l}` : '') + (mk ? NP[0] : ''), lw = (l ? `${l} · ` : '') + (mk ? NP[1] : '');
      const dh = !q.meal && off != null ? dayHours(r.p.id, n, off) : null;  // "open on Sunday": that day's hours
      if (meal) { said(`${nm}${ls}${far.say}, ${meal.day} from ${sayTime(meal.s)} to ${sayTime(meal.e)}`, r.p.id); line(`${lw}${far.show}${meal.day} ${clock(meal.s)}–${until(meal.e)}`, r.p.id); }
      else if (dh && dh.length) { const dw = dayWords(off, n); said(`${nm}${ls}${far.say}, ${dw} from ${dh.map(([x, y]) => `${sayTime(x)} to ${sayTime(y)}`).join(', and from ')}`, r.p.id); line(`${lw}${far.show}${dw} ${dh.map(([x, y]) => `${clock(x)}–${until(y)}`).join(', ')}`, r.p.id); }
      else if (openNow(a)) { said(`${nm}${ls}${far.say}, open until ${sayTime(a.until)}`, r.p.id); line(`${lw}${far.show}open until ${until(a.until)}`, r.p.id); }
      else if (a && a.at != null) { const w = nextOpenWords(a, n); said(`${nm}${ls}${far.say}, opening ${w.say.replace(/^today /, '')}`, r.p.id); line(`${lw}${far.show}opens ${w.show.replace(/^today /, '')}`, r.p.id); }
      else { said(`${nm}${ls}${far.say}`, r.p.id); line(`${lw}${far.show}${a ? 'closed' : 'hours not published'}`, r.p.id); }
    }
    return out;
  }

  // ---------- the answers in Spanish: the same logic as one() and listAnswer(), its own sentences (the English ones stay as they are) ----------
  const ao = (p) => (/^(la|las)\s/i.test(p.name) ? 'a' : 'o');  // abierta / abierto: La Azotea, but El Rinconcito, Bocaciega
  const nmEs = (p) => p.name.replace(/&/g, 'y');                // the phone's Spanish voice reads the name as written, accents and all
  const monthEs = (id) => pickDate(id).toLocaleDateString(LOCALE.es, { month: 'long', year: 'numeric' });
  const wroteEs = (id) => CT.es.wrote.replace('{month}', monthEs(id));
  function nextOpenEs(a, n) {  // "hoy a la 1 de la tarde", "mañana al mediodía", "el jueves a las 8 de la mañana"
    const k = Math.floor(a.at / 1440), when = k <= 0 ? 'hoy' : k === 1 ? 'mañana' : `el ${DIAS[(n.d + k) % 7]}`;
    return { say: `${when} ${aTimeEs(a.at)}`, show: `${when} a ${showTimeEs(a.at)}` };
  }
  function oneEs(p, n, q = {}, here = null) {
    const nm = nmEs(p), o = ao(p);
    const out = { kind: 'one', id: p.id, ids: [p.id], say: [], show: '' };
    const said = (text) => out.say.push({ text: stop(text), id: p.id });
    const done = () => {
      if (p.other) { out.show += ' No es de nuestra lista.'; said('No es de nuestra lista'); }
      out.lines = [{ text: out.show, id: p.id }]; if (picks[p.id] && !isSight(p)) out.lines.push({ text: `${wroteEs(p.id)}.`, id: p.id }); return out;
    };
    const susan = () => { if (picks[p.id]) said(`${wroteEs(p.id)}`); };
    if (isSight(p)) { out.show = `${p.name} es un lugar para visitar, no para comer.`; said(`${nm} es un lugar para visitar, no para comer. Aquí está`); return done(); }
    const off = dayOff(q, n);
    if (off) {  // "¿Está abierto Bocaciega mañana?", "… el domingo?"
      const day = (n.d + off) % 7, h = HOURS[p.id], t = h ? h[String(day)] : undefined, tmr = off === 1;
      if (t === undefined) {
        out.show = tmr ? `El horario de mañana de ${p.name} no está publicado en internet. Consulta Google Maps.` : `El horario de ${p.name} para el ${DIAS[day]} no está publicado en internet. Consulta Google Maps.`;
        said(tmr ? `No tengo el horario de mañana de ${nm}. Consulta Google Maps` : `No tengo el horario de ${nm} para el ${DIAS[day]}. Consulta Google Maps`);
      } else if (t === null) { out.show = `${p.name} está cerrad${o} ${tmr ? `mañana (${DIAS[day]})` : `el ${DIAS[day]}`}.`; said(`${nm} está cerrad${o} ${tmr ? 'mañana' : `el ${DIAS[day]}`}`); }
      else {
        const rs = ranges(t);
        out.show = `${tmr ? `Mañana (${DIAS[day]})` : `El ${DIAS[day]}`} ${p.name} abre ${rs.map(([a, b]) => `de ${clock(a)} a ${untilEs(b)}`).join(' y ')}.`;
        said(`Sí. ${tmr ? 'Mañana' : `El ${DIAS[day]}`} ${nm} abre ${rs.map(([a, b]) => rangeEs(a, b)).join(', y ')}`);
      }
      susan(); return done();
    }
    const a = avail(p.id, n);
    if (q.howFar || q.near) {  // "¿Qué tan lejos está La Azotea?": la distancia primero
      const og = origin(here), m = metres(og.o, p), km = m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
      if (og.mine) { out.show = `${p.name} está a ${km} de ti, ${walkMin(m) === 1 ? '1 min' : `unos ${walkMin(m)} min`} a pie.`; said(`${nm} está ${sayDistEs(m)} de ti, ${walkEs(m)} a pie`); }
      else if (og.far) { out.show = `No parece que estés en ${TX.es.city} ahora. Desde ${TX.es.centre}, ${p.name} está a ${km}.`; said(`No parece que estés en ${TX.es.city} ahora. Desde ${TX.es.centre}, ${nm} está ${sayDistEs(m)}`); }
      else { out.show = `No sé dónde estás, así que no puedo decir qué tan lejos está ${p.name}.`; said(`No sé dónde estás, así que no puedo decir qué tan lejos está ${nm}`); }
      if (!a) { out.show += ' Su horario no está publicado en internet.'; said('Su horario no está publicado en internet'); }
      else if (openNow(a)) { out.show += ` Está abiert${o} ahora, hasta ${showTimeEs(a.until)}.`; said(`Está abiert${o} ahora, hasta ${sayTimeEs(a.until)}`); }
      else if (a.open) { out.show += ` Cierra pronto, a ${showTimeEs(a.until)}.`; said(`Cierra pronto, ${aTimeEs(a.until)}`); }
      else if (a.at != null) { const w = nextOpenEs(a, n); out.show += ` Ahora está cerrad${o}; abre ${w.show}.`; said(`Ahora está cerrad${o}. Abre ${w.say}`); }
      susan(); return done();
    }
    if (!a) { out.show = `El horario de ${p.name} no está publicado en internet. Consulta Google Maps.`; said(`No tengo el horario de ${nm}. Consulta Google Maps`); }
    else if (openNow(a)) { out.show = `Sí, ${p.name} está abiert${o} ahora, hasta ${showTimeEs(a.until)}.`; said(`Sí. ${nm} está abiert${o} ahora, hasta ${sayTimeEs(a.until)}`); }
    else if (a.open) { out.show = `${p.name} está abiert${o}, pero cierra pronto, a ${showTimeEs(a.until)}.`; said(`${nm} está abiert${o}, pero cierra pronto, ${aTimeEs(a.until)}`); }
    else if (a.at != null) {
      const w = nextOpenEs(a, n), why = a.closedToday ? 'hoy' : 'ahora';
      out.show = `No, ${p.name} está cerrad${o} ${why}. Abre ${w.show}.`;
      said(`No. ${nm} está cerrad${o} ${why}. Abre ${w.say}`);
    } else { out.show = `No, ${p.name} está cerrad${o} y no se sabe cuándo abre.`; said(`No. ${nm} está cerrad${o} y no sé cuándo abre`); }
    if (q.price) priceSay(p, (t) => { out.show += ' ' + t + '.'; said(t); }, true);
    susan(); return done();
  }
  const KIND_ES = { bfast: ['cafés', 'café', 'm'], mex: ['lugares de comida mexicana', 'lugar de comida mexicana', 'm'], world: ['lugares de cocina del mundo', 'lugar de cocina del mundo', 'm'],
    street: ['puestos de comida callejera', 'puesto de comida callejera', 'm'], share: ['bares', 'bar', 'm'], roof: ['terrazas', 'terraza', 'f'], wine: ['viñedos', 'viñedo', 'm'] };
  const ins = (s, w) => (w ? s.replace(/^(\S+)/, `$1${w}`) : s);  // a word after the noun: "lugares baratos para comida mexicana"
  // [plural, singular, gender]: "lugares baratos para comida mexicana", "terrazas con vista", "lugares para ver el atardecer"
  function kindPhraseEs(q, ts0) {
    const ts = phraseTopics(q, ts0), cat = catOf(ts), foods = ts.filter((t) => t.kind === 'food'), feats = ts.filter((t) => t.kind === 'feat');
    const price = phrasePrice(q, ts);
    if (!cat && !foods.length && feats.length === 1 && !price && !q.local && !q.unique) return [feats[0].es, feats[0].es.replace(/^lugares\b/, 'lugar').replace(' que aceptan ', ' que acepta '), 'm'];
    let [pl, sg, g] = cat ? cat.nounEs : ['lugares', 'lugar', 'm'];
    if (q.local) [pl, sg, g] = ['lugares sencillos y locales', 'lugar sencillo y local', 'm'];
    if (q.unique) [pl, sg, g] = ['lugares diferentes', 'lugar diferente', 'm'];
    const adj = (one) => (price === 'low' ? (g === 'f' ? (one ? ' barata' : ' baratas') : one ? ' barato' : ' baratos') : price === 'high' ? (one ? ' elegante' : ' elegantes') : price === 'mid' ? ' de precio moderado' : '');
    const trad = foods.find((t) => t.k === 'tradmex'), other = foods.filter((t) => t.k !== 'tradmex');
    const food = foods.length ? ` para ${trad && other.length ? other[0].es + (/s$/.test(other[0].es) ? ' tradicionales' : ' tradicional') : (other[0] || trad).es}` : '';
    const withs = feats.map((t) => t.withEs).join(' y');
    return [ins(pl, adj(false)) + food + withs, ins(sg, adj(true)) + food + withs, g];
  }
  function describeEs(q, n, og, ranked = {}) {  // " en el Centro", " cerca de ti"; the kind of place and its gender; " abiertos ahora o en las próximas dos horas"
    const near = og ? (og.sight ? ` cerca de ${sightName(og.sight, 'es')}`.replace(' de el ', ' del ') : og.mine ? ' cerca de ti' : ` cerca de ${TX.es.centre}`.replace(' de el ', ' del ')) : '';
    const where = (q.centro && !(og && og.sight === pack.centre.place) ? TX.es.inCentre : q.area && q.area === compiled(pack).outOfTown ? areaOf(q.area).in.es : q.area && !(og && og.sight) ? areaOf(q.area).in.es : '') + near;
    const ts = shownTopics(q, ranked);
    let kind = ts.length || q.price || q.local || q.unique ? kindPhraseEs({ ...q, priceMiss: ranked.priceMiss }, ts) : q.cats && q.cats.length === 1 ? KIND_ES[q.cats[0]] || null : null;
    if ((q.unclear || ranked.recommend) && (!kind || kind[0] === 'lugares')) kind = ['lugares que recomendamos', 'lugar que recomendamos', 'm'];
    const off = dayOff(q, n);
    const when = (g, one, digits) => {  // the adjective agrees with the noun: lugares abiertos, terrazas abiertas, un lugar abierto
      const adj = one ? (g === 'f' ? 'abierta' : 'abierto') : g === 'f' ? 'abiertas' : 'abiertos';
      if (q.lateMeal) return q.lateMeal === 'tonight' ? ` ${adj} ahora` : ` ${adj} ahora para ${{ bfast: 'un desayuno tardío', brunch: 'un brunch tardío', lunch: 'una comida tardía', dinner: 'una cena tardía' }[q.lateMeal]}`;
      if (q.meal) { const dd = mealDay(q.meal, n, off); return q.meal === 'late' ? ` ${adj} tarde en la noche${off != null ? ' ' + dayWordsEs(dd, n) : ''}` : ` ${adj} para ${{ bfast: 'desayunar', brunch: 'el brunch', lunch: 'comer', dinner: 'cenar' }[q.meal]} ${dayWordsEs(dd, n)}`; }
      if (off != null) return ` ${adj} ${dayWordsEs(off, n)}`;
      if (q.window == null) return '';
      const h = q.window % 60 === 0 ? q.window / 60 : null;
      const span = q.window === SOON ? (digits ? 'las próximas 2 horas' : 'las próximas dos horas') : h === 1 ? 'la próxima hora' : h ? `las próximas ${digits ? h : sayNumEs(h, true)} horas` : `los próximos ${q.window} minutos`;
      return q.now ? ` ${adj} ahora o en ${span}` : ` ${adj} en ${span}`;
    };
    return { where, kind, when, ts };
  }
  function listAnswerEs(q, n, ranked, offset, count) {
    const page = ranked.rows.slice(offset, offset + count), total = ranked.rows.length;
    const og = ranked.origin || null, elsewhere = { ...q, centro: false, area: null, unique: false, local: false, collection: null };
    const d = describeEs(ranked.whereMiss ? elsewhere : q, n, ranked.whereMiss ? null : og, ranked), k = page.length, asked = q.count || 0;
    const out = { kind: 'list', q, ids: page.map((r) => r.p.id), all: ranked.rows.map((r) => r.p.id), offset, count, left: Math.max(0, total - offset - k), say: [], lines: [], show: '', collection: q.collection,
      here: ranked.here || null, dist: og ? Object.fromEntries(page.map((r) => [r.p.id, r.m])) : null, mine: !!(og && og.mine) };
    const said = (text, id) => out.say.push({ text: stop(text.replace(/\s+/g, ' ').trim()), id });
    const line = (text, id) => out.lines.push({ text, id });
    const both = (text) => { said(text); line(text + '.'); };
    const notes = [], note = (text) => { both(text); notes.push(text + '.'); };
    const [pl, sg, g0] = d.kind || ['lugares', 'lugar', 'm'];
    const labels = !kindAsked(d.ts), lab = (r) => (labels ? (q.unique && F(r.p).u_es) || F(r.p).w_es || '' : '');
    if (offset === 0 && ranked.miss) note(`No encontré ${ranked.miss.topic.es || ranked.miss.topic.nounEs[0]} en la lista de este sitio`);
    if (offset === 0 && ranked.priceMiss) note(`No conozco ningun${g0 === 'f' ? 'a' : 'o'} ${{ low: g0 === 'f' ? 'barata' : 'barato', high: 'elegante', mid: 'de precio moderado' }[q.price]}, así que aquí están todos`);
    if (offset === 0 && ranked.whereMiss) { const d0 = describeEs(q, n, og, {}); note(`No encontré ${(d0.kind || ['lugares'])[0]}${d0.where}`); }
    if (offset === 0 && q.unclear) note('No estoy seguro de qué buscas');
    if (og && !og.mine && !og.sight && offset === 0) both(og.far ? `No parece que estés en ${TX.es.city} ahora, así que medí desde ${TX.es.centre}` : `No sé dónde estás, así que medí desde ${TX.es.centre}`);
    if (q.local && offset === 0 && k) both(TX.es.localClaim);
    if (!k) {
      if (offset > 0) { out.show = 'Esos son todos.'; said('Esos son todos'); line(out.show); return out; }
      if (ranked.miss && !ranked.pool.length) { out.show = out.lines.map((l) => l.text).join(' '); return out; }
      const among = q.collection ? ` entre ${CT.es.picks}` : '';
      if (d.kind && !q.collection) {  // "Ninguno de los lugares para ir con niños está abierto para desayunar mañana."
        const [pl0, , g1] = d.kind, de = g1 === 'f' ? 'Ninguna de las' : 'Ninguno de los', w1 = d.when(g1, true, false), w2 = d.when(g1, true, true);
        out.show = w1 ? `${de} ${pl0}${d.where} está${w2}.` : `No encontré ${pl0}${d.where}.`; said(w1 ? `${de} ${pl0}${d.where} está${w1}` : `No encontré ${pl0}${d.where}`);
      } else {
        out.show = `No hay nada${d.where}${among}${d.when('m', true, true)}.`;
        said(`No encontré nada${d.where}${among}${d.when('m', true, false)}`);
      }
      line(out.show);
      if (notes.length) out.show = notes.join(' ') + ' ' + out.show;
      if (q.window != null || q.meal || dayOff(q, n) != null) {  // the time rules everything out: the first of them to open
        const firsts = ranked.pool.map((p) => ({ p, a: avail(p.id, n) })).filter((r) => r.a && r.a.at != null).sort((x, y) => x.a.at - y.a.at);
        if (firsts.length) { const f = firsts[0], w = nextOpenEs(f.a, n); out.ids = [f.p.id]; said(`El primero en abrir es ${nmEs(f.p)}, ${w.say}`, f.p.id); out.show += ` El primero en abrir es ${f.p.name}, ${w.show}.`; line(`El primero en abrir es ${f.p.name}, ${w.show}.`); }
      }
      return out;
    }
    const allRecent = page.every((r) => !picks[r.p.id] || n.date - pickDate(r.p.id) <= C.recentDays * 864e5);
    const one1 = k === 1, thing = one1 ? sg : pl, g = q.collection ? (CT.es.gender || 'f') : g0;
    const ours = page.filter((r) => !r.p.other).length, theirs = k - ours, NP = [', no es de nuestra lista', 'no es de nuestra lista · '];
    out.mixed = !!(ours && theirs);
    const fav = q.best && !q.collection && !q.price && !theirs;  // "los mejores": "dos de nuestros lugares favoritos para comida peruana"
    const wh = d.when(g, one1, false), whShow = d.when(g, one1, true), n1 = fav && one1 ? (g === 'f' ? 'una' : 'uno') : sayNumEs(k, g === 'f');
    const favOf = (num) => `${num} de ${g === 'f' ? 'nuestras' : 'nuestros'} ${ins(pl, g === 'f' ? ' favoritas' : ' favoritos')}`;
    const susanOf = (num) => `${num} de ${allRecent ? CT.es.recentPicks : CT.es.picks}`;
    const subj = (num) => (q.collection ? susanOf(num) : fav ? favOf(num) : `${num} ${thing}`) + d.where;
    const order = q.priciest && k > 1 ? (g === 'f' ? ', las más caras primero' : ', los más caros primero') : '';
    if (offset > 0) said(`${capEs(sayNumEs(k, g === 'f'))} ${q.collection ? CT.es.more : `${thing} más`}${d.where}${wh}`);
    else if (k < asked) said(`Encontré solo ${subj(n1)}${wh}${order}`);
    else if (q.surprise) said(`Una sorpresa: ${subj(n1)}${wh}`);
    else said(`Aquí tienes ${subj(n1)}${wh}${order}`);
    if (!ours && theirs) said(theirs === 1 ? 'No es de nuestra lista' : 'No son de nuestra lista');
    const num = offset > 0 ? `${k} ${q.collection ? CT.es.more : `${thing} más`}` : k < asked ? `Solo ${k}` : String(k);
    const what = fav && offset === 0 && !(k < asked) ? favOf(num) : `${num} ${thing}`;
    out.show = capEs(offset > 0 ? `${num}${d.where}${whShow}.` : q.collection ? `${susanOf(num)}${d.where}${whShow ? ',' : ''}${whShow}.` : `${what}${d.where}${whShow}${order}.`);
    if (!ours && theirs) out.show += theirs === 1 ? ' No es de nuestra lista.' : ' No son de nuestra lista.';
    line(out.show);
    if (notes.length) out.show = notes.join(' ') + ' ' + out.show;
    const off = dayOff(q, n);
    for (const r of page) {
      const nm = nmEs(r.p), a = r.a, o = ao(r.p), meal = q.meal && mealSpan(r.p.id, q.meal, n, off);
      const far = r.m != null ? { say: `, ${sayDistEs(r.m)}`, show: `${showDistEs(r.m)} · ` } : { say: '', show: '' };
      const l = lab(r), mk = ours && r.p.other, ls = (l ? `, ${l}` : '') + (mk ? NP[0] : ''), lw = (l ? `${l} · ` : '') + (mk ? NP[1] : '');
      const dh = !q.meal && off != null ? dayHours(r.p.id, n, off) : null;
      if (meal) { const day = dayWordsEs(meal.off, n); said(`${nm}${ls}${far.say}, ${day} ${rangeEs(meal.s, meal.e)}`, r.p.id); line(`${lw}${far.show}${day} ${clock(meal.s)}–${untilEs(meal.e)}`, r.p.id); }
      else if (dh && dh.length) { const day = dayWordsEs(off, n); said(`${nm}${ls}${far.say}, ${day} ${dh.map(([x, y]) => rangeEs(x, y)).join(', y ')}`, r.p.id); line(`${lw}${far.show}${day} ${dh.map(([x, y]) => `${clock(x)}–${untilEs(y)}`).join(', ')}`, r.p.id); }
      else if (openNow(a)) { said(`${nm}${ls}${far.say}, abiert${o} hasta ${sayTimeEs(a.until)}`, r.p.id); line(`${lw}${far.show}abiert${o} hasta ${showTimeEs(a.until)}`, r.p.id); }
      else if (a && a.at != null) { const w = nextOpenEs(a, n); said(`${nm}${ls}${far.say}, abre ${w.say.replace(/^hoy /, '')}`, r.p.id); line(`${lw}${far.show}abre ${w.show.replace(/^hoy /, '')}`, r.p.id); }
      else { said(`${nm}${ls}${far.say}`, r.p.id); line(`${lw}${far.show}${a ? `cerrad${o}` : 'horario no publicado'}`, r.p.id); }
    }
    return out;
  }

  // The answer to a question: {kind: 'list'|'one'|'none', ids, say: [{text, id?}], show}. `last` is the previous list, for "4 more".
  // Reading (read.js) turns the words into a request; answerRequest() answers a request, whoever wrote it (Lars, 18 Nov 2026: "Do 1-3
  // proposal", 2: reading the question apart from finding the answer).
  const reader = createReader({ places, MEALS, pack });
  // Live music (B8): only a city whose pack has music nights answers music questions from them; any other city answers as before.
  const MUSIC = Object.keys(pack.music || {}).length > 0;
  function answer(text, n, last = null, here = null) {
    const q = reader.read(text, n);
    if (MUSIC) {
      const m = answerMusic(text, pack, n, es ? 'es' : 'en', { named: q.named?.id });
      if (m) return { ...m, q, show: m.say[0].text, lines: m.say };
    }
    return answerRequest(q, n, last, here);
  }
  function answerRequest(q, n, last = null, here = null) {
    if (q.more && last && last.kind === 'list') {
      const ranked = { ...list(last.q, n, last.here), here: last.here }, count = q.count || last.count || 4, offset = last.offset + last.ids.length;
      return (es ? listAnswerEs : listAnswer)(last.q, n, ranked, offset, count);
    }
    const named = q.named ? byId[q.named.id] : null;
    if (named && !q.wantsList) return { ...(es ? oneEs : one)(named, n, q, here), q };
    // "Is … open?" about one place whose name was not caught: say so, and offer the closest names, rather than a list of other places
    const onePlace = (/^(is|are|when|what time|does|do|how late|until when|till when|tell me about|how about|what about|esta|estan|a que hora|cuando|abre|cierra|hasta que hora|que tal|donde esta|como llego)\b/.test(q.s) || q.howFar) && !q.wantsList && !q.near && !q.centro && !q.area && !q.cats && !q.asks && !q.nearSight;
    if (onePlace) {
      const near = (q.nearNames || []).map((id) => byId[id]).filter((p) => p && shown(p));
      const names = near.map((p) => (es ? nmEs(p) : sayName(p.name)));
      const joined = names.length > 1 ? names.slice(0, -1).join(', ') + (es ? ' o ' : ', or ') + names[names.length - 1] : names[0];
      const say = es ? (names.length ? `No entendí el nombre del lugar. ¿Quisiste decir ${joined}?` : 'No entendí el nombre del lugar. Dilo otra vez o escríbelo.')
        : names.length ? `I didn't catch the name of the place. Did you mean ${joined}?` : "I didn't catch the name of the place. Please say it again, or type it.";
      const show = es ? (names.length ? 'No entendí el nombre del lugar. ¿Quisiste decir:' : 'No entendí el nombre del lugar. Dilo otra vez o escríbelo.')
        : names.length ? "I didn't catch the place's name. Did you mean:" : "I didn't catch the place's name. Please say it again, or type it.";
      return { kind: 'none', q, ids: [], near: near.map((p) => p.id), say: [{ text: say }], show, lines: [{ text: show }] };
    }
    if (q.wantsList || q.asks || q.near || q.nearSight || q.centro || q.area || q.cats || q.window != null || q.dayIdx != null) {
      const count = q.count || (q.collection ? C.count || 4 : 4);
      return (es ? listAnswerEs : listAnswer)(q, n, { ...list(q, n, here), here }, 0, count);
    }
    // a word search, as the search box on /page2 does
    const words = q.rest.split(' ').filter((w) => w.length >= 4 && !/^(what|where|when|which|about|there|place|please|tell|show|find|good|best|some|with|from|that|this|have|open|donde|cuando|lugar|lugares|esta|estan|abierto|abierta|para|comer|beber|quiero|busco|tienen|tiene|algun|alguna|buen|buena|mejor|mejores|cerca|hora|horas|ahora|aqui|algo|como|cual|cuales|sitio|sitios)$/.test(w));
    const found = words.length ? places.filter((p) => shown(p) && words.some((w) => fold([p.name, p.area, p.desc, (CATS[p.cat] || {}).label, (INFO[p.id] || {}).address].join(' ')).includes(w))) : [];
    if (found.length) {
      const rows = found.map((p) => ({ p, a: avail(p.id, n) }));
      return (es ? listAnswerEs : listAnswer)({ ...q, window: null }, n, { rows: [...rows.filter((r) => openNow(r.a)), ...rows.filter((r) => !openNow(r.a))], pool: found }, 0, 4);
    }
    // not understood: four places we recommend that are open now (any time, when none is), not "Sorry" (Lars, 18 Nov 2026)
    let uq = { ...q, unclear: true, picksOnly: true, window: SOON, now: true, best: false, topics: [], cats: null }, ur = list(uq, n, here);
    if (!ur.rows.length) { uq = { ...uq, window: null, now: false }; ur = list(uq, n, here); }
    return (es ? listAnswerEs : listAnswer)(uq, n, { ...ur, here }, 0, q.count || 4);
  }

  return { answer, answerRequest, read: reader.read, parse: (text) => parse(text, pack), matchPlace: reader.matchPlace, avail, openNow, inCentro, dist, picks, spans };
}
