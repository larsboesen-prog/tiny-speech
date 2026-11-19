// A generated large city for timing (plan step B4): n made-up places with made-up names in a made-up town's settings.
// Deterministic: the same n gives the same city every time.
import { readFileSync } from "node:fs";

const SYL = ["ca", "sa", "ma", "lo", "ri", "ta", "no", "ve", "do", "mi", "ra", "le", "pa", "zu", "co", "ga", "be", "ti", "na", "fe", "chi", "llo", "rro", "que"];
const FIRST = ["Café", "Casa", "La", "El", "Bar", "Taquería", "Fonda", "Terraza", "Cocina", "Mercado", "Panadería", "Restaurante", "Tacos", "Pizzería", ""];
const KINDS = ["bfast", "mex", "world", "street", "share", "roof"];
const CUISINES = ["coffee", "bakery", "tacos", "pizza", "italian", "sushi", "seafood", "vegetarian", "cocktails", "mezcal", "burgers", "ramen"];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A pack object (as core/pack/assemble.js makes) with n places, built on the test town's settings. */
export function bigCity(n, root = new URL("../", import.meta.url)) {
  const r = rng(n);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const word = () => { const k = 2 + Math.floor(r() * 2); let w = ""; for (let i = 0; i < k; i++) w += pick(SYL); return w[0].toUpperCase() + w.slice(1); };
  const city = JSON.parse(readFileSync(new URL("packs/src/xx-test/city.json", root), "utf8"));
  const areas = JSON.parse(readFileSync(new URL("packs/src/xx-test/areas.json", root), "utf8"));
  const places = [{ id: "T-S1", name: "Plaza Mayor de Villa Ejemplo", kind: "sights", lat: 0.5, lng: -80.5, area: "Casco antiguo", photo: true, names: [{ t: "plaza mayor" }] }];
  const hours = {};
  const used = new Set();
  for (let i = 1; i < n; i++) {
    let name;
    do { name = [pick(FIRST), word(), r() < 0.4 ? word() : ""].filter(Boolean).join(" "); } while (used.has(name));
    used.add(name);
    const id = "B" + i;
    places.push({ id, name, kind: pick(KINDS), lat: 0.45 + r() * 0.1, lng: -80.56 + r() * 0.12, area: pick(["Casco antiguo", "Barrio Alto", "La Ribera"]), photo: true,
      facts: { c: [pick(CUISINES), pick(CUISINES)], p: 1 + Math.floor(r() * 3) } });
    const open = 6 + Math.floor(r() * 8), close = open + 6 + Math.floor(r() * 10);
    hours[id] = { h: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), r() < 0.1 ? null : `${open}:00–${close % 24}:${r() < 0.5 ? "00" : "30"}`])) };
  }
  return { ...city, places, areas, collections: [], lexicon: {}, hours };
}
