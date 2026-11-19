// Matching a spoken name by sound. From MapSMA's read.js (17–18 Nov 2026), unchanged, so any city's names are compared the
// same way: speech to text writes Spanish names as it hears them ("Boca Ciega", "Yerba Santa", "La Sotea"), so names are
// compared by a rough sound-alike key, letter by letter, with a little room for error in long names and none in short ones.

export const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function sound(s) {
  return fold(s).replace(/[^a-z0-9]+/g, "")
    .replace(/ph/g, "f").replace(/qu/g, "k").replace(/ch/g, "§").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/§/g, "ch")
    .replace(/z/g, "s").replace(/v/g, "b").replace(/ll/g, "y").replace(/y/g, "i").replace(/x/g, "j").replace(/j/g, "h").replace(/(^|[^c])h/g, "$1")
    .replace(/w/g, "u").replace(/(.)\1+/g, "$1");
}

export function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** How alike a heard name must be: short names exactly. */
export const need = (len) => (len <= 4 ? 1 : len <= 7 ? 0.85 : 0.78);

// Speech to text keeps a name's consonants better than its vowels ("La Zotay it" for La Azotea, "Tastavir" for Tostévere): a heard
// name with the same consonants in the same order, and about half its letters right, counts too (score SKELETON).
export const skeleton = (snd) => snd.replace(/[aeiou]/g, "").replace(/(.)\1+/g, "$1");
export const SKELETON = 0.8;

/** How alike two names sound, 0..1 (1 = the same sound key). */
export const alike = (a, b) => {
  const x = sound(a), y = sound(b);
  return x === y ? 1 : 1 - lev(x, y) / Math.max(x.length, y.length, 1);
};
