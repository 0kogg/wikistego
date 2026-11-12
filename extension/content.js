'use strict';
/*
 * WikiStego auto decoder — content script.
 *
 * Runs on every http(s) page but exits immediately unless the document is a
 * MediaWiki article view. On a wiki it asks the same origin for the page's
 * ?action=raw wikitext, decodes plain payloads, and shows them in a panel.
 * Encrypted payloads are counted (visible in the toolbar popup) but never
 * guessed at — decryption needs the passphrase.
 *
 * No storage, no telemetry, no third-party requests: the only fetch is to the
 * wiki you are already looking at.
 */
(function () {
  if (globalThis.__wikistegoContent) return;
  globalThis.__wikistegoContent = true;

  var TOOL = 'https://wikistego.pages.dev/';
  var state = {
    wiki: false,
    scanning: false,
    messages: [],
    encrypted: 0,
    closed: false,
    panel: null
  };
  var seen = Object.create(null);
  var encSeen = Object.create(null);

  /* ── status for the toolbar popup ───────────────────────────────────── */
  try {
    chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
      if (!msg || msg.type !== 'wsg-status') return;
      reply({
        wiki: state.wiki,
        scanning: state.scanning,
        plain: state.messages.length,
        encrypted: state.encrypted
      });
    });
  } catch (e) { /* not an extension context (tests) */ }

  /* ── detection ──────────────────────────────────────────────────────── */
  function isMediaWiki() {
    var meta = document.querySelector('meta[name="generator"]');
    if (meta && /mediawiki/i.test(meta.getAttribute('content') || '')) return true;
    if (document.body && document.body.classList.contains('mediawiki')) return true;
    if (typeof mw !== 'undefined' && mw && mw.config) return true;
    return false;
  }

  function actionOf(url) {
    try { return (new URL(url).searchParams.get('action') || 'view').toLowerCase(); }
    catch (e) { return 'view'; }
  }

  function rawUrl() {
    var u = new URL(location.href);
    u.hash = '';
    u.searchParams.set('action', 'raw');
    return u.toString();
  }

  function keyOf(item) {
    var b = item.payloadBytes;
    var out = b.length + ':';
    for (var i = 0; i < b.length; i++) out += b[i].toString(36) + '.';
    return out;
  }

  /* ── decoding ───────────────────────────────────────────────────────── */
  async function collect(text) {
    if (!text || text.length < 30 || typeof __stego === 'undefined') return;
    var res;
    try { res = __stego.decodeText(text); } catch (e) { return; }

    for (var i = 0; i < res.items.length; i++) {
      var it = res.items[i];
      var k = keyOf(it);

      if (it.legacy || (it.flags & __stego.F_ENC)) {
        if (!encSeen[k]) { encSeen[k] = true; state.encrypted++; }
        continue;
      }
      if (seen[k]) continue;
      seen[k] = true;

      try {
        var msg = await __stego.decryptItem(it, '');
        if (typeof msg === 'string' && msg) state.messages.push(msg);
      } catch (e) { /* not valid UTF-8 — ignore */ }
    }
  }

  async function scan() {
    state.scanning = true;
    var raw = '';

    try {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
      var res = await fetch(rawUrl(), {
        credentials: 'same-origin',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res.ok) raw = await res.text();
    } catch (e) { /* raw unavailable — the DOM fallback still runs */ }

    if (raw) await collect(raw);
    if (!state.messages.length && document.body) {
      await collect(document.body.textContent || '');
    }

    state.scanning = false;
    if (state.messages.length && !state.closed) render();
  }

  /* ── panel ──────────────────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; },
        function () { return false; });
    }
    return Promise.resolve(false);
  }

  function render() {
    if (state.panel || state.closed) return;

    var panel = el('div');
    panel.id = 'wsg-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'WikiStego decoded messages');

    var head = el('div', 'wsg-head');
    head.appendChild(el('span', 'wsg-dot'));
    head.appendChild(el('span', 'wsg-title', 'wikistego'));
    head.appendChild(el('span', 'wsg-count',
      state.messages.length + (state.messages.length === 1 ? ' message' : ' messages')));

    var close = el('button', 'wsg-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'close');
    close.addEventListener('click', function () {
      state.closed = true;
      panel.remove();
      state.panel = null;
    });
    head.appendChild(close);

    var list = el('div', 'wsg-list');
    state.messages.forEach(function (msg) {
      var item = el('div', 'wsg-item');
      item.appendChild(el('div', 'wsg-msg', msg));

      var cp = el('button', 'wsg-copy', 'copy');
      cp.type = 'button';
      cp.addEventListener('click', function () {
        copyText(msg).then(function (ok) {
          cp.textContent = ok ? 'copied ✓' : 'copy failed';
          cp.classList.toggle('ok', ok);
          setTimeout(function () {
            cp.textContent = 'copy';
            cp.classList.remove('ok');
          }, 1600);
        });
      });
      item.appendChild(cp);
      list.appendChild(item);
    });

    var foot = el('div', 'wsg-foot');
    var open = el('a', '', 'open wikistego ↗');
    open.href = TOOL;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    foot.appendChild(open);

    if (state.encrypted > 0) {
      foot.appendChild(el('span', 'wsg-enc',
        state.encrypted + (state.encrypted === 1 ? ' encrypted' : ' encrypted')));
    }

    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(foot);
    (document.body || document.documentElement).appendChild(panel);
    state.panel = panel;

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.panel) {
        state.closed = true;
        state.panel.remove();
        state.panel = null;
      }
    }, { once: true });
  }

  /* ── go ─────────────────────────────────────────────────────────────── */
  if (!isMediaWiki()) return;

  state.wiki = true;
  if (actionOf(location.href) !== 'view') return;

  scan();
})();
