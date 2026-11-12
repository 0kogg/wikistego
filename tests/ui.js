'use strict';
/*
 * UI smoke test: loads wikistego.html in jsdom and drives the real handlers
 * (encrypted encode -> place -> decode, wrong password, plain decode, no payload).
 *
 *   npm install jsdom      (once, in the project root)
 *   node tests/ui.js
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('crypto');
const assert = require('assert');

const PATH = require('path');
const FILE = PATH.join(__dirname, '..', 'wikistego.html');
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
  }
});

const { window } = dom;
const { document } = window;
const WS = window.WS;

function tick(ms) { return new Promise((r) => setTimeout(r, ms || 0)); }
function $(id) { return document.getElementById(id); }

let passed = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error('assertion failed: ' + name + (extra ? ' — ' + extra : ''));
  passed++;
  console.log('  ok   ' + name);
}

(async function main() {
  await tick(50);

  ok('page boots without script errors', errors.length === 0, errors.join(' | '));
  ok('window.WS exported', !!WS && typeof WS.doEncode === 'function');
  ok('WebCrypto banner hidden', !$('crypto-warn').classList.contains('on'));
  ok('local-only badge shown', /no tracking/.test(document.querySelector('.local').textContent));
  ok('four tabs, no clean tab', document.querySelectorAll('.tab').length === 4 &&
    !document.querySelector('.tab[onclick*="clean"]'));
  ok('page import present, no api endpoint field', !!$('d-page') && !$('d-api') &&
    typeof WS.importPage === 'function' && !WS.loadWiki);
  ok('theme switcher present', !!$('theme') && $('theme').options.length === 4);
  ok('live counter reacts to input', (function () {
    $('e-msg').value = 'abcde';
    $('e-msg').dispatchEvent(new window.Event('input'));
    return /5 chars/.test($('e-count').textContent) && /B on page/.test($('e-count').textContent);
  })());
  ok('password toggle flips type', (function () {
    const btn = document.querySelector('.pw .eye');
    WS.togglePw('e-pw', btn);
    const shown = $('e-pw').type === 'text';
    WS.togglePw('e-pw', btn);
    return shown && $('e-pw').type === 'password';
  })());
  ok('faq has alphabet + privacy + terms', (function () {
    const faq = $('p-faq');
    return faq.querySelector('.alph') &&
      /U\+200B/.test(faq.textContent) &&
      /privacy policy/i.test(faq.textContent) &&
      /terms of use/i.test(faq.textContent);
  })());
  ok('WS exposes no removed functions', !WS.scanClean && !WS.stripFrames && !WS.loadWiki);

  /* ---------- encrypted: encode ---------- */
  $('e-msg').value = 'meet at the pier';
  $('e-pw').value = 'correct horse battery';
  $('e-pw2').value = 'correct horse battery';
  await WS.doEncode();
  await tick(20);

  ok('encode produced output', $('e-out').classList.contains('on'), $('e-err').textContent);
  ok('self-test passed', $('e-test').textContent.indexOf('\u2713') >= 0, $('e-test').textContent);
  const payload = $('e-manual').value;
  ok('payload has markers', payload[0] === '\u2060' && payload[payload.length - 1] === '\u2060');
  ok('payload is invisible ascii', /^[\u200b\u200c\u2060]+$/.test(payload));
  ok('payload size shown', $('e-chars').textContent === String(payload.length));

  /* ---------- encrypted: place ---------- */
  const page = [
    '== Sandbox ==',
    '* a list line with a sentence.',
    'The sandbox paragraph has a real sentence. It continues with more prose text here.',
    '{{cite web|title=Example.}}',
    '[[Category:Sandbox]]'
  ].join('\n');
  $('pl-wiki').value = page;
  WS.findSlots();
  await tick(10);

  const slots = document.querySelectorAll('#pl-out .slot');
  ok('placement found slots', slots.length > 0, String(slots.length));
  const snippet = slots[0].querySelector('.snip').textContent;
  ok('slot shows a marker', snippet.indexOf('\u27e6ZW\u27e7') >= 0, snippet);

  slots[0].querySelector('.btn').click();
  await tick(10);
  const patched = $('pl-patched').value;
  ok('patched textarea produced', patched.length === page.length + payload.length);
  ok('patched text contains payload', patched.indexOf(payload) >= 0);

  $('pl-check').click();
  await tick(10);
  ok('insertion verified in spot', $('pl-check-note').textContent.indexOf('\u2713') >= 0,
    $('pl-check-note').textContent);

  /* ---------- encrypted: decode ---------- */
  $('d-wiki').value = patched;
  $('d-pw').value = 'correct horse battery';
  await WS.doDecode();
  await tick(20);

  ok('decode found one payload', document.querySelectorAll('#d-out .item').length === 1);
  const revealed = document.querySelector('#d-out .revealed');
  ok('revealed message matches', revealed && revealed.textContent === 'meet at the pier',
    revealed ? revealed.textContent : 'no revealed node');
  ok('badge says encrypted', document.querySelector('#d-out .badge').textContent === 'encrypted');

  /* ---------- wrong password ---------- */
  $('d-pw').value = 'nope';
  await WS.doDecode();
  await tick(20);
  ok('wrong password reported, not silently empty',
    document.querySelector('#d-out .item-err') !== null &&
    /decrypt/.test(document.querySelector('#d-out .item-err').textContent));

  /* ---------- plain mode ---------- */
  $('e-enc').checked = false;
  WS.updateMode();
  ok('password fields hidden in plain mode', $('e-pw-wrap').style.display === 'none');
  $('e-msg').value = 'plain note';
  await WS.doEncode();
  await tick(20);
  ok('plain self-test passed', $('e-test').textContent.indexOf('\u2713') >= 0, $('e-test').textContent);
  const plainPayload = $('e-manual').value;

  $('d-wiki').value = 'Some text. ' + plainPayload + ' More text.';
  $('d-pw').value = '';
  await WS.doDecode();
  await tick(20);
  ok('plain payload decodes without password',
    document.querySelector('#d-out .revealed') &&
    document.querySelector('#d-out .revealed').textContent === 'plain note');
  ok('badge says plain', document.querySelector('#d-out .badge').textContent === 'plain');

  /* ---------- no payload ---------- */
  $('d-wiki').value = 'just ordinary wikitext here.';
  $('d-pw').value = '';
  await WS.doDecode();
  await tick(10);
  ok('missing payload reported clearly', /no hidden payload/.test($('d-err').textContent));

  ok('no script errors during the run', errors.length === 0, errors.join(' | '));

  console.log('\n' + passed + ' ui checks passed\n');
})().catch((e) => {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  if (errors.length) console.error('page errors:', errors.join('\n'));
  process.exit(1);
});
