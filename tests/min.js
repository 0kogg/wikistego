'use strict';
/*
 * Checks the generated minified files (wikistego.min.html, decode.min.html):
 * they must boot, encode, and decode exactly like the readable sources.
 *
 *   npm install      (once, for jsdom)
 *   npm run build
 *   node tests/min.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('crypto');

const root = path.join(__dirname, '..');
const te = new TextEncoder();

const errors = [];
function boot(file) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(file + ': ' + e.message));
  return new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), {
    runScripts: 'dangerously',
    virtualConsole: vc,
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    }
  }).window;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

let passed = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error(name + (extra ? ' — ' + extra : ''));
  passed++;
  console.log('  ok   ' + name);
}

(async function main() {
  const mainHtml = fs.readFileSync(path.join(root, 'wikistego.min.html'), 'utf8');
  const decHtml = fs.readFileSync(path.join(root, 'decode.min.html'), 'utf8');
  const srcHtml = fs.readFileSync(path.join(root, 'wikistego.html'), 'utf8');
  const srcDec = fs.readFileSync(path.join(root, 'decode.html'), 'utf8');

  ok('both minified files exist and are smaller',
    mainHtml.length < srcHtml.length && decHtml.length < srcDec.length);
  ok('no html comments survive minification',
    !mainHtml.includes('<!--') && !decHtml.includes('<!--'));
  ok('no indentation runs survive', !/\n\s{2,}/.test(mainHtml) && !/\n\s{2,}/.test(decHtml));
  ok('inline scripts cannot close the tag early',
    !/<\/script(?!>)/i.test(mainHtml.split('<script>')[1].split('</script>')[0]) &&
    !/<\/script(?!>)/i.test(decHtml.split('<script>')[1].split('</script>')[0]));

  /* ── minified main tool ── */
  const A = boot('wikistego.min.html');
  const aDoc = A.document;
  const $a = (id) => aDoc.getElementById(id);
  await tick(40);

  ok('minified tool boots without errors', errors.length === 0, errors.join(' | '));
  ok('encode ui is intact',
    !!$a('e-msg') && !!$a('e-pw') && !!$a('e-alph') &&
    aDoc.querySelectorAll('.tab').length === 4 &&
    aDoc.querySelectorAll('.panel').length === 4);
  ok('theme switcher kept four choices', $a('theme') && $a('theme').options.length === 4);
  ok('WS api is exported', A.WS && typeof A.WS.doEncode === 'function' &&
    typeof A.WS.doDecode === 'function' && typeof A.WS.importPage === 'function');

  const secret = 'minified payload ✓';
  const pass = 'minified passphrase';
  $a('e-msg').value = secret;
  $a('e-pw').value = pass;
  $a('e-pw2').value = pass;
  await A.WS.doEncode();
  await tick(30);

  const payload = $a('e-manual').value;
  ok('minified encode passes its self-test', /✓/.test($a('e-test').textContent));
  ok('minified encode produces a payload', payload.length > 0 && /[\u200b\u200c]/.test(payload));

  const plain = A.__stego.frameToZwc(
    A.__stego.buildFrame(te.encode('minified plain'), 0),
    A.__stego.ALPHABETS[0]
  );
  const plainText = await A.__stego.decryptItem(
    A.__stego.decodeText(plain).items[0], ''
  );
  ok('minified carrier round-trips plain text', plainText === 'minified plain');

  /* ── minified decoder ── */
  const B = boot('decode.min.html');
  const bDoc = B.document;
  const $b = (id) => bDoc.getElementById(id);
  await tick(40);

  ok('minified decoder is decode-only', !$b('e-msg') && !$b('d-api') &&
    bDoc.querySelectorAll('.tab').length === 0);

  $b('d-wiki').value = payload;
  $b('d-pw').value = pass;
  await B.WS.doDecode();
  await tick(30);
  const revealed = bDoc.querySelector('#d-out .revealed');
  ok('minified decoder reads the minified encoder output',
    revealed && revealed.textContent === secret);

  $b('d-pw').value = 'wrong';
  await B.WS.doDecode();
  await tick(30);
  ok('wrong password is still reported',
    !!bDoc.querySelector('#d-out .item-err') &&
    /decrypt/.test(bDoc.querySelector('#d-out .item-err').textContent));

  $b('d-wiki').value = 'no payload here';
  $b('d-pw').value = '';
  await B.WS.doDecode();
  await tick(15);
  ok('missing payload is still reported',
    /no hidden payload/.test($b('d-err').textContent));

  ok('page url parsing survives minification', (function () {
    const p = B.__stego.parsePageUrl('https://en.wikipedia.org/wiki/Zero-width_space');
    return p && p.endpoint === 'https://en.wikipedia.org/w/api.php' &&
      p.title === 'Zero-width space';
  })());

  ok('no script errors during the run', errors.length === 0, errors.join(' | '));

  console.log('\n' + passed + ' minified-build checks passed\n');
})().catch((e) => {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  if (errors.length) console.error(errors.join('\n'));
  process.exit(1);
});
