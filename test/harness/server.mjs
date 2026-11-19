// A small static server for the browser tests: the two sites' original files (as they were served on 18 Nov 2026) at /page40/
// and /page5/, the shared core at /tiny-speech/, and the harness page. Every request is counted in `hits` (path -> count).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MOUNTS = [
  ["/page40/", join(ROOT, "test/fixtures/before/credbrief-page40")],
  ["/page5/", join(ROOT, "test/fixtures/before/mapsma-page5")],
  ["/tiny-speech/", join(ROOT, "browser")],
  ["/harness/", join(ROOT, "test/harness")],
];
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json", ".wav": "audio/wav" };

// Stand-in for each site's tinyvoca/dizione.zip (the phonemizer's source); the fake Pyodide only records its size.
const DIZIONE = Buffer.from("PK\u0003\u0004 stand-in for dizione 8cd889e");

export function startServer() {
  const hits = {};
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    hits[path] = (hits[path] || 0) + 1;
    if (path.endsWith("/tinyvoca/dizione.zip")) {
      res.writeHead(200, { "content-type": "application/zip", "content-length": DIZIONE.length });
      return res.end(DIZIONE);
    }
    const mount = MOUNTS.find(([prefix]) => path.startsWith(prefix));
    const file = mount && normalize(join(mount[1], path.slice(mount[0].length)));
    if (!file || !file.startsWith(mount[1])) { res.writeHead(404); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, hits })));
}
