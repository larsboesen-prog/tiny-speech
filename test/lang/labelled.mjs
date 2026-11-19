// Questions whose language is known, for measuring the language decision on text (plan step B6). Taken from the golden
// questions (test/golden/questions-mapsma.json): those built from an English or a Spanish template, and the hand-written ones.
// Mixed-language questions are kept apart: they have no single right answer.
import { readFileSync } from "node:fs";

const golden = JSON.parse(readFileSync(new URL("../golden/questions-mapsma.json", import.meta.url), "utf8")).conversations
  .filter((c) => c.length === 1).map((c) => c[0]);

const EN_WRITTEN = [
  "Find 4 restaurants in Centro that are open in the next 2 hours", "Surprise me: three restaurants Susan York reviewed recently that are open now",
  "Best tacos in Centro", "Cheap eats", "Rooftop with a view", "Something unique", "Is La Azotea open?", "What's open near me?", "How far is La Azotea?",
  "Is Bocaciega open tomorrow?", "Is Cien 24 open?", "Is Fenicia cheap?", "I'm hungry", "Mexican food in San Antonio", "brunch on Sunday",
  "cheap places for Mexican food", "dinner tonight", "find 4 restaurants near the Jardín", "fish tacos", "four places in Centro", "hidden gems",
  "lunch near the Parroquia", "lunch spots open now", "open on Monday", "places to watch the sunset", "rooftop bars", "rooftops in Guadalupe",
  "rooftops with a view", "surprise me", "the best Italian", "the best Mexican restaurant", "the most expensive", "upscale places for fine dining",
  "where do locals eat", "which places can be booked", "three of Susan York's recent picks", "a view of the Parroquia", "open now", "Tonight",
  "cheap tacos open now", "dinner tonight in Guadalupe", "breakfast tomorrow at 9", "breakfast tomorrow", "lunch tomorrow at noon", "open late tonight",
  "something romantic for dinner on Friday", "places open on Sunday", "what is open in the next hour", "what is open in the next 30 minutes", "coffee now",
  "a cheap breakfast", "the most expensive restaurant in Centro", "kid friendly lunch spots", "dog friendly cafés", "coffee with wifi",
  "a quiet garden for lunch", "best pizza", "pizza open now", "sushi tonight what is open", "ramen for dinner", "vegan food near me",
  "gluten free bakery", "mezcal bar open late", "craft beer on Saturday", "a winery out of town", "places for groups tonight", "parking for dinner",
  "live music tonight", "live jazz tonight", "where is there live music", "jazz on Thursday", "a bar with a band", "somewhere to dance salsa",
  "Is La Sotea open?", "is la zotay it open", "is tastavir open", "sues in York picks", "restaurants in central", "is the sushi gami open", "how far is boca ciega",
  "pozole tonight", "enchiladas for lunch", "tacos al pastor near me", "hello", "thank you", "what can you do", "help",
];
const ES_WRITTEN = [
  "Busca 4 restaurantes en el Centro abiertos en las próximas 2 horas", "Sorpréndeme: tres restaurantes que Susan York reseñó hace poco y que están abiertos ahora",
  "¿Qué tan lejos está La Azotea?", "¿Está abierto Bocaciega mañana?", "una terraza con vista", "terrazas con vista", "lugares baratos para comida mexicana",
  "lugares para ver el atardecer", "tacos baratos abiertos ahora", "cena esta noche en Guadalupe", "desayuno mañana a las 9", "comida mañana al mediodía",
  "abierto tarde esta noche", "algo romántico para cenar el viernes", "lugares abiertos el domingo", "qué hay abierto en la próxima hora", "café ahorita",
  "un desayuno barato", "el restaurante más caro del Centro", "lugares para ir con niños", "café con wifi", "la mejor pizza", "sushi esta noche",
  "comida vegana cerca de mí", "panadería sin gluten", "bar de mezcal abierto tarde", "cerveza artesanal el sábado", "un viñedo fuera de la ciudad",
  "dónde comen los locales", "sorpréndeme", "qué hay abierto cerca de mí", "¿Qué tan lejos está la Parroquia?", "al rato una cena", "mande",
  "cuarto para las nueve", "música en vivo esta noche", "jazz en vivo", "dónde hay música en vivo", "jazz el jueves", "mariachis en el Jardín",
  "un bar con concierto", "trova el jueves", "a que hora abrebocaciga", "dónde puedo comer mole", "churros y chocolate", "quesadillas ahorita",
  "gracias", "¿qué puedes hacer?",
];
export const MIXED = ["hay sushi open tonight?", "¿dónde hay brunch near the Jardín?", "best tacos en el Centro", "cheap comida mexicana", "rooftop con vista",
  "is there música en vivo tonight"];

const byTemplate = (q) =>
  MIXED.includes(q) ? null
    : /^where can I get /.test(q) || /^(Is .+ open\?|How far is .+\?|lunch near .+|.+ tomorrow)$/.test(q) ? "en"
    : /^(¿dónde hay .+\?|¿Está abierto .+\?|cerca de .+)$/.test(q) ? "es" : null;

export const LABELLED = [
  ...golden.map((q) => [q, byTemplate(q)]).filter(([, l]) => l),
  ...EN_WRITTEN.map((q) => [q, "en"]), ...ES_WRITTEN.map((q) => [q, "es"]),
].filter(([q], i, all) => !MIXED.includes(q) && all.findIndex(([x]) => x === q) === i);
