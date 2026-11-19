// Spanish language pack (plan step B6): days, numbers and clock times, said and read, for every variety; what differs by country
// is in its variety table (mx.json first). sayTimeEs, sayNumEs, aTimeEs and showTimeEs are MapSMA's (ask.js, 17–18 Nov 2026),
// moved here unchanged; readClock is new. Rule (review 3.2): understand every variety's way of saying it, speak the local one.
import { fold } from "../../core/text/sound.js";
import { clock } from "../en/index.js";

export const code = "es";
export const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const NUM_ES = ["ningún", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
export const sayNumEs = (n, fem) => (n === 1 ? (fem ? "una" : "un") : NUM_ES[n] || String(n));
// A time as the phone's Spanish voice says it: "la medianoche", "el mediodía", "la 1 de la tarde", "las 10 y media de la noche".
export function sayTimeEs(m) {
  m = ((m % 1440) + 1440) % 1440;
  if (m === 0) return "la medianoche";
  if (m === 720) return "el mediodía";
  const h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12;
  const part = h < 1 ? "de la noche" : h < 6 ? "de la madrugada" : h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";  // 0:30 is still "de la noche"
  const mins = mm === 0 ? "" : mm === 30 ? " y media" : mm === 15 ? " y cuarto" : ` y ${mm}`;
  return `${h12 === 1 ? "la" : "las"} ${h12}${mins} ${part}`;
}
export const aTimeEs = (m) => { const t = sayTimeEs(m); return t.startsWith("el ") ? "al " + t.slice(3) : "a " + t; };  // "a la 1 de la tarde", "al mediodía"
// On screen: "las 22:00", "la 1:00", "la medianoche".
export const showTimeEs = (m) => { m = ((m % 1440) + 1440) % 1440; if (m === 0) return "la medianoche"; const c = clock(m); return (/^1:/.test(c) ? "la " : "las ") + c; };

const UNITS = { cero: 0, una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50 };
const HOUR = "(\\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
const MINS = "(media|cuarto|\\d{1,2}|veinte|veinticinco|diez|cinco|quince|treinta|cuarenta|cincuenta|treinta y \\w+|cuarenta y \\w+|cincuenta y \\w+|veinti\\w+)";

/** A number said in Spanish (digits or words up to 59): "veinticinco", "treinta y dos", "45". */
export function numberOf(s) {
  s = String(s).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s in UNITS) return UNITS[s];
  const m = /^(treinta|cuarenta|cincuenta)(?: y (\w+))?$/.exec(s);
  if (m) return TENS[m[1]] + (m[2] ? UNITS[m[2]] ?? NaN : 0);
  return NaN;
}
const minutesOf = (w) => (w === "media" ? 30 : w === "cuarto" ? 15 : numberOf(w));

/**
 * A clock time in a question, in any variety: "a las nueve", "las 9 y media", "a la una", "cuarto para las nueve" (Mexico: 8:45),
 * "diez para las nueve" (8:50), "nueve menos cuarto" (Spain: 8:45), "las diez de la noche", "al mediodía", "a medianoche".
 * Returns {m, sure} or null; without "de la mañana / tarde / noche" a 12-hour time comes back as said (sure: false).
 */
export function readClock(text) {
  const s = " " + fold(text).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (/ (mediodia|medio dia) /.test(s)) return { m: 720, sure: true };
  if (/ (medianoche|media noche) /.test(s) || / las doce de la noche /.test(s)) return { m: 0, sure: true };
  const part = / de la (manana|madrugada) /.test(s) ? "am" : / (de la (tarde|noche)|en la noche|esta noche|por la noche) /.test(s) ? "pm" : null;
  let h = null, mm = 0, m;
  if ((m = new RegExp(` (?:un )?(cuarto|${MINS})(?: minutos)? para (?:la|las) ${HOUR} `).exec(s))) {  // "cuarto para las nueve": 8:45
    const before = minutesOf(m[1]);
    h = numberOf(m[m.length - 1]) - 1; mm = 60 - before;
    if (h === 0) h = 12;
  } else if ((m = new RegExp(` (?:la |las )?${HOUR} menos (cuarto|${MINS}) `).exec(s))) {  // "las nueve menos cuarto": 8:45
    h = numberOf(m[1]) - 1; mm = 60 - minutesOf(m[2]);
    if (h === 0) h = 12;
  } else if ((m = / (\d{1,2}):(\d{2}) /.exec(s))) {
    h = +m[1]; mm = +m[2];
  } else if ((m = new RegExp(` (?:a |para |hacia |como a |desde |hasta |antes de |despues de )?(?:la|las) ${HOUR}(?: y ${MINS})?(?: en punto)? `).exec(s))) {
    h = numberOf(m[1]); mm = m[2] ? minutesOf(m[2]) : 0;
  }
  if (h == null || !Number.isFinite(h) || !Number.isFinite(mm) || h > 24 || mm > 59) return null;
  if (h > 12 || h === 0) return { m: (h % 24) * 60 + mm, sure: true };
  if (part === "am") return { m: (h % 12) * 60 + mm, sure: true };
  if (part === "pm") return { m: (h === 12 && / (de la|en la|por la|esta) noche /.test(s) ? 0 : (h % 12) + 12) * 60 + mm, sure: true };  // "las 12 y media de la noche": 0:30
  return { m: h * 60 + mm, sure: false };
}
