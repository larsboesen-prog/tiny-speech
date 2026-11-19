// Live music (plan step B8, decision D5): which venues have music, which genres, on which nights, from the city pack's music
// table (live.json's music: {placeId: {genres, slots: [{days: [0–6, Monday = 0], from: "20:00", to: "23:00", genres?}], checked}};
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
  mariachi: ["mariachi", "mariachis"], son: ["son jarocho", "jarocho", "son huasteco"], salsa: ["bailar salsa", "salsa music", "salsa dancing", "salsa dance", "salsa night", "salsa nights", "salsa en vivo", "musica salsa", "salsa band", "noche de salsa", "salsero", "salseros"],
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

/**
 * Music answer from the pack: {kind: "music", ids, say: [{text, id?}]} or null when the pack has no music data.
 * now: {d (Monday = 0), m (minutes), date} in the city's time (domains/places/ask.js nowAt).
 */
export function answerMusic(text, pack, now, lang = "en", { staleDays = 60, named = null } = {}) {
  const q = readMusic(text);
  if (!q) return null;
  const byId = Object.fromEntries((pack.places || []).map((p) => [p.id, p]));
  const venues = Object.entries(pack.music || {}).filter(([id, m]) => byId[id] && (m.slots || []).length).map(([id, m]) => ({ ...byId[id], music: m }));
  if (!venues.length) return null;
  if (named) return namedVenue(byId[named], pack.music?.[named], q, lang);
  const es = lang === "es";
  const day = q.when.day ?? (q.when.tomorrow ? (now.d + 1) % 7 : now.d);
  const rows = [];
  // tonight's nights, and, in the small hours, last night's that are still playing (a DJ from 22:00 to 1:00 at 0:30)
  const nights = [[day, 0]];
  if ((q.when.now || q.when.tonight) && day === now.d && now.m < 360) nights.push([(day + 6) % 7, -1440]);
  for (const p of venues) {
    for (const slot of p.music.slots) {
      const genres = slot.genres || p.music.genres;
      if (q.genres.length && !q.genres.some((g) => genres.includes(g))) continue;
      for (const [d, shift] of nights) {
        if (!slot.days.includes(d)) continue;
        const from = toMin(slot.from) + shift, to = (toMin(slot.to) <= toMin(slot.from) ? toMin(slot.to) + 1440 : toMin(slot.to)) + shift;
        if (shift && to <= now.m) continue;
        if (q.when.now && day === now.d && !(now.m >= from - 120 && now.m < to)) continue;  // playing now, or starting within two hours
        if (q.when.tonight && day === now.d && to <= now.m) continue;                         // already over tonight
        rows.push({ p, from, to, genres });
      }
    }
  }
  rows.sort((a, b) => a.from - b.from);
  const say = [];
  const genreWord = (g) => (es ? GENRE_ES[g] : GENRE_EN[g]);
  const asked = q.genres.length ? q.genres.map(genreWord).join(es ? " o " : " or ") : es ? "música en vivo" : "live music";
  const whenWord = q.when.day != null ? (es ? `el ${DIAS[day]}` : `on ${DAYNAMES[day]}`) : q.when.tomorrow ? (es ? "mañana" : "tomorrow")
    : q.when.now ? (es ? "ahora" : "now") : (es ? "esta noche" : "tonight");
  if (!rows.length) {
    say.push({ text: es ? `No tengo ${asked} ${whenWord} en la lista.` : `I don't have ${asked} ${whenWord} on the list.` });
  } else {
    say.push({ text: es ? `${cap(asked)} ${whenWord}:` : `${cap(asked)} ${whenWord}:` });
    for (const r of rows.slice(0, 4)) {
      const g = listWords(r.genres.map(genreWord), es);
      say.push({ id: r.p.id, text: es ? `${r.p.name}, ${g}, de ${sayTimeEs(r.from)} ${aTimeEs(r.to)}.`
        : end(`${r.p.name}, ${g}, from ${sayTime(r.from)} to ${sayTime(r.to)}`) });
    }
  }
  // music changes often: say how old the list is when it is old
  const checked = venues.map((p) => p.music.checked).filter(Boolean).sort()[0];
  if (checked && now.date && (now.date - new Date(checked + "T12:00:00")) / 864e5 > staleDays) {
    say.push({ text: es ? `La lista de música es del ${new Date(checked + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long" })}; conviene confirmar.`
      : `The music list was last checked on ${new Date(checked + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}; worth confirming.` });
  }
  return { kind: "music", request: q, ids: rows.slice(0, 4).map((r) => r.p.id), say };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const end = (s) => (/[.!?]$/.test(s) ? s : s + ".");  // "… to 1 a.m." keeps its one full stop
const diasPl = (d) => (DIAS[d].endsWith("s") ? DIAS[d] : DIAS[d] + "s");  // los domingos, los lunes
const listWords = (xs, es) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + (es ? " y " : " and ") + xs[xs.length - 1] : xs[0] || "");

// "Is there music at <place>?": that place's nights, or that it has none on the list.
function namedVenue(p, m, q, lang) {
  const es = lang === "es";
  if (!p) return null;
  if (!m || !(m.slots || []).length) {
    return { kind: "music", request: q, ids: [p.id], say: [{ id: p.id, text: es ? `No tengo música en vivo en ${p.name} en la lista.` : `I don't have live music at ${p.name} on the list.` }] };
  }
  const word = (gs) => listWords(gs.map((g) => (es ? GENRE_ES[g] : GENRE_EN[g])), es);
  const nights = m.slots.map((s) => {
    const days = listWords(s.days.map((d) => (es ? diasPl(d) : DAYNAMES[d] + "s")), es);
    const own = s.genres ? `${word(s.genres)} ` : "";
    return es ? `${own}los ${days} de ${sayTimeEs(toMin(s.from))} ${aTimeEs(toMin(s.to))}` : `${own}${days} from ${sayTime(toMin(s.from))} to ${sayTime(toMin(s.to))}`;
  });
  const verb = es ? "tiene" : "has";
  return { kind: "music", request: q, ids: [p.id], say: [{ id: p.id, text: end(`${p.name} ${verb} ${word(m.genres)}: ${nights.join("; ")}`) }] };
}
