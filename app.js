'use strict';
(() => {
  // ---------- Config & data ----------
  const CFG = window.FILMAVOND_CONFIG || {};
  const DB = String(CFG.firebaseUrl || '').trim().replace(/\/+$/, '');
  const LIVE = /^https:\/\//.test(DB);
  const MAX_FILMS = 100;

  const GENRES = window.FILMAVOND_GENRES || [];
  const GENRE = Object.fromEntries(GENRES.map(([k, e, l]) => [k, { emoji: e, label: l }]));
  const CATALOG = (window.FILMAVOND_MOVIES || []).map(([id, title, year, g]) => ({
    id: 'tt' + id, title, year, genres: g.split(' '),
  }));
  const FILMS = new Map(CATALOG.map((f) => [f.id, f])); // alle bekende films (ook eigen toevoegingen)

  // ---------- Helpers ----------
  const app = document.getElementById('app');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const render = (html) => { app.innerHTML = html; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  // Sleutel voor een naam; namen zonder Latijnse letters (bv. emoji) krijgen een hash i.p.v. allemaal dezelfde sleutel.
  const keyOf = (name) => norm(name).replace(/\s+/g, '-').slice(0, 40)
    || 'n' + [...String(name || '').trim()].reduce((h, c) => (Math.imul(h, 31) + c.codePointAt(0)) >>> 0, 7).toString(36);
  const KEY_RE = /^[a-z0-9-]{1,60}$/;
  const voteKey = (v) => (typeof v.k === 'string' && KEY_RE.test(v.k) ? v.k : keyOf(v.name));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* opslag vol of geblokkeerd */ } },
  };

  const uid = (n = 8) => {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => abc[x % abc.length]).join('');
  };
  const b64e = (str) => {
    let bin = '';
    new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64d = (s) => {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copyText(text, okMsg = 'Link gekopieerd 📋') {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { window.prompt('Kopieer deze link:', text); }
  }
  async function shareUrl(url, title, text) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyText(url);
  }
  const whatsappUrl = (text, url) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

  // ---------- IMDb (posters, zoeken) ----------
  async function imdbSuggest(query) {
    const q = norm(query);
    if (!q) return [];
    const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/${q[0]}/${encodeURIComponent(q)}.json`);
    if (!res.ok) throw new Error('IMDb ' + res.status);
    const json = await res.json();
    return (json.d || []).filter((d) => d.id && d.id.startsWith('tt'));
  }

  const Posters = {
    cache: LS.get('fa.posters', {}),
    waiting: new Map(),
    queue: [],
    active: 0,
    save() { LS.set('fa.posters', this.cache); },
    seed(id, info) { this.cache[id] = info; this.save(); },
    fails: 0,
    ok: false,
    get(film) {
      if (this.cache[film.id] !== undefined) return Promise.resolve(this.cache[film.id]);
      if (!this.ok && this.fails >= 4) return Promise.resolve(null); // IMDb onbereikbaar: niet blijven proberen
      if (!this.waiting.has(film.id)) {
        this.waiting.set(film.id, new Promise((resolve) => { this.queue.push({ film, resolve }); this.pump(); }));
      }
      return this.waiting.get(film.id);
    },
    pump() {
      while (this.active < 4 && this.queue.length) {
        const { film, resolve } = this.queue.shift();
        this.active++;
        resolvePoster(film)
          .then((info) => { this.ok = true; if (info) { this.cache[film.id] = info; this.save(); } resolve(info); })
          .catch(() => { this.fails++; resolve(null); })
          .finally(() => { this.active--; this.waiting.delete(film.id); this.pump(); });
      }
    },
  };

  const pack = (d) => ({ id: d.id, img: d.i && d.i.imageUrl ? d.i.imageUrl : null, stars: d.s || '' });
  const titleOk = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
  const yearOk = (d, film) => !film.year || !d.y || Math.abs(d.y - film.year) <= 1;

  async function resolvePoster(film) {
    let byId = null, err = null;
    try {
      byId = (await imdbSuggest(film.id)).find((d) => d.id === film.id) || null;
      if (byId && titleOk(byId.l, film.title) && yearOk(byId, film)) return pack(byId);
    } catch (e) { err = e; /* val terug op zoeken op titel */ }
    if (err && film.custom) throw err; // niet als 'geen poster' cachen als IMDb niet antwoordde
    if (!film.custom) {
      const list = await imdbSuggest(film.title);
      const hit = list.find((d) => titleOk(d.l, film.title) && yearOk(d, film)) || list.find((d) => yearOk(d, film) && d.y);
      if (hit) return pack(hit);
    }
    return byId ? pack(byId) : { id: film.id, img: null, stars: '' };
  }

  const sized = (url, w) => (url ? url.replace(/\._V1_.*?\.(jpe?g|png)$/i, `._V1_QL80_UX${w}_.$1`) : url);
  const imdbUrl = (film) => `https://www.imdb.com/title/${(Posters.cache[film.id] && Posters.cache[film.id].id) || film.id}/`;

  function posterHTML(film, w = 300) {
    return `<div class="poster" data-pid="${esc(film.id)}" data-w="${w}" style="--h:${hue(film.title)}">
      <div class="poster-fallback"><span>${esc(film.title)}</span>${film.year ? `<small>${esc(film.year)}</small>` : ''}</div>
    </div>`;
  }

  const LOADED = new Set(); // al geladen posters: niet opnieuw laten infaden
  function hydratePoster(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const film = FILMS.get(el.dataset.pid);
    if (!film) return;
    Posters.get(film).then((info) => {
      if (!info) return;
      if (info.img && !el.querySelector('img')) {
        const img = new Image();
        img.alt = film.title;
        img.decoding = 'async';
        const src = sized(info.img, el.dataset.w);
        img.onload = () => { LOADED.add(src); el.classList.add('loaded'); };
        img.src = src;
        el.prepend(img);
        if (LOADED.has(src)) el.classList.add('loaded');
      }
      $$(`[data-imdb="${CSS.escape(film.id)}"]`).forEach((a) => { a.href = imdbUrl(film); });
      $$(`[data-stars="${CSS.escape(film.id)}"]`).forEach((s) => { s.textContent = info.stars ? `Met ${info.stars}` : ''; });
    });
  }

  let observer = null;
  function hydratePosters(root = app, lazy = false) {
    const els = $$('.poster[data-pid]', root);
    if (!lazy || !('IntersectionObserver' in window)) { els.forEach(hydratePoster); return; }
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { observer.unobserve(en.target); hydratePoster(en.target); } });
      }, { rootMargin: '300px' });
    }
    els.forEach((el) => observer.observe(el));
  }

  // ---------- Sessies ----------
  // Sessie: { id, name, host, target, people, live, films: [{id,title,year,genres,custom}] }
  function packSession(s) {
    return {
      v: 1, i: s.id, n: s.name, h: s.host, t: s.target, p: s.people || 0, l: s.live ? 1 : 0,
      f: s.films.map((f) => (FILMS.get(f.id) && !f.custom ? f.id.slice(2) : [f.id.slice(2), f.title, f.year || 0])),
    };
  }
  function unpackSession(o) {
    if (!o || !o.i || !Array.isArray(o.f)) throw new Error('Ongeldige sessie');
    const films = o.f.map((x) => {
      if (Array.isArray(x)) {
        const f = { id: 'tt' + x[0], title: String(x[1] || 'Onbekende film'), year: +x[2] || 0, genres: [], custom: true };
        if (!FILMS.has(f.id)) FILMS.set(f.id, f);
        return f;
      }
      return FILMS.get('tt' + x) || { id: 'tt' + x, title: 'tt' + x, year: 0, genres: [] };
    });
    films.forEach((f) => { if (!FILMS.has(f.id)) FILMS.set(f.id, f); });
    return {
      id: String(o.i).replace(/[^a-z0-9]/gi, ''), name: String(o.n || 'Filmavond'), host: String(o.h || ''),
      target: Math.min(10, Math.max(1, Math.round(+o.t) || 3)), people: Math.min(30, Math.max(0, Math.round(+o.p) || 0)),
      live: !!o.l, films,
    };
  }

  const Store = {
    all() { return LS.get('fa.sessions', {}); },
    get(id) {
      const e = this.all()[id];
      if (e && e.s) e.s.films.forEach((f) => { if (!FILMS.has(f.id)) FILMS.set(f.id, f); });
      return e || null;
    },
    put(id, patch) {
      const all = this.all();
      all[id] = Object.assign(all[id] || { votes: {}, at: Date.now() }, patch);
      LS.set('fa.sessions', all);
      return all[id];
    },
    addVote(id, vote) {
      const e = this.get(id);
      if (!e) return;
      const votes = Object.assign({}, e.votes, { [voteKey(vote)]: vote });
      this.put(id, { votes });
    },
    remove(id) { const all = this.all(); delete all[id]; LS.set('fa.sessions', all); },
  };

  const Remote = {
    async req(path, opts = {}) {
      if (!LIVE) throw new Error('Geen live database ingesteld (config.js).');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const res = await fetch(`${DB}/${path}.json`, Object.assign({ headers: { 'Content-Type': 'application/json' }, signal: ctl.signal }, opts));
        if (!res.ok) throw new Error(`Database gaf fout ${res.status}`);
        return await res.json();
      } catch (e) {
        throw e && e.name === 'AbortError' ? new Error('Geen antwoord van de database') : e;
      } finally { clearTimeout(timer); }
    },
    saveSession(s) { return this.req(`sessions/${s.id}/meta`, { method: 'PUT', body: JSON.stringify(packSession(s)) }); },
    async loadSession(id) { const m = await this.req(`sessions/${id}/meta`); return m ? unpackSession(m) : null; },
    saveVote(id, vote) { return this.req(`sessions/${id}/votes/${voteKey(vote)}`, { method: 'PUT', body: JSON.stringify(vote) }); },
    deleteVote(id, key) { return this.req(`sessions/${id}/votes/${key}`, { method: 'DELETE' }); },
    async loadVotes(id) { return (await this.req(`sessions/${id}/votes`)) || {}; },
  };

  const baseUrl = () => location.href.split('#')[0];
  const joinLink = (s) => (s.live ? `${baseUrl()}#j=${s.id}` : `${baseUrl()}#s=${b64e(JSON.stringify(packSession(s)))}`);
  const replyLink = (s, vote) => `${baseUrl()}#s=${b64e(JSON.stringify(packSession(s)))}&v=${b64e(JSON.stringify({ n: vote.name, v: vote.v, k: vote.k }))}`;
  // Stem uit een stemlink lezen (naam en sleutel komen van buitenaf: opschonen)
  function voteFromLink(raw) {
    const o = JSON.parse(b64d(raw));
    const vote = { name: String(o.n || 'Anoniem').slice(0, 40), v: String(o.v || ''), at: Date.now() };
    const k = String(o.k || '');
    if (KEY_RE.test(k)) vote.k = k;
    return vote;
  }
  const sameFilms = (a, b) => a.films.map((f) => f.id).join() === b.films.map((f) => f.id).join();

  function validVotes(s, votes) {
    const out = {};
    Object.entries(votes || {}).forEach(([k, v]) => {
      if (KEY_RE.test(k) && v && typeof v.v === 'string' && v.v.length === s.films.length && /^[012]+$/.test(v.v)) out[k] = v;
    });
    return out;
  }

  // ---------- Router ----------
  let cleanup = null;
  function route() {
    if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
    const raw = location.hash.slice(1);
    window.scrollTo(0, 0);
    document.body.classList.remove('swiping');
    if (/^(s|j)=/.test(raw)) return handleIncoming(new URLSearchParams(raw));
    const [view, id] = raw.split('/');
    switch (view) {
      case 'nieuw': return viewNew();
      case 'deel': return viewShare(id);
      case 'swipe': return viewSwipe(id);
      case 'uitslag': return viewResults(id);
      default: return viewHome();
    }
  }
  window.addEventListener('hashchange', route);

  function viewError(title, text) {
    render(`<div class="wrap center">
      <div class="big-emoji">🙈</div><h1>${esc(title)}</h1><p class="muted">${esc(text || '')}</p>
      <a class="btn" href="#">Naar de startpagina</a></div>`);
  }

  async function handleIncoming(params) {
    try {
      let s;
      if (params.get('s')) {
        s = unpackSession(JSON.parse(b64d(params.get('s'))));
      } else {
        const jid = String(params.get('j')).replace(/[^a-z0-9]/gi, '');
        const cached = Store.get(jid);
        render('<p class="loading">Sessie laden…</p>');
        try { s = await Remote.loadSession(jid); }
        catch (err) { if (!(cached && cached.s)) throw new Error('Geen verbinding met de server – probeer het straks opnieuw.'); }
        if (!s && cached && cached.s) s = cached.s; // offline: bewaarde kopie gebruiken
        if (!s) throw new Error('Deze sessie bestaat niet (meer).');
      }
      const prev = Store.get(s.id);
      if (prev && prev.s) {
        // de bewaarde sessie wint; een link kan ze niet overschrijven
        if (!sameFilms(prev.s, s)) throw new Error('Deze link hoort niet bij de sessie op dit toestel.');
        s = prev.s;
      } else {
        Store.put(s.id, { s });
      }
      const v = params.get('v');
      if (v) {
        const vote = voteFromLink(v);
        if (Object.keys(validVotes(s, { x: vote })).length !== 1) throw new Error('Deze stemlink is beschadigd.');
        Store.addVote(s.id, vote);
        toast(`Stemmen van ${vote.name} toegevoegd ✔`);
        location.replace('#uitslag/' + s.id);
      } else {
        location.replace('#swipe/' + s.id);
      }
    } catch (e) {
      viewError('Deze link werkt niet', e && e.message ? e.message : 'Vraag de link opnieuw op.');
    }
  }

  // ---------- Home ----------
  function viewHome() {
    const list = Object.entries(Store.all()).filter(([, e]) => e && e.s).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    render(`<div class="wrap">
      <header class="hero">
        <div class="logo">🍿</div>
        <h1>Filmavond</h1>
        <p class="lead">Kiezen wat je kijkt, zonder eindeloos discussiëren. Swipe samen met je vrienden door films – ❤️ of ✕ – en zie meteen waar iedereen zin in heeft.</p>
        <a class="btn btn-big" href="#nieuw">🎬 Nieuwe filmavond</a>
      </header>
      <ol class="steps">
        <li><b>Maak een sessie</b><span>Kies genres of losse films en hoeveel films er moeten overblijven.</span></li>
        <li><b>Deel de link</b><span>Stuur hem via WhatsApp of laat de QR-code scannen.</span></li>
        <li><b>Iedereen swipet</b><span>Rechts = zin in, links = liever niet, omhoog = superlike ⭐.</span></li>
        <li><b>Bekijk de matches</b><span>De films waar iedereen ja op zei komen bovenaan.</span></li>
      </ol>
      ${list.length ? `<section><h2>Jouw sessies</h2><ul class="session-list">
        ${list.map(([id, e]) => `<li>
          <div><b>${esc(e.s.name)}</b><small>${plural(e.s.films.length, 'film', 'films')} · ${plural(Object.keys(e.votes || {}).length, 'stem', 'stemmen')}${e.s.live ? ' · live' : ''}</small></div>
          <div class="row-actions">
            <a class="btn btn-small btn-ghost" href="#swipe/${id}">Swipen</a>
            <a class="btn btn-small" href="#uitslag/${id}">Uitslag</a>
            <button class="icon-btn" data-del="${id}" title="Verwijderen" aria-label="Verwijderen">🗑</button>
          </div></li>`).join('')}
      </ul></section>` : ''}
    </div>`);
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (confirm('Deze sessie van dit toestel verwijderen?')) { Store.remove(b.dataset.del); viewHome(); }
    }));
  }

  // ---------- Nieuwe sessie ----------
  function stepperHTML(name, value, min, max, zeroLabel) {
    return `<div class="stepper" data-stepper="${name}" data-min="${min}" data-max="${max}" data-zero="${esc(zeroLabel || '')}">
      <button type="button" data-d="-1" aria-label="Minder">−</button>
      <output>${value === 0 && zeroLabel ? zeroLabel : value}</output>
      <button type="button" data-d="1" aria-label="Meer">+</button></div>`;
  }
  function bindStepper(root, st) {
    $$('[data-stepper]', root).forEach((el) => {
      const name = el.dataset.stepper, min = +el.dataset.min, max = +el.dataset.max, zero = el.dataset.zero;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        st[name] = Math.min(max, Math.max(min, st[name] + +b.dataset.d));
        $('output', el).textContent = st[name] === 0 && zero ? zero : st[name];
      });
    });
  }

  function viewNew() {
    const st = { genres: new Set(), selected: new Map(), custom: [], randomN: 20, target: 3, people: 0 };
    const myName = LS.get('fa.name', '');
    const days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

    render(`<div class="wrap create">
      <a class="back" href="#">← Terug</a>
      <h1>Nieuwe filmavond</h1>

      <section class="card-section">
        <label class="field"><span>Naam van de avond</span>
          <input id="f-name" maxlength="60" placeholder="Filmavond ${days[new Date().getDay()]}" autocomplete="off"></label>
        <label class="field"><span>Jouw naam</span>
          <input id="f-host" maxlength="40" placeholder="bv. Florian" value="${esc(myName)}" autocomplete="given-name"></label>
        <div class="field-row">
          <div class="field"><span>Hoeveel films moeten er overblijven?</span>${stepperHTML('target', st.target, 1, 10)}</div>
          <div class="field"><span>Met hoeveel zijn jullie? <small>(optioneel)</small></span>${stepperHTML('people', st.people, 0, 30, '?')}</div>
        </div>
      </section>

      <section class="card-section">
        <h2>Genres</h2>
        <p class="muted small">Kies één of meer genres om de lijst te filteren – of kies hieronder zelf films.</p>
        <div class="chips" id="genres">
          ${GENRES.map(([k, e, l]) => `<button type="button" class="chip" data-genre="${k}">${e} ${esc(l)}</button>`).join('')}
        </div>
      </section>

      <section class="card-section">
        <h2>Films</h2>
        <div class="search">
          <input id="f-search" type="search" placeholder="🔎 Zoek een andere film of serie op IMDb…" autocomplete="off">
          <div id="search-results" class="search-results"></div>
        </div>
        <div class="toolbar">
          <span id="count" class="muted"></span>
          <div class="toolbar-actions">
            <select id="f-random" aria-label="Aantal willekeurige films">
              ${[10, 15, 20, 25, 30, 40].map((n) => `<option value="${n}" ${n === 20 ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-small btn-ghost" id="b-random">🎲 Willekeurig</button>
            <button type="button" class="btn btn-small btn-ghost" id="b-all">Alles</button>
            <button type="button" class="btn btn-small btn-ghost" id="b-none">Wis</button>
          </div>
        </div>
        <div class="grid" id="grid"></div>
      </section>

      <div class="sticky-bar"><button class="btn btn-big" id="b-create">Start sessie</button></div>
    </div>`);

    const grid = $('#grid');
    bindStepper(app, st);

    const filtered = () => {
      const base = st.genres.size ? CATALOG.filter((f) => f.genres.some((g) => st.genres.has(g))) : CATALOG;
      return [...st.custom, ...base];
    };

    function updateCount() {
      const n = st.selected.size;
      $('#count').textContent = n ? `${plural(n, 'film', 'films')} gekozen` : (st.genres.size ? 'Nog niets gekozen – dan nemen we willekeurige films uit deze genres' : 'Tik op films om ze te kiezen');
      const b = $('#b-create');
      if (n >= 2) { b.textContent = `Start sessie met ${n} films →`; b.disabled = false; }
      else if (!n && st.genres.size) { b.textContent = `Start met ${Math.min(st.randomN, filtered().filter((f) => !f.custom).length)} willekeurige films →`; b.disabled = false; }
      else { b.textContent = n === 1 ? 'Kies nog minstens 1 film' : 'Kies minstens 2 films of een genre'; b.disabled = true; }
    }

    function drawGrid() {
      const list = filtered();
      grid.innerHTML = list.map((f) => `<button type="button" class="tile ${st.selected.has(f.id) ? 'on' : ''}" data-id="${esc(f.id)}">
        ${posterHTML(f, 220)}<span class="tile-check">✓</span>
        <span class="tile-title">${esc(f.title)}${f.year ? ` <small>${esc(f.year)}</small>` : ''}</span></button>`).join('');
      hydratePosters(grid, true);
      updateCount();
    }

    grid.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const f = FILMS.get(t.dataset.id);
      if (st.selected.has(f.id)) st.selected.delete(f.id);
      else if (st.selected.size >= MAX_FILMS) return toast(`Maximaal ${MAX_FILMS} films per sessie`);
      else st.selected.set(f.id, f);
      t.classList.toggle('on', st.selected.has(f.id));
      updateCount();
    });

    $('#genres').addEventListener('click', (e) => {
      const c = e.target.closest('[data-genre]');
      if (!c) return;
      const g = c.dataset.genre;
      if (st.genres.has(g)) st.genres.delete(g); else st.genres.add(g);
      c.classList.toggle('on', st.genres.has(g));
      drawGrid();
    });

    const pickRandom = () => {
      const keep = st.custom.filter((f) => st.selected.has(f.id));
      st.selected = new Map(keep.map((f) => [f.id, f]));
      shuffle(filtered().filter((f) => !f.custom)).slice(0, Math.max(0, st.randomN - keep.length))
        .forEach((f) => st.selected.set(f.id, f));
    };
    $('#f-random').addEventListener('change', (e) => { st.randomN = +e.target.value; updateCount(); });
    $('#b-random').addEventListener('click', () => { pickRandom(); drawGrid(); });
    $('#b-all').addEventListener('click', () => {
      const list = filtered();
      if (list.length + st.selected.size > MAX_FILMS) toast(`Maximaal ${MAX_FILMS} films – kies een genre om te filteren`);
      [...st.custom, ...shuffle(list.filter((f) => !f.custom))].forEach((f) => { if (st.selected.size < MAX_FILMS) st.selected.set(f.id, f); });
      drawGrid();
    });
    $('#b-none').addEventListener('click', () => { st.selected.clear(); drawGrid(); });

    // IMDb zoeken
    const sInput = $('#f-search'), sBox = $('#search-results');
    let sTimer, sSeq = 0;
    sInput.addEventListener('input', () => {
      clearTimeout(sTimer);
      sSeq++; // lopende zoekopdrachten zijn nu verouderd
      const q = sInput.value.trim();
      if (q.length < 2) { sBox.innerHTML = ''; return; }
      sTimer = setTimeout(async () => {
        const seq = ++sSeq;
        sBox.innerHTML = '<p class="muted small pad">Zoeken…</p>';
        try {
          const res = (await imdbSuggest(q)).filter((d) => !d.qid || /^(movie|tvSeries|tvMiniSeries|tvMovie|video)$/.test(d.qid)).slice(0, 8);
          if (seq !== sSeq) return;
          sBox.innerHTML = res.length ? res.map((d) => `<button type="button" class="search-hit" data-hit='${esc(JSON.stringify({ id: d.id, l: d.l, y: +d.y || 0, img: d.i ? d.i.imageUrl : null, s: d.s || '' }))}'>
              ${d.i ? `<img src="${esc(sized(d.i.imageUrl, 80))}" alt="">` : '<span class="noimg">🎬</span>'}
              <span><b>${esc(d.l)}</b><small>${[d.y, d.q, d.s].filter(Boolean).map(esc).join(' · ')}</small></span><i>+</i></button>`).join('')
            : '<p class="muted small pad">Niets gevonden.</p>';
        } catch {
          if (seq === sSeq) sBox.innerHTML = '<p class="muted small pad">Zoeken via IMDb lukt niet in deze browser. Kies uit de lijst hieronder.</p>';
        }
      }, 300);
    });
    sBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hit]');
      if (!b) return;
      const d = JSON.parse(b.dataset.hit);
      let f = FILMS.get(d.id);
      if (!f) {
        f = { id: d.id, title: String(d.l || d.id), year: +d.y || 0, genres: [], custom: true };
        FILMS.set(f.id, f);
        Posters.seed(f.id, { id: d.id, img: d.img, stars: d.s });
      }
      if (f.custom && !st.custom.some((c) => c.id === f.id)) st.custom.unshift(f);
      if (st.selected.size >= MAX_FILMS) return toast(`Maximaal ${MAX_FILMS} films per sessie`);
      st.selected.set(f.id, f);
      clearTimeout(sTimer); sSeq++;
      sInput.value = ''; sBox.innerHTML = '';
      toast(`${f.title} toegevoegd`);
      drawGrid();
    });

    $('#b-create').addEventListener('click', async () => {
      const host = $('#f-host').value.trim();
      if (!host) { toast('Vul je naam in'); $('#f-host').focus(); return; }
      if (!st.selected.size && st.genres.size) pickRandom();
      if (st.selected.size < 2) { toast('Kies minstens 2 films'); return; }
      const s = {
        id: uid(), name: $('#f-name').value.trim() || $('#f-name').placeholder, host,
        // minstens 1 film minder overhouden dan er zijn, anders valt er niets te kiezen
        target: Math.min(st.target, Math.max(1, st.selected.size - 1)), people: st.people, live: LIVE, films: [...st.selected.values()],
      };
      const btn = $('#b-create');
      btn.disabled = true; btn.textContent = 'Bezig…';
      if (s.live) {
        try { await Remote.saveSession(s); }
        catch (e) { toast('Kon de sessie niet opslaan: ' + e.message); btn.disabled = false; updateCount(); return; }
      }
      LS.set('fa.name', host);
      Store.put(s.id, { s, mine: true, at: Date.now() });
      location.hash = '#deel/' + s.id;
    });

    drawGrid();
  }

  // ---------- Delen ----------
  function viewShare(id) {
    const e = Store.get(id);
    if (!e) return viewError('Sessie niet gevonden', 'Deze sessie staat niet op dit toestel.');
    const s = e.s, link = joinLink(s);
    const msg = `🍿 ${s.host ? s.host + ' nodigt je uit: ' : ''}help kiezen wat we kijken op "${s.name}"! Swipe hier:`;
    render(`<div class="wrap center share">
      <a class="back" href="#">← Start</a>
      <div class="big-emoji">📨</div>
      <h1>${esc(s.name)}</h1>
      <p class="muted">${plural(s.films.length, 'film', 'films')} · we houden er ${s.target} over${s.people ? ` · ${s.people} personen` : ''}</p>
      <div class="link-box"><input readonly value="${esc(link)}" id="link"><button class="btn btn-small" id="b-copy">Kopieer</button></div>
      <div class="btn-row">
        <button class="btn" id="b-share">📤 Deel link</button>
        <a class="btn btn-whatsapp" href="${esc(whatsappUrl(msg, link))}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      <div id="qr" class="qr" aria-label="QR-code met de link"></div>
      <div class="info">${s.live
        ? '⚡ <b>Live modus:</b> de stemmen van je vrienden komen automatisch binnen bij de uitslag.'
        : '💡 Na het swipen krijgen je vrienden een knop om hun <b>stemlink terug te sturen</b>. Open die link op dit toestel (in dezelfde browser) en hun stemmen verschijnen bij de uitslag.'}</div>
      <div class="btn-row">
        <a class="btn btn-big" href="#swipe/${id}">Zelf swipen →</a>
        <a class="btn btn-ghost" href="#uitslag/${id}">Uitslag bekijken</a>
      </div>
    </div>`);
    $('#b-copy').addEventListener('click', () => copyText(link));
    $('#link').addEventListener('focus', (ev) => ev.target.select());
    $('#b-share').addEventListener('click', () => shareUrl(link, s.name, msg));
    drawQR($('#qr'), link);
  }

  function drawQR(el, text) {
    if (typeof window.qrcode !== 'function') {
      // bibliotheek laadt async; later tekenen zodra ze er is (of weglaten als ze faalt)
      const lib = document.getElementById('qr-lib');
      if (lib && !lib.dataset.failed) {
        lib.addEventListener('load', () => { if (el.isConnected) drawQR(el, text); }, { once: true });
        lib.addEventListener('error', () => el.remove(), { once: true });
      } else el.remove();
      return;
    }
    try {
      const qr = window.qrcode(0, 'L');
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    } catch { el.remove(); }
  }

  // ---------- Swipen ----------
  function viewSwipe(id) {
    const e = Store.get(id);
    if (!e) return viewError('Sessie niet gevonden', 'Open de link die je kreeg opnieuw.');
    const s = e.s;
    if (!e.my || !e.my.name) {
      if (!(e.mine && s.host)) return askName(id, s);
      startSwiping(id, s, s.host); // de organisator kennen we al
    } else if (e.my.done) return swipeDone(id);
    swipeDeck(id);
  }

  function startSwiping(id, s, name) {
    // Elke deelnemer krijgt een eigen sleutel, zodat twee mensen met dezelfde naam elkaar niet overschrijven.
    // Opnieuw swipen met dezelfde naam houdt de sleutel, zodat de nieuwe stem de oude vervangt.
    const prev = (Store.get(id) || {}).my;
    const key = prev && prev.key && prev.name === name ? prev.key : `${keyOf(name).slice(0, 40)}-${uid(4)}`;
    Store.put(id, { my: { key, name, order: shuffle(s.films.map((_, i) => i)), v: s.films.map(() => null), pos: 0 } });
  }

  function askName(id, s) {
    render(`<div class="wrap center">
      <div class="big-emoji">🍿</div>
      <h1>${esc(s.name)}</h1>
      <p class="lead">${s.host ? `<b>${esc(s.host)}</b> wil samen een film kiezen. ` : ''}Swipe door ${plural(s.films.length, 'film', 'films')}: rechts = zin in, links = liever niet, omhoog = superlike ⭐</p>
      <form id="name-form" class="name-form">
        <label class="field"><span>Hoe heet je?</span>
          <input id="f-me" required maxlength="40" value="${esc(LS.get('fa.name', ''))}" autocomplete="given-name" placeholder="Je naam"></label>
        <button class="btn btn-big">Start met swipen →</button>
      </form>
    </div>`);
    $('#name-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = $('#f-me').value.trim().slice(0, 40);
      if (!name) return;
      LS.set('fa.name', name);
      startSwiping(id, s, name);
      swipeDeck(id);
    });
  }

  function swipeDeck(id) {
    const e = Store.get(id), s = e.s;
    const my = e.my;
    if (my.order.length !== s.films.length) { Store.put(id, { my: null }); return viewSwipe(id); }
    document.body.classList.add('swiping');
    render(`<div class="swipe">
      <header class="swipe-head">
        <a class="icon-btn" href="#" aria-label="Start">←</a>
        <div class="swipe-title"><b>${esc(s.name)}</b><small id="progress"></small></div>
        <button class="icon-btn" id="b-undo" aria-label="Ongedaan maken" title="Ongedaan maken">↶</button>
      </header>
      <div class="bar"><i id="bar"></i></div>
      <div class="deck" id="deck"></div>
      <div class="controls">
        <button class="ctl ctl-no" data-v="0" aria-label="Nee">✕</button>
        <button class="ctl ctl-super" data-v="2" aria-label="Superlike">★</button>
        <button class="ctl ctl-yes" data-v="1" aria-label="Ja">♥</button>
      </div>
    </div>`);
    const deck = $('#deck');
    let busy = false;

    function save() { Store.put(id, { my }); }

    function cardHTML(film, depth, idx) {
      return `<article class="card" data-idx="${idx}" data-depth="${depth}" style="--depth:${depth}">
        ${posterHTML(film, 600)}
        <div class="stamp stamp-yes">ZIN IN</div><div class="stamp stamp-no">NEE</div><div class="stamp stamp-super">SUPER ★</div>
        <div class="card-info">
          <h2>${esc(film.title)}</h2>
          <p>${[film.year, ...(film.genres || []).map((g) => GENRE[g] ? GENRE[g].label : g)].filter(Boolean).map(esc).join(' · ')}</p>
          <p class="stars" data-stars="${esc(film.id)}"></p>
          <a class="imdb" data-imdb="${esc(film.id)}" href="${esc(imdbUrl(film))}" target="_blank" rel="noopener">IMDb ↗</a>
        </div></article>`;
    }

    function draw() {
      const n = s.films.length;
      $('#progress').textContent = `${Math.min(my.pos + 1, n)} / ${n}`;
      $('#bar').style.width = `${(my.pos / n) * 100}%`;
      $('#b-undo').disabled = my.pos === 0;
      // bestaande kaarten behouden (geen flits), enkel diepte aanpassen en ontbrekende toevoegen
      const next = my.order.slice(my.pos, my.pos + 3);
      const existing = new Map($$('.card:not(.gone)', deck).map((c) => [+c.dataset.idx, c]));
      existing.forEach((c, idx) => { if (!next.includes(idx)) c.remove(); });
      if (my.pos >= n) return finish();
      next.forEach((idx, depth) => {
        let c = existing.get(idx);
        if (!c) { deck.insertAdjacentHTML('afterbegin', cardHTML(s.films[idx], depth, idx)); c = deck.firstElementChild; }
        c.dataset.depth = depth;
        c.style.setProperty('--depth', depth);
      });
      hydratePosters(deck);
      // posters van de volgende kaarten alvast laden
      my.order.slice(my.pos + 3, my.pos + 6).forEach((idx) => Posters.get(s.films[idx]));
      const top = $('.card[data-depth="0"]', deck);
      if (top && !top.dataset.bound) { top.dataset.bound = '1'; bindDrag(top); }
    }

    // Eén drempel voor zowel de stempels tijdens het slepen als de beslissing bij loslaten
    const limOf = (card) => Math.min(120, card.offsetWidth * 0.28);
    function setStamps(card, dx, dy) {
      const c = (x) => Math.max(0, Math.min(1, x));
      const lim = limOf(card);
      const sup = Math.abs(dx) < lim ? c(-dy / 110) : 0;
      $('.stamp-yes', card).style.opacity = c(dx / lim) * (1 - sup);
      $('.stamp-no', card).style.opacity = c(-dx / lim) * (1 - sup);
      $('.stamp-super', card).style.opacity = sup;
    }

    function decide(val) {
      if (busy || my.done || my.pos >= s.films.length) return;
      const card = $('.card[data-depth="0"]', deck);
      busy = true;
      my.v[my.order[my.pos]] = val;
      my.pos++;
      save();
      if (card) {
        card.classList.add('gone');
        card.removeAttribute('data-depth');
        card.style.transition = 'transform .35s ease-in, opacity .35s ease-in';
        const tf = val === '1' ? 'translate(130vw, -5vh) rotate(28deg)' : val === '0' ? 'translate(-130vw, -5vh) rotate(-28deg)' : 'translate(0, -130vh) rotate(0)';
        requestAnimationFrame(() => { card.style.transform = tf; card.style.opacity = '0.6'; });
        setStamps(card, val === '1' ? 200 : val === '0' ? -200 : 0, val === '2' ? -200 : 0);
        setTimeout(() => card.remove(), 380);
      }
      if (navigator.vibrate) { try { navigator.vibrate(val === '2' ? [15, 40, 15] : 12); } catch { /* */ } }
      draw();
      setTimeout(() => { busy = false; }, 120);
    }

    function undo() {
      if (my.done || my.pos === 0) return;
      my.pos--;
      my.v[my.order[my.pos]] = null;
      save();
      draw();
    }

    function bindDrag(card) {
      let sx = 0, sy = 0, dx = 0, dy = 0, pid = null;
      card.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('a,button') || busy) return;
        pid = ev.pointerId; sx = ev.clientX; sy = ev.clientY; dx = dy = 0;
        card.setPointerCapture(pid);
        card.style.transition = 'none';
        card.classList.add('dragging');
      });
      card.addEventListener('pointermove', (ev) => {
        if (ev.pointerId !== pid) return;
        dx = ev.clientX - sx; dy = ev.clientY - sy;
        card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
        setStamps(card, dx, dy);
      });
      const end = (ev) => {
        if (ev.pointerId !== pid) return;
        pid = null;
        card.classList.remove('dragging');
        const lim = limOf(card);
        if (dx > lim) decide('1');
        else if (dx < -lim) decide('0');
        else if (dy < -110 && Math.abs(dx) < lim) decide('2');
        else { card.style.transition = ''; card.style.transform = ''; setStamps(card, 0, 0); }
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    }

    function finish() {
      const vote = { k: my.key, name: my.name, v: my.v.map((x) => x || '0').join(''), at: Date.now() };
      my.done = true;
      my.synced = false;
      Store.put(id, { my });
      Store.addVote(id, vote);
      $('#b-undo').disabled = true;
      document.removeEventListener('keydown', onKey);
      setTimeout(() => swipeDone(id), 250);
    }

    $('.controls').addEventListener('click', (ev) => { const b = ev.target.closest('[data-v]'); if (b) decide(b.dataset.v); });
    $('#b-undo').addEventListener('click', undo);
    const onKey = (ev) => {
      if (my.done || !deck.isConnected || ev.altKey || ev.metaKey || ev.ctrlKey) return;
      if (ev.target && ev.target.closest && ev.target.closest('input,textarea,select')) return;
      if (ev.key === 'ArrowRight') decide('1');
      else if (ev.key === 'ArrowLeft') decide('0');
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); decide('2'); }
      else if (ev.key === 'Backspace' || ev.key === 'z') undo();
    };
    document.addEventListener('keydown', onKey);
    cleanup = () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('swiping'); };
    draw();
  }

  async function swipeDone(id) {
    if (location.hash !== '#swipe/' + id) return; // gebruiker is intussen weg genavigeerd
    document.body.classList.remove('swiping');
    const e = Store.get(id), s = e.s, my = e.my;
    const vote = { k: my.key, name: my.name, v: my.v.map((x) => x || '0').join(''), at: Date.now() };
    const likes = [...vote.v].filter((c) => c !== '0').length;
    const supers = [...vote.v].filter((c) => c === '2').length;
    const reply = replyLink(s, vote);
    const msg = `🍿 Mijn stemmen voor "${s.name}" (${my.name}):`;

    render(`<div class="wrap center">
      <div class="big-emoji">🎬</div>
      <h1>Klaar, ${esc(my.name)}!</h1>
      <p class="lead">Je had zin in ${likes} van de ${s.films.length} films${supers ? ` (${supers}× superlike ⭐)` : ''}.</p>
      <div id="done-actions"></div>
      <button class="link-btn" id="b-redo">Opnieuw swipen</button>
    </div>`);
    const box = $('#done-actions');

    if (s.live) {
      const saved = `<div class="info">✅ Je stemmen zijn opgeslagen.</div>
          <div class="btn-row"><a class="btn btn-big" href="#uitslag/${id}">Bekijk de uitslag →</a></div>`;
      // al opgeslagen: niet opnieuw versturen (anders komt een door de organisator verwijderde stem terug)
      if (my.synced) { box.innerHTML = saved; return bindRedo(); }
      box.innerHTML = '<p class="muted">Stemmen opslaan…</p>';
      try {
        await Remote.saveVote(id, vote);
        const cur = Store.get(id);
        if (cur && cur.my) Store.put(id, { my: Object.assign(cur.my, { synced: true }) });
        if (!box.isConnected) return;
        box.innerHTML = saved;
      } catch (err) {
        if (!box.isConnected) return;
        box.innerHTML = `<div class="info warn">⚠️ Opslaan mislukt (${esc(err.message)}).</div>
          <div class="btn-row"><button class="btn" id="b-retry">Opnieuw proberen</button></div>`;
        $('#b-retry').addEventListener('click', () => swipeDone(id));
      }
    } else if (e.mine) {
      box.innerHTML = `<div class="info">✅ Je stemmen staan op dit toestel. Wacht op de stemlinks van je vrienden.</div>
        <div class="btn-row"><a class="btn btn-big" href="#uitslag/${id}">Bekijk de uitslag →</a>
        <a class="btn btn-ghost" href="#deel/${id}">Link opnieuw delen</a></div>`;
    } else {
      box.innerHTML = `<div class="info"><b>Laatste stap:</b> stuur je stemmen terug naar ${esc(s.host || 'de organisator')}, anders telt je stem niet mee.</div>
        <div class="btn-row">
          <button class="btn btn-big" id="b-reply">📤 Stuur mijn stemmen</button>
          <a class="btn btn-whatsapp" href="${esc(whatsappUrl(msg, reply))}" target="_blank" rel="noopener">Via WhatsApp</a>
        </div>
        <div class="btn-row"><button class="btn btn-ghost btn-small" id="b-copy">Kopieer stemlink</button>
        <a class="btn btn-ghost btn-small" href="#uitslag/${id}">Tussenstand op dit toestel</a></div>`;
      $('#b-reply').addEventListener('click', () => shareUrl(reply, s.name, msg));
      $('#b-copy').addEventListener('click', () => copyText(reply, 'Stemlink gekopieerd 📋'));
    }

    bindRedo();
    function bindRedo() {
      $('#b-redo').addEventListener('click', () => {
        if (!confirm('Je huidige stemmen wissen en opnieuw beginnen?')) return;
        startSwiping(id, s, my.name);
        route(); // ruimt de vorige weergave netjes op
      });
    }
  }

  // ---------- Uitslag ----------
  function computeResults(s, votes) {
    const people = Object.entries(votes).map(([key, v]) => ({ key, ...v })).sort((a, b) => (a.at || 0) - (b.at || 0));
    const n = people.length;
    const rows = s.films.map((film, i) => {
      const likedBy = people.filter((p) => p.v[i] !== '0').map((p) => p.name);
      const supers = people.filter((p) => p.v[i] === '2').length;
      return { film, i, likes: likedBy.length, supers, likedBy };
    }).sort((a, b) => b.likes - a.likes || b.supers - a.supers || a.i - b.i);
    const unanimous = n ? rows.filter((r) => r.likes === n) : [];
    const T = s.target;
    const top = rows.filter((r) => r.likes > 0).slice(0, T);
    // Finale: te veel matches, of een gelijkstand op de laatste plaats(en).
    // Bij een gelijkstand gaan enkel de gelijke films door; wie al zeker bij de top hoort, blijft daar.
    let finale = [], finaleTarget = T;
    if (unanimous.length > T) finale = unanimous;
    else if (rows.length > T && top.length === T) {
      const edge = rows[T - 1];
      const locked = rows.filter((r) => r.likes > edge.likes || (r.likes === edge.likes && r.supers > edge.supers));
      const tied = rows.filter((r) => r.likes === edge.likes && r.supers === edge.supers);
      if (locked.length + tied.length > T) { finale = tied; finaleTarget = T - locked.length; }
    }
    return { people, n, rows, unanimous, top, finale, finaleTarget };
  }

  function viewResults(id) {
    const e0 = Store.get(id);
    if (!e0) return viewError('Sessie niet gevonden', 'Deze sessie staat niet op dit toestel.');
    let lastKey = '';
    let alive = true;

    function draw() {
      if (!alive) return; // intussen naar een andere pagina gegaan
      const e = Store.get(id), s = e.s;
      const votes = validVotes(s, e.votes);
      const key = JSON.stringify(votes);
      if (key === lastKey) return;
      lastKey = key;
      const R = computeResults(s, votes);
      const T = s.target, U = R.unanimous.length;
      const waiting = s.people && R.n < s.people ? s.people - R.n : 0;
      const early = R.n < 2 || waiting > 0; // nog niet iedereen: geen 'match'-oordeel en geen finale
      const unsynced = s.live && e.my && e.my.done && !e.my.synced;
      const iVoted = e.my && e.my.done && !unsynced;
      const showFinale = e.mine && !early && R.finale.length > R.finaleTarget;

      let verdict;
      if (!R.n) verdict = { icon: '⏳', title: 'Nog niemand heeft geswiped', text: 'Deel de link en swipe zelf mee.' };
      else if (!R.top.length) verdict = { icon: '😬', title: 'Niemand had zin in deze films', text: 'Probeer een nieuwe sessie met andere films.' };
      else if (early) verdict = { icon: '⏳', title: `Tussenstand (${plural(R.n, 'stem', 'stemmen')})`, text: 'Wacht tot iedereen geswiped heeft – de uitslag kan nog veranderen.' };
      else if (U === 0) verdict = { icon: '🤔', title: 'Geen film waar iedereen ja op zei', text: 'Dit zijn de films met de meeste likes.' };
      else if (U === T) verdict = { icon: '🎉', title: `Perfect! ${plural(U, 'match', 'matches')}`, text: 'Precies zoveel films als jullie wilden.' };
      else if (U < T) verdict = { icon: '🎉', title: `${plural(U, 'match', 'matches')}`, text: R.top.length > U ? `Je wilde er ${T}; aangevuld met de films met de meeste likes.` : `Je wilde er ${T}, maar geen andere film kreeg een like.` };
      else verdict = { icon: '🔥', title: `${U} films door iedereen geliked`, text: `Je wilde er maar ${T}. De top hieronder is gerangschikt op superlikes ⭐${e.mine ? ` – of doe een finale-ronde met enkel deze ${U} films` : ''}.` };

      render(`<div class="wrap results">
        <a class="back" href="#">← Start</a>
        <h1>${esc(s.name)}</h1>
        <p class="muted">${plural(s.films.length, 'film', 'films')} · doel: ${s.target} · ${s.live ? '⚡ live' : 'via stemlinks'}</p>

        <div class="people">
          ${R.people.map((p) => `<span class="person">✓ ${esc(p.name)}${e.mine ? `<button data-rm="${esc(p.key)}" aria-label="Verwijder ${esc(p.name)}">×</button>` : ''}</span>`).join('')}
          ${waiting ? Array.from({ length: waiting }, () => '<span class="person pending">⏳ …</span>').join('') : ''}
        </div>
        ${waiting ? `<p class="muted small">Nog ${plural(waiting, 'persoon', 'personen')} moet${waiting === 1 ? '' : 'en'} swipen – de uitslag kan nog veranderen.</p>` : ''}

        <div class="verdict"><span>${verdict.icon}</span><div><b>${esc(verdict.title)}</b><p>${esc(verdict.text)}</p></div></div>

        ${R.top.length ? `<h2>${R.top.length === 1 ? 'Jullie film' : `Jullie top ${R.top.length}`}</h2>
        <div class="winners">${R.top.map((r, k) => `<a class="winner" data-imdb="${esc(r.film.id)}" href="${esc(imdbUrl(r.film))}" target="_blank" rel="noopener">
            <span class="rank">${k + 1}</span>${posterHTML(r.film, 300)}
            <b>${esc(r.film.title)}</b><small>${esc(r.film.year || '')} · ${r.likes}/${R.n} ❤️${r.supers ? ` · ${r.supers} ⭐` : ''}</small></a>`).join('')}</div>` : ''}

        ${showFinale ? `<div class="info">🏁 ${R.unanimous.length > T
          ? `${R.finale.length} films kregen een ja van iedereen. Start een finale-ronde met enkel deze films om tot ${T} te komen.`
          : `Gelijkstand tussen ${R.finale.length} films voor ${R.finaleTarget === T ? '' : 'de laatste '}${plural(R.finaleTarget, 'plaats', 'plaatsen')}. Start een finale-ronde met enkel deze films.`}
          <div class="btn-row"><button class="btn" id="b-finale">Start finale-ronde (${R.finale.length} films)</button></div></div>` : ''}

        <div class="btn-row">
          ${unsynced ? `<a class="btn" href="#swipe/${id}">⚠️ Je stem is nog niet opgeslagen – opnieuw versturen</a>` : iVoted ? '' : `<a class="btn" href="#swipe/${id}">Zelf swipen</a>`}
          ${e.mine ? `<a class="btn btn-ghost" href="#deel/${id}">Link delen</a>` : ''}
          ${s.live ? '' : '<button class="btn btn-ghost" id="b-paste">Stemlink plakken</button>'}
        </div>
        <div id="paste-box" hidden class="paste-box">
          <textarea id="f-paste" rows="3" placeholder="Plak hier de stemlink(s) die je kreeg…"></textarea>
          <button class="btn btn-small" id="b-import">Toevoegen</button>
        </div>

        ${R.n ? `<h2>Volledige ranglijst</h2>
        <ol class="ranking">${R.rows.map((r) => `<li class="${R.n && r.likes === R.n ? 'match' : ''}">
          ${posterHTML(r.film, 120)}
          <div class="r-main">
            <b>${esc(r.film.title)}</b> <small>${esc(r.film.year || '')}</small>
            <div class="meter"><i style="width:${R.n ? (r.likes / R.n) * 100 : 0}%"></i></div>
            <small class="muted">${r.likes}/${R.n} ❤️${r.supers ? ` · ${r.supers} ⭐` : ''}${r.likedBy.length ? ` · ${esc(r.likedBy.join(', '))}` : ''}</small>
          </div>
          <a class="imdb small" data-imdb="${esc(r.film.id)}" href="${esc(imdbUrl(r.film))}" target="_blank" rel="noopener">IMDb</a>
        </li>`).join('')}</ol>` : ''}
      </div>`);

      hydratePosters(app, true);

      $$('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
        const p = R.people.find((x) => x.key === b.dataset.rm);
        if (!p || !confirm(`Stemmen van ${p.name} verwijderen?`)) return;
        if (s.live) { try { await Remote.deleteVote(id, p.key); } catch (err) { toast(err.message); return; } }
        const cur = Store.get(id);
        const votes2 = Object.assign({}, cur.votes);
        delete votes2[p.key];
        const patch = { votes: votes2 };
        if (cur.my && (cur.my.key === p.key || (!cur.my.key && keyOf(cur.my.name) === p.key))) patch.my = null;
        Store.put(id, patch);
        draw();
      }));

      const fin = $('#b-finale');
      if (fin) fin.addEventListener('click', () => startFinale(s, R.finale.map((r) => r.film), R.finaleTarget, fin));

      const paste = $('#b-paste');
      if (paste) {
        paste.addEventListener('click', () => { $('#paste-box').hidden = false; $('#f-paste').focus(); });
        $('#b-import').addEventListener('click', () => importPasted(id, $('#f-paste').value, draw));
      }
    }

    async function poll() {
      if (!alive) return;
      try {
        const votes = await Remote.loadVotes(id);
        if (!alive) return;
        const patch = { votes };
        const me = Store.get(id).my;
        if (me && me.done && me.synced && me.key && !votes[me.key]) {
          patch.my = null; // de organisator heeft je stem verwijderd
          toast('Je stem werd verwijderd – je kunt opnieuw swipen');
        }
        Store.put(id, patch);
        draw();
      } catch (err) {
        if (alive) toast('Live verbinding mislukt: ' + err.message);
      }
    }

    draw();
    cleanup = () => { alive = false; };
    if (e0.s.live) {
      if (!LIVE) { toast('Deze sessie is live, maar er is geen database ingesteld.'); return; }
      poll();
      const timer = setInterval(poll, 5000);
      const onVis = () => { if (!document.hidden) poll(); };
      document.addEventListener('visibilitychange', onVis);
      cleanup = () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
    }
  }

  function importPasted(id, text, redraw) {
    const s = Store.get(id).s;
    const links = String(text).match(/#s=[^\s]+/g) || [];
    let added = 0, other = 0;
    links.forEach((l) => {
      try {
        const p = new URLSearchParams(l.slice(1));
        const ses = unpackSession(JSON.parse(b64d(p.get('s'))));
        if (!p.get('v')) return;
        if (ses.id !== s.id) { other++; return; }
        if (!sameFilms(ses, s)) { other++; return; }
        const vote = voteFromLink(p.get('v'));
        if (Object.keys(validVotes(s, { x: vote })).length) { Store.addVote(id, vote); added++; }
      } catch { /* ongeldige link overslaan */ }
    });
    if (added) { toast(`${plural(added, 'stem', 'stemmen')} toegevoegd ✔`); redraw(); }
    else toast(other ? 'Die stemlink hoort bij een andere sessie.' : 'Geen geldige stemlink gevonden.');
  }

  async function startFinale(s, films, target, btn) {
    const base = s.name.replace(/ – finale( \d+)?$/, '');
    const me = (Store.get(s.id) || {}).my;
    const host = (me && me.name) || LS.get('fa.name', '') || s.host;
    const ns = { id: uid(), name: `${base} – finale`, host, target, people: s.people, live: s.live, films };
    if (ns.live) {
      btn.disabled = true;
      try { await Remote.saveSession(ns); }
      catch (e) { toast('Kon de finale niet starten: ' + e.message); btn.disabled = false; return; }
    }
    Store.put(ns.id, { s: ns, mine: true, at: Date.now() });
    location.hash = '#deel/' + ns.id;
  }

  route();
})();
