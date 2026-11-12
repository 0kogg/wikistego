'use strict';
/*
 * Cross-checks decode.html against wikistego.html:
 *   payloads produced by the full tool must decode in the standalone decoder.
 *
 *   npm install jsdom      (once, in the project root)
 *   node tests/decode.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('crypto');

const root = path.join(__dirname, '..');
const te = new TextEncoder();

/* ---- build payloads with the full tool's core ---- */
const mainHtml = fs.readFileSync(path.join(root, 'wikistego.html'), 'utf8');
const mainScript = mainHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInThisContext(mainScript, { filename: 'wikistego.inline.js' });
const S = globalThis.__stego;

function plainPayload(msg) {
  const al = S.ALPHABETS[0];
  const bytes = te.encode(msg);
  return S.frameToZwc(S.buildFrame(bytes, 0), al);
}
async function encPayload(msg, pw) {
  const al = S.ALPHABETS[0];
  const bytes = await S.aesEnc(te.encode(msg), pw);
  return S.frameToZwc(S.buildFrame(bytes, S.F_ENC), al);
}

/* ---- load the decoder ---- */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));

const dom = new JSDOM(fs.readFileSync(path.join(root, 'decode.html'), 'utf8'), {
  runScripts: 'dangerously',
  virtualConsole: vc,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  }
});
const { window } = dom;
const { document } = window;
const WS = window.WS;

function $(id) { return document.getElementById(id); }
function reveal() { return document.querySelector('#d-out .revealed'); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

let passed = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error(name + (extra ? ' — ' + extra : ''));
  passed++;
  console.log('  ok   ' + name);
}

(async function main() {
  await tick(40);

  ok('decoder boots without errors', errors.length === 0, errors.join(' | '));
  ok('is decode-only', !$('e-msg') && !$('p-encode') &&
    document.querySelectorAll('.tab').length === 0);
  ok('no api endpoint field', !$('d-api'));
  ok('WS surface is decode-only', !WS.doEncode && typeof WS.doDecode === 'function');

  $('d-wiki').value = plainPayload('standalone plain');
  $('d-pw').value = '';
  await WS.doDecode();
  await tick(15);
  ok('decodes a plain payload from the full tool',
    reveal() && reveal().textContent === 'standalone plain');

  $('d-wiki').value = await encPayload('standalone secret', 'correct horse');
  $('d-pw').value = 'correct horse';
  await WS.doDecode();
  await tick(20);
  ok('decodes an encrypted payload from the full tool',
    reveal() && reveal().textContent === 'standalone secret');
  ok('shows the encrypted badge',
    document.querySelector('#d-out .badge').textContent === 'encrypted');

  $('d-pw').value = 'wrong';
  await WS.doDecode();
  await tick(20);
  ok('wrong password is reported',
    !!document.querySelector('#d-out .item-err') &&
    /decrypt/.test(document.querySelector('#d-out .item-err').textContent));

  $('d-wiki').value = 'nothing hidden here';
  $('d-pw').value = '';
  await WS.doDecode();
  await tick(10);
  ok('missing payload is reported', /no hidden payload/.test($('d-err').textContent));

  ok('parses /wiki/ URLs', (function () {
    const p = window.__stego.parsePageUrl('https://en.wikipedia.org/wiki/Zero-width_space');
    return p && p.endpoint === 'https://en.wikipedia.org/w/api.php' &&
      p.title === 'Zero-width space';
  })());
  ok('parses index.php?title= URLs', (function () {
    const p = window.__stego.parsePageUrl('https://example.org/w/index.php?title=Foo_bar&action=raw');
    return p && p.endpoint === 'https://example.org/w/api.php' && p.title === 'Foo bar';
  })());
  ok('rejects non-URLs', window.__stego.parsePageUrl('just a title') === null);

  ok('no script errors during the run', errors.length === 0, errors.join(' | '));

  console.log('\n' + passed + ' decode checks passed\n');
})().catch((e) => {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  if (errors.length) console.error(errors.join('\n'));
  process.exit(1);
});
