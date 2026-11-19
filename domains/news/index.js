// News, small (plan step B12; review 1.10): search the stories' titles, read one, next, stop, and hand a real question to the
// site's server as one action. Nothing more is promised than the feed can keep: a feed without story dates cannot say what is
// "latest" or "today", so the answer says so and offers the top-ranked stories instead.
// Answers: {kind, ids, say: [{text, id?}], state, action?}. `state` is the conversation (the list being read and where), passed
// back with the next question; `action` is for the page: {type: "stop"} (stop the voice) or {type: "ask", question, about}
// (send the question, as text, to the site's server: the recording itself never leaves the page).
import { fold } from "../../core/text/sound.js";

const STOP = /^(stop|stop it|stop reading|enough|quiet|be quiet|cancel|shut up|that'?s enough|para|parale|detente|basta|silencio|alto|ya)$/;
const NEXT = /^(next|next one|next story|the next one|skip|skip it|another|another one|go on|siguiente|la siguiente|otra|otra noticia|sigue)$/;
const LATEST = /\b(latest|newest|most recent|today'?s?|this morning|tonight'?s?|breaking|just in|right now|ultimas?|hoy|de hoy|recientes?)\b/;
const HEADLINES = /^(what'?s new|whats in the news|the news|news|headlines|top stories|top news|what is in the news|any news|noticias|titulares)$/;
const READ = /^(?:read|open|tell me (?:about|more about)?|play|lee|leeme|abre)\s*(?:me\s+)?(?:the\s+|la\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|one|two|three|four|five|primera|segunda|tercera|cuarta|quinta|uno|dos|tres|cuatro|cinco|\d)?\s*(?:one|story|article|noticia|una)?\s*(.*)$/;
const ORDINAL = { first: 1, "1st": 1, one: 1, primera: 1, uno: 1, second: 2, "2nd": 2, two: 2, segunda: 2, dos: 2, third: 3, "3rd": 3, three: 3, tercera: 3, tres: 3,
  fourth: 4, "4th": 4, four: 4, cuarta: 4, cuatro: 4, fifth: 5, "5th": 5, five: 5, quinta: 5, cinco: 5 };
const FIND = /^(?:(?:find|search(?: for)?|look for|look up|any(?:thing| news| stories)?|is there (?:any|anything)|are there any|what about|what'?s new|news|stories|busca|buscar|hay algo|noticias)(?:\s+(?:on|about|in|from|de|sobre|of))?(?:\s+(?:the|la|el|los|las))?\s+)(.+)$/;
// a question to answer, not a command: the site's server answers it (as text), with the story being read if any
const QUESTION = /^(why|how|who|whom|whose|when|where|which|what (?:does|do|did|will|would|happens|happened|is the (?:impact|effect|reason|deal))|should|will|would|could|can|is (?:it|this|that)|are (?:they|we)|does|do|did|explain|summari[sz]e|por que|porque|como|quien|cuando|donde|cual|que significa|explica)\b/;
const SMALL = new Set(("the a an of on in about for to and or is are was were be any some news story stories article articles what whats whats " +
  "there anything me tell with from at by de la el los las del sobre y en un una que hay").split(" "));
const words = (s) => fold(s).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 1 && !SMALL.has(w)).map((w) => w.replace(/(?<=\w{3})(es|s)$/, ""));

export function createNews(feed, { handoff = "the newsroom", list = 3, readSentences = 4 } = {}) {
  const stories = feed.items;
  const byScore = [...stories].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.n - b.n);
  const index = stories.map((s) => ({ s, title: new Set(words(s.title)), more: new Set(words([s.categories.join(" "), s.summary].join(" "))) }));
  const builtOn = feed.built ? new Date(feed.built).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  /** Titles that share words with the query: title words count three, categories and the summary one. */
  function search(query) {
    const q = words(query);
    if (!q.length) return [];
    return index.map(({ s, title, more }) => ({ s, score: q.reduce((n, w) => n + (title.has(w) ? 3 : more.has(w) ? 1 : 0), 0) }))
      .filter((x) => x.score >= Math.min(3, q.length)).sort((a, b) => b.score - a.score || (b.s.score ?? 0) - (a.s.score ?? 0)).map((x) => x.s);
  }
  const listOf = (found, lead) => {
    const shown = found.slice(0, list);
    return [{ text: lead }, ...shown.map((s, i) => ({ id: s.id, text: `${i + 1}. ${s.title}.` })), { text: "Say “read the first one”, or “next”." }];
  };
  const firstSentences = (s) => {
    const text = s.body || s.summary;
    const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”’)]*\s*/g) || [text];
    return sentences.slice(0, readSentences).join("").trim();
  };
  const read = (s, state) => ({
    kind: "read", ids: [s.id], say: [{ id: s.id, text: s.title + "." }, { id: s.id, text: firstSentences(s) }],
    state: { ...state, at: state.list.indexOf(s.id) }, link: s.link,
  });

  /** One question or command; state: what answer() returned last time (or null). */
  function answer(text, state = null) {
    const t = fold(text).replace(/[¿?¡!.,]+/g, " ").replace(/\s+/g, " ").trim();
    state = state || { list: byScore.map((s) => s.id), at: -1 };
    if (STOP.test(t)) return { kind: "stop", ids: [], say: [], state, action: { type: "stop" } };
    if (NEXT.test(t)) {
      const at = state.at + 1, id = state.list[at];
      if (!id) return { kind: "none", ids: [], say: [{ text: "That was the last one." }], state };
      return read(stories.find((s) => s.id === id), { ...state, at });
    }
    if (LATEST.test(t) && !feed.hasDates) {
      const lead = `This feed has no dates on its stories, so I can't tell which is newest${builtOn ? `; it was last updated on ${builtOn}` : ""}. Its top-ranked stories:`;
      return { kind: "list", ids: byScore.slice(0, list).map((s) => s.id), say: listOf(byScore, lead), state: { list: byScore.map((s) => s.id), at: -1 } };
    }
    if (LATEST.test(t) || HEADLINES.test(t)) {
      const order = feed.hasDates ? [...stories].sort((a, b) => (b.date || "").localeCompare(a.date || "")) : byScore;
      return { kind: "list", ids: order.slice(0, list).map((s) => s.id), say: listOf(order, feed.hasDates ? "The latest stories:" : "The top-ranked stories:"),
        state: { list: order.map((s) => s.id), at: -1 } };
    }
    const r = READ.exec(t);
    if (r && (r[1] || r[2])) {
      const n = r[1] ? (ORDINAL[r[1]] || Number(r[1])) : 0;
      if (n) {
        const id = state.list[n - 1];
        return id ? read(stories.find((s) => s.id === id), state) : { kind: "none", ids: [], say: [{ text: `There is no story number ${n} in this list.` }], state };
      }
      const found = search(r[2]);
      if (found.length) return read(found[0], { list: found.map((s) => s.id), at: 0 });
    }
    const f = QUESTION.test(t) ? null : FIND.exec(t);
    const query = f ? f[1] : t;
    const found = QUESTION.test(t) ? [] : search(query);
    if (found.length && (f || words(query).length <= 4)) {
      return { kind: "list", ids: found.slice(0, list).map((s) => s.id), say: listOf(found, `${found.length === 1 ? "One story" : `${found.length} stories`} about ${query}:`),
        state: { list: found.map((s) => s.id), at: -1 } };
    }
    if (f) return { kind: "none", ids: [], say: [{ text: `No story in this feed is about ${f[1]}.` }], state };
    // a real question (why, what does it mean, who...): the site's server answers it, as text, with the story being read if any
    const about = state.at >= 0 ? stories.find((s) => s.id === state.list[state.at]) : null;
    return { kind: "ask", ids: about ? [about.id] : [], say: [{ text: `Asking ${handoff}…` }], state,
      action: { type: "ask", question: text.trim(), about: about ? { id: about.id, title: about.title } : null } };
  }
  return { answer, search, stories, hasDates: feed.hasDates, built: feed.built };
}
