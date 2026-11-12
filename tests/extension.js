'use strict';
/*
 * Checks the browser extension without a browser:
 *   - manifest points at real files and is MV3
 *   - content script decodes plain payloads from ?action=raw
 *   - DOM fallback, encrypted handling, dedupe, non-wiki pages
 *
 *   npm install      (once, for jsdom)
 *   npm run build:extension
 *   node tests/extension.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'extension');
const te = new TextEncoder();

/* ── payloads, built with the same core as the tool ───────────────────── */
const mainScript = fs
  .readFileSync(path.join(root, 'wikistego.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInThisContext(mainScript, { filename: 'wikistego.inline.js' });
const S = globalThis.__stego;

function plain(msg) {
  return S.frameToZwc(S.buildFrame(te.encode(msg), 0), S.ALPHABETS[0]);
}
async function encrypted(msg, pw) {
  return S.frameToZwc(S.buildFrame(await S.aesEnc(te.encode(msg), pw), S.F_ENC), S.ALPHABETS[0]);
}

const decoder = fs.readFileSync(path.join(ext, 'decoder.js'), 'utf8');
const content = fs.readFileSync(path.join(ext, 'content.js'), 'utf8');

const WIKI_HTML =
  '<!doctype html><html><head>' +
  '<meta name="generator" content="MediaWiki 1.42.1">' +
  '</head><body class="mediawiki"><p id="article">Some ordinary article text.</p></body></html>';

const WIKI_URL = 'https://en.wikipedia.org/wiki/Target';

function makePage(opts) {
  const dom = new JSDOM(opts.html, {
    url: opts.url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  let listener = null;
  let fetches = 0;

  w.chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } }
  };

  w.fetch = function () {
    fetches++;
    if (opts.fetchFails) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, text: async () => opts.raw || '' });
  };

  if (opts.bodyHtml) w.document.getElementById('article').textContent = opts.bodyHtml;

  w.eval(decoder);
  w.eval(content);

  return {
    w,
    doc: w.document,
    fetches: () => fetches,
    status: () => new Promise((resolve) => {
      if (!listener) return resolve(null);
      listener({ type: 'wsg-status' }, null, resolve);
    })
  };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 1200);
  while (Date.now() < end) {
    if (fn()) return true;
    await tick(10);
  }
  return false;
}
const panel = (doc) => doc.getElementById('wsg-panel');
const messages = (doc) => Array.from(doc.querySelectorAll('#wsg-panel .wsg-msg')).map((n) => n.textContent);

let passed = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error(name + (extra ? ' — ' + extra : ''));
  passed++;
  console.log('  ok   ' + name);
}

(async function main() {
  /* ── manifest ── */
  const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  ok('manifest is MV3', mf.manifest_version === 3);
  ok('manifest files all exist', (function () {
    const files = [
      mf.action.default_popup,
      ...mf.content_scripts[0].js,
      ...mf.content_scripts[0].css,
      ...Object.values(mf.icons)
    ];
    return files.every((f) => fs.existsSync(path.join(ext, f)));
  })());
  ok('content script runs on http(s) pages', mf.content_scripts[0].matches.includes('*://*/*'));
  ok('firefox id present', !!(mf.browser_specific_settings && mf.browser_specific_settings.gecko.id));

  /* ── plain payload ── */
  {
    const secret = 'meet me at the usual place';
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL,
      raw: 'Ordinary wikitext. ' + plain(secret) + ' More text.'
    });
    ok('fetches the raw wikitext', await waitFor(() => page.fetches() === 1));
    ok('panel appears with the message', await waitFor(() => panel(page.doc) && messages(page.doc).length === 1));
    ok('message text is correct', messages(page.doc)[0] === secret);
    ok('header counts one message',
      /1 message/.test(page.doc.querySelector('#wsg-panel .wsg-count').textContent));
    const st = await page.status();
    ok('popup status reports one plain message', st && st.wiki && !st.scanning && st.plain === 1);
  }

  /* ── decoded text is never treated as html ── */
  {
    const secret = '<b>not bold</b> & <img src=x onerror=alert(1)>';
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL,
      raw: 'X ' + plain(secret) + ' Y'
    });
    await waitFor(() => panel(page.doc) && messages(page.doc).length === 1);
    ok('decoded text is inserted as text, not html',
      !page.doc.querySelector('#wsg-panel b') &&
      messages(page.doc)[0] === secret);
  }

  /* ── encrypted only: no panel, but the popup sees it ── */
  {
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL,
      raw: 'X ' + await encrypted('top secret', 'passphrase') + ' Y'
    });
    await waitFor(() => false, 80);
    const st = await page.status();
    ok('encrypted-only payload produces no panel', !panel(page.doc));
    ok('popup reports the encrypted payload', st && st.encrypted === 1 && st.plain === 0);
  }

  /* ── DOM fallback when raw fails ── */
  {
    const secret = 'survived the parser';
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL,
      fetchFails: true,
      bodyHtml: 'Article text ' + plain(secret) + ' end.'
    });
    ok('falls back to the rendered DOM',
      await waitFor(() => panel(page.doc) && messages(page.doc).length === 1));
    ok('DOM fallback decodes the message', messages(page.doc)[0] === secret);
  }

  /* ── dedupe: same payload in raw and DOM ── */
  {
    const secret = 'only once';
    const p = plain(secret);
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL,
      raw: 'A ' + p + ' B',
      bodyHtml: 'A ' + p + ' B'
    });
    await waitFor(() => panel(page.doc) && messages(page.doc).length === 1);
    await tick(40);
    ok('same payload is shown once', messages(page.doc).length === 1);
  }

  /* ── non-wiki and non-view pages do nothing ── */
  {
    const page = makePage({
      html: '<!doctype html><html><body><p>just a blog</p></body></html>',
      url: 'https://example.com/post',
      raw: 'x ' + plain('should not show') + ' y'
    });
    await tick(60);
    const st = await page.status();
    ok('non-mediawiki page is ignored', !panel(page.doc) && page.fetches() === 0 && st && !st.wiki);
  }
  {
    const page = makePage({
      html: WIKI_HTML,
      url: WIKI_URL + '?action=edit',
      raw: 'x ' + plain('nope') + ' y'
    });
    await tick(60);
    ok('edit/history views are skipped', !panel(page.doc) && page.fetches() === 0);
  }

  /* ── zip ── */
  ok('store zip was generated',
    fs.existsSync(path.join(root, 'dist-ext', 'wikistego-extension.zip')));

  console.log('\n' + passed + ' extension checks passed\n');
})().catch((e) => {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
