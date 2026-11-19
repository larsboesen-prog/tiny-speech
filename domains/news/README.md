# domains/news: news, small (plan step B12)

`feed.js` reads an RSS 2.0 feed (the repository's `feed.xml`, CredBrief's ranked stories) into stories; `index.js` answers
spoken commands about them, in a conversation (`state` goes back with the next question):

| Said | Answer |
|---|---|
| "news about Brazil", "anything on the NFL", "find tariffs" | the matching titles, best first (title words count most) |
| "read the second one", "read the story about the tariff deal" | its title and first few sentences |
| "next" | the next story of the list being read |
| "stop" | `action: {type: "stop"}`: the page stops the voice |
| "latest", "today's news" | the feed has no story dates, so it says so (and when the feed was built), then the top-ranked stories |
| "why…?", "what does it mean…?", "how will…?" | `action: {type: "ask", question, about}`: the page sends the question, as text, to the site's server, with the story being read |

The recording never leaves the page: only the question's words go to the server, and only for the hand-off. Tests:
`test/news.test.mjs` on `feed.xml`.
