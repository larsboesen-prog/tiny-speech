// A city pack as the code uses it: the manifest's settings, base.json's places, areas, collections and lexicon, and live.json's
// hours and music nights, in one object. Files are checked against the manifest's SHA-256 before they are used (a browser does this with
// crypto.subtle; Node with node:crypto), so a half-downloaded or altered file is never read as a city.

/** Join the three parts of a pack (already parsed). */
export function assemble(manifest, base, live) {
  if (base.id !== manifest.id || live.id !== manifest.id) throw new Error(`pack files are not all for ${manifest.id}`);
  return { ...manifest, places: base.places, areas: base.areas, collections: base.collections || [], lexicon: base.lexicon || {}, hours: live.hours, music: live.music || {} };
}

/** Check a file's text against its manifest entry; `sha256` is (text) => hex digest (sync or async). */
export async function checked(text, entry, sha256) {
  const digest = await sha256(text);
  if (digest !== entry.sha256) throw new Error(`${entry.path}: SHA-256 does not match the manifest`);
  return JSON.parse(text);
}
