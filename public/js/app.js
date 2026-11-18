/* VIBENT chat client. Conversation state lives only in this page (no persistence). */
(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 20000;
  const MAX_LENGTH = 500;

  const els = {
    chat: document.getElementById('chat'),
    empty: document.getElementById('empty'),
    messages: document.getElementById('messages'),
    form: document.getElementById('composer'),
    input: document.getElementById('input'),
    send: document.getElementById('send'),
    hint: document.getElementById('composer-hint'),
    status: document.getElementById('status'),
    banner: document.getElementById('demo-banner'),
    newChat: document.getElementById('new-chat'),
    dialog: document.getElementById('details'),
    dialogContent: document.getElementById('details-content'),
    dialogClose: document.getElementById('details-close')
  };

  const state = {
    messages: [],      // { role: 'user' | 'bot', text, data? }
    context: null,     // paging context returned by the server, used for "show me more"
    pending: false,
    source: null
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- DOM helpers ----------
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  const yearOf = (date) => (typeof date === 'string' && date.length >= 4 ? date.slice(0, 4) : '');
  const formatRating = (r) => (typeof r === 'number' && r > 0 ? r.toFixed(1) : null);

  function scrollToNode(node) {
    node.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function scrollToBottom() {
    els.chat.scrollTop = els.chat.scrollHeight;
  }

  // ---------- Status ----------
  function pill(text, kind) {
    return el('span', { class: `pill ${kind}`, text });
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      state.source = data.source;
      els.status.replaceChildren(
        data.source === 'tmdb' ? pill('Live TMDB', 'live') : pill('Demo data', 'demo'),
        pill(data.interpreter === 'openai' ? 'OpenAI parsing' : 'Rule-based parsing', 'plain')
      );
      els.banner.hidden = data.source !== 'demo';
    } catch {
      els.status.replaceChildren(pill('Server offline', 'offline'));
    }
  }

  // ---------- Rendering ----------
  function startConversation() {
    els.empty.hidden = true;
    els.newChat.hidden = false;
  }

  function renderUser(text) {
    const node = el('li', { class: 'msg user' }, [
      el('div', { class: 'msg-body' }, el('div', { class: 'bubble', text }))
    ]);
    els.messages.append(node);
    scrollToBottom();
  }

  function botShell(extraClass = '') {
    const body = el('div', { class: 'msg-body' });
    const node = el('li', { class: `msg bot ${extraClass}`.trim() }, [
      el('div', { class: 'avatar', 'aria-hidden': 'true', text: 'V' }),
      body
    ]);
    els.messages.append(node);
    return { node, body };
  }

  function showTyping() {
    const { node, body } = botShell('typing-msg');
    body.append(el('div', { class: 'bubble' },
      el('span', { class: 'typing' }, [
        el('span', { class: 'dots', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
        el('span', { text: 'Finding movies…' })
      ])));
    scrollToBottom();
    return node;
  }

  function interpretationTags(data) {
    const f = data.interpretation;
    const tags = [];
    if (data.source === 'demo' && data.movies.length) tags.push(el('span', { class: 'tag demo', text: 'Demo data, not TMDB' }));
    if (!f) return tags;

    if (f.kind === 'search') tags.push(el('span', { class: 'tag', text: `Title search: ${f.query}` }));
    if (f.kind === 'similar') tags.push(el('span', { class: 'tag', text: `Similar to: ${f.query}` }));
    for (const g of f.genres || []) tags.push(el('span', { class: 'tag', text: g }));
    if (f.year_from && f.year_to) tags.push(el('span', { class: 'tag', text: f.year_from === f.year_to ? `${f.year_from}` : `${f.year_from}–${f.year_to}` }));
    else if (f.year_from) tags.push(el('span', { class: 'tag', text: `${f.year_from}+` }));
    else if (f.year_to) tags.push(el('span', { class: 'tag', text: `Up to ${f.year_to}` }));
    if (f.min_rating) tags.push(el('span', { class: 'tag', text: `Rated ${f.min_rating}+` }));
    if (f.kind === 'discover') tags.push(el('span', { class: 'tag', text: f.sort_by === 'vote_average.desc' ? 'Top rated' : 'Popular' }));
    if (f.mood) tags.push(el('span', { class: 'tag', text: `Mood: ${f.mood}` }));
    tags.push(el('span', {
      class: 'tag subtle',
      title: 'How your message was converted into search filters',
      text: data.interpreter === 'openai' ? 'Parsed by OpenAI' : 'Parsed by rules'
    }));
    return tags;
  }

  function movieCard(movie) {
    const title = movie.title || 'Untitled';
    const year = yearOf(movie.release_date);
    const rating = formatRating(movie.rating);

    const poster = movie.poster_url
      ? el('img', { class: 'poster', src: movie.poster_url, alt: `Poster for ${title}`, loading: 'lazy', width: '342', height: '513' })
      : el('div', { class: 'poster placeholder', 'aria-hidden': 'true', text: movie.tmdb_url ? 'No poster available' : 'Sample title · no poster' });

    // A broken image URL falls back to the placeholder instead of an empty box.
    if (poster.tagName === 'IMG') {
      poster.addEventListener('error', () => poster.replaceWith(el('div', { class: 'poster placeholder', text: 'No poster available' })), { once: true });
    }

    const meta = el('div', { class: 'card-meta' }, [
      year ? el('span', { text: year }) : null,
      rating ? el('span', { class: 'rating', 'aria-label': `Rating ${rating} out of 10`, text: `★ ${rating}` }) : null
    ]);

    return el('article', { class: 'card' }, [
      el('button', {
        type: 'button',
        class: 'card-hit',
        'aria-label': `More about ${title}${year ? ` (${year})` : ''}`,
        onclick: () => openDetails(movie)
      }, [
        poster,
        el('div', { class: 'card-info' }, [
          el('h3', { class: 'card-title', text: title }),
          meta,
          movie.overview ? el('p', { class: 'card-overview', text: movie.overview }) : null
        ])
      ]),
      el('div', { class: 'card-footer' }, [
        el('span', { class: 'hint', text: 'Details' }),
        movie.tmdb_url
          ? el('a', { href: movie.tmdb_url, target: '_blank', rel: 'noopener noreferrer', text: 'TMDB ↗' })
          : el('span', { class: 'hint', text: 'Demo' })
      ])
    ]);
  }

  function clearOldActions() {
    els.messages.querySelectorAll('[data-ephemeral]').forEach((n) => n.remove());
  }

  function renderBot(data) {
    const { node, body } = botShell();
    body.append(el('div', { class: 'bubble', text: data.message }));

    const tags = interpretationTags(data);
    if (tags.length) body.append(el('div', { class: 'meta' }, tags));

    if (data.movies.length) body.append(el('div', { class: 'cards' }, data.movies.map(movieCard)));

    const actions = [];
    if (data.next) {
      actions.push(el('button', {
        type: 'button', class: 'chip-btn primary', text: 'Show me more', onclick: () => submit('Show me more')
      }));
    }
    for (const s of data.suggestions || []) {
      actions.push(el('button', { type: 'button', class: 'chip-btn', text: s, onclick: () => submit(s) }));
    }
    if (actions.length) body.append(el('div', { class: 'actions', 'data-ephemeral': true }, actions));

    scrollToNode(node);
  }

  function renderError(message, retryText) {
    const { node, body } = botShell('error');
    body.append(el('div', { class: 'bubble', role: 'alert', text: message }));
    if (retryText) {
      body.append(el('div', { class: 'actions', 'data-ephemeral': true },
        el('button', {
          type: 'button',
          class: 'chip-btn primary',
          text: 'Try again',
          onclick: () => { node.remove(); submit(retryText, { echo: false }); }
        })));
    }
    scrollToNode(node);
  }

  // ---------- Networking ----------
  function isValidReply(data) {
    return data && data.success === true && typeof data.message === 'string' && Array.isArray(data.movies);
  }

  function errorMessageFor(status, data) {
    if (data && data.error && typeof data.error.message === 'string') return data.error.message;
    if (status === 429) return "You're sending messages too quickly. Please wait a moment.";
    if (status >= 500) return 'The server ran into a problem. Please try again.';
    return 'Something went wrong with that request.';
  }

  function setPending(pending) {
    state.pending = pending;
    els.send.disabled = pending;
    els.messages.querySelectorAll('.chip-btn').forEach((b) => { b.disabled = pending; });
  }

  async function submit(rawText, { echo = true } = {}) {
    const text = (rawText || '').trim();
    if (state.pending) return;
    if (!text) {
      els.hint.textContent = 'Type a message first.';
      els.input.focus();
      return;
    }
    if (text.length > MAX_LENGTH) {
      els.hint.textContent = `Messages are limited to ${MAX_LENGTH} characters.`;
      return;
    }
    els.hint.textContent = '';

    startConversation();
    clearOldActions();
    if (echo) {
      state.messages.push({ role: 'user', text });
      renderUser(text);
    }

    setPending(true);
    const typing = showTyping();

    let res;
    let data = null;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: state.context }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      try { data = await res.json(); } catch { data = null; }
    } catch (err) {
      typing.remove();
      setPending(false);
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      renderError(timedOut
        ? 'That took too long. The server may be busy.'
        : "I couldn't reach the VIBENT server. Check that it's running and try again.", text);
      return;
    }

    typing.remove();
    setPending(false);

    if (!res.ok) {
      // Validation errors (4xx) won't succeed on retry, so only offer it for server errors.
      renderError(errorMessageFor(res.status, data), res.status >= 500 || res.status === 429 ? text : null);
      return;
    }
    if (!isValidReply(data)) {
      renderError('I got an unexpected response from the server.', text);
      return;
    }

    if (data.interpretation) state.context = data.next || null;
    state.messages.push({ role: 'bot', text: data.message, data });
    renderBot(data);
  }

  // ---------- Details dialog ----------
  async function openDetails(movie) {
    const title = movie.title || 'Untitled';
    els.dialogContent.replaceChildren(el('p', { class: 'details-status', text: `Loading ${title}…` }));
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');

    try {
      const res = await fetch(`/api/movies/${encodeURIComponent(movie.id)}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.movie) throw new Error(errorMessageFor(res.status, data));
      renderDetails(data.movie);
    } catch (err) {
      els.dialogContent.replaceChildren(el('p', {
        class: 'details-status error',
        text: err && err.message && !/fetch|network|signal|abort|timeout|json/i.test(err.message) ? err.message : "Couldn't load details right now."
      }));
    }
  }

  function renderDetails(m) {
    const year = yearOf(m.release_date);
    const rating = formatRating(m.rating);
    const meta = [
      year,
      m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : null,
      rating ? `★ ${rating}${m.vote_count ? ` (${m.vote_count.toLocaleString()} votes)` : ''}` : null
    ].filter(Boolean);

    els.dialogContent.replaceChildren(
      m.poster_url
        ? el('img', { class: 'poster', src: m.poster_url, alt: `Poster for ${m.title}` })
        : el('div', { class: 'poster placeholder', text: 'No poster' }),
      el('div', {}, [
        el('h2', { id: 'details-title', text: m.title }),
        m.tagline ? el('p', { class: 'details-tagline', text: m.tagline }) : null,
        el('div', { class: 'details-meta' }, meta.map((t) => el('span', { text: t }))),
        m.genres && m.genres.length ? el('div', { class: 'meta' }, m.genres.map((g) => el('span', { class: 'tag', text: g }))) : null,
        el('p', { class: 'details-overview', text: m.overview || 'No overview available.' }),
        m.tmdb_url
          ? el('a', { href: m.tmdb_url, target: '_blank', rel: 'noopener noreferrer', text: 'View on TMDB ↗' })
          : el('span', { class: 'tag demo', text: 'Demo sample, not a real movie' })
      ])
    );
  }

  // ---------- Events ----------
  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 140)}px`;
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value;
    if (!text.trim()) { submit(''); return; }
    if (state.pending) return;
    els.input.value = '';
    autosize();
    submit(text);
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.input.addEventListener('input', () => {
    autosize();
    if (els.hint.textContent) els.hint.textContent = '';
  });

  document.querySelectorAll('.prompt').forEach((btn) => {
    btn.addEventListener('click', () => submit(btn.dataset.prompt));
  });

  els.newChat.addEventListener('click', () => {
    if (state.pending) return;
    state.messages = [];
    state.context = null;
    els.messages.replaceChildren();
    els.empty.hidden = false;
    els.newChat.hidden = true;
    els.input.focus();
  });

  els.dialogClose.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) els.dialog.close(); });

  loadStatus();
  els.input.focus();
})();
