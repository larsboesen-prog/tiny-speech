// English language pack (plan step B6): days, numbers and clock times, said and read. No city here (D6).
// sayTime, sayNum and clock are MapSMA's (ask.js, 17–18 Nov 2026), moved here unchanged; readClock is new.
import { fold } from "../../core/text/sound.js";

export const code = "en";
export const DAYNAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// A time as the cards show it (22:00, 1:00) and as the voice says it (10 p.m., 1 a.m., noon, midnight).
export const clock = (m) => { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); };
export function sayTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  const h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12, ap = h < 12 ? "a.m." : "p.m.";
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ap}` : `${h12} ${ap}`;
}
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const sayNum = (n) => WORDS[n] || String(n);

const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const MIN = "(\\d{1,2}|o \\w+|oh \\w+|fifteen|thirty|forty five|forty|twenty|twenty \\w+|ten|five|fifty|fifty \\w+|thirty \\w+|forty \\w+)";

/** A number said in English (digits or words up to 59): "twenty five", "45". */
export function numberOf(s) {
  s = String(s).trim().replace(/^(o|oh) /, "");
  if (/^\d+$/.test(s)) return Number(s);
  if (s in UNITS) return UNITS[s];
  const [a, b] = s.split(" ");
  if (a in TENS) return TENS[a] + (b ? UNITS[b] ?? NaN : 0);
  return NaN;
}

/**
 * A clock time in a question: "at 9", "9:30 pm", "nine thirty", "half past nine", "quarter to nine", "ten to nine", "noon".
 * Returns {m: minutes after midnight, sure: false when a.m. or p.m. is not said} or null. 12-hour times without a.m./p.m.
 * come back as said (9 → 9:00) for the caller to place in the day.
 */
export function readClock(text) {
  const s = " " + fold(text).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (/ (noon|midday) /.test(s)) return { m: 720, sure: true };
  if (/ midnight /.test(s)) return { m: 0, sure: true };
  // a.m. / p.m. only right after a number ("I am hungry" is not the morning)
  const N = "(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|thirty|forty|fifty|o ?clock)";
  const part = new RegExp(`${N} ?a ?m | (in the morning|this morning) `).test(s) ? "am"
    : new RegExp(`${N} ?p ?m | (in the (afternoon|evening)|at night|tonight|this (afternoon|evening)) `).test(s) ? "pm" : null;
  let h = null, mm = 0, m;
  if ((m = new RegExp(` (half|a quarter|quarter|${MIN}) (past|after) ${NUM} `).exec(s))) {
    mm = /half/.test(m[1]) ? 30 : /quarter/.test(m[1]) ? 15 : numberOf(m[1]);
    h = numberOf(m[m.length - 1]);
  } else if ((m = new RegExp(` (a quarter|quarter|${MIN}) (to|till|before|of) ${NUM} `).exec(s))) {
    const before = /quarter/.test(m[1]) ? 15 : numberOf(m[1]);
    h = numberOf(m[m.length - 1]) - 1;
    mm = 60 - before;
    if (h === 0) h = 12;
  } else if ((m = / (\d{1,2}):(\d{2}) /.exec(s))) {
    h = +m[1]; mm = +m[2];
  } else if ((m = new RegExp(` (?:at|by|around|about|from|until|till|after|before)? ?${NUM}(?: oclock| o clock)? (${MIN} )?(?=a ?m |p ?m |oclock |o clock |in the |at night |tonight |this )`).exec(s))
    || (m = new RegExp(` (?:at|by|around|about|from|until|till|after|before) ${NUM}(?: oclock| o clock)?(?: ${MIN})? `).exec(s))) {
    h = numberOf(m[1]); mm = m[2] ? numberOf(m[2].trim()) : 0;
  }
  if (h == null || !Number.isFinite(h) || !Number.isFinite(mm) || h > 24 || mm > 59) return null;
  if (h > 12 || h === 0) return { m: (h % 24) * 60 + mm, sure: true };
  if (part === "am") return { m: (h % 12) * 60 + mm, sure: true };
  if (part === "pm") return { m: ((h % 12) + 12) * 60 + mm, sure: true };
  return { m: h * 60 + mm, sure: false };
}
