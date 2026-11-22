// tiny-speech domains/places/read.js: reading a question about places to eat, drink and see (words → request), for any city.
// MapSMA /page5's read.js (18 Nov 2026) with every San Miguel name, area and list moved to the city pack (D6, plan step B2): the
// code is MapSMA's except where it reads the pack, and the golden tests check it gives /page5's requests to 434 questions.
// The comments below are MapSMA's, San Miguel examples and all: they say why each rule exists.
// MapSMA /page5 (Ask by voice): reading a question. The words, typed or heard, become a REQUEST; ask.js answers the request from the
// site's data. (Lars, 18 Nov 2026: "Do 1-3 proposal", 2: reading the question apart from finding the answer, so that something else
// than these rules, e.g. a small on-phone model, could one day fill in the same request; it would never pick the places itself.)
//
// The request (one plain object, from parse() and createReader().read(); requestOf() shows the parts that are set):
//   text, s, rest        the question as typed or heard; folded (no accents, lower case); what is left once the time words are read
//   named {id, score}     the place the question names, if any; nearNames: the closest names, for "Did you mean …?"
//   wantsList, asks       several places wanted ("4 restaurants", "find…", "Susan…"); the question asks for kinds of places, not one
//   topics                what it asks for: TOPICS keys below ("italian", "rooftop", "view", "dish:mole"…); cats: old kind words
//   centro, area, near, nearWord, nearSight, howFar     where: Centro; "san antonio" | "guadalupe" | "out of town" | "aurora";
//                         near the phone; "near …" + a named sight (its id); "how far is …"
//   now, window, meal, mealNow, lateMeal, tonight, dayIdx, tomorrow     when: "open now"; the next N minutes; breakfast | brunch |
//                         lunch | dinner | late; a meal "now"; a late meal (set by resolveTime); "tonight"; a weekday (Monday = 0)
//   price, priciest       "low" | "mid" | "high"; "the most expensive"
//   unique, local, best, susan, surprise, eat, restaurantWord, exists, count, more, plural, listVerb
//                         "something unique"; "where locals eat"; "best" (said as "our favourite"); Susan York; "surprise me";
//                         food wanted; the word "restaurant"; "is there…"; a number of places; "4 more"; plural words; "find…"

import { fold, sound, lev, need, skeleton, SKELETON } from '../../core/text/sound.js';
import { streetIndex, findStreet } from './streets.js';
export { fold, sound };
export const SOON = 120;          // "open now" = open now or opening within this many minutes
const MAX_COUNT = 8;

// ---------- matching a spoken name ----------
// Speech to text writes Spanish names as it hears them ("Boca Ciega", "Yerba Santa", "La Sotea"), so names are compared by a rough
// sound-alike key, letter by letter, with a little room for error in long names and none in short ones.
// sound(), lev(), need(), skeleton() and SKELETON live in core/text/sound.js (unchanged from here).
const NAME_STOP = new Set(['la', 'el', 'los', 'las', 'the', 'de', 'del', 'y', 'and', 'cafe', 'coffee', 'tacos', 'panaderia', 'casa']);
// A place's other names, its exact-only names and whether its short form counts come from the city pack (places[].names,
// exactName, noShort). Words for an area or the town are not names ("Mexican food in San Antonio" is not Café Santa Ana): the
// pack's areas say which words to mask. A number before a time unit is not a name either (Spanish "las quince horas").
const maskNumberTimes = (s) => s.replace(/\b(las |a las )?quince (minutos|mins?|horas)\b/g, (m) => m.replace(/\S+/g, '§'));
const maskAreaNames = (pack, s) => compiled(pack).masks.reduce((t, re) => t.replace(re, (m) => m.replace(/\S+/g, '§')), s);

// Letters counted (a–z, 0–9), and the "bag" distance between two counts: a lower bound of the edit distance (lev).
const letterCounts = (s) => { const c = new Int16Array(36); for (let i = 0; i < s.length; i++) { const x = s.charCodeAt(i); c[x >= 97 ? x - 97 : x - 22]++; } return c; };
const bagDistance = (a, b) => { let more = 0, less = 0; for (let i = 0; i < 36; i++) { const d = a[i] - b[i]; if (d > 0) more += d; else less -= d; } return Math.max(more, less); };

// The pack's words as patterns, made once per pack: the centre, the areas (in order), the collections ("Susan York's picks").
const COMPILED = new WeakMap();
const wordsRe = (list) => new RegExp(`\\b(${list.map((w) => fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
export function compiled(pack) {
  let c = COMPILED.get(pack);
  if (!c) {
    const centre = pack.areas.find((a) => a.role === 'centre');
    c = {
      centre: wordsRe(centre.words), centreNot: centre.notWhen ? new RegExp(centre.notWhen, 'g') : null,
      areas: pack.areas.filter((a) => a.role !== 'centre').map((a) => ({ id: a.id, re: wordsRe(a.words) })),
      masks: pack.areas.filter((a) => a.maskInNames).map((a) => new RegExp(a.maskInNames, 'g')),
      collections: (pack.collections || []).map((x) => ({ id: x.id, re: wordsRe(x.words) })),
      outOfTown: (pack.areas.find((a) => a.role === 'outOfTown') || {}).id || null,
      streets: streetIndex(pack.places.map((p) => ({ id: p.id, address: (p.info || {}).address }))),  // from the addresses: "Umarán 8" → Umarán
    };
    COMPILED.set(pack, c);
  }
  return c;
}

// ---------- reading the question ----------
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, una: 1, un: 1, 'par de': 2, par: 2 };  // and in Spanish
const numOf = (w) => (/^\d+$/.test(w) ? Number(w) : NUMW[w] ?? null);
// ---------- what a question asks for: topics (Lars, 17 Nov 2026: "answer 100 random questions that people might dream up knowing it is a
// restaurant app but don't know the restaurant names eg which are the best Italian restaurants, best Mexican, best hamburgers, best tacos,
// best Peruvian, sushi, etc in centro, in San Antonio, cheap or expensive, roof top with a view, unique etc") ----------
// Each topic is found by its words (English and Spanish, folded) and matched against facts.js (cuisine c, main first; dishes d; features f;
// price p: researched on the web 17 Nov 2026, sources in data/facts.json), the place's category, and its name and description (t).
// Score: 3 = category or main cuisine, 2 = another cuisine, a dish or a feature (fs if set), 1 = only the words in its text. Every topic in a
// question must match; the scores order the places. kind: 'cat' a kind of place, 'food' a cuisine or dish (both: no "what it is" after
// each name, the question said it), 'feat' a feature. near: the topic offered instead when no place matches ("pizza" -> Italian food).
// en / es: "places for Italian food" / "lugares para comida italiana"; a 'cat' topic has nouns instead, a 'feat' topic words to add.
const TOPICS = [
  // kinds of place
  { k: 'coffee', kind: 'cat', re: /\b(coffee|coffees|cafes?|espresso|cappuccino|latte|cafecito|cafeterias?|cafe de especialidad)\b/, cat: ['bfast'], cs: 2, c: ['coffee'], noun: ['cafés', 'café'], nounEs: ['cafés', 'café', 'm'] },
  { k: 'bakery', kind: 'food', re: /\b(bakery|bakeries|bread|breads|sourdough|pastry|pastries|pan dulce|panaderias?|pasteler[ia]+s?|reposteria|conchas?|cinnamon rolls?|danish)\b/, c: ['bakery', 'pastries'], d: ['bread', 'croissant', 'sourdough', 'roll', 'danish', 'focaccia', 'strudel', 'muffin', 'pastr'], t: ['bakery', 'panaderia'], en: 'bread and pastries', es: 'pan y pasteles', near: 'coffee' },
  { k: 'street', kind: 'cat', re: /\b(street food|street stalls?|stalls?|food carts?|comida callejera|puestos?|antojitos)\b/, cat: ['street'], c: ['street_food'], noun: ['street-food places', 'street-food place'], nounEs: ['puestos de comida callejera', 'puesto de comida callejera', 'm'] },
  { k: 'bar', kind: 'cat', re: /\b(bars?|pubs?|drinks?|a drink|happy hour|nightlife|bares|tragos?|bebidas?|copas?|cantinas?|vida nocturna|antros?|nightclubs?|night clubs?|discotecas?|club nocturno)\b/, cat: ['share', 'roof'], c: ['cocktails', 'mezcal', 'beer', 'craft_beer', 'wine'], f: ['full_bar', 'cocktails'], fs: 1, noun: ['bars', 'bar'], nounEs: ['bares', 'bar', 'm'] },
  { k: 'rooftop', kind: 'cat', re: /\b(roof ?tops?|roofs?|roof terraces?|terraces?|terrace|azoteas?|terrazas?|terrasas)\b/, cat: ['roof'], f: ['rooftop', 'terrace'], noun: ['rooftops', 'rooftop'], nounEs: ['terrazas', 'terraza', 'f'] },
  { k: 'winery', kind: 'cat', re: /\b(winery|wineries|vineyards?|wine tastings?|wine tours?|wine country|vinicolas?|vinedos?|catas? de vinos?|bodegas?)\b/, cat: ['wine'], pool: ['wine'], noun: ['wineries', 'winery'], nounEs: ['viñedos', 'viñedo', 'm'] },
  { k: 'world', kind: 'cat', re: /\b(world food|international|del mundo|internacional(es)?|fusion|global)\b/, cat: ['world'], c: ['international', 'fusion'], noun: ['world-food places', 'world-food place'], nounEs: ['lugares de cocina del mundo', 'lugar de cocina del mundo', 'm'] },
  // cuisines
  { k: 'mexican', kind: 'food', re: /\b(mexican|mexicanas?|mexicanos?)\b/, cat: ['mex'], c: ['mexican', 'traditional_mexican', 'modern_mexican', 'home_style', 'tacos', 'birria'], en: 'Mexican food', es: 'comida mexicana' },
  { k: 'tradmex', kind: 'food', re: /\b(traditional|authentic|typical|real mexican|old school|home cooking|home style|homestyle|home cooked|homemade|grandma s|grandmas|grandmother s|like grandma|tipic[oa]s?|tradicional(es)?|autentic[oa]s?|casera|caseros?|de la abuela|de la abuelita|como en casa|comida de casa|hecho en casa|fondas?|fonditas?|cocinas? economicas?)\b/, c: ['traditional_mexican', 'home_style', 'street_food', 'birria'], t: ['traditional', 'home-style', 'tradicional', 'casera'], en: 'traditional food', es: 'comida tradicional' },
  { k: 'modmex', kind: 'food', re: /\b(modern|contemporary|creative|nueva cocina|contemporane[oa]s?|modern[oa]s?|de autor)\b/, c: ['modern_mexican', 'fusion'], en: 'modern cooking', es: 'cocina contemporánea' },
  { k: 'tacos', kind: 'food', re: /\b(tacos?|taqueria|taquerias|taquitos?|al pastor|pastor)\b/, c: ['tacos', 'birria'], d: ['taco'], t: ['taco', 'taqueria'], en: 'tacos', es: 'tacos', near: 'mexican' },
  { k: 'fishtacos', kind: 'food', re: /\b(fish tacos?|shrimp tacos?|seafood tacos?|tacos? de (pescado|camaron|camarones|mariscos))\b/, d: ['fish tacos', 'shrimp tacos', 'seafood tacos', 'marlin tacos'], en: 'fish tacos', es: 'tacos de pescado', near: 'seafood' },
  { k: 'birria', kind: 'food', re: /\b(birria|consome)\b/, c: ['birria'], d: ['birria'], t: ['birria'], en: 'birria', es: 'birria', near: 'tacos' },
  { k: 'italian', kind: 'food', re: /\b(italian|italy|italian[oa]s?|italia)\b/, c: ['italian', 'sicilian'], t: ['italian', 'sicilian', 'italiana', 'italiano'], en: 'Italian food', es: 'comida italiana', near: 'world' },
  { k: 'sicilian', kind: 'food', re: /\b(sicilian|sicily|sicilian[oa]s?|sicilia)\b/, c: ['sicilian'], t: ['sicilian', 'siciliana'], en: 'Sicilian food', es: 'comida siciliana', near: 'italian' },
  { k: 'pizza', kind: 'food', re: /\b(pizzas?|pizzeria|pizzerias)\b/, c: ['pizza'], d: ['pizza'], t: ['pizza'], en: 'pizza', es: 'pizza', near: 'italian' },
  { k: 'pasta', kind: 'food', re: /\b(pastas?|spaghetti|lasagna|lasana|ravioli|fettuccine|gnocchi|risotto)\b/, c: ['pasta'], d: ['pasta', 'cannelloni', 'lasagna', 'ravioli', 'gnocchi'], t: ['pasta'], en: 'pasta', es: 'pasta', near: 'italian' },
  { k: 'peruvian', kind: 'food', re: /\b(peruvian|peru|peruan[oa]s?|nikkei|pisco)\b/, c: ['peruvian'], t: ['peruvian', 'peruana'], en: 'Peruvian food', es: 'comida peruana', near: 'seafood' },
  { k: 'ceviche', kind: 'food', re: /\b(ceviches?|cebiches?|aguachiles?|tiradito)\b/, c: ['ceviche'], d: ['ceviche', 'aguachile'], t: ['ceviche', 'aguachile'], en: 'ceviche', es: 'ceviche', near: 'seafood' },
  { k: 'seafood', kind: 'food', re: /\b(seafood|sea food|fish|shrimp|prawns?|oysters?|octopus|lobster|trout|mariscos?|pescados?|camarones|camaron|ostiones|ostras|pulpo|langosta|trucha|marisqueria)\b/, c: ['seafood', 'ceviche'], d: ['fish', 'shrimp', 'octopus', 'oyster', 'aguachile', 'seafood', 'pescadilla', 'trout', 'ceviche'], t: ['seafood', 'mariscos', 'fish', 'pescado', 'trout', 'trucha'], en: 'seafood', es: 'mariscos' },
  { k: 'sushi', kind: 'food', re: /\b(sushi|sushis|sashimi|maki|nigiri)\b/, c: ['sushi'], d: ['sushi'], t: ['sushi'], en: 'sushi', es: 'sushi', near: 'japanese' },
  { k: 'japanese', kind: 'food', re: /\b(japanese|japan|japones[a]?s?|japon)\b/, c: ['japanese', 'sushi', 'ramen'], t: ['japanese', 'japonesa'], en: 'Japanese food', es: 'comida japonesa', near: 'asian' },
  { k: 'ramen', kind: 'food', re: /\b(ramen|noodles?|noodle soup|udon|pho|fideos)\b/, c: ['ramen'], d: ['ramen', 'noodle'], t: ['ramen', 'noodle'], en: 'ramen', es: 'ramen', near: 'asian' },
  { k: 'dumplings', kind: 'food', re: /\b(dumplings?|gyozas?|baos?|bao buns?|dim sum)\b/, d: ['dumpling', 'bao', 'gyoza'], t: ['dumpling', 'bao', 'gyoza'], en: 'dumplings', es: 'dumplings', near: 'asian' },
  { k: 'korean', kind: 'food', re: /\b(korean|korea|corean[oa]s?|corea|kimchi)\b/, c: ['korean'], t: ['korean', 'coreana'], en: 'Korean food', es: 'comida coreana', near: 'asian' },
  { k: 'thai', kind: 'food', re: /\b(thai|thailand|tailandes[a]?s?|tailandia|pad thai)\b/, c: ['thai'], t: ['thai'], en: 'Thai food', es: 'comida tailandesa', near: 'asian' },
  { k: 'chinese', kind: 'food', re: /\b(chinese|china|chin[oa]s?)\b/, c: ['chinese'], t: ['chinese'], en: 'Chinese food', es: 'comida china', near: 'asian' },
  { k: 'indian', kind: 'food', re: /\b(indian|india|hindu|curry|curries|tandoori)\b/, c: ['indian'], d: ['curry'], t: ['indian', 'curry'], en: 'Indian food', es: 'comida india', near: 'world' },
  { k: 'asian', kind: 'food', re: /\b(asian|asia|asiatic[oa]s?|oriental)\b/, c: ['asian', 'japanese', 'korean', 'thai', 'chinese', 'sushi', 'ramen'], t: ['asian', 'asiatica'], en: 'Asian food', es: 'comida asiática', near: 'world' },
  { k: 'lebanese', kind: 'food', re: /\b(lebanese|lebanon|middle eastern|middle east|arab|arabic|falafel|hummus|shawarma|kebabs?|libanes[a]?s?|libano|arabe|arabes|medio oriente)\b/, c: ['lebanese', 'middle_eastern'], d: ['falafel', 'hummus', 'lebanese'], t: ['lebanese', 'libanesa', 'falafel', 'hummus'], en: 'Lebanese and Middle Eastern food', es: 'comida libanesa y de Medio Oriente', near: 'mediterranean' },
  { k: 'mediterranean', kind: 'food', re: /\b(mediterranean|greek|greece|mediterrane[oa]s?|grieg[oa]s?|grecia)\b/, c: ['mediterranean', 'greek', 'lebanese', 'middle_eastern'], t: ['mediterranean', 'greek', 'mediterranea'], en: 'Mediterranean food', es: 'comida mediterránea', near: 'world' },
  { k: 'french', kind: 'food', re: /\b(french|france|frances[a]?s?|francia|bistro|bistros)\b/, c: ['french'], t: ['french', 'francesa', 'bistro'], en: 'French food', es: 'comida francesa', near: 'world' },
  { k: 'spanish', kind: 'food', re: /\b(tapas|spanish food|spanish cuisine|spanish restaurant|paella|comida espanola|cocina espanola)\b/, c: ['spanish', 'tapas'], d: ['tapas', 'paella'], t: ['tapas', 'paella'], en: 'tapas', es: 'tapas', near: 'world' },
  { k: 'american', kind: 'food', re: /\b(american food|american restaurant|diner|comida americana|comida gringa|americana|wings|chicken wings|alitas|hot dogs?|bbq|barbecue|barbacoa americana)\b/, c: ['american', 'burgers', 'comfort_food'], t: ['american'], en: 'American food', es: 'comida americana', near: 'world' },
  { k: 'burgers', kind: 'food', re: /\b(hamburgers?|burgers?|cheeseburgers?|hamburguesas?|hamburguesa)\b/, c: ['burgers'], d: ['burger'], t: ['burger', 'hamburguesa'], en: 'burgers', es: 'hamburguesas', near: 'american' },
  { k: 'steak', kind: 'food', re: /\b(steaks?|steakhouse|steak house|ribeye|rib eye|beef|meat|carnes?|carne asada|arrachera|cortes de carne|filete|asador|parrilla|parrilladas?)\b/, c: ['steak', 'grill'], d: ['steak', 'ribeye', 'arrachera'], t: ['steak', 'arrachera'], en: 'steak', es: 'cortes de carne', near: 'mexican' },
  { k: 'vegetarian', kind: 'food', re: /\b(vegetarian|vegetarians|veggie|meatless|no meat|vegetarian[oa]s?|sin carne)\b/, c: ['vegetarian', 'vegan'], f: ['vegetarian_options', 'vegan_options'], fs: 1, t: ['vegetarian', 'vegan', 'plant-based', 'vegetariana', 'vegana'], en: 'vegetarian food', es: 'comida vegetariana' },
  { k: 'vegan', kind: 'food', re: /\b(vegan|vegans|plant based|plant-based|vegan[oa]s?|a base de plantas)\b/, c: ['vegan'], f: ['vegan_options'], fs: 1, t: ['vegan', 'plant-based', 'vegana'], en: 'vegan food', es: 'comida vegana', near: 'vegetarian' },
  { k: 'healthy', kind: 'food', re: /\b(healthy|health food|salads?|smoothies?|juices?|green juice|bowls?|light food|saludables?|ensaladas?|jugos?|licuados?|comida ligera|sana)\b/, c: ['healthy', 'vegan', 'vegetarian', 'juice'], d: ['salad', 'smoothie', 'juice', 'bowl'], t: ['healthy', 'salad', 'saludable', 'ensalada'], en: 'healthy food', es: 'comida saludable', near: 'vegetarian' },
  { k: 'comfort', kind: 'food', re: /\b(comfort food|comida reconfortante)\b/, c: ['comfort_food', 'home_style'], t: ['comfort food'], en: 'comfort food', es: 'comida casera' },
  { k: 'brunch', kind: 'food', re: /\b(brunch|brunches|bottomless mimosas?|mimosas?)\b/, c: ['brunch'], f: ['weekend_brunch'], t: ['brunch'], en: 'brunch', es: 'brunch', near: 'breakfast' },
  { k: 'breakfast', kind: 'food', re: /^$/, cat: ['bfast'], cs: 2, c: ['breakfast', 'brunch'], t: ['breakfast', 'desayuno'], en: 'breakfast', es: 'desayuno' },  // only offered when "brunch" finds nothing
  { k: 'croissant', kind: 'food', re: /\b(croissants?|cruasan(es)?|cuernitos?)\b/, d: ['croissant'], t: ['croissant'], en: 'croissants', es: 'croissants', near: 'bakery' },
  { k: 'desserts', kind: 'food', re: /\b(desserts?|sweets?|sweet tooth|cakes?|cheesecakes?|pies?|tarts?|cookies?|postres?|pasteles?|galletas?)\b/, c: ['desserts', 'pastries', 'ice_cream', 'chocolate'], d: ['cake', 'cheesecake', 'tart', 'dessert', 'ice cream', 'pastr', 'cookie', 'sorbet'], en: 'desserts', es: 'postres', near: 'bakery' },
  { k: 'icecream', kind: 'food', re: /\b(ice ?creams?|gelato|gelatos|sorbets?|helados?|nieves?|paletas?|paleteria)\b/, c: ['ice_cream'], d: ['ice cream', 'sorbet', 'gelato'], t: ['ice cream', 'nieves', 'helado'], en: 'ice cream', es: 'helado', near: 'desserts' },
  { k: 'chocolate', kind: 'food', re: /\b(chocolate|chocolates|cacao|hot chocolate|chocolate caliente)\b/, c: ['chocolate'], d: ['chocolate', 'mocha'], t: ['chocolate', 'cacao'], en: 'chocolate', es: 'chocolate', near: 'desserts' },
  { k: 'sandwich', kind: 'food', re: /\b(sandwich|sandwiches|sandwichs|bagels?|wraps?|tortas?|deli|sandwicheria)\b/, c: ['sandwiches'], d: ['sandwich', 'bagel', 'wrap', 'grilled cheese', 'torta'], t: ['sandwich', 'deli'], en: 'sandwiches', es: 'sándwiches', near: 'coffee' },
  { k: 'wine', kind: 'food', re: /\b(wine bars?|wines?|vinos?|bar de vinos|vinoteca|natural wine|vino natural)\b/, c: ['wine'], f: ['wine_list'], pool: ['shop'], t: ['wine', 'vino'], en: 'wine', es: 'vino', near: 'bar' },
  { k: 'winelist', kind: 'feat', re: /\b(wine lists?|wine selection|wine cellar|good wines?|great wines?|big wine|carta de vinos|buena carta de vinos|cava de vinos)\b/, f: ['wine_list'], fs: 3, c: ['wine'], en: 'places with a good wine list', es: 'lugares con buena carta de vinos', with: ' with a good wine list', withEs: ' con buena carta de vinos' },
  { k: 'mezcal', kind: 'food', re: /\b(mezcal|mezcals|mezcales|mezcaleria|tequila|tequilas|agave|agaves)\b/, c: ['mezcal'], f: ['mezcal'], d: ['mezcal', 'tequila'], t: ['mezcal', 'tequila'], en: 'mezcal and tequila', es: 'mezcal y tequila', near: 'bar' },
  { k: 'cocktails', kind: 'food', re: /\b(cocktails?|cocteles?|cocteleria|cocktelerias?|margaritas?|mixology|martinis?|mojitos?|negronis?|craft cocktails?)\b/, c: ['cocktails'], f: ['cocktails', 'full_bar'], d: ['margarita', 'cocktail'], t: ['cocktail', 'coctel', 'margarita'], en: 'cocktails', es: 'cócteles', near: 'bar' },
  { k: 'beer', kind: 'food', re: /\b(beers?|craft beers?|brewery|breweries|brewpub|ipa|cervezas?|cerveza artesanal|cerveceria|cervecerias|chelas?|cheves?|micheladas?|caguamas?)\b/, c: ['beer', 'craft_beer'], f: ['craft_beer'], d: ['beer'], t: ['beer', 'cerveza', 'brew'], en: 'beer', es: 'cerveza', near: 'bar' },
  { k: 'tasting', kind: 'food', re: /\b(tasting menus?|set menus?|chefs table|chef s table|prix fixe|menu de degustacion|degustacion|menu fijo|menu del chef)\b/, c: ['tasting_menu'], d: ['tasting menu'], t: ['tasting menu', 'set menu', 'degustacion'], en: 'a tasting menu', es: 'menú de degustación', near: 'fine' },
  { k: 'fine', kind: 'food', re: /\b(fine dining|haute cuisine|gourmet|michelin|alta cocina|cocina de autor|gastronomic[oa]s?)\b/, c: ['fine_dining', 'tasting_menu'], extra: (p, F) => ((F.p || 0) >= 3 ? 2 : 0), en: 'fine dining', es: 'alta cocina' },
  { k: 'farm', kind: 'food', re: /\b(farm to table|farm-to-table|organic|local produce|de la granja|organic[oa]s?|del campo a la mesa)\b/, t: ['farm to table', 'organic', 'organico'], en: 'farm-to-table food', es: 'cocina del campo a la mesa', near: 'garden' },
  // added 19 Nov 2026 from the questions a language model wrote that the reader missed (test/llm/REPORT.md): a topic no place has
  // is said so ("I couldn't find pulque on this site's list") and its nearest topic is offered; none of these adds a fact to a place
  { k: 'pulque', kind: 'food', re: /\b(pulques?|pulquerias?|curados? de \w+)\b/, c: ['pulque'], d: ['pulque', 'curado'], t: ['pulque', 'pulqueria'], en: 'pulque', es: 'pulque', near: 'mezcal' },
  { k: 'spicy', kind: 'food', re: /\b(spicy|spicier|spiciest|really hot food|hot sauces?|picante|picantes|picos[oa]s?|que pique|enchilos[oa]s?|habaneros?|salsa macha)\b/, c: ['spicy'], d: ['habanero', 'salsa macha', 'spicy'], t: ['spicy', 'picante', 'habanero'], en: 'very spicy food', es: 'comida muy picante', near: 'mexican' },
  { k: 'corrida', kind: 'food', re: /\b(comida corrida|comidas corridas|menu del dia|set lunch|lunch specials?|lunch menu)\b/, d: ['comida corrida', 'set lunch', 'menu del dia'], t: ['comida corrida'], en: 'a set lunch (comida corrida)', es: 'comida corrida', near: 'tradmex' },
  { k: 'hangover', kind: 'food', re: /\b(hangover|hung over|hungover|cruda|crudota|crudisima|la cruda|ando crud[oa]|estoy crud[oa])\b/, c: ['birria'], d: ['menudo', 'pozole', 'chilaquiles', 'birria', 'consome'], t: ['menudo', 'pozole', 'chilaquiles', 'birria'], en: 'hangover food (menudo, chilaquiles, birria)', es: 'algo para la cruda (menudo, chilaquiles, birria)', near: 'mexican' },
  // features
  { k: 'view', kind: 'feat', re: /\b(views?|view of|overlook|overlooks|overlooking|panoramic|panorama|vistas?|con vista|panoramica?s?|skyline)\b/, f: ['view', 'sunset'], fs: 3, cat: ['roof'], cs: 2, extra: (p, F) => ((F.f || []).includes('rooftop') ? 2 : 0), en: 'places with a view', es: 'lugares con vista', with: ' with a view', withEs: ' con vista' },
  { k: 'sunset', kind: 'feat', re: /\b(sunsets?|sun set|sundown|golden hour|atardecer(es)?|puesta de sol|puestas de sol|ocaso)\b/, f: ['sunset'], fs: 3, cat: ['roof'], cs: 2, extra: (p, F) => ((F.f || []).some((x) => x === 'view' || x === 'rooftop') ? 2 : 0), en: 'places to watch the sunset', es: 'lugares para ver el atardecer', with: ' to watch the sunset', withEs: ' para ver el atardecer' },
  { k: 'garden', kind: 'feat', re: /\b(gardens?|garden setting|leafy|under the trees|con jardin|en un jardin|jardines|arboles)\b/, f: ['garden'], fs: 3, extra: (p, F) => ((F.f || []).some((x) => x === 'courtyard' || x === 'patio') ? 1 : 0), en: 'places with a garden', es: 'lugares con jardín', with: ' with a garden', withEs: ' con jardín' },
  { k: 'outdoor', kind: 'feat', re: /\b(outdoors?|outside|open air|al fresco|alfresco|patios?|courtyards?|outdoor seating|al aire libre|afuera|exterior)\b/, f: ['patio', 'garden', 'courtyard', 'terrace', 'rooftop'], cat: ['roof'], cs: 2, en: 'places to eat outside', es: 'lugares para comer al aire libre', with: ' to eat outside', withEs: ' para comer al aire libre' },
  { k: 'music', kind: 'feat', re: /\b(live music|live band|live jazz|jazz|concerts?|bands?|musicians?|music|musica en vivo|musica|conciertos?|grupo en vivo|en vivo)\b/, f: ['live_music'], fs: 3, en: 'places with live music', es: 'lugares con música en vivo', with: ' with live music', withEs: ' con música en vivo' },
  { k: 'romantic', kind: 'feat', re: /\b(romantic|romance|date night|a date|on a date|first date|honeymoon|propose|proposal|candlelit|intimate|romantic[oa]s?|una cita|cita romantica|primera cita|luna de miel|pedir matrimonio|intim[oa]s?)\b/, f: ['romantic'], fs: 3, c: ['fine_dining', 'tasting_menu'], extra: (p, F) => ((F.p || 0) >= 3 && (F.f || []).some((x) => ['view', 'garden', 'courtyard', 'rooftop', 'historic_building'].includes(x)) ? 2 : 0), en: 'places for a romantic evening', es: 'lugares para una cita romántica', with: ' for a romantic evening', withEs: ' para una cita romántica' },
  { k: 'occasion', kind: 'feat', re: /\b(special occasion|special night|celebrat\w*|birthday|anniversary|graduation|ocasion especial|celebrar|celebracion|cumpleanos|aniversario|festejar)\b/, f: ['romantic'], fs: 3, c: ['fine_dining', 'tasting_menu'], extra: (p, F) => ((F.p || 0) >= 3 ? 2 : 0), en: 'places for a special occasion', es: 'lugares para una ocasión especial', with: ' for a special occasion', withEs: ' para una ocasión especial' },
  { k: 'kids', kind: 'feat', re: /\b(kids?|children|child|toddlers?|family|families|family friendly|kid friendly|ninos?|ninas?|nenes?|chamac[oa]s?|chamaquit[oa]s?|escuincles?|familia|familiar(es)?|bebes?|infantil)\b/, f: ['kids'], fs: 3, en: 'places that are good with children', es: 'lugares para ir con niños', with: ' that are good with children', withEs: ' para ir con niños' },
  { k: 'dogs', kind: 'feat', re: /\b(dogs?|puppy|pets?|pet friendly|dog friendly|perros?|perritos?|mascotas?|pet friendly)\b/, f: ['dogs'], fs: 3, en: 'places that welcome dogs', es: 'lugares que aceptan perros', with: ' that welcome dogs', withEs: ' que aceptan perros' },
  { k: 'wifi', kind: 'feat', re: /\b(wifi|wi fi|internet|laptop|laptops|to work|work from|remote work|working|study|studying|trabajar|computadora|estudiar|home office)\b/, f: ['wifi'], fs: 3, en: 'places with Wi-Fi', es: 'lugares con wifi', with: ' with Wi-Fi', withEs: ' con wifi' },
  { k: 'groups', kind: 'feat', re: /\b(big group|large group|groups?|party of|a party|many people|lots of people|grupos?|grupo grande|muchas personas|mucha gente)\b/, f: ['groups'], fs: 3, en: 'places for big groups', es: 'lugares para grupos grandes', with: ' for big groups', withEs: ' para grupos grandes' },
  { k: 'historic', kind: 'feat', re: /\b(historic building|historic house|historic|history|colonial|old building|old house|mansion|hacienda|historic[oa]s?|antigua casa|casona|edificio historico)\b/, f: ['historic_building'], fs: 3, extra: (p, F) => ((F.f || []).includes('courtyard') ? 1 : 0), en: 'places in historic buildings', es: 'lugares en edificios históricos', with: ' in a historic building', withEs: ' en un edificio histórico' },
  { k: 'booking', kind: 'feat', re: /\b(reservations?|reserve|book a table|booking|book ahead|reservacion(es)?|reservar|reserva)\b/, f: ['reservations'], fs: 3, en: 'places that take reservations', es: 'lugares que aceptan reservaciones', with: ' that take reservations', withEs: ' que aceptan reservaciones' },
  { k: 'parking', kind: 'feat', re: /\b(parking|park the car|car park|estacionamiento|estacionar|aparcamiento)\b/, f: ['parking'], fs: 3, en: 'places with parking', es: 'lugares con estacionamiento', with: ' with parking', withEs: ' con estacionamiento' },
  { k: 'access', kind: 'feat', re: /\b(wheelchairs?|wheel chair|accessible|accessibility|step free|no steps|without steps|no stairs|without stairs|few stairs|lots of stairs|walkers?|mobility|silla de ruedas|accesible para|acceso para silla|accesibilidad|sin escalones|sin escaleras|pocas escaleras|camina lento|andadera|rampas?)\b/, f: ['wheelchair', 'step_free'], fs: 3, en: 'places that are easy to get into (no steps)', es: 'lugares de fácil acceso (sin escalones)', with: ' with step-free access', withEs: ' de fácil acceso' },
  { k: 'sports', kind: 'feat', re: /\b(watch the game|watch the match|watch soccer|watch football|watch sports|sports bars?|ver el futbol|ver futbol|ver el partido|ver los partidos|partido de futbol|big screens?|pantallas? grandes?)\b/, f: ['tv', 'sports'], fs: 3, en: 'places to watch the game', es: 'lugares para ver el partido', with: ' to watch the game', withEs: ' para ver el partido', near: 'bar' },
  { k: 'quick', kind: 'feat', re: /\b(quick bite|quick meal|quick lunch|something quick|grab and go|in a hurry|fast food|rapido|rapida|de prisa|con prisa|para llevar|takeaway|take away|take out|takeout)\b/, f: ['takeaway', 'counter_seating'], fs: 3, cat: ['street'], cs: 2, en: 'places for a quick bite', es: 'lugares para comer rápido', with: ' for a quick bite', withEs: ' para comer rápido' },
  { k: 'karaoke', kind: 'feat', re: /\b(karaokes?)\b/, f: ['karaoke'], fs: 3, en: 'karaoke', es: 'karaoke', with: ' with karaoke', withEs: ' con karaoke', near: 'music' },
  { k: 'dj', kind: 'feat', re: /\b(dj|djs|deejay)\b/, f: ['dj'], fs: 3, en: 'a DJ', es: 'DJ', with: ' with a DJ', withEs: ' con DJ', near: 'music' },
  { k: 'glutenfree', kind: 'feat', re: /\b(gluten free|gluten-free|no gluten|celiac|coeliac|sin gluten|celiac[oa]s?)\b/, f: ['gluten_free'], fs: 3, en: 'places with gluten-free food', es: 'lugares con opciones sin gluten', with: ' with gluten-free food', withEs: ' con opciones sin gluten' },
];
// Dishes: a place is found by its dishes in facts.js and the words of its description. [words, English, Spanish, topic offered when none has it]
const DISHES = [
  [/\bmoles?\b/, 'mole', 'mole', 'mexican'], [/\benchiladas?\b/, 'enchiladas', 'enchiladas', 'mexican'], [/\bchilaquiles?\b/, 'chilaquiles', 'chilaquiles', 'breakfast'],
  [/\bpozoles?\b/, 'pozole', 'pozole', 'mexican'], [/\b(tamales?|tamal)\b/, 'tamales', 'tamales', 'mexican'], [/\bquesadillas?\b/, 'quesadillas', 'quesadillas', 'mexican'],
  [/\bchiles? en nogada\b/, 'chiles en nogada', 'chiles en nogada', 'mexican'], [/\bchiles? rellenos?\b/, 'chiles rellenos', 'chiles rellenos', 'mexican'],
  [/\b(esquites?|elotes?)\b/, 'esquites', 'esquites', 'street'], [/\bcarnitas\b/, 'carnitas', 'carnitas', 'tacos'], [/\bbarbacoa\b/, 'barbacoa', 'barbacoa', 'tacos'],
  [/\bcochinita( pibil)?\b/, 'cochinita pibil', 'cochinita pibil', 'mexican'], [/\btostadas?\b/, 'tostadas', 'tostadas', 'mexican'], [/\b(sopes?|gorditas?|tlayudas?)\b/, 'antojitos', 'antojitos', 'street'],
  [/\bhuevos rancheros\b/, 'huevos rancheros', 'huevos rancheros', 'breakfast'], [/\b(tortilla soup|sopa de tortilla|sopa azteca)\b/, 'tortilla soup', 'sopa de tortilla', 'mexican'],
  [/\b(pancakes?|hot ?cakes?|panqueques?)\b/, 'pancakes', 'hot cakes', 'breakfast'], [/\bwaffles?\b/, 'waffles', 'waffles', 'breakfast'], [/\b(french toast|pan frances)\b/, 'French toast', 'pan francés', 'breakfast'],
  [/\b(avocado toast|pan con aguacate|tostada de aguacate)\b/, 'avocado toast', 'pan con aguacate', 'breakfast'], [/\bburritos?\b/, 'burritos', 'burritos', 'mexican'],
  [/\b(squash blossoms?|squash flowers?|zucchini flowers?|flor(es)? de calabaza)\b/, 'squash blossoms', 'flor de calabaza', 'mexican'],
  [/\b(handmade tortillas?|fresh tortillas?|fresh pressed tortillas?|homemade tortillas?|tortillas? (hechas )?a mano|tortillas? recien hechas|tortillas? de comal)\b/, 'handmade tortillas', 'tortillas hechas a mano', 'tradmex'],
  [/\b(menudo|pancita|mondongo)\b/, 'menudo', 'menudo', 'mexican'],
  [/\b(crepes?|crepas?)\b/, 'crêpes', 'crepas', 'french'], [/\bchurros?\b/, 'churros', 'churros', 'desserts'], [/\bguacamole\b/, 'guacamole', 'guacamole', 'mexican'],
];
const DISH_WORDS = { 'tortilla soup': ['tortilla soup', 'sopa azteca', 'sopa de tortilla'], pancakes: ['pancake', 'hot cake'], 'French toast': ['french toast'], 'crêpes': ['crepe'], 'avocado toast': ['avocado toast'], antojitos: ['sope', 'gordita', 'tlayuda'], esquites: ['esquites', 'elote'], 'cochinita pibil': ['cochinita'], 'squash blossoms': ['squash blossom', 'flor de calabaza'], 'handmade tortillas': ['handmade tortilla', 'tortillas a mano', 'tortillas hechas a mano'], menudo: ['menudo', 'pancita'] };
for (const [re, en, es, near] of DISHES) {
  const w = DISH_WORDS[en] || [en.replace(/s$/, '').toLowerCase()];
  TOPICS.push({ k: 'dish:' + en, kind: 'food', re, d: w, t: w, en, es, near });
}
export const TOPIC = Object.fromEntries(TOPICS.map((t) => [t.k, t]));
// Words that would also find a narrower topic: the narrower one wins ("fish tacos" is not all tacos and all seafood).
const NARROWER = { vegetarian: ['steak'], vegan: ['steak'], fishtacos: ['tacos', 'seafood'], winelist: ['wine'], winery: ['wine'], sunset: ['view'], croissant: ['bakery'], sicilian: ['italian'], icecream: ['desserts'], romantic: ['occasion'] };
const LIST_NOUNS = /\b(restaurants|places|spots|cafes|bars|options|ones|picks|rooftops|wineries|anywhere|anything|something|somewhere|some|restaurantes|lugares|sitios|opciones|cafeterias|bares|terrazas|terrasas|puestos|vinedos|algo|algun lugar|alguno)\b/;
// at the start of the question only ("Find…", "Can you list…"): inside a yes/no question "list" is more likely a misheard name
const LIST_VERBS = /^\s*(?:please |can you |could you |would you |hey |por favor )?(list|find|suggest|recommend|show me|show|give me|where can|where should|where is there|where are|busca|buscame|encuentra|encuentrame|recomienda|recomiendame|recomiendas|muestrame|dame|lista|donde puedo|donde hay|hay algun|hay algo|que hay|que me recomiendas)\b/;

export function parse(text, pack) {
  let s = ' ' + fold(text).replace(/&/g, ' and ').replace(/[’‘`]/g, "'").replace(/'/g, '').replace(/[^a-z0-9:]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  // Speech to text writes some numbers as words that sound alike: "find for restaurants", "the next to hours".
  if (!/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(s)) s = s.replace(/\b(find|show|give|list|suggest|recommend|me|us) (?:for|fore) (?=(?:good |nice |great |more )?(?:restaurants|places|spots|cafes|bars|options|rooftops)\b)/g, '$1 4 ');
  s = s.replace(/\bnext (?:to|too) (?=(?:hours?|hrs?)\b)/g, 'next 2 ');
  s = s.replace(/ (abre|cierra)(?=[a-z]{5,} )/g, ' $1 ');  // Spanish speech to text runs the verb into an unknown name: "a que hora abrebocaciga"
  const q = { text, s: s.trim(), count: null, window: null, now: false, meal: null, centro: false, area: null, cats: null, collection: null, surprise: false, more: false, tomorrow: false };
  // time: "the next 2 hours", "the next hour", "within half an hour", "now", meals
  let rest = s;
  const tm = /\b(?:in |within |over |during |for )?(?:the )?next (half|\d{1,3}|one|two|three|four|five|six|couple of|couple|few) ?(hours?|hrs?|h|minutes?|mins?)\b/.exec(rest)
    || /\b(?:in |within )?(?:the )?next (half )?(hour)\b/.exec(rest) || /\bwithin (?:an? |one |the )?(half )?(hour)\b/.exec(rest) || /\bin (?:an? |one )?(half )?(hour)\b/.exec(rest);
  // in Spanish: "en las próximas 2 horas", "en la próxima hora", "en los próximos 30 minutos", "en media hora", "en una hora"
  const tmEs = !tm && (/\b(?:en |dentro de )?(?:las |la |los )?proxim[oa]s? (media|\d{1,3}|una|un|dos|tres|cuatro|cinco|seis|par de)? ?(horas?|hrs?|minutos?|mins?)\b/.exec(rest)
    || /\b(?:en |dentro de )(media|una) (hora)\b/.exec(rest));
  if (tm) {
    const unit = tm[2] || '', amount = tm[1] === 'half' || tm[1] === 'half ' ? 0.5 : numOf((tm[1] || 'one').replace(/ of$/, '')) ?? 1;
    q.window = Math.round(/^m/.test(unit) ? amount : amount * 60);
    rest = rest.replace(tm[0], ' ');
  } else if (tmEs) {
    const unit = tmEs[2] || '', amount = tmEs[1] === 'media' ? 0.5 : numOf(tmEs[1] || 'una') ?? 1;
    q.window = Math.round(/^m/.test(unit) ? amount : amount * 60);
    rest = rest.replace(tmEs[0], ' ');
  }
  if (/\b(now|right now|currently|at the moment|open|opened|available|still open)\b/.test(rest)) { q.now = /\b(now|currently|at the moment|still open)\b/.test(rest); if (q.window == null) q.window = SOON; }
  if (/\b(ahora|ahorita|en este momento|abiert[oa]s?|disponibles?|todavia)\b/.test(rest)) { q.now = q.now || /\b(ahora|ahorita|en este momento|todavia)\b/.test(rest); if (q.window == null) q.window = SOON; }
  if (/\bbrunch(es)?\b/.test(rest)) q.meal = 'brunch';  // brunch has its own hours (10:00-14:00), later than breakfast
  else if (/\b(breakfast|morning)\b/.test(rest)) q.meal = 'bfast';
  else if (/\blunch\b/.test(rest)) q.meal = 'lunch';
  else if (/\b(dinner|supper|tonight|this evening)\b/.test(rest)) q.meal = 'dinner';
  else if (/\b(late night|late|after midnight|nightcap)\b/.test(rest)) q.meal = 'late';
  else if (/\b(desayun(o|os|ar)|almuerzo|en la manana|por la manana)\b/.test(rest)) q.meal = 'bfast';  // in Mexico "almuerzo" is a late breakfast
  else if (/\b(almorzar|hora de la comida|para la comida)\b/.test(rest)) q.meal = 'lunch';
  else if (/\b(tarde en la noche|de madrugada|trasnoche|muy tarde)\b/.test(rest)) q.meal = 'late';
  else if (/\b(cena|cenar|esta noche|hoy en la noche|en la noche|de noche)\b/.test(rest)) q.meal = 'dinner';
  if (q.meal && !tm && !tmEs && !q.now) q.window = null;  // "dinner" alone: the dinner hours decide, not the next two hours
  if (q.meal && q.now && q.meal !== 'late') { q.mealNow = q.meal; q.meal = null; }  // "lunch spots open now": what is open now (lunch time may be over)
  q.tonight = /\b(tonight|this evening|esta noche|hoy en la noche|hoy por la noche)\b/.test(rest);
  q.restaurantWord = /\b(restaurants?|restaurantes?|dining|dine|eatery|eateries)\b/.test(rest);
  // count: the first number left once the time is taken out
  const cm = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|par de)\b/.exec(rest);
  if (cm) q.count = Math.max(1, Math.min(MAX_COUNT, numOf(cm[1])));
  // where
  const where = compiled(pack);  // the centre's words, then each area's, in the pack's order
  if (where.centre.test(where.centreNot ? rest.replace(where.centreNot, ' ') : rest)) q.centro = true;  // Whisper often writes "central"
  else { const a = where.areas.find((x) => x.re.test(rest)); if (a) q.area = a.id; }
  // a street ("restaurants on Umarán", "en la calle Mesones"); its words are then not a place's name (Café Umarán)
  const st = findStreet(q.s, where.streets);
  if (st) { q.street = { key: st.key, name: st.name }; q.sNames = st.masked; }
  // what
  const c = new Set();
  if (/\b(coffee|cafes?|bakery|bakeries|pastry|pastries|bread|panaderia|panaderias|cafeterias?|pan dulce|pasteles?|cafecito)\b/.test(rest)) c.add('bfast');
  if (/\b(mexican|mexicanas?|mexicanos?)\b/.test(rest)) c.add('mex');
  if (/\b(tacos?|taqueria|taquerias)\b/.test(rest)) { c.add('mex'); c.add('street'); }
  if (/\bstreet( food)?\b/.test(rest) || /\b(comida callejera|puestos?|antojitos)\b/.test(rest)) c.add('street');
  const roof = /\b(roof ?tops?|roofs?|terraces?|terrace|views?|sunsets?|terra[sz]as?|azoteas|co[nm] ?vista|vistas?|atardecer)\b/.test(rest);
  if (roof) c.add('roof');
  else if (/\b(bars?|drinks?|cocktails?|mezcal|beer|small plates|tapas|bares|tragos?|bebidas?|cocteles?|cocteleria|cervezas?|botanas|copas?|cantinas?)\b/.test(rest)) { c.add('share'); c.add('roof'); }  // "rooftop bars": rooftops
  if (/\b(winery|wineries|vineyards?|wine tasting|wine tastings|vinicolas?|vinedos?|catas? de vino|bodegas?)\b/.test(rest)) c.add('wine');
  if (/\b(world|international|italian|sicilian|sushi|japanese|korean|asian|french|mediterranean|lebanese|peruvian|pizza|ramen|del mundo|internacional|italian[oa]s?|sicilian[oa]s?|japones[a]?|coreana?|asiatica?|frances[a]?|libanesa?|peruana?|mediterranea?)\b/.test(rest)) c.add('world');
  if (c.size) q.cats = [...c];
  q.tomorrow = /\btomorrow\b/.test(rest) || (/\bmanana\b/.test(rest) && !/\b(la|esta|en la|por la|de la) manana\b/.test(rest));  // "mañana": tomorrow, but "la mañana": the morning
  // "near me", "nearby", "closest": sorted by distance from the phone's location (the page asks for it only then)
  q.near = /\b(near me|nearby|near by|near here|close to me|close by|closest|nearest|around me|around here|walking distance|from here|near where i am|close to here)\b/.test(rest)
    || /\b(cerca de mi|acerca de mi|cerca de aqui|aqui cerca|por aqui|mas cercan[oa]s?|cercan[oa]s|cerca de donde estoy)\b/.test(rest);
  q.howFar = /\b(how far|how long to walk|how long a walk|walk to|walking to|distance to)\b/.test(rest)
    || /\b(que tan lejos|a que distancia|que distancia|cuanto se camina|cuanto camino|como llego|como llegar|esta lejos)\b/.test(rest);
  q.collection = (compiled(pack).collections.find((x) => x.re.test(rest)) || {}).id || null;  // a curated list, by its words
  q.surprise = /\b(surprise|surprising|random|randomly|dealers choice|pick for me|up to you|sorprendeme|sorprendame|sorpresa|al azar|lo que sea|elige por mi|escoge por mi|tu eliges)\b/.test(rest);
  q.more = /^\s*(?:(?:show|give|tell|find)(?: me| us)? )?(?:\d+ |one |two |three |four |five |six )?(?:more|others?)(?: please| places| ones)?\s*$/.test(rest) || /\b(what else|any more|next ones|next four|next three|more places|more ones)\b/.test(rest)
    || /^\s*(?:(?:muestrame|dame|ensename|busca) )?(?:\d+ |dos |tres |cuatro |cinco |seis )?(?:mas|otros|otras)(?: por favor| lugares| opciones)?\s*$/.test(rest)
    || /\b(que mas|algo mas|los siguientes|otros cuatro|otros tres|mas lugares|mas opciones)\b/.test(rest);
  q.plural = LIST_NOUNS.test(rest);
  q.listVerb = LIST_VERBS.test(rest);
  q.rest = rest.trim();
  // what it asks for (TOPICS); of two overlapping topics the narrower wins
  let topics = TOPICS.filter((t) => t.re.test(rest)).map((t) => t.k);
  for (const k of [...topics]) for (const wider of NARROWER[k] || []) topics = topics.filter((x) => x !== wider);
  q.topics = topics;
  // price: "cheap eats", "upscale", "the most expensive"
  if (/\b(not (too |very |that |so )?expensive|no (tan |muy )?car[oa]s?|cheap|cheaply|cheaper|cheapest|inexpensive|budget|affordable|bargains?|good value|great value|value for money|low cost|low price|baratos?|baratas?|baratit[oa]s?|economic[oa]s?|buen precio|precios? bajos?|accesibles?)\b/.test(rest)) q.price = 'low';
  else if (/\b(moderate|moderately priced|mid range|midrange|reasonable|reasonably priced|precio medio|precio razonable|precios razonables)\b/.test(rest)) q.price = 'mid';
  else if (/\b(expensive|pricey|priciest|upscale|fancy|fanciest|high end|luxury|luxurious|splurge|swanky|posh|elegant|classy|fine dining|car[oa]s?|elegantes?|de lujo|lujos[oa]s?|exclusiv[oa]s?|fin[oa]s?)\b/.test(rest)) q.price = 'high';
  // a budget in pesos ("traigo como doscientos pesos", "200 pesos for two"): up to 300 a person is cheap, up to 700 middle
  if (!q.price) {
    const PESOS = { cien: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, mil: 1000 };
    const b = /\b(\d{2,5}|cien|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|mil) (pesos|varos|mxn)\b/.exec(rest);
    if (b) {
      const each = (PESOS[b[1]] || Number(b[1])) / (/\b(para|for) (dos|two|2)\b/.test(rest) ? 2 : 1);
      if (each <= 300) q.price = 'low'; else if (each <= 700) q.price = 'mid';
    }
  }
  q.priciest = /\b(most expensive|priciest|fanciest|mas car[oa]s?)\b/.test(rest);
  // "something unique", "hidden gems"; "where do locals eat"; "best" (every place here is a favourite: the answer says so)
  q.unique = /\b(unique|different|unusual|special|hidden gems?|gems?|off the beaten|quirky|interesting|original|one of a kind|secret|unic[oa]s?|diferentes?|especial(es)?|raros?|joyas?|escondid[oa]s?|secretos?|originales?|curios[oa]s?|fuera de lo comun)\b/.test(rest.replace(/\b(special occasion|special night|ocasion especial)\b/g, ' '));
  q.local = /\b(locals|local people|where locals|like a local|local favou?rites?|local food|local places|los locales|la gente de aqui|lugarenos|como (un )?local|como los locales|comen los locales|gente local|comida local)\b/.test(rest);
  q.best = /\b(best|top|favou?rites?|greatest|finest|must try|good|great|nice|quality|recommend\w*|calidad|mejor|mejores|favorit[oa]s?|buen[oa]?s?|recomiend\w*|recomendad[oa]s?|recomendar|imperdibles?)\b/.test(rest.replace(/\b(good|great) (value|price|prices)\b|\bbuen precio\b/g, ' '));
  q.eat = /\b(eat|eats|eating|food|hungry|meal|meals|restaurants?|lunch|dinner|comer|come|comen|comemos|comida|comidas|hambre|restaurantes?|almorzar|cenar|cena|llenan|llenen|llenar|llenarme|llenarnos|quedar llenos|full meal|filling)\b/.test(rest);  // a meal, not an ice cream or a coffee
  // a day of the week ("open on Mondays", "brunch on Sunday", "el sábado"); the weekend is Saturday
  const dm = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/.exec(rest);
  q.dayIdx = dm ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].indexOf(dm[1]) % 7
    : /\b(weekend|fin de semana|finde)\b/.test(rest) ? 5 : null;
  if ((q.dayIdx != null || q.tomorrow) && !tm && !tmEs && !q.now) q.window = null;  // "open on Monday": all of Monday, not the next two hours
  if (/\b(hungry|starving|hambre|hambrient[oa]s?)\b/.test(rest) && q.window == null && !q.meal && q.dayIdx == null && !q.tomorrow) { q.now = true; q.window = SOON; }  // "I'm hungry": somewhere to eat, open now
  q.exists = /^(is there|are there|any|do you have|do you know|hay|tienes|conoces|existe)\b/.test(q.s);
  q.nearWord = /\b(near|nearby|close to|by the|next to|around the|beside|cerca de|cerca del|junto a|junto al|alrededor de|alrededor del|al lado de|al lado del)\b/.test(rest);
  return q;
}

// The day a question names, in days from today: "tomorrow" 1, "on Sunday" 0-6; null when it names none.
export const dayOff = (q, n) => (q.tomorrow ? 1 : q.dayIdx != null ? (q.dayIdx - n.d + 7) % 7 : null);

// A meal without a day (Lars, 18 Nov 2026: "Need to understand 'tonight' and 'for lunch' 'breakfast' and 'open now'"): today's meal hours
// until they end (the "When?" menu's: breakfast 8:00-10:30, lunch 13:00-16:00, dinner 19:30-21:30); up to two hours after them, what is
// open now, for a late breakfast, lunch or dinner; after that, tomorrow's. "Tonight" after the dinner hours, or after midnight, is what
// is open now. ("Open now" = open now or opening within two hours, Lars's "open now (next 2 hrs)"; a late meal: within half an hour.)
export const LATE_AFTER = 120, LATE_WINDOW = 30;
export function resolveTime(q, n, MEALS, pack) {
  if (dayOff(q, n) != null) return;
  const late = (k) => { q.lateMeal = k; q.meal = null; q.now = true; q.window = LATE_WINDOW; };
  if (q.tonight && (!q.meal || q.meal === 'dinner') && (n.m > MEALS.dinner.win[1] || n.m < 300)) return late('tonight');
  if (!q.meal || !MEALS[q.meal] || q.meal === 'late' || (q.area && q.area === compiled(pack).outOfTown)) return;  // out of town: a drive away, not "now"
  const end = MEALS[q.meal].win[1];
  if (n.m > end && n.m <= end + LATE_AFTER) late(q.meal);
}


// The reader for a list of places: the words, the place they name, the meal's time.
export function createReader({ places, MEALS, pack }) {
  const isSight = (p) => p.cat === 'sights';
  // The place a question names, if any: {p, score, at, span}; and the names closest to its words, for "Did you mean …?".
  const keys = places.map((p) => {
    const list = [[p.name, !!p.exactName]];
    const short = fold(p.name).replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w && !NAME_STOP.has(w)).join(' ');
    if (!p.noShort && short && short !== fold(p.name)) list.push([short, false]);
    for (const a of p.names || []) list.push([a.t, !!a.exact]);  // the pack lists other names first, then exact-only ones
    return { p, keys: list.map(([k, exact]) => {
      const snd = sound(k), skel = skeleton(snd);
      return { words: fold(k).split(/[^a-z0-9]+/).filter(Boolean), snd, skel, exact, sc: letterCounts(snd), kc: letterCounts(skel) };
    }) };
  });
  function matchPlace(q) {
    const tok = maskNumberTimes(maskAreaNames(pack, q.sNames || q.s)).split(' ').filter(Boolean);
    // The sound of each run of the question's words, made once per question, not once per name (19 Nov 2026: 5,000 places).
    const runs = new Map();
    const run = (i, len) => {
      const at = i * 64 + len;
      let r = runs.get(at);
      if (!r) { const w = sound(tok.slice(i, i + len).join('')), ws = skeleton(w); r = { w, ws, wc: letterCounts(w), wsc: letterCounts(ws) }; runs.set(at, r); }
      return r;
    };
    let best = null;
    near.clear();
    for (const { p, keys: ks } of keys) {
      for (const k of ks) {
        const n = k.words.length;
        if (!n) continue;
        for (let len = Math.max(1, n - 1); len <= n + 1; len++) {
          for (let i = 0; i + len <= tok.length; i++) {
            const win = tok.slice(i, i + len);
            if (win.includes('§')) continue;
            let score, skel = false;
            if (k.exact) score = win.join(' ') === k.words.join(' ') ? 1 : 0;
            else {
              const r = run(i, len), w = r.w;
              if (Math.abs(w.length - k.snd.length) > 3) continue;
              // No hope: even the letters alone differ too much for 0.5, the lowest score anything here uses (the names, "Did you
              // mean", the consonant match). Letter counts bound the edit distance from below, so skipping changes no answer.
              if (1 - bagDistance(r.wc, k.sc) / Math.max(w.length, k.snd.length) < 0.5
                && (k.skel.length < 3 || isSight(p) || 0.9 * (1 - bagDistance(r.wsc, k.kc) / Math.max(r.ws.length, k.skel.length)) < 0.5)) continue;
              score = 1 - lev(w, k.snd) / Math.max(w.length, k.snd.length);
              if (score < need(k.snd.length) && k.skel.length >= 3 && skeleton(w) === k.skel && score >= (k.skel.length >= 4 ? 0.5 : 0.6)) { score = SKELETON; skel = true; }
            }
            if (!k.exact && !isSight(p)) {  // for "Did you mean …?": the letters, or the consonants, closest to the words heard
              const ws = run(i, len).ws, sk = k.skel.length >= 3 ? 0.9 * (1 - lev(ws, k.skel) / Math.max(ws.length, k.skel.length)) : 0;
              const close = Math.max(score, sk);
              if (close > (near.get(p.id) || 0)) near.set(p.id, close);
            }
            // (a letter score of exactly 0.8 is not a consonant match: "makes" is not Jacques, 18 Nov 2026)
            if ((score >= need(k.snd.length) || skel)
              && (!best || score > best.score || (score === best.score && k.snd.length > best.len))) best = { p, score, len: k.snd.length, at: i, span: len };
          }
        }
      }
    }
    lastNear = [...near.entries()].filter(([, s]) => s >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    return best;
  }
  let lastNear = [];  // the names closest to the last question's words, best first: "Did you mean …?"
  const near = new Map();

  // The question's words become the request.
  function read(text, n) {
    const q = parse(text, pack);
    if (!q.more) resolveTime(q, n, MEALS, pack);
    let hit = matchPlace(q);
    q.nearNames = lastNear;
    // a number inside a name ("Is Cien 24 open?") is not a count of places
    if (hit && q.count != null && q.s.split(' ').filter(Boolean).slice(hit.at, hit.at + hit.span).some((w) => numOf(w) != null)) q.count = null;
    // one place when one is named, unless the question asks for several ("find 4 restaurants near the Jardín")
    q.wantsList = (q.count || 0) > 1 || q.plural || q.susan || q.surprise || (q.listVerb && !(hit && hit.score >= 0.9));
    // the question asks for kinds of places, not one place: a cuisine, a dish, a feature, a price, a meal, "is there…"
    q.asks = q.topics.length > 0 || !!q.price || q.unique || q.local || !!q.meal || q.exists || q.eat;
    // a sight with kinds of places: "lunch near the Parroquia" (nearest first); "a view of the Parroquia" (not the sight itself)
    if (hit && isSight(hit.p) && (q.asks || q.nearWord || q.wantsList)) { if (q.nearWord) q.nearSight = hit.p.id; hit = null; }
    q.named = hit ? { id: hit.p.id, score: hit.score } : null;
    return q;
  }
  return { read, matchPlace };
}

// The parts of a request that are set, for tests and for reading by eye.
export function requestOf(q) {
  const keep = (o) => { const r = Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== false && v !== '' && !(Array.isArray(v) && !v.length))); return Object.keys(r).length ? r : null; };
  return keep({
    place: q.named ? q.named.id : null, list: q.wantsList, what: q.topics, kinds: q.cats,
    where: keep({ centro: q.centro, area: q.area, street: q.street ? q.street.key : null, nearMe: q.near, nearSight: q.nearSight, howFar: q.howFar }),
    when: keep({ now: q.now, window: q.window, meal: q.meal, mealNow: q.mealNow, lateMeal: q.lateMeal, tonight: q.tonight, day: q.dayIdx, tomorrow: q.tomorrow }),
    price: q.price, priciest: q.priciest, unique: q.unique, local: q.local, best: q.best, collection: q.collection, surprise: q.surprise,
    eat: q.eat, restaurant: q.restaurantWord, exists: q.exists, count: q.count, more: q.more,
  }) || {};
}
