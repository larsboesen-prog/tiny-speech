// A small static server for the browser tests: the two sites' original files (as they were served on 18 Nov 2026) at /page40/
// and /page5/, the shared core at /tiny-speech/, and the harness page. Every request is counted in `hits` (path -> count).
// `dizione` replaces the stand-in tinyvoca/dizione.zip with real bytes (the live test serves the real one).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize } from "node:path";
import { fakeResponse } from "./fakes.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MOUNTS = [
  ["/page40/", join(ROOT, "test/fixtures/before/credbrief-page40")],
  ["/page5/", join(ROOT, "test/fixtures/before/mapsma-page5")],
  ["/tiny-speech/", join(ROOT, "browser")],
  ["/harness/", join(ROOT, "test/harness")],
  ["/packs/", join(ROOT, "packs/dist")],
  ["/core/", join(ROOT, "core")],
  ["/domains/", join(ROOT, "domains")],
  ["/lang/", join(ROOT, "lang")],
  ["/engines/", join(ROOT, "engines")],
  ["/vendor/", join(ROOT, "vendor")],
  ["/training/", join(ROOT, "training")],
  ["/apps/", join(ROOT, "apps")],
];
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json", ".wav": "audio/wav" };

// Stand-in for each site's tinyvoca/dizione.zip (the phonemizer's source); the fake Pyodide only records its size.
const DIZIONE = Buffer.from("PK\u0003\u0004 stand-in for dizione 8cd889e");

// `requests`: every request that reached this server, with its method and how many bytes it carried (plan step B13: no audio in
// any request). `leaks`: requests a browser sent through this server as its proxy, i.e. meant for another host (a test that
// launches Chromium with this server as its proxy sees every attempt to leave the test origin here, even from a worker).
export function startServer({ dizione = DIZIONE } = {}) {
  const hits = {}, requests = [], leaks = [];
  const server = createServer(async (req, res) => {
    if (/^https?:\/\//.test(req.url)) { leaks.push(req.method + " " + req.url); res.writeHead(403); return res.end(); }
    let bytes = 0;
    req.on("data", (chunk) => { bytes += chunk.length; });
    await new Promise((resolve) => req.on("end", resolve));
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    requests.push({ method: req.method, path, bytes, url: req.url });
    hits[path] = (hits[path] || 0) + 1;
    if (path.startsWith("/mirror/")) {  // a site serving its own copies of the libraries (here: the stand-ins)
      const fake = fakeResponse("https://" + path.slice("/mirror/".length).replace(/(@\d[\w.-]*)\/index\.js$/, "$1"));  // a package's own file
      res.writeHead(fake.status, { "content-type": fake.contentType });
      return res.end(fake.body);
    }
    if (path === "/corrupt/tiny-voca-js.gguf") {  // the voice file with one byte changed (a route would stop module workers starting)
      const bytes = await readFile(join(ROOT, "vendor/tiny-voca/tiny-voca-js.gguf"));
      bytes[bytes.length - 100] ^= 0xff;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length });
      return res.end(bytes);
    }
    if (path.endsWith("/tinyvoca/dizione.zip")) {
      res.writeHead(200, { "content-type": "application/zip", "content-length": dizione.length });
      return res.end(dizione);
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
  server.on("connect", (req, socket) => { leaks.push("CONNECT " + req.url); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });  // https, through the proxy
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, hits, requests, leaks })));
}
