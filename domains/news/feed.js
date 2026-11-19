// An RSS 2.0 feed read into stories (plan step B12), without a DOM parser, so it runs in a page, a worker or Node alike.
// Each story: {id, title, link, summary, body, score, categories, source, date}. A feed whose items carry no pubDate has no
// story dates at all (hasDates: false): then "latest" cannot be answered honestly, only "top-ranked", and the news domain says so.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m));
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? decode(m[1]).trim() : ""; };
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => decode(m[1]).trim());
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function parseFeed(xml) {
  const channel = tag(xml, "channel") ? xml : "";
  const head = channel.split(/<item[\s>]/i)[0];
  const built = tag(head, "lastBuildDate") || tag(head, "pubDate") || null;
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m, i) => {
    const x = m[1];
    const date = tag(x, "pubDate") || tag(x, "dc:date") || null;
    return {
      id: tag(x, "guid") || tag(x, "link") || String(i + 1),
      n: i + 1,
      title: tag(x, "title"),
      link: tag(x, "link"),
      summary: plain(tag(x, "description")),
      body: plain(tag(x, "content:encoded")),
      score: Number(tag(x, "score")) || null,
      categories: tags(x, "category").flatMap((c) => c.split(/\s*,\s*/)).filter(Boolean),
      source: tag(x, "source") || null,
      date: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    };
  });
  return { title: tag(head, "title"), built: built && !Number.isNaN(Date.parse(built)) ? new Date(built).toISOString() : null, items, hasDates: items.some((s) => s.date) };
}
