// Writes test/golden/questions-mapsma.json once: the fixed questions the golden snapshot records. Run again only to add
// questions on purpose (the file is reviewed as a diff). Sources: phrases quoted in MapSMA's code comments and page,
// Lars's examples, known mis-hearings, every reader topic in English and Spanish, place-name questions, times, prices,
// areas, music, mixed-language questions and follow-ups ("4 more").
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIX = ROOT + "test/fixtures/before/mapsma-page5/";
const { TOPIC } = await import(pathToFileURL(FIX + "read.js").href);
const data = JSON.parse(readFileSync(FIX + "data.json", "utf8"));

const fromComments = [
  "Find 4 restaurants in Centro that are open in the next 2 hours", "Busca 4 restaurantes en el Centro abiertos en las próximas 2 horas",
  "Surprise me: three restaurants Susan York reviewed recently that are open now",
  "Sorpréndeme: tres restaurantes que Susan York reseñó hace poco y que están abiertos ahora",
  "Best tacos in Centro", "Cheap eats", "Rooftop with a view", "Something unique", "Is La Azotea open?", "What's open near me?",
  "How far is La Azotea?", "¿Qué tan lejos está La Azotea?", "Is Bocaciega open tomorrow?", "¿Está abierto Bocaciega mañana?",
  "Is Cien 24 open?", "Is Fenicia cheap?", "I'm hungry", "Mexican food in San Antonio", "brunch on Sunday", "cheap places for Mexican food",
  "dinner tonight", "find 4 restaurants near the Jardín", "fish tacos", "four places in Centro", "hidden gems", "lunch near the Parroquia",
  "lunch spots open now", "open on Monday", "places to watch the sunset", "rooftop bars", "rooftops in Guadalupe", "rooftops with a view",
  "surprise me", "the best Italian", "the best Mexican restaurant", "the most expensive", "upscale places for fine dining",
  "where do locals eat", "which places can be booked", "una terraza con vista", "terrazas con vista", "lugares baratos para comida mexicana",
  "lugares para ver el atardecer", "three of Susan York's recent picks", "a view of the Parroquia", "open now", "Tonight",
];
const misHeard = [
  "Is La Sotea open?", "is la zotay it open", "Boca Ciega", "Yerba Santa", "is tastavir open", "a que hora abrebocaciga", "quien hace",
  "el plato", "sues in York picks", "restaurants in central", "is the sushi gami open", "how far is boca ciega",
];
const timesPricesAreas = [
  "cheap tacos open now", "dinner tonight in Guadalupe", "breakfast tomorrow at 9", "breakfast tomorrow", "lunch tomorrow at noon",
  "open late tonight", "something romantic for dinner on Friday", "places open on Sunday", "what is open in the next hour",
  "what is open in the next 30 minutes", "coffee now", "a cheap breakfast", "the most expensive restaurant in Centro",
  "kid friendly lunch spots", "dog friendly cafés", "coffee with wifi", "a quiet garden for lunch", "best pizza", "pizza open now",
  "sushi tonight what is open", "ramen for dinner", "vegan food near me", "gluten free bakery", "mezcal bar open late",
  "craft beer on Saturday", "a winery out of town", "places for groups tonight", "parking for dinner",
  "tacos baratos abiertos ahora", "cena esta noche en Guadalupe", "desayuno mañana a las 9", "comida mañana al mediodía",
  "abierto tarde esta noche", "algo romántico para cenar el viernes", "lugares abiertos el domingo", "qué hay abierto en la próxima hora",
  "café ahorita", "un desayuno barato", "el restaurante más caro del Centro", "lugares para ir con niños", "café con wifi",
  "la mejor pizza", "sushi esta noche", "comida vegana cerca de mí", "panadería sin gluten", "bar de mezcal abierto tarde",
  "cerveza artesanal el sábado", "un viñedo fuera de la ciudad", "dónde comen los locales", "sorpréndeme",
  "qué hay abierto cerca de mí", "¿Qué tan lejos está la Parroquia?", "al rato una cena", "mande", "cuarto para las nueve",
];
const music = [
  "live music tonight", "live jazz tonight", "where is there live music", "jazz on Thursday", "mariachi", "a bar with a band",
  "música en vivo esta noche", "jazz en vivo", "dónde hay música en vivo", "jazz el jueves", "mariachis en el Jardín", "un bar con concierto",
  "trova el jueves", "somewhere to dance salsa",
];
const mixed = [
  "hay sushi open tonight?", "¿dónde hay brunch near the Jardín?", "best tacos en el Centro", "cheap comida mexicana",
  "rooftop con vista", "is there música en vivo tonight", "tacos al pastor near me", "pozole tonight", "chiles en nogada",
  "dónde puedo comer mole", "enchiladas for lunch", "churros y chocolate", "quesadillas ahorita",
];
const smallTalk = ["hello", "thank you", "gracias", "what can you do", "help", "¿qué puedes hacer?", "ok", "yes", "no"];
const conversations = [
  ["Find 4 restaurants in Centro that are open in the next 2 hours", "4 more"],
  ["tacos", "more"], ["cafés", "4 más"], ["rooftop bars", "two more"], ["Mexican food", "more please", "more"],
];

// Every reader topic: one English and one Spanish question built from its own words.
const clean = (w) => /^[a-zñ ]+$/.test(w) && w.length > 2;
const alternatives = (re) => re.source.replace(/^\\b\(|\)\\b$/g, "").split("|").map((w) => w.replace(/\?|\[[^\]]*\]\+?|\\b/g, "").replace(/s\?$/, ""));
const topicQuestions = [];
for (const [k, t] of Object.entries(TOPIC)) {
  const words = alternatives(t.re).filter(clean);
  const en = (t.en && !t.en.includes(" ") ? t.en : words[0]) || k.replace(/^dish:/, "");
  const es = (t.es && t.es !== t.en ? t.es : null) || (t.nounEs && t.nounEs[0]) || words.find((w) => /[ñ]|(os|as|eria|ia|cion)$/.test(w) && w !== en) || words[words.length - 1] || en;
  topicQuestions.push(`where can I get ${en}?`, `¿dónde hay ${es}?`);
}

// Place names: our picks, the extra places and sights, each asked four ways.
const pickPlaces = data.PLACES.filter((p) => p.cat !== "sights" && !p.other).slice(0, 18);
const extraPlaces = data.PLACES.filter((p) => p.other).slice(0, 4);
const sights = data.PLACES.filter((p) => p.cat === "sights").slice(0, 4);
const placeQuestions = [];
for (const p of [...pickPlaces, ...extraPlaces]) placeQuestions.push(`Is ${p.name} open?`, `¿Está abierto ${p.name}?`, `How far is ${p.name}?`, `${p.name} tomorrow`);
for (const p of sights) placeQuestions.push(`lunch near ${p.name}`, `cerca de ${p.name}`);

const singles = [...new Set([...fromComments, ...misHeard, ...timesPricesAreas, ...music, ...mixed, ...smallTalk, ...topicQuestions, ...placeQuestions])];
const out = {
  note: "Fixed questions for the MapSMA golden snapshot. Written by tools/golden-questions.mjs on 19 Nov 2026; edit by adding, as a reviewed diff.",
  clocks: ["tue-14:10", "sat-23:40", "mon-03:00"],
  conversations: [...singles.map((q) => [q]), ...conversations],
};
writeFileSync(ROOT + "test/golden/questions-mapsma.json", JSON.stringify(out, null, 1) + "\n");
console.log(`${singles.length} questions + ${conversations.length} conversations`);
