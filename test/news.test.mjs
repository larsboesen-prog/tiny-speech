// Plan step B12: the news domain on the repository's own feed.xml (71 ranked stories, no story dates): search titles, read one,
// next, stop, the hand-off of a real question to the site's server, and an honest "latest".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFeed } from "../domains/news/feed.js";
import { createNews } from "../domains/news/index.js";

const feed = parseFeed(readFileSync(new URL("../../feed.xml", import.meta.url), "utf8"));
const news = createNews(feed, { handoff: "CredBrief" });
const said = (a) => a.say.map((s) => s.text).join(" ");
const talk = (questions) => { let state = null; return questions.map((q) => { const a = news.answer(q, state); state = a.state; return a; }); };

test("the feed: 71 stories with titles, scores, categories and bodies, and no story dates", () => {
  assert.equal(feed.items.length, 71);
  assert.equal(feed.hasDates, false);
  assert.equal(feed.built, "2026-09-26T23:10:02.916Z");
  const first = feed.items[0];
  assert.match(first.title, /^In Brazil, frustration over cost of living/);
  assert.deepEqual([first.score, first.categories, first.source], [73, ["politics", "economy"], "NewsData"]);
  assert.ok(first.body.length > 1000 && !/<|CDATA/.test(first.body), "the story's text, without markup");
  assert.ok(feed.items.every((s) => s.title && s.link && s.id));
});

test("“latest” says the feed has no dates, then offers the top-ranked stories", () => {
  for (const q of ["what's the latest news", "today's news", "¿cuáles son las últimas noticias?"]) {
    const a = news.answer(q);
    assert.equal(a.kind, "list", q);
    assert.match(said(a), /^This feed has no dates on its stories, so I can't tell which is newest; it was last updated on September 26, 2026\. Its top-ranked stories: 1\. /);
  }
  assert.match(said(news.answer("headlines")), /^The top-ranked stories: 1\. In Brazil/);
});

test("search titles, read one, next, stop", () => {
  const [found, read, next, stop] = talk(["anything on the NFL", "read the second one", "next", "stop"]);
  assert.match(said(found), /^\d+ stories about nfl: 1\. .*NFL/);
  assert.equal(read.kind, "read");
  assert.equal(read.ids[0], found.state.list[1], "the second of the list just given");
  assert.ok(read.say[1].text.split(/[.!?]["”’)]*\s/).length <= 5, "a few sentences, not the whole story");
  assert.equal(next.ids[0], found.state.list[2], "next: the third");
  assert.deepEqual([stop.kind, stop.action], ["stop", { type: "stop" }]);
  assert.match(said(news.answer("find tariffs")), /^One story about tariffs: 1\. U\.S\., China reach \$30 billion tariff deal/);
  assert.match(said(news.answer("read the story about the tariff deal")), /^U\.S\., China reach \$30 billion tariff deal/);
  assert.equal(said(news.answer("find bananas")), "No story in this feed is about bananas.");
  const [, last] = talk(["news about brazil", "next", "next"]);
  assert.equal(last.kind, "read");
});

test("a real question goes to the site's server as text, with the story being read", () => {
  const [, , q] = talk(["news about brazil", "read the first one", "why is Lula struggling in the polls?"]);
  assert.equal(q.kind, "ask");
  assert.deepEqual(q.action, { type: "ask", question: "why is Lula struggling in the polls?", about: { id: feed.items[0].id, title: feed.items[0].title } });
  assert.equal(said(q), "Asking CredBrief…");
  assert.equal(news.answer("how will the tariff deal affect prices?").action.about, null, "nothing being read: the question alone");
});
