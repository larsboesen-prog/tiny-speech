// Text language ID for English vs (Mexican) Spanish.
// Used for typed input, Web Speech transcripts, and as one feature in the acoustic race.
// It is deliberately tiny: function words, domain words and spelling cues.

import { fold, normalize } from "../text/normalize.js";

const ES_WORDS = `de la que el en y los las del se por un una para con no es lo como mas pero sus le ya este
esta estos estas entre cuando muy sin sobre tambien me hay donde quien desde todo nos durante uno les ni
contra otros ese eso ante ellos esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho
quienes nada muchos cual poco ella estar estas algunas algo nosotros tu te ti tus ellas nosotras vosotros
qué dónde cuál cuándo cómo cuánto quiero dame dime pon ponme lee leeme leela busca buscame encuentra
muestrame enseñame abierto abierta abiertos abiertas cerrado noticias noticia titulares nota notas
siguiente anterior ahorita ahora noche hoy mañana tarde cerca cerquita comida comer cenar desayunar
restaurante restaurantes lugar lugares algun alguno alguna hay sobre acerca pausa sigue continua repite
otra vez para detente callate ayuda puedes habla español ingles mande barato barata caro cara mejor
mejores japonesa japones mariscos tacos taqueria pozole birria tortas cafe cafeteria pan panaderia
abren cierran abre cierra hora horas horario hasta mas despacio rapido fuerte bajo volumen primero
primera segundo segunda tercero tercera ultimo ultima deportes politica economia negocios tecnologia
ciencia salud mundo espectaculos buscame quiero tengo hambre algo rico donde puedo`;

const EN_WORDS = `the of and to in is it you that he was for on are with as i his they be at one have this from
or had by what where which open tonight now news find search play read next previous stop show me near any
some places place food want latest about headlines story stories article articles tell more less again
help can could would will please cheap expensive best good nearby close closes opens until time hours
breakfast lunch dinner late morning evening today tomorrow first second third last skip back pause resume
continue repeat louder softer slower faster speak spanish english sushi tacos pizza coffee burgers ramen
seafood japanese mexican italian chinese thai korean indian vegetarian vegan restaurant restaurants eat
there their them those these then than how who when why does do did is are was were has been being
any anything something hungry get give want need looking whats`;

const ES_SET = new Set(fold(ES_WORDS).split(/\s+/));
const EN_SET = new Set(fold(EN_WORDS).split(/\s+/));
// Words in both lists (me, no, a, ...) are not evidence either way.
for (const word of [...ES_SET]) if (EN_SET.has(word)) { ES_SET.delete(word); EN_SET.delete(word); }
for (const word of ["a", "no", "me", "sushi", "tacos", "pizza", "hotdog", "bar"]) { ES_SET.delete(word); EN_SET.delete(word); }

const ES_SUFFIX = /(cion|ciones|dad|dades|mente|ado|ada|ados|adas|ido|ida|idos|idas|ito|ita|itos|itas|ería|eria|aria)$/;
const EN_SUFFIX = /(ing|tion|tions|ly|ed|ness|ful|ght|th)$/;

/**
 * Score a text for English vs Spanish.
 * @returns {{lang: "en"|"es"|null, en: number, es: number, confidence: number}}
 */
export function detectTextLanguage(text) {
  const raw = String(text ?? "");
  const words = normalize(raw).split(" ").filter(Boolean);
  let en = 0, es = 0;
  if (/[ñ¿¡]/i.test(raw)) es += 2;
  if (/[áéíóú]/i.test(raw)) es += 1;
  for (const word of words) {
    if (ES_SET.has(word)) es += 1;
    else if (EN_SET.has(word)) en += 1;
    else if (word.length > 4 && ES_SUFFIX.test(word)) es += 0.5;
    else if (word.length > 4 && EN_SUFFIX.test(word)) en += 0.5;
    if (/^(th|wh|sh)|w|k|y$/.test(word) && !/^(ya|y|hoy|muy|hay|soy|voy|doy|estoy)$/.test(word)) en += 0.25;
  }
  const total = en + es;
  if (total === 0) return { lang: null, en: 0, es: 0, confidence: 0 };
  const lang = es > en ? "es" : en > es ? "en" : null;
  return { lang, en, es, confidence: Math.abs(es - en) / (total + 1) };
}

/** Fraction of a hypothesis' words that are known words of the given language. */
export function lexicalFit(text, lang, extra = null) {
  const words = normalize(text).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const own = lang === "es" ? ES_SET : EN_SET;
  let hits = 0;
  for (const word of words) if (own.has(word) || extra?.has(word)) hits += 1;
  return hits / words.length;
}
