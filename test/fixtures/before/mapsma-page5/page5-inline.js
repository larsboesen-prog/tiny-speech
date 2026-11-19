
// Spanish or English (Lars, 17 Nov 2026: "Yes build that way - with phones output for Spanish and a language switch EN ES"). The language
// is chosen as on the rest of the site (i18n.js: the reader's ES|EN choice, else the browser's language). This page's own words are
// swapped here, before the page is drawn, from data-es (text), data-esh (HTML), data-esp (placeholder), data-esl (aria-label),
// data-est (title) and data-esq (the question a button asks); i18n.js, after data.js, puts the places' areas, descriptions and
// kinds in Spanish and draws the ES|EN switch.
(function () {
  let L = null; try { L = localStorage.getItem('sma-lang'); } catch (e) {}
  if (L !== 'es' && L !== 'en') L = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
  window.LANG = L; document.documentElement.lang = L;
  // The opening screen asks for the language once per visit: not again after a choice in this tab (there or on the ES|EN switch),
  // nor for a ?q= link. Hidden here, before it is drawn.
  let skip = /[?&]q=./.test(location.search);
  try { skip = skip || sessionStorage.getItem('sma-ask:chosen') === '1'; } catch (e) {}
  if (skip) { const s = document.getElementById('splash'); s.classList.add('skip', 'gone'); s.setAttribute('aria-hidden', 'true'); }
  if (L !== 'es') return;
  document.title = 'San Miguel de Allende · Pregunta con tu voz';
  const each = (a, fn) => document.querySelectorAll('[' + a + ']').forEach((e) => fn(e, e.getAttribute(a)));
  each('data-es', (e, v) => { e.textContent = v; });
  each('data-esh', (e, v) => { e.innerHTML = v; });
  each('data-esp', (e, v) => { e.placeholder = v; });
  each('data-esl', (e, v) => { e.setAttribute('aria-label', v); });
  each('data-est', (e, v) => { e.title = v; });
  each('data-esq', (e, v) => { e.dataset.q = v; });
})();

//----

//----

//----

//----

//----

//----

// ?v=: each update gets new file addresses, so a phone never mixes a new page with old cached files (a cached asr-worker.js
// without the name hint was found in testing, 17 Nov 2026). Change V and every ?v= below together.
import { detector, speechAt16k } from './listen.js?v=20261118d';
import { createAsker, nowMX, ranges, DAYNAMES, showDist } from './ask.js?v=20261118d';
import { spanishLexicon } from './spanish.js?v=20261118d';

const $ = (id) => document.getElementById(id);
// The page's language (set above, as on the rest of the site): tx(english, spanish) for the words written here, T() for the card's
// words, which /page2 shares (i18n.js).
const ES = window.LANG === 'es';
const tx = (en, es) => (ES ? es : en);
const T = window.T || ((s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s));
const LOCALE = ES ? 'es-MX' : 'en-US';
const HAD_KEY = ES ? 'had-es' : 'had';  // speech recognition was loaded on this phone before (each language has its own model)
const store = { get(k, d) { try { return localStorage.getItem('sma-ask:' + k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('sma-ask:' + k, v); } catch {} } };
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortErr = (e) => { const s = String(e?.message ?? e ?? '').replace(/^Error:\s*/, '').trim() || tx('unknown error', 'error desconocido'); return s.length > 100 ? s.slice(0, 97) + '…' : s; };

// ---------- the places: the same files /page2 reads (data.js, Google's hours, the chosen photos) ----------
const { CATS, PLACES, INFO } = window;
const places = PLACES.map((p) => ({ ...p }));
const isS = (p) => p.cat === 'sights';
const LM = window.SMA_ICON_PATHS || {};
const HOURS = window.HOURS || {};
// The extra places, not our picks (Lars, 18 Nov 2026: "We might need a list of another up to 50 restaurants we don't recommend but include
// them in the list to cover categories - We should call out who we recommend", then "1a, 2a"): in data.js like every place, with
// other: true (data/places.json INFO "pick": false); only here, in the answers, after our picks and marked "Not our pick"; the photo and
// map pages leave them out. No map number, no Save or Share (Directions only); what each one is comes from facts.js.
const whatOf = (p) => { const f = (window.FACTS || {})[p.id] || {}; return (ES ? f.w_es : f.w) || ''; };
const byId = Object.fromEntries(places.map((p) => [p.id, p]));
const LIVE = {};  // place id -> "YYYY-MM-DD" Google's hours were checked
let PHOTOS = {}, photosFailed = false;  // places without a photo are left out, as on /page2 (Lars, 4 Nov); if the list fails to load, all show
const purl = (s) => (/^https?:/.test(s) ? s : '/' + s.replace(/^\//, ''));
const dataReady = Promise.all([
  fetch('/photos/hours.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.places) for (const [id, v] of Object.entries(j.places)) { HOURS[id] = v.hours; LIVE[id] = v.checked; } }).catch(() => {}),
  fetch('/photos/selected.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((j) => { PHOTOS = j || {}; }).catch(() => { photosFailed = true; }),
]);
// ---------- the opening screen (Lars, 17 Nov 2026: "Add a loading page to explain mapsma and SMA image while the models loading", then
// "Make the loading screen bilingual and a clear choice ENG vs ES") ----------
// What MapSMA is, in English and in Spanish, over La Parroquia (the photo chosen for it on /photo, credited as on the cards), and two
// buttons: English and Español. The tap sets the language for the whole site ("sma-lang", as the ES|EN switch does), lets the phone
// play the voice later, and opens the page; the other language reloads the page in that language. It waits for the tap, once per visit:
// after a choice in this tab (here or on the ES|EN switch) it is not shown again (skipped by the early script). On a first visit nothing
// loads before the tap, as English and Spanish have different speech models; a visitor who chose before has that language's model
// loading behind it, with the bar. A ?q= link skips it. If the script never runs, CSS lifts it after 25 s.
let splashUp = !$('splash').classList.contains('gone'), bgPlanned = false;
const langStored = (() => { try { return /^(es|en)$/.test(localStorage.getItem('sma-lang') || ''); } catch { return false; } })();
function hideSplash() {
  if (!splashUp) return;
  splashUp = false;
  $('splash').classList.add('gone'); $('splash').setAttribute('aria-hidden', 'true');
}
const chosen = () => { try { sessionStorage.setItem('sma-ask:chosen', '1'); } catch {} };
function chooseLang(l) {
  try { localStorage.setItem('sma-lang', l); } catch {}
  chosen();
  if (l !== (ES ? 'es' : 'en')) { location.reload(); return; }
  unlockAudio(); hideSplash();
  if (!bgPlanned) startBackground(false);
}
const asker = createAsker({ places, INFO, HOURS, CATS, ALSO: window.ALSO || {}, SUSAN: window.SUSAN, FACTS: window.FACTS || {}, shown: (p) => p.other || photosFailed || !!PHOTOS[p.id], lang: ES ? 'es' : 'en' });
const picks = asker.picks;
dataReady.then(() => {
  const ph = PHOTOS.S1, img = $('spPhoto');  // La Parroquia
  img.onload = () => img.classList.add('on');
  if (ph) {
    img.sizes = '(orientation: portrait) 150vh, 100vw'; img.srcset = `${purl(ph.small)} 960w, ${purl(ph.src)} 1920w`; img.src = purl(ph.small);
    $('spCredit').innerHTML = phCredit(ph);
  } else img.src = '../own/10.jpg';  // the Parroquia from the homepage's own photos
});
const month = (d) => new Date(d + 'T12:00:00').toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' }).replace('.', '');

// ---------- opening hours on the cards: copied from /page2 (keep in step) ----------
const fmt = (m) => { m %= 1440; return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
function todayHours(id) { const h = HOURS[id]; if (!h) return undefined; return h[String(nowMX().d)]; }  // string | null (closed) | undefined (unknown)
function hoursStatus(id) {  // {cls, text} for right now
  const h = HOURS[id]; if (!h) return null; const n = nowMX();
  const y = h[String((n.d + 6) % 7)]; if (typeof y === 'string') for (const [, e] of ranges(y)) if (e > 1440 && n.m < e - 1440) return { cls: 'st-open', text: T('Open now · until {t}', { t: fmt(e) }) };
  const t = h[String(n.d)]; if (t === null) return { cls: 'st-closed', text: T('Closed today') }; if (t === undefined) return null;
  for (const [s0, e] of ranges(t)) if (n.m >= s0 && n.m < e) return { cls: e - n.m <= 45 ? 'st-soon' : 'st-open', text: T(e - n.m <= 45 ? 'Closing soon · until {t}' : 'Open now · until {t}', { t: fmt(e) }) };
  const next = ranges(t).find(([s0]) => s0 > n.m); return next ? { cls: 'st-soon', text: T('Opens at {t}', { t: fmt(next[0]) }) } : { cls: 'st-closed', text: T('Closed for today') };
}
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }).replace('.', '');
const gmaps = (p) => { const a = INFO[p.id]?.address; const n = p.name.replace(' · ', ' ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(n + ', ' + (a && !/Jardín|Mercado/.test(a) ? a.replace(/\(.*?\)/g, '') + ', ' : '') + 'San Miguel de Allende, Guanajuato'); };
let saved = new Set(); try { saved = new Set(JSON.parse(localStorage.getItem('sma-saved') || '[]')); } catch {}
const persist = () => { try { localStorage.setItem('sma-saved', JSON.stringify([...saved])); } catch {} };

// ---------- cards: the photo card of /page2's grid, and its detail card (/page2/#id) ----------
// The card's status line, short enough for a 320-px phone: "Open until 22:30", "Closes at 16:00", "Opens at 13:00"; in Spanish
// "Abierto hasta 22:30" (no "las": 117 px is all a 320-px phone has), "Cierra a las 16:00", "Abre a la 1:00".
const cardStatus = (st) => (ES
  ? st.text.replace(/^Abierto ahora · hasta las /, 'Abierto hasta ').replace(/^Cierra pronto · hasta /, 'Cierra a ').replace(/ las 1:(\d\d)$/, ' la 1:$1')
  : st.text.replace(/^Open now · until /, 'Open until ').replace(/^Closing soon · until /, 'Closes at ').replace(/ 0:00$/, ' midnight'));
const shortMonth = (d) => { const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString(LOCALE, { month: 'short' }).replace('.', '') + ' ’' + String(x.getFullYear()).slice(2); };
function cardHTML(p, metresAway, mixed) {
  const c = CATS[p.cat], ph = PHOTOS[p.id], st = hoursStatus(p.id), pk = picks[p.id];
  const tag = p.other ? `<span class="tag np">${escH(tx('Not our pick', 'No es de nuestra lista'))}</span>` : mixed ? `<span class="tag op">${escH(tx('★ Our pick', '★ Recomendado'))}</span>` : '';
  const line = isS(p) ? escH(p.area) : st ? `<span class="${st.cls}">${escH(cardStatus(st))}</span>` : todayHours(p.id) === null ? `<span class="st-closed">${escH(T('Closed today'))}</span>` : escH(tx('Hours not published', 'Sin horario'));
  const art = ph ? `<img loading="lazy" src="${escH(purl(ph.small))}" alt="">`
    : LM[p.id] ? `<svg viewBox="0 0 64 64" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${LM[p.id]}</svg>`
    : `<span class="ini">${escH(p.name.replace(/^(La|El|Los|Las|The|Café|Cafe) /i, '').charAt(0))}</span>`;
  return `<button type="button" class="pc" data-id="${escH(p.id)}" style="--c:${c.color}"><div class="im">${art}${p.other ? '' : `<span class="num" style="${isS(p) ? 'color:#f2c14e;border-radius:8px' : ''}">${isS(p) ? '★' : escH(p.id)}</span>`}${saved.has(p.id) ? '<span class="sv">★</span>' : ''}${tag}</div>
    <div class="tx"><b>${escH(p.name)}</b><small>${line}</small>${metresAway != null ? `<small class="dist">${escH(showDist(metresAway))}</small>` : pk ? `<small class="sy">Susan York · ${escH(shortMonth(pk.date))}</small>` : `<small>${escH(p.area)}</small>`}</div></button>`;
}
const phCredit = (ph) => { const lic = ph.license ? ` · ${ph.license_url ? `<a href="${escH(ph.license_url)}" target="_blank" rel="noopener">${escH(ph.license)}</a>` : escH(ph.license)}` : '';
  const by = ph.credit ? (ph.source ? `<a href="${escH(ph.source)}" target="_blank" rel="noopener">${escH(ph.credit)}</a>` : escH(ph.credit)) : '';
  return by || lic ? `${escH(T('Photo'))}${by ? ': ' + by : ''}${lic}` : ''; };
function photoHTML(p) {
  const ph = PHOTOS[p.id]; if (!ph) return '';
  const all = [ph, ...(ph.more || [])];
  return `<figure class="c-photo" data-id="${escH(p.id)}"><div class="c-strip">${all.map((x, i) => `<img loading="${i ? 'lazy' : 'eager'}" src="${escH(purl(x.small))}" alt="">`).join('')}</div>`
    + (all.length > 1 ? `<div class="c-dots">${all.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : '') + `<figcaption>${phCredit(ph)}</figcaption></figure>`;
}
const ACC = { 'osm-name': ['ok', T('Exact')], address: ['ok', T('Exact')], corner: ['ok', T('Exact')], street: ['st', T('On its street')], approx: ['ap', T('Approximate location')], est: ['ap', T('Approximate location')] };
function infoHTML(p) {
  const i = INFO[p.id] || {}, a = ACC[p.acc] || ACC.approx;
  let h = '<div class="c-info">';
  h += `<div><span class="k">📍</span><span>${i.address ? escH(i.address) + '<br>' : ''}<span class="acc ${a[0]}">${a[1]}</span></span></div>`;
  if (!isS(p)) {
    let hrs;
    if (HOURS[p.id]) { const n = nowMX(), st = hoursStatus(p.id), w = HOURS[p.id];
      hrs = (st ? `<span class="${st.cls}">${escH(st.text)}</span><br>` : '') + `<details class="wk"${innerWidth >= 900 ? ' open' : ''}><summary>${escH(T('All week'))}</summary><div class="week">`
        + (window.DAYS || DAYNAMES).map((d, k) => { const v = w[String(k)]; return `<span class="${k === n.d ? 't' : ''}">${escH(d.slice(0, 3))}</span><span class="${k === n.d ? 't' : ''}">${v === null ? escH(T('Closed')) : v === undefined ? escH(T('not listed')) : escH(v)}</span>`; }).join('') + '</div></details>';
    } else hrs = i.hours ? escH(i.hours) : `<span class="muted">${escH(T('Hours not published online — check Google Maps'))}</span>`;
    const lv = LIVE[p.id];
    const src = lv ? ` · <a href="${escH(gmaps(p))}" target="_blank" rel="noopener">Google Maps</a>` : i.source ? ` · <a href="${escH(i.source)}" target="_blank" rel="noopener">${escH(T('source'))}</a>` : '';
    h += `<div><span class="k">🕒</span><span>${hrs}${i.note && !lv ? `<small>${escH(i.note)}</small>` : ''}<small>${escH(lv ? T('checked-on', { date: shortDate(lv) }) : T('Checked Nov 2026'))}${src}</small></span></div>`;
  }
  return h + '</div>';
}
function oneHTML(p, closable) {
  const c = CATS[p.cat], pk = picks[p.id];
  return `${photoHTML(p)}
   <div class="c-top">
     <div class="c-badge" style="background:${c.color};${isS(p) ? 'color:#f2c14e;border-radius:10px' : ''}">${isS(p) ? '★' : p.other ? escH(p.name.replace(/^(La|El|Los|Las|The|Café|Cafe|Panadería) /i, '').charAt(0)) : escH(p.id)}</div>
     <div class="c-main"><div class="c-cat" style="color:${c.color}">${escH(c.label)}</div><div class="c-name">${escH(p.name)}</div><div class="c-area">${escH(p.area)}</div></div>
     ${closable ? '<button type="button" class="c-x" aria-label="Close">✕</button>' : ''}
   </div>
   ${p.other ? `<div class="c-np">${escH(tx('Not one of our picks: listed so you get an answer.', 'No es de nuestra lista de favoritos: la incluimos para que tengas una respuesta.'))}</div>` : ''}
   ${p.desc || (p.other && whatOf(p)) ? `<div class="c-desc">${escH(p.desc || whatOf(p).charAt(0).toUpperCase() + whatOf(p).slice(1) + '.')}</div>` : ''}
   ${pk ? `<div class="c-susan">Susan York, ${escH(month(pk.date))}: ${escH(ES ? pk.note_es || pk.note : pk.note)}. <a href="${escH(pk.url)}" target="_blank" rel="noopener">${ES ? `Lee «${escH(pk.post)}» (en inglés)` : `Read “${escH(pk.post)}”`}</a></div>` : ''}
   ${infoHTML(p)}
   <div class="c-actions">${p.other ? `
     <a class="primary" href="${escH(gmaps(p))}" target="_blank" rel="noopener">${escH(T('Directions ↗'))}</a>
   </div>` : `
     <a class="primary" href="/page3/?p=${encodeURIComponent(p.id)}">${escH(T('🗺 Show on the map'))}</a>
     <a href="${escH(gmaps(p))}" target="_blank" rel="noopener">${escH(T('Directions ↗'))}</a>
     <button type="button" class="svb${saved.has(p.id) ? ' is-saved' : ''}">${escH(T(saved.has(p.id) ? '★ Saved' : '☆ Save'))}</button>
     <button type="button" class="shb">${escH(T('Share'))}</button>
   </div>`}`;
}
// The photos swipe sideways (a tap shows the next one), Save and Share work, as on /page2.
function wireCard(root, p) {
  const fig = root.querySelector('.c-photo');
  if (fig) {
    const strip = fig.querySelector('.c-strip'), ph = PHOTOS[p.id], all = ph ? [ph, ...(ph.more || [])] : [];
    strip.addEventListener('click', () => { if (strip.children.length < 2) return; const end = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4; strip.scrollTo({ left: end ? 0 : strip.scrollLeft + strip.clientWidth, behavior: 'smooth' }); });
    strip.addEventListener('scroll', () => {
      const i = Math.max(0, Math.min(all.length - 1, Math.round(strip.scrollLeft / strip.clientWidth)));
      if (fig.dataset.i == i) return; fig.dataset.i = i;
      fig.querySelectorAll('.c-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
      fig.querySelector('figcaption').innerHTML = phCredit(all[i]);
    }, { passive: true });
  }
  root.querySelector('.svb')?.addEventListener('click', (e) => {
    saved.has(p.id) ? saved.delete(p.id) : saved.add(p.id); persist();
    e.currentTarget.classList.toggle('is-saved', saved.has(p.id)); e.currentTarget.textContent = T(saved.has(p.id) ? '★ Saved' : '☆ Save');
    document.querySelectorAll(`.pc[data-id="${CSS.escape(p.id)}"] .im`).forEach((im) => { im.querySelector('.sv')?.remove(); if (saved.has(p.id)) im.insertAdjacentHTML('beforeend', '<span class="sv">★</span>'); });
  });
  root.querySelector('.shb')?.addEventListener('click', (e) => share(p, e.currentTarget));  // (an extra place has neither)
}
async function share(p, btn) {  // a link that opens this place on the map: the phone's share sheet, or the link copied
  const url = location.origin + '/page3/?p=' + encodeURIComponent(p.id);
  if (navigator.share) { try { await navigator.share({ title: p.name + ' · San Miguel de Allende', url }); } catch {} return; }
  try { await navigator.clipboard.writeText(url); btn.textContent = T('Link copied ✓'); } catch { prompt(T('Copy this link:'), url); return; }
  setTimeout(() => { if (btn.isConnected) btn.textContent = T('Share'); }, 2000);
}
// A card in a list opens its detail card over the page; the phone's back button closes it (#id in the address, as on /page2).
const detail = $('detail'), card = $('card');
let selId = null;
function openDetail(id, fromHistory) {
  const p = byId[id]; if (!p) return; selId = id;
  card.innerHTML = oneHTML(p, true); wireCard(card, p);
  card.querySelector('.c-x').onclick = () => closeDetail();
  detail.classList.add('show'); card.scrollTop = 0; document.body.style.overflow = 'hidden';
  if (!fromHistory) history.pushState({ p: id }, '', '#' + encodeURIComponent(id));
}
function closeDetail(fromHistory) { if (!selId) return; selId = null; detail.classList.remove('show'); document.body.style.overflow = ''; if (!fromHistory) history.back(); }
detail.addEventListener('click', (e) => { if (e.target === detail) closeDetail(); });
addEventListener('popstate', () => { const id = decodeURIComponent(location.hash.slice(1)); if (byId[id]) openDetail(id, true); else closeDetail(true); });

// ---------- where the phone is: asked for only when a question needs it ("near me", "how far"), kept two minutes, never sent anywhere ----------
// (Lars, 17 Nov 2026: "locations can also be enabled", in Safari's settings for the site beside the microphone.)
let hereKept = null;
function getHere() {
  if (hereKept && Date.now() - hereKept.at < 120000) return Promise.resolve({ pos: hereKept.pos });
  if (!navigator.geolocation) return Promise.resolve({ error: 'none' });
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => { const pos = { lat: p.coords.latitude, lng: p.coords.longitude }; hereKept = { pos, at: Date.now() }; resolve({ pos }); },
    (e) => resolve({ error: e.code === 1 ? 'denied' : 'unavailable' }),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }));
}
function locationHelp(error) {  // under an answer when the location could not be had
  if (error === 'denied' && IOS_SAFARI) return `<p class="steps-h">${tx('To let this page see where you are:', 'Para que esta página sepa dónde estás:')}</p>` + safariSteps('Location') + `<p class="steps-old">${tx('Then ask again.', 'Luego pregunta otra vez.')}</p>`;
  if (error === 'denied') return tx("Your browser is set to keep your location from this site: allow Location for mapsma.com in the browser's settings, then ask again.",
    'Tu navegador no le da tu ubicación a este sitio: permite la Ubicación para mapsma.com en los ajustes del navegador y pregunta otra vez.');
  return tx("I couldn't find your location just now (no signal, or Location Services is off for the browser). Try again in a moment.",
    'No pude encontrar tu ubicación ahora (sin señal, o la Localización está apagada para el navegador). Inténtalo de nuevo en un momento.');
}

// ---------- the conversation: a question, the answer in a sentence, and its cards (newest first) ----------
let lastList = null;  // the last list, for "4 more"
async function ask(text, how = 'typed') {
  text = String(text || '').trim();
  if (!text) return;
  hideMicFix(); closeDetail(true);
  await dataReady;
  stopVoice();
  const pq = asker.parse(text);
  let here = null, hereError = '';
  if (pq.near || pq.howFar) {
    status(tx('Finding where you are…', 'Buscando dónde estás…'));
    const got = await getHere();
    if (got.pos) here = got.pos; else hereError = got.error;
    status('');
  }
  const res = asker.answer(text, nowMX(), lastList, here);
  if (hereError) res.locHelp = locationHelp(hereError);
  if (res.kind === 'list' && res.ids.length && !(res.ids.length === 1 && !res.all.length)) lastList = res;
  const turn = renderTurn(text, res);
  if ($('q').value.trim() === text) $('q').value = '';
  $('q').blur();
  bringIntoView(turn.el);
  if (how !== 'silent' && !quiet) readTurn(turn, 0, true);
  if (quiet && !rec) $('dock').classList.add('typing');  // Quiet: the typing row stays (its small mic still listens)
  if (fgText && !fgText.startsWith('Getting')) status('');
}
// The answer written out, for Quiet's chat: the sentences, and one line per place ("Andanza — open until 22:30", a tap opens its card).
function chatHTML(res) {
  const lines = res.lines || [{ text: res.show }];
  if (res.kind !== 'list') return lines.map((l) => `<p>${escH(l.text)}</p>`).join('');
  const rows = lines.filter((l) => l.id && byId[l.id]);
  return lines.filter((l) => !l.id).map((l) => `<p>${escH(l.text)}</p>`).join('')
    + (rows.length ? `<ul>${rows.map((l) => `<li><button type="button" data-id="${escH(l.id)}"><b>${escH(byId[l.id].name)}</b> — ${escH(l.text)}</button></li>`).join('')}</ul>` : '');
}
function renderTurn(text, res) {
  const el = document.createElement('section');
  el.className = 'turn';
  el.innerHTML = `<div class="qrow"><p class="q"></p><button type="button" class="again" title="${tx('Read the answer aloud again', 'Leer otra vez la respuesta en voz alta')}">${tx('🔊 Again', '🔊 Otra vez')}</button></div><p class="a"></p><div class="chat">${chatHTML(res)}</div>`;
  el.querySelector('.q').textContent = text;  // the quote marks come from the style sheet (none in Quiet's chat bubbles)
  el.querySelector('.a').textContent = res.show;
  el.querySelectorAll('.chat [data-id]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
  const targets = new Map();
  if (res.kind === 'one') {
    const box = document.createElement('div');
    box.className = 'one'; box.innerHTML = oneHTML(byId[res.id], false);
    el.appendChild(box); wireCard(box, byId[res.id]); targets.set(res.id, box);
  } else if (res.ids.length) {
    const grid = document.createElement('div');
    grid.className = 'cards'; grid.innerHTML = res.ids.map((id) => cardHTML(byId[id], res.mine && res.dist ? res.dist[id] : null, res.mixed)).join('');
    el.appendChild(grid);
    grid.querySelectorAll('.pc').forEach((b) => { targets.set(b.dataset.id, b); b.addEventListener('click', () => openDetail(b.dataset.id)); });
    const mine = res.ids.filter((id) => picks[id]);
    if (res.susan && mine.length) {  // where Susan York wrote about them, with a link to each post
      const p = document.createElement('p'); p.className = 'credit';
      p.innerHTML = tx('From Susan York’s blog: ', 'Del blog de Susan York: ') + mine.map((id) => `<a href="${escH(picks[id].url)}" target="_blank" rel="noopener">${escH(byId[id].name)}</a> (${escH(month(picks[id].date))})`).join(', ') + '.';
      el.appendChild(p);
    }
    if (res.left > 0) {
      const k = Math.min(res.count || 4, res.left), b = document.createElement('button'), more = tx(`${k} more`, `${k} más`);
      b.type = 'button'; b.className = 'more'; b.textContent = more;
      b.addEventListener('click', () => { unlockAudio(); b.remove(); ask(more); });
      el.appendChild(b);
    }
  }
  if (res.locHelp) {  // the location could not be had: why, and where to allow it, right under the answer
    const h = document.createElement('div');
    h.className = 'lochelp'; h.innerHTML = res.locHelp;
    el.querySelector('.chat').after(h);
  }
  if (res.near && res.near.length) {  // a name not caught: the closest names, one tap each
    const row = document.createElement('div');
    row.className = 'nearrow';
    for (const id of res.near) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'more'; b.textContent = byId[id].name;
      b.addEventListener('click', () => { unlockAudio(); const n = byId[id].name; ask(ES ? `¿Está abiert${/^(la|las)\s/i.test(n) ? 'a' : 'o'} ${n}?` : `Is ${n} open?`); });
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  $('convo').prepend(el);
  const turn = { el, sentences: res.say.map((s) => s.text), marks: res.say.map((s) => (s.id ? targets.get(s.id) || null : null)) };
  el.querySelector('.again').addEventListener('click', () => { unlockAudio(); readTurn(turn, 0); });
  return turn;
}
function bringIntoView(el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
for (const b of document.querySelectorAll('.exq')) b.addEventListener('click', () => { unlockAudio(); warmVoice(); ask(b.dataset.q); });

// ---------- what the bar shows: background loading, the mic's state ----------
const prep = { asr: null, voice: null };  // null (not started), {frac} while loading, 'ready', or {error}
let fgText = '', prepDoneAt = 0;
function status(t) { fgText = t || ''; render(); }
function prepLine() {
  const parts = [], fr = [];
  for (const [k, label] of [['asr', tx('speech recognition', 'reconocimiento de voz')], ['voice', tx('voice', 'voz')]]) {
    const p = prep[k];
    if (p && p !== 'ready' && !p.error) { parts.push(`${label} ${Math.round((p.frac || 0) * 100)}%`); fr.push(p.frac || 0); }
  }
  if (parts.length) return { text: (store.get(HAD_KEY, '') === '1' ? tx('Starting the voice from this phone: ', 'Cargando desde este teléfono: ') : tx('Getting the voice ready: ', 'Preparando: ')) + parts.join(', '), pct: (100 * fr.reduce((a, b) => a + b, 0)) / fr.length };
  return prepDoneAt && Date.now() - prepDoneAt < 4000 ? { text: tx('Ready: tap the mic and ask.', 'Listo: toca el micrófono y pregunta.'), pct: null } : null;
}
function voiceState() {  // listening, working (speech to text), speaking or idle
  if (rec) return 'listen';
  if (transcribing) return 'work';
  if (reading && !reading.done && !reading.stopped) return 'speak';
  return 'idle';
}
const MIC_LINE = ES
  ? { idle: 'Toca para preguntar', listen: 'Escuchando… se envía cuando terminas', work: 'Pasando tu voz a texto…', speak: 'Hablando… toca para preguntar otra cosa' }
  : { idle: 'Tap to ask', listen: 'Listening… it sends when you stop', work: 'Turning your voice into text…', speak: 'Speaking… tap to ask next' };
function render() {
  const st = voiceState();
  $('dock').dataset.state = st; $('micLabel').textContent = MIC_LINE[st];
  let bg = prepLine();
  if (bg && bg.pct == null && st !== 'idle') bg = null;  // "Ready: tap the mic" only while nothing else is going on
  $('status').textContent = fgText || bg?.text || '';
  const pct = fgText ? null : bg?.pct ?? null;
  $('barFill').style.width = pct == null ? '0' : Math.max(2, Math.min(100, pct)) + '%';
  const word = (p) => (p === 'ready' ? tx('ready', 'listo') : p?.error ? tx(`could not load (${shortErr(p.error)})`, `no se pudo cargar (${shortErr(p.error)})`)
    : p ? tx('loading ', 'cargando ') + Math.round((p.frac || 0) * 100) + '%' : tx('loads on first use', 'se carga al usarlo'));
  $('prepState').textContent = `${tx('Speech recognition', 'Reconocimiento de voz')}: ${word(prep.asr)} · ${tx('Voice', 'Voz')}: ${$('voice').value === 'tinyvoca' ? word(prep.voice) : tx('no download needed', 'sin descarga')}`;
  if (splashUp) {  // the opening screen's bar, in both languages: speech recognition, then (English) the voice, as one figure
    const done = (p) => (p === 'ready' || p?.error ? 1 : p ? p.frac || 0 : 0), voiceToo = !document.documentElement.classList.contains('quiet') && $('voice').value === 'tinyvoca';  // (the class: render() may run before `quiet` is set)
    const busy = stillLoading(), pct = Math.round(100 * (voiceToo ? (done(prep.asr) + done(prep.voice)) / 2 : done(prep.asr)));
    $('splash').classList.toggle('loading', bgPlanned && !prep.asr?.error);
    $('spLoad').textContent = busy ? `Getting ready · Preparando… ${pct}%` : 'Ready · Listo';
    $('spFill').style.width = busy ? Math.max(4, Math.min(100, pct)) + '%' : '100%';
  }
}
// Something the opening screen waits for: speech recognition not yet started or loading, or the voice about to load or loading.
function stillLoading() {
  const busy = (p) => !!p && p !== 'ready' && !p.error;
  return bgPlanned && (prep.asr === null || busy(prep.asr) || voiceAfterAsr || busy(prep.voice));
}
function prepFinished() {
  if (Object.values(prep).some((p) => p && p !== 'ready' && !p.error)) { render(); return; }
  prepDoneAt = Date.now(); render(); setTimeout(render, 4100);
}
if ('ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px')).observe($('dock'));

// ---------- speech to text, on the phone: Whisper tiny.en in a worker (asr-worker.js, as on CredBrief's /page40) ----------
// In Spanish (17 Nov 2026): the multilingual Whisper tiny, told the language (about 40 MB, as tiny.en; English keeps tiny.en, which
// hears English better).
const ASR_MODEL = ES ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-tiny.en';
const ASR_LANG = ES ? 'es' : undefined;
let asrWorker = null, asrReq = 0, voiceAfterAsr = false, asrReady = false;
const asrReqs = new Map();
function asrW() {
  if (asrWorker) return asrWorker;
  asrWorker = new Worker('asr-worker.js?v=20261118d', { type: 'module' });
  asrWorker.onmessage = ({ data }) => {
    if (data.type === 'progress') { if (!asrReady) { prep.asr = { frac: Math.max(prep.asr?.frac || 0, 0.97 * data.frac) }; render(); } }
    else if (data.type === 'ready') { asrReady = true; prep.asr = 'ready'; keepStorage(); prepFinished(); if (voiceAfterAsr) { voiceAfterAsr = false; warmVoice(); render(); } }
    else if (data.type === 'error') { prep.asr = { error: data.message }; render(); if (voiceAfterAsr) { voiceAfterAsr = false; warmVoice(); } }
    else if (data.type === 'text') { const r = asrReqs.get(data.reqId); asrReqs.delete(data.reqId); if (r) { if (data.error) r.reject(new Error(data.error)); else r.resolve(data.text); } }
  };
  asrWorker.onerror = (e) => {
    prep.asr = { error: e.message || 'speech worker failed' }; render();
    for (const r of asrReqs.values()) r.reject(new Error('speech worker failed'));
    asrReqs.clear(); asrWorker = null;
    if (voiceAfterAsr) { voiceAfterAsr = false; warmVoice(); }
  };
  return asrWorker;
}
function getAsr() {
  if (!asrReady && !(prep.asr && prep.asr !== 'ready' && !prep.asr.error)) { prep.asr = { frac: 0 }; render(); }
  asrW().postMessage({ type: 'load', model: ASR_MODEL });
}
// The names Whisper should expect (Lars, 17 Nov 2026: "It has problems with my Spanish names", then "Add help text for all other
// restaurants"; see asr-worker.js): every place shown here, plus Centro (heard as "central"), Jardín and Susan York ("sues in York").
// Whisper reads at most about 220 tokens of it, so the list is kept short enough for every restaurant to fit (214 tokens on 17 Nov):
// names Whisper hears right on its own are left out (HINT_SKIP) and long ones are cut to their unusual part (HINT_AS). A place added
// later goes in under its full name; check the count when adding many (a longer list loses its start).
const HINT_SKIP = new Set(['20', '35', '39', '49', '62', '80', '81']);  // Andy's Taco Cart, Baja Fish Taquito, Don Taco Tequila, Inside Café, Luna Rooftop, The Restaurant, Geek & Coffee
const HINT_AS = { 3: 'Santa Ana', 9: "K'ibok", 11: 'Zenteno', 17: 'El Maple', 21: 'Nieves', 22: 'Don Tomás', 28: 'La Mancha', 32: 'Oratorio', 65: 'Sautto', 66: 'La Frontera', 75: 'Casa Giovanni', 77: 'Garambullo', 78: 'Viñedo' };
let hintText = '';
function nameHint() {
  if (hintText) return hintText;
  const names = places.filter((p) => !isS(p) && !p.other && (photosFailed || PHOTOS[p.id]) && !HINT_SKIP.has(p.id)).map((p) => HINT_AS[p.id] || p.name);  // our picks only: the hint has no room for more
  if (!names.length) return '';
  hintText = `Centro, Jardín, Susan York, ${names.join(', ')}.`;
  return hintText;
}
function transcribeText(audio) {
  const reqId = ++asrReq;
  return new Promise((resolve, reject) => { asrReqs.set(reqId, { resolve, reject }); asrW().postMessage({ type: 'transcribe', reqId, model: ASR_MODEL, language: ASR_LANG, audio, hint: nameHint() }, [audio.buffer]); });
}
// Ask the browser to keep the downloaded models for good (Safari may clear a site's storage after weeks without a visit); Apple's browsers only.
let storageAsked = false;
function keepStorage() {
  store.set(HAD_KEY, '1');
  if (storageAsked || !navigator.storage?.persist || !(IOS || /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent))) return;
  storageAsked = true; navigator.storage.persisted().then((kept) => kept || navigator.storage.persist()).catch(() => {});
}

// ---------- the microphone: asked for once per visit, switched off between questions, let go after two idle minutes ----------
const MIC_IDLE_MS = 2 * 60 * 1000;
let micStream = null, micIdle = null;
async function getMic() {
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live')) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  micTip(); hideMicFix();
  return micStream;
}
function releaseMic() { clearTimeout(micIdle); micStream?.getTracks().forEach((t) => t.stop()); micStream = null; }
function micQuiet() { micStream?.getAudioTracks().forEach((t) => { t.enabled = false; }); clearTimeout(micIdle); micIdle = setTimeout(releaseMic, MIC_IDLE_MS); }
addEventListener('pagehide', releaseMic);
// Where Safari on iPhone and iPad keeps this site's microphone switch, shown step by step with pictures of its buttons (Lars, 17 Nov
// 2026: "tap left icon in url - then three dots in right corner then scroll down and find Microphone and set to Allow"). Safari 26 has a
// page menu left of the address; earlier versions have aA and Website Settings. Safari says its version in "Version/26.0".
const SAFARI_V = Number((/Version\/(\d+)/.exec(navigator.userAgent) || [])[1] || 0);
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_PAGE = SVG('<path d="M5 7h14M5 12h14M5 17h9"/>');  // the page menu button: lines, left of the address
const ICON_MORE = SVG('<circle cx="12" cy="12" r="9.5" stroke-width="1.6"/><circle cx="8" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="16" cy="12" r=".9" fill="currentColor"/>');
const ICON_MIC = SVG('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/>');
const ICON_PIN = SVG('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>');
function safariSteps(what = 'Microphone') {
  const icon = what === 'Location' ? ICON_PIN : ICON_MIC;
  const name = ES ? { Microphone: 'Micrófono', Location: 'Ubicación' }[what] : what;  // as Safari names them in Spanish
  const site = location.hostname.replace(/^www\./, '') || 'mapsma.com';
  const li = (icon, text) => `<li><span class="ico">${icon}</span><span>${text}</span></li>`;
  const older = SAFARI_V > 0 && SAFARI_V < 26;
  const steps = older
    ? li('aA', tx('Tap <b>aA</b> in the address bar.', 'Toca <b>aA</b> en la barra de direcciones.')) + li(SVG('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'), tx('Tap <b>Website Settings</b>.', 'Toca <b>Configuración del sitio web</b>.')) + li(icon, tx(`Tap <b>${name}</b> and choose <b>Allow</b>.`, `Toca <b>${name}</b> y elige <b>Permitir</b>.`))
    : li(ICON_PAGE, tx(`Tap the icon left of <b>${site}</b> in the address bar.`, `Toca el icono a la izquierda de <b>${site}</b> en la barra de direcciones.`)) + li(ICON_MORE, tx('Tap <b>⋯</b> at the top right.', 'Toca <b>⋯</b> arriba a la derecha.')) + li(icon, tx(`Scroll down to <b>${name}</b> and choose <b>Allow</b>.`, `Baja hasta <b>${name}</b> y elige <b>Permitir</b>.`));
  return `<ol class="steps">${steps}</ol>${SAFARI_V ? '' : `<p class="steps-old">${tx(`Older iPhones: tap aA, then Website Settings, then ${name}.`, `iPhone más antiguos: toca aA, luego Configuración del sitio web y luego ${name}.`)}</p>`}`;
}
const IOS_SAFARI = IOS && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
function micTipHTML() {  // in Voice settings: how to stop the browser asking every time
  if (IOS_SAFARI) return `<p class="steps-h">${tx('So Safari stops asking for the microphone:', 'Para que Safari deje de pedir el micrófono:')}</p>` + safariSteps();
  return tx('To stop the browser asking for the microphone every time: in Chrome, tap the icon left of the address, then Permissions, Microphone: Allow. '
    + 'A page opened inside another app (Mail, WhatsApp) always asks: open mapsma.com/page5 in Safari or Chrome.',
    'Para que el navegador no pida el micrófono cada vez: en Chrome, toca el icono a la izquierda de la dirección, luego Permisos, Micrófono: Permitir. '
    + 'Una página abierta dentro de otra app (Mail, WhatsApp) siempre lo pide: abre mapsma.com/page5 en Safari o Chrome.');
}
async function micTip() { let state = ''; try { state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {} $('micTip').innerHTML = state === 'granted' ? '' : micTipHTML(); }
function micSteps() {  // when the microphone is blocked: where to switch it on (HTML)
  const ua = navigator.userAgent;
  if (IOS && /CriOS|FxiOS|EdgiOS/.test(ua)) return tx("To allow it: open this browser's settings for mapsma.com and set Microphone to Allow.", 'Para permitirlo: abre los ajustes de este navegador para mapsma.com y pon Micrófono en Permitir.');
  if (IOS && !/Safari\//.test(ua)) return tx('This page is open inside another app, which may not lend it the microphone. Open mapsma.com/page5 in Safari.', 'Esta página está abierta dentro de otra app, que quizá no le presta el micrófono. Abre mapsma.com/page5 en Safari.');
  if (IOS) return `<p class="steps-h">${tx('To allow the microphone in Safari:', 'Para permitir el micrófono en Safari:')}</p>` + safariSteps();
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) return tx('To allow it: in the Safari menu, choose Settings for mapsma.com, then Microphone: Allow.', 'Para permitirlo: en el menú Safari, elige Configuración de mapsma.com y luego Micrófono: Permitir.');
  return tx('To allow it: tap or click the icon at the left of the address bar, then set Microphone to Allow.', 'Para permitirlo: toca o haz clic en el icono a la izquierda de la barra de direcciones y pon Micrófono en Permitir.');
}
function showMicFix(label, how) { $('micAllow').textContent = label; $('micHow').innerHTML = how || ''; $('micOr').classList.toggle('hide', !!how); $('micFix').classList.remove('hide'); }
function hideMicFix() { $('micFix').classList.add('hide'); }
async function micFailed(err, ms, again) {
  const name = err?.name || '';
  let state = ''; try { state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
  $('micTip').innerHTML = micTipHTML();
  if (!navigator.mediaDevices?.getUserMedia) { status(tx('This browser cannot use the microphone here. Type your question instead.', 'Este navegador no puede usar el micrófono aquí. Escribe tu pregunta.')); hideMicFix(); return; }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') { status(tx('No microphone was found. Type your question instead.', 'No se encontró un micrófono. Escribe tu pregunta.')); hideMicFix(); return; }
  if (name === 'NotReadableError' || name === 'AbortError') { status(tx('The microphone is busy: a call or another app may be using it.', 'El micrófono está ocupado: quizá lo usa una llamada u otra app.')); showMicFix(tx('Try the microphone again', 'Probar otra vez el micrófono'), ''); return; }
  const setting = state === 'denied' || ms < 400;
  status(setting ? tx(`${IOS ? 'Safari' : 'Your browser'} is set to block the microphone for this site.`, `${IOS ? 'Safari' : 'Tu navegador'} tiene bloqueado el micrófono para este sitio.`)
    : again ? tx('The microphone is still blocked.', 'El micrófono sigue bloqueado.') : tx('The microphone is blocked.', 'El micrófono está bloqueado.'));
  showMicFix(tx('Allow the microphone', 'Permitir el micrófono'), setting || again ? micSteps() : '');
}

// ---------- recording: raw sound, ended by a pause (0.7 s, listen.js, as on /page40) or after eight seconds ----------
// Eight, not /page40's five: a question here names a place and a time ("Surprise me: three restaurants Susan York reviewed recently that
// are open now" takes about five seconds to say), and the pause still sends it as soon as the speaker stops.
const REC_MAX_MS = 8000;
let rec = null, recStarting = false, transcribing = false;
function newAudioContext() {  // made in the tap itself: iPhone and iPad start sound only inside a tap
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
async function startRec(ctx) {
  if (recStarting) { ctx.close().catch(() => {}); return; }
  recStarting = true;
  const t0 = performance.now();
  try {
    let stream;
    try { stream = await getMic(); } catch (err) { ctx.close().catch(() => {}); micFailed(err, performance.now() - t0, false); return; }
    clearTimeout(micIdle);
    stream.getAudioTracks().forEach((t) => { t.enabled = true; });
    stopVoice();
    getAsr();  // start loading while the question is spoken
    const r = { ctx, d: detector(ctx.sampleRate), began: 0, tick: 0, src: null, node: null, mute: null };
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      r.src = ctx.createMediaStreamSource(stream);
      if (ctx.audioWorklet && window.AudioWorkletNode) {
        try { await ctx.audioWorklet.addModule('pcm-worklet.js?v=20261118d'); r.node = new AudioWorkletNode(ctx, 'pcm-tap'); r.node.port.onmessage = (e) => hear(r, e.data); } catch { r.node = null; }
      }
      if (!r.node) { r.node = ctx.createScriptProcessor(2048, 1, 1); r.node.onaudioprocess = (e) => hear(r, new Float32Array(e.inputBuffer.getChannelData(0))); }
      r.mute = ctx.createGain(); r.mute.gain.value = 0;  // the graph runs only when it reaches the speakers: so it does, silently
      r.src.connect(r.node); r.node.connect(r.mute); r.mute.connect(ctx.destination);
    } catch {
      endRecording(r); status(tx('Recording could not start in this browser. Please type your question.', 'No se pudo grabar en este navegador. Escribe tu pregunta.')); return;
    }
    r.began = performance.now();
    rec = r;
    $('mic').classList.add('rec');
    r.tick = setInterval(() => recTick(r), 100);
    recTick(r);
  } finally { recStarting = false; }
}
function recTick(r) {
  if (rec !== r) return;
  const used = performance.now() - r.began;
  if (used > 1500 && r.d.n === 0) { rec = null; endRecording(r); status(tx('The microphone gave no sound. Tap the mic and try again.', 'El micrófono no capta sonido. Toca el micrófono e inténtalo otra vez.')); return; }
  if (used >= REC_MAX_MS) { stopRec(); return; }
  $('dock').style.setProperty('--p', (used / REC_MAX_MS).toFixed(3));
  status(r.d.speechAt < 0 ? tx('Listening… ask your question.', 'Escuchando… haz tu pregunta.') : tx('Listening… it sends when you stop talking.', 'Escuchando… se envía cuando dejas de hablar.'));
}
function hear(r, buf) {  // one block of sound: 2048 samples, about 0.04 s
  if (rec !== r) return;
  const event = r.d.feed(buf);
  $('dock').style.setProperty('--lvl', Math.min(1, Math.sqrt((r.d.rms || 0) / 0.12)).toFixed(2));  // the mic glows with the voice
  if (event === 'end') stopRec();
}
function endRecording(r) {
  clearInterval(r.tick);
  try { r.src?.disconnect(); r.node?.disconnect(); r.mute?.disconnect(); } catch {}
  if (r.node?.port) r.node.port.onmessage = null; else if (r.node) r.node.onaudioprocess = null;
  r.ctx.close().catch(() => {});
  $('mic').classList.remove('rec'); $('dock').style.setProperty('--lvl', '0'); $('dock').style.setProperty('--p', '0');
  micQuiet(); render();
}
function stopRec() { const r = rec; if (!r) return; rec = null; endRecording(r); transcribe(r); }
async function transcribe(r) {
  transcribing = true; render();
  try {
    await dataReady;  // the place names for the hint
    const audio = speechAt16k(r.d);
    warmVoice();  // the question is over: the voice may load now (never during the recording)
    if (audio.length < 16000 * 0.4) { status(tx('That was too short. Tap and ask again.', 'Fue muy corto. Toca y pregunta otra vez.')); return; }
    status(asrReady ? '' : tx('Speech recognition is still loading…', 'El reconocimiento de voz aún se está cargando…'));
    const text = spokenText(await transcribeText(audio));
    if (!text) { status(tx("I didn't catch that. Tap the mic and ask again.", 'No te entendí. Toca el micrófono y pregunta otra vez.')); return; }
    transcribing = false;
    ask(text, 'voice');
  } catch (err) {
    console.error(err); status(tx('Speech recognition failed on this phone. Please type your question.', 'El reconocimiento de voz falló en este teléfono. Escribe tu pregunta.'));
  } finally { transcribing = false; render(); }
}
// What Whisper hears that is not speech comes as tags ([BLANK_AUDIO], (wind blowing)): no question.
function spokenText(s) { const t = String(s || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); return /\p{L}/u.test(t) ? t : ''; }

$('mic').addEventListener('click', () => {
  unlockAudio();
  $('dock').classList.remove('typing');
  if (rec) { stopRec(); return; }
  startRec(newAudioContext());
});
$('micAllow').addEventListener('click', () => {
  unlockAudio();
  const t0 = performance.now();
  getMic().then(() => { micQuiet(); status(tx('Microphone on. Tap the mic and ask your question.', 'Micrófono activado. Toca el micrófono y haz tu pregunta.')); }, (err) => micFailed(err, performance.now() - t0, true));
});
$('kbd').addEventListener('click', () => { $('dock').classList.add('typing'); $('q').focus(); });
$('stopBtn').addEventListener('click', () => { unlockAudio(); if (rec) { const r = rec; rec = null; endRecording(r); status(''); } stopVoice(); render(); });
$('askForm').addEventListener('submit', (e) => { e.preventDefault(); unlockAudio(); warmVoice(); const t = $('q').value.trim(); if (t) ask(t); });

// ---------- reading the answer aloud: tiny-voca (tinyvoca-worker.js, as on /page40) or the phone's own voice ----------
// One <audio> player for every sentence, unlocked by the first tap: Safari only plays sound from a player that first played in a tap.
let reading = null;  // {turn, gen, pos, done, stopped, genDone, via}
let voiceEl = null, voiceUnlocked = false, voiceQueue = [], voicePlaying = false, voiceGen = 0, speechUnlocked = false;
function wavBlob(samples, rate) {  // 16-bit mono WAV: every browser's player reads it
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
function player() { if (!voiceEl) { voiceEl = new Audio(); voiceEl.setAttribute('playsinline', ''); voiceEl.preload = 'auto'; } return voiceEl; }
function unlockSpeech() { if (speechUnlocked || !('speechSynthesis' in window)) return; speechUnlocked = true; try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch {} }
function unlockAudio() {  // inside a tap: a moment of silence, so the browser lets this player speak later
  unlockSpeech();
  if (voiceUnlocked || voicePlaying) return;
  const el = player(), url = URL.createObjectURL(wavBlob(new Float32Array(2400), 24000));
  el.src = url; el.play().catch(() => {}).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
  voiceUnlocked = true;
}
function markSentence(turn, i) {  // the card being read out is outlined
  for (const m of turn?.marks || []) m?.classList.remove('speaking');
  const el = i != null ? turn?.marks?.[i] : null;
  if (el) { el.classList.add('speaking'); const r = el.getBoundingClientRect(), dockTop = $('dock').getBoundingClientRect().top; if (r.top < 70 || r.bottom > dockTop) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function enqueueVoice(blob, gen, i) {
  if (gen !== voiceGen) return;
  voiceQueue.push({ url: URL.createObjectURL(blob), i });
  if (!voicePlaying) playNext(gen);
}
function playNext(gen) {
  if (gen !== voiceGen) return;
  const item = voiceQueue.shift();
  if (!item) { voicePlaying = false; if (reading && reading.gen === gen && reading.genDone) finishReading(gen); return; }
  voicePlaying = true;
  if (reading && reading.gen === gen) { reading.pos = item.i; markSentence(reading.turn, item.i); }
  const el = player();
  el.onended = () => { URL.revokeObjectURL(item.url); playNext(gen); };
  el.onerror = () => { URL.revokeObjectURL(item.url); playNext(gen); };
  el.src = item.url;
  el.play().catch((err) => {
    voicePlaying = false; voiceQueue.forEach((q) => URL.revokeObjectURL(q.url)); voiceQueue = [];
    if (reading && reading.gen === gen) { reading.stopped = true; markSentence(reading.turn, null); }
    status(tx(`The browser did not let the voice play (${err.name}). Tap “🔊 Again” on the answer.`, `El navegador no dejó sonar la voz (${err.name}). Toca «🔊 Otra vez» en la respuesta.`));
  });
}
function finishReading(gen) {
  if (!reading || reading.gen !== gen) return;
  reading.done = true; markSentence(reading.turn, null); render();
}
function beforeSpeaking() { if (IOS) releaseMic(); }  // on iPhone and iPad an open microphone sends the sound to the quiet earpiece
function stopVoice() {
  voiceGen += 1;
  try { speechSynthesis.cancel(); } catch {}
  if (voiceEl && voicePlaying) { voiceEl.pause(); voiceEl.onended = null; voiceEl.onerror = null; }
  voiceQueue.forEach((q) => URL.revokeObjectURL(q.url)); voiceQueue = []; voicePlaying = false;
  tinyId += 1; tinyWorker?.postMessage({ type: 'stop' });
  if (reading && !reading.done) { reading.stopped = true; markSentence(reading.turn, null); }
  render();
}
function readTurn(turn, from = 0, auto = false) {
  stopVoice();
  const v = $('voice').value;
  if (v === 'off') { if (!auto) status(tx('Reading aloud is off: choose a voice in Voice settings.', 'La lectura en voz alta está apagada: elige una voz en Ajustes de voz.')); return; }
  reading = { turn, gen: voiceGen, pos: from, done: false, stopped: false, genDone: false, via: v === 'system' ? 'system' : 'player' };
  beforeSpeaking();
  if (v === 'system') readSystem(turn.sentences, from, reading.gen); else readTiny(turn.sentences, from, reading.gen);
  render();
}
// Spanish answers are read by the phone's own Spanish voice (Lars, 17 Nov 2026: "with phones output for Spanish"; tiny-voca speaks
// English only): a Mexican voice first (Juan or Paulina on an iPhone, an "Enhanced" one if the owner downloaded it), then US Spanish
// (Android's Google voice), then any Spanish; never the joke voices Apple lists for every language (Eddy, Grandma, Rocko...).
const JOKE_VOICES = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
function spanishVoice(all) {
  const lang = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  const rank = (v) => ({ 'es-mx': 0, 'es-us': 10, 'es-419': 15 }[lang(v)] ?? 20) + (/juan/i.test(v.name) ? 0 : /paulina/i.test(v.name) ? 1 : 3) - (/enhanced|premium|mejorad/i.test(v.name) ? 2 : 0);
  return all.filter((v) => /^es(-|$)/.test(lang(v)) && !JOKE_VOICES.test(v.name)).sort((a, b) => rank(a) - rank(b))[0] || null;
}
function readSystem(list, from, gen, standIn = false) {
  if (!('speechSynthesis' in window)) { status(tx('This browser has no voice of its own.', 'Este navegador no tiene voz propia.')); return; }
  let voice = null;
  if (ES) voice = spanishVoice(speechSynthesis.getVoices());
  else { const vs = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('en')); voice = vs.find((x) => /daniel|alex|fred|aaron|david|male|guy|james|arthur/i.test(x.name)) || vs[0] || null; }
  let ended = 0;
  for (let i = from; i < list.length; i++) {
    const u = new SpeechSynthesisUtterance(list[i]); u.voice = voice; if (ES) u.lang = voice ? voice.lang : 'es-MX'; u.rate = 1.0;
    u.onstart = () => { if (reading && reading.gen === gen) { reading.pos = i; markSentence(reading.turn, i); } };
    u.onend = () => { ended += 1; if (ended >= list.length - from && gen === voiceGen) finishReading(gen); };
    speechSynthesis.speak(u);
  }
  if (!standIn) status('');
}
async function readTiny(list, from, gen) {
  const id = ++tinyId;
  try {
    await tinyLoad();
    if (gen !== voiceGen || id !== tinyId) return;
    tinyWorker.postMessage({ type: 'speak', id, sentences: list.slice(from), base: from, voice: tinyMale, speed: 1.0, pitch: Number(store.get('pitch', '-0.3')) || 0 });
  } catch (err) {
    if (gen !== voiceGen) return;
    status(`The voice could not start on this phone (${shortErr(err)}). Its own voice reads instead.`);
    if (reading) reading.via = 'system';
    readSystem(list, from, gen, true);
  }
}
let tinyWorker = null, tinyReady = null, tinyLoaded = false, tinyMale = 1, tinyId = 0, tinyFailed = '';
function warmVoice() { if (!quiet && $('voice').value === 'tinyvoca') tinyLoad().catch(() => {}); }  // Quiet needs no voice: nothing to download
function tinyLoad() {
  if (tinyReady) return tinyReady;
  if (tinyFailed) return Promise.reject(new Error(tinyFailed));
  const failed = (why) => { tinyFailed = why || 'failed'; tinyWorker?.terminate(); tinyWorker = null; tinyReady = null; prep.voice = { error: tinyFailed }; render(); return new Error(tinyFailed); };
  tinyWorker = new Worker('tinyvoca-worker.js?v=20261118d');
  prep.voice = { frac: 0 }; render();
  tinyReady = new Promise((resolve, reject) => {
    tinyWorker.onmessage = ({ data }) => {
      if (data.type === 'status') {
        if (!tinyLoaded) { const p = data.progress || 0, t = String(data.text || ''); const f = /Starting/.test(t) ? 0.95 : /voice/.test(t) ? 0.35 + 0.6 * p : /dictionary/.test(t) ? 0.1 + 0.25 * p : 0.05; prep.voice = { frac: Math.max(prep.voice?.frac || 0, f) }; render(); }
      } else if (data.type === 'ready') {
        tinyLoaded = true; tinyMale = Math.max(0, (data.voices || []).indexOf('M2')); keepStorage(); prep.voice = 'ready'; prepFinished(); resolve();
      } else if (data.type === 'sentence') { if (data.id === tinyId) enqueueVoice(wavBlob(data.audio, data.sampleRate), voiceGen, data.index); }
      else if (data.type === 'done') { if (data.id === tinyId && reading && reading.gen === voiceGen) { reading.genDone = true; if (!voicePlaying && !voiceQueue.length) finishReading(voiceGen); } }
      else if (data.type === 'error') { if (!tinyLoaded) reject(failed(data.message)); else if (data.id === tinyId) status('Voice: ' + data.message); }
    };
    tinyWorker.onerror = (e) => { if (!tinyLoaded) reject(failed('worker: ' + (e.message || 'failed'))); };
  });
  tinyWorker.postMessage({ type: 'load' });
  // Spanish names said the Spanish way (Lars, 17 Nov 2026; spanish.js): every place's name, Centro, Jardín and San Miguel de Allende
  tinyWorker.postMessage({ type: 'teach', words: spanishLexicon([...places.map((p) => p.name), 'Centro', 'Jardín', 'San Miguel de Allende']) });
  return tinyReady;
}

// ---------- settings ----------
// In Spanish the phone's own voice reads (tiny-voca speaks English only), and the choice is kept apart from the English page's.
const VOICE_KEY = ES ? 'voice-es' : 'voice', VOICE_DEFAULT = ES ? 'system' : 'tinyvoca';
if (ES) $('voice').querySelector('option[value="tinyvoca"]')?.remove();
$('voice').value = store.get(VOICE_KEY, VOICE_DEFAULT); if (!$('voice').value) $('voice').value = VOICE_DEFAULT;
$('voice').addEventListener('change', () => { store.set(VOICE_KEY, $('voice').value); if ($('voice').value === 'tinyvoca' && tinyFailed) { tinyFailed = ''; prep.voice = null; } if ($('voice').value === 'tinyvoca') warmVoice(); render(); });
const saveData = !!(navigator.connection && navigator.connection.saveData);
$('preload').checked = store.get('preload', saveData ? '0' : '1') === '1';
$('preload').addEventListener('change', () => { store.set('preload', $('preload').checked ? '1' : '0'); if ($('preload').checked) startBackground(true); });
$('setBtn').addEventListener('click', () => { $('sheet').classList.remove('hide'); micTip(); render(); });
$('setClose').addEventListener('click', () => $('sheet').classList.add('hide'));
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').classList.add('hide'); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('sheet').classList.add('hide'); closeDetail(); } });
$('testVoice').addEventListener('click', () => { unlockAudio(); warmVoice(); readTurn({ el: null, sentences: ES ? ['Hola desde San Miguel de Allende.', 'Si me escuchas, la voz funciona.'] : ['Hello from San Miguel de Allende.', 'If you can hear me, the voice works.'], marks: [] }, 0); });

// Speech recognition and the voice load in the background, one after the other, when the browser is idle.
function startBackground(force) {
  if (!force && !$('preload').checked) { render(); return; }
  bgPlanned = true;
  const go = () => { voiceAfterAsr = true; getAsr(); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 800);
}
// ---------- Quiet (Lars, 17 Nov 2026: "Make a quiet button for user being in a public space so voice instead is show as text chat
// dialog"): nothing is read aloud, the conversation is a text chat with each answer written out, and typing is the default (the small
// mic in the typing row still listens). Kept on this phone. ----------
let quiet = store.get('quiet', '') === '1';
function setQuiet(on, first) {
  quiet = on;
  if (!first) store.set('quiet', on ? '1' : '');
  document.documentElement.classList.toggle('quiet', on);
  $('quietBtn').setAttribute('aria-checked', String(on));
  if (on) { stopVoice(); if (!rec) $('dock').classList.add('typing'); }
  else if (!first) { $('dock').classList.remove('typing'); if ($('preload').checked) warmVoice(); }
  render();
}
$('quietBtn').addEventListener('click', () => {
  setQuiet(!quiet);
  const newest = document.querySelector('#convo .turn');  // the chat runs the other way: keep the newest answer in view
  if (newest) bringIntoView(newest);
});
setQuiet(quiet, true);
// The opening screen's two buttons; the ES|EN switch in the header (i18n.js reloads the page) also counts as the choice for this tab.
document.querySelectorAll('.sp-lang').forEach((b) => b.addEventListener('click', () => chooseLang(b.dataset.lang)));
document.querySelectorAll('.lang').forEach((box) => box.addEventListener('click', chosen, true));
$('splash').classList.add('live');
render();
// A first visit loads nothing before the language is chosen: English and Spanish have different speech models (about 40 MB each).
if (!splashUp || langStored) startBackground(false);
// ?q=... asks that question when the page opens (the answer shows; it is read aloud after a tap on "🔊 Again").
const q0 = new URLSearchParams(location.search).get('q');
if (q0) ask(q0, 'silent');
