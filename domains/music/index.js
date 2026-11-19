// Live music (plan step B8, decision D5): which venues have music, which genres, on which nights, from the city pack's music
// table (live.json's music: {placeId: {genres, slots: [{days: [0–6, Monday = 0], from: "20:00", to?: "23:00", genres?}], checked}};
// a night with no end time (listings often give only the start) is said as "from 8 p.m." and counted as two hours long;
// a night's own genres, when given, replace the venue's: mariachi on Sundays, trova on Wednesdays).
// Music nights change more often than places do, so they travel with the hours in the small live file, not in base.json.
// An added layer: it answers only questions about music and only from music data, so a city without music data (or a site that
// does not use it) answers exactly as before. Words in English and Spanish; answers in the page's language.
import { fold } from "../../core/text/sound.js";
import { sayTime, DAYNAMES } from "../../lang/en/index.js";
import { sayTimeEs, aTimeEs, DIAS } from "../../lang/es/index.js";

// Genres, with the words a question uses for each.
export const GENRES = {
  jazz: ["jazz"], blues: ["blues"], rock: ["rock", "rockero", "rocanrol"], trova: ["trova", "trovador", "trovadores", "bolero", "boleros", "bohemio", "bohemia", "noche bohemia"],
  mariachi: ["mariachi", "mariachis"], son: ["son jarocho", "jarocho", "son huasteco"], salsa: ["bailar salsa", "dance salsa", "salsa music", "salsa dancing", "salsa dance", "salsa night", "salsa nights", "salsa en vivo", "musica salsa", "salsa band", "noche de salsa", "salsero", "salseros"],
  cumbia: ["cumbia", "cumbias"], flamenco: ["flamenco"], latin: ["latin music", "latin jazz", "musica latina", "bossa nova", "bossa", "bachata", "merengue"],
  dj: ["dj", "deejay", "electronica", "electronic", "house music", "techno"], acoustic: ["acoustic", "acustico", "acustica", "guitar", "guitars", "guitarra", "guitarras", "guitarrista"],
  karaoke: ["karaoke"], openmic: ["open mic", "micro abierto"], classical: ["classical", "clasica", "musica clasica", "opera", "orquesta", "chamber music", "string quartet", "cuarteto de cuerdas"],
  folk: ["folk", "folklore", "folclor", "folclorica", "folklorica"], piano: ["piano", "piano bar", "pianista"],
};
const GENRE_ES = { jazz: "jazz", blues: "blues", rock: "rock", trova: "trova", mariachi: "mariachi", son: "son jarocho", salsa: "salsa",
  cumbia: "cumbia", flamenco: "flamenco", latin: "música latina", dj: "DJ", acoustic: "música acústica", karaoke: "karaoke", openmic: "micrófono abierto",
  classical: "música clásica", folk: "música folclórica", piano: "piano" };
const GENRE_EN = { ...Object.fromEntries(Object.keys(GENRES).map((g) => [g, g])), son: "son jarocho", latin: "Latin music", dj: "a DJ", acoustic: "acoustic music", openmic: "open mic", classical: "classical music", folk: "folk music" };
const MUSIC_WORDS = /\b(live music|music|band|bands|concert|concerts|gig|gigs|musicians?|playing|plays|who is playing|whos playing|dance|dancing|musica|en vivo|banda|bandas|concierto|conciertos|toca|tocan|tocando|bailar|baile|quien toca)\b/;
const NOT_MUSIC = /\b(sin musica|without music|no music|sin que .*musica|musica fuerte|loud music|blast the music|so loud|griten|quiet|tranquilo|tranquila|tranquilito)\b/;
// "salsa" alone is a sauce in Mexico; the genre needs "bailar salsa", "salsa night"…; "latin" alone is a cuisine word
const DAY_WORDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

/** What a question asks about music: {genres, live, when: {day | tonight | now}} or null when it is not about music. */
export function readMusic(text) {
  const s = " " + fold(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ") + " ";
  const genres = Object.entries(GENRES).filter(([, ws]) => ws.some((w) => s.includes(" " + w + " "))).map(([g]) => g);
  if (!genres.length && !MUSIC_WORDS.test(s)) return null;
  if (!genres.length && NOT_MUSIC.test(s)) return null;  // "somewhere quiet, without loud music" asks for a place, not a band
  const d = DAY_WORDS.findIndex((w) => new RegExp(`\\b${w}s?\\b`).test(s));
  const when = d >= 0 ? { day: d % 7 } : / (tonight|this evening|esta noche|hoy en la noche|hoy por la noche|hoy) /.test(s) ? { tonight: true }
    : / (now|right now|ahora|ahorita) /.test(s) ? { now: true } : / (tomorrow|manana) /.test(s) && !/ (la|esta) manana /.test(s) ? { tomorrow: true } : { tonight: true };
  return { genres, when };
}

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const endOf = (slot) => { const f = toMin(slot.from); if (!slot.to) return f + 120; const t = toMin(slot.to); return t <= f ? t + 1440 : t; };
const spanEn = (from, to) => (to == null ? `from ${sayTime(from)}` : `from ${sayTime(from)} to ${sayTime(to)}`);
const spanEs = (from, to) => (to == null ? `desde ${sayTimeEs(from)}` : `de ${sayTimeEs(from)} ${aTimeEs(to)}`);

/**
 * Music answer from the pack: {kind: "music", ids, say: [{text, id?}]}, or null when the places answer should answer instead:
 * the pack has no music nights, nobody on the list plays the genre asked for (mariachis gather in a square, not a venue), or
 * the place named is not a music venue. now: {d (Monday = 0), m (minutes), date} in the city's time (ask.js nowAt).
 */
export function answerMusic(text, pack, now, lang = "en", { staleDays = 60, named = null } = {}) {
  const q = readMusic(text);
  if (!q) return null;
  const es = lang === "es";
  const byId = Object.fromEntries((pack.places || []).map((p) => [p.id, p]));
  const venues = Object.entries(pack.music || {}).filter(([id, m]) => byId[id] && (m.slots || []).length).map(([id, m]) => ({ ...byId[id], music: m }));
  if (!venues.length) return null;
  if (named) return namedVenue(byId[named], pack.music?.[named], q, lang);
  const genresOf = (p, slot) => slot.genres || p.music.genres;
  const plays = (p, slot) => !q.genres.length || q.genres.some((g) => genresOf(p, slot).includes(g));
  const players = venues.filter((p) => p.music.slots.some((s) => plays(p, s)));
  if (!players.length) {
    // nobody's listed nights play it; a venue that lists the genre among its own (without saying which night) is still named, so
    // the question is not answered with places that have nothing to do with it. Nobody at all: the places answer answers.
    const some = venues.filter((p) => q.genres.some((g) => p.music.genres.includes(g)));
    if (!some.length) return null;
    const asked = q.genres.map((g) => (es ? GENRE_ES[g] : GENRE_EN[g])).join(es ? " o " : " or ");
    const names = listWords(some.slice(0, 3).map((p) => p.name), es);
    const say = [{ text: es ? `No tengo noches de ${asked} en la lista.` : `I don't have ${asked} nights on the list.` },
      { text: es ? `${names} ${some.length > 1 ? "tienen" : "tiene"} ${asked} algunas noches; no sé cuáles.` : `${names} ${some.length > 1 ? "have" : "has"} ${asked} on some nights; I don't know which.` }];
    return { kind: "music", request: q, ids: some.slice(0, 3).map((p) => p.id), say: withAge(say, some, now, es, staleDays) };
  }
  const day = q.when.day ?? (q.when.tomorrow ? (now.d + 1) % 7 : now.d);
  // tonight's nights, and, in the small hours, last night's that are still playing (a DJ from 22:00 to 1:00 at 0:30)
  const nights = [[day, 0]];
  if ((q.when.now || q.when.tonight) && day === now.d && now.m < 360) nights.push([(day + 6) % 7, -1440]);
  const rows = [];
  for (const p of players) {
    for (const slot of p.music.slots) {
      if (!plays(p, slot)) continue;
      for (const [d, shift] of nights) {
        if (!slot.days.includes(d)) continue;
        const from = toMin(slot.from) + shift, to = endOf(slot) + shift;
        if (shift && to <= now.m) continue;
        if (q.when.now && day === now.d && !(now.m >= from - 120 && now.m < to)) continue;  // playing now, or starting within two hours
        if (q.when.tonight && day === now.d && to <= now.m) continue;                         // already over tonight
        rows.push({ p, from, to: slot.to ? to : null, genres: genresOf(p, slot) });
      }
    }
  }
  rows.sort((a, b) => a.from - b.from);
  // one line a venue, its nights in order: "Mama Mía: Latin music from 7 p.m. to 9 p.m.; live music from 8 p.m."
  const byVenue = new Map();
  for (const r of rows) byVenue.set(r.p.id, [...(byVenue.get(r.p.id) || []), r]);
  const genreWord = (g) => (es ? GENRE_ES[g] : GENRE_EN[g]);
  const shown = (genres) => {
    const gs = q.genres.length ? genres.filter((g) => q.genres.includes(g)) : genres;
    if (!gs.length) return es ? "música en vivo" : "live music";
    return gs.length > 3 ? listWords([...gs.slice(0, 3).map(genreWord), es ? "más" : "more"], es) : listWords(gs.map(genreWord), es);
  };
  const span = (from, to) => (es ? spanEs(from, to) : spanEn(from, to));
  const asked = q.genres.length ? q.genres.map(genreWord).join(es ? " o " : " or ") : es ? "música en vivo" : "live music";
  const whenWord = q.when.day != null ? (es ? `el ${DIAS[day]}` : `on ${DAYNAMES[day]}`) : q.when.tomorrow ? (es ? "mañana" : "tomorrow")
    : q.when.now ? (es ? "ahora" : "now") : (es ? "esta noche" : "tonight");
  const say = [];
  const ids = [...byVenue.keys()].slice(0, 4);
  if (ids.length) {
    say.push({ text: `${cap(asked)} ${whenWord}:` });
    for (const id of ids) {
      const rs = byVenue.get(id), name = rs[0].p.name;
      say.push({ id, text: end(rs.length === 1 ? `${name}, ${shown(rs[0].genres)}, ${span(rs[0].from, rs[0].to)}`
        : `${name}: ${rs.map((r) => `${shown(r.genres)} ${span(r.from, r.to)}`).join("; ")}`) });
    }
  } else {
    say.push({ text: es ? `No tengo ${asked} ${whenWord} en la lista.` : `I don't have ${asked} ${whenWord} on the list.` });
    // the nights it does have: "Salsa on other nights: Mama Mía, Fridays and Saturdays from 10 p.m. to 12:30 a.m."
    const other = players.slice(0, 3).map((p) => end(`${p.name}, ${p.music.slots.filter((s) => plays(p, s)).map((s) => nightsOf(s, es)).join("; ")}`)).join(" ");
    say.push({ text: es ? `${cap(asked)} otras noches: ${other}` : `${cap(asked)} on other nights: ${other}` });
  }
  // places known for live music whose nights are not on the list, so a music question never hides them
  if (!q.genres.length) {
    const more = (pack.places || []).filter((p) => (p.facts?.f || []).includes("live_music") && !byVenue.has(p.id) && !venues.some((v) => v.id === p.id)).slice(0, 3);
    if (more.length) say.push({ text: es ? `También con música en vivo, sin horario en la lista: ${listWords(more.map((p) => p.name), es)}.`
      : `Also with live music, nights not on the list: ${listWords(more.map((p) => p.name), es)}.` });
  }
  // music changes often: say how old the list is when it is old (the oldest of the venues in this answer)
  const used = ids.length ? ids.map((id) => byVenue.get(id)[0].p) : players.slice(0, 3);
  return { kind: "music", request: q, ids, say: withAge(say, used, now, es, staleDays) };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// the answer, and how old the music list of these venues is when that is over staleDays
function withAge(say, venues, now, es, staleDays) {
  const checked = venues.map((p) => p.music.checked).filter(Boolean).sort()[0];
  if (!checked || !now.date || (now.date - new Date(checked + "T12:00:00")) / 864e5 <= staleDays) return say;
  const d = new Date(checked + "T12:00:00"), year = d.getFullYear() !== now.date.getFullYear() ? { year: "numeric" } : {};
  return [...say, { text: es ? `La lista de música es del ${d.toLocaleDateString("es-MX", { day: "numeric", month: "long", ...year })}; conviene confirmar.`
    : `The music list was last checked on ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", ...year })}; worth confirming.` }];
}
const end = (s) => (/[.!?]$/.test(s) ? s : s + ".");  // "… to 1 a.m." keeps its one full stop
const diasPl = (d) => (DIAS[d].endsWith("s") ? DIAS[d] : DIAS[d] + "s");  // los domingos, los lunes
// "Fridays and Saturdays from 10 p.m. to 12:30 a.m." · "los viernes y sábados de las 10 de la noche a las 12 y media de la noche"
function nightsOf(s, es) {
  const every = s.days.length === 7, days = listWords(s.days.map((d) => (es ? diasPl(d) : DAYNAMES[d] + "s")), es);
  const to = s.to ? toMin(s.to) : null;
  return es ? `${every ? "todas las noches" : "los " + days} ${spanEs(toMin(s.from), to)}` : `${every ? "every night" : days} ${spanEn(toMin(s.from), to)}`;
}
const listWords = (xs, es) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + (es ? " y " : " and ") + xs[xs.length - 1] : xs[0] || "");

// "Is there music at <place>?": that place's nights, or that it has none on the list.
function namedVenue(p, m, q, lang) {
  const es = lang === "es";
  if (!p) return null;
  if (!m || !(m.slots || []).length) {
    if (!(p.facts?.f || []).includes("live_music")) return null;  // not a music venue: the places answer says what it is
    return { kind: "music", request: q, ids: [p.id], say: [{ id: p.id, text: es ? `${p.name} tiene música en vivo; no tengo su horario en la lista.` : `${p.name} has live music; I don't have its nights on the list.` }] };
  }
  const word = (gs) => listWords(gs.map((g) => (es ? GENRE_ES[g] : GENRE_EN[g])), es);
  const nights = m.slots.map((s) => `${s.genres ? `${s.genres.length ? word(s.genres) : es ? "música en vivo" : "live music"} ` : ""}${nightsOf(s, es)}`);
  const verb = es ? "tiene" : "has";
  return { kind: "music", request: q, ids: [p.id], say: [{ id: p.id, text: end(`${p.name} ${verb} ${word(m.genres)}: ${nights.join("; ")}`) }] };
}
