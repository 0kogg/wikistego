'use strict';
/*
 * Test harness for wikistego.html.
 * Extracts the inline <script>, evaluates it in this context, and exercises
 * the pure carrier/crypto/placement functions through globalThis.__stego.
 *
 *   node tests/run.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'wikistego.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no <script> block found');

vm.runInThisContext(m[1], { filename: 'wikistego.inline.js' });

const S = globalThis.__stego;
const te = new TextEncoder();

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok   ' + name);
}
async function okAsync(name, fn) {
  await fn();
  passed++;
  console.log('  ok   ' + name);
}

/* ---------- helpers ---------- */
function makePayload(msg, alphId, whiten) {
  const al = S.ALPHABETS[alphId || 0];
  let bytes = te.encode(msg);
  let flags = 0;
  if (whiten) { bytes = S.whitenBytes(bytes); flags |= S.F_WHITEN; }
  flags |= (al.id << 1);
  const frame = S.buildFrame(bytes, flags);
  return { zwc: S.frameToZwc(frame, al), frame, flags };
}

async function makeEnc(msg, pw, alphId) {
  const al = S.ALPHABETS[alphId || 0];
  const bytes = await S.aesEnc(te.encode(msg), pw);
  const flags = S.F_ENC | ((al.id << 1) & 0x0e);
  const frame = S.buildFrame(bytes, flags);
  return { zwc: S.frameToZwc(frame, al), frame, flags };
}

function v1Encode(msg, pw) {
  return S.aesEnc(te.encode(msg), pw).then(function (bytes) {
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    return S.ZWJ + [...bits].map(function (b) { return b === '1' ? S.ZW1 : S.ZW0; }).join('') + S.ZWJ;
  });
}

/* ---------- tests ---------- */
(async function main() {
  console.log('\ncrc32');
  ok('empty input is 0', function () {
    assert.strictEqual(S.crc32(new Uint8Array(0)), 0);
  });
  ok('standard check vector', function () {
    assert.strictEqual(S.crc32(te.encode('123456789')), 0xCBF43926);
  });

  console.log('\nframe layout');
  ok('frame length is 7 + payload + 4', function () {
    const f = S.buildFrame(new Uint8Array(10), 0);
    assert.strictEqual(f.length, 21);
    assert.strictEqual(String.fromCharCode(f[0], f[1], f[2], f[3]), 'WSG2');
  });
  ok('zwc length is 8 per byte plus two markers', function () {
    const { zwc, frame } = makePayload('hello', 0, false);
    assert.strictEqual(zwc.length, frame.length * 8 + 2);
    assert.strictEqual(zwc[0], S.MARK);
    assert.strictEqual(zwc[zwc.length - 1], S.MARK);
  });

  console.log('\nplain mode');
  await okAsync('round-trip', async function () {
    const { zwc } = makePayload('hello seasteg', 0, false);
    const res = S.decodeText(zwc);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(await S.decryptItem(res.items[0], ''), 'hello seasteg');
  });
  await okAsync('unicode + emoji preserved', async function () {
    const msg = 'ключ 🔑 秘密';
    const { zwc } = makePayload(msg, 0, false);
    const res = S.decodeText(zwc);
    assert.strictEqual(await S.decryptItem(res.items[0], ''), msg);
  });
  await okAsync('whitened plain', async function () {
    const { zwc } = makePayload('whitened text', 0, true);
    const res = S.decodeText(zwc);
    assert.strictEqual(await S.decryptItem(res.items[0], ''), 'whitened text');
  });
  await okAsync('alphabet 1 and 2 decode', async function () {
    for (const id of [1, 2]) {
      const { zwc } = makePayload('alpha ' + id, id, false);
      const res = S.decodeText(zwc);
      assert.strictEqual(res.items.length, 1, 'alphabet ' + id);
      assert.strictEqual(await S.decryptItem(res.items[0], ''), 'alpha ' + id);
    }
  });

  console.log('\nencrypted mode');
  await okAsync('round-trip', async function () {
    const { zwc } = await makeEnc('top secret', 'correct horse battery');
    const res = S.decodeText(zwc);
    assert.strictEqual(res.items.length, 1);
    const msg = await S.decryptItem(res.items[0], 'correct horse battery');
    assert.strictEqual(msg, 'top secret');
  });
  await okAsync('wrong password rejects', async function () {
    const { zwc } = await makeEnc('top secret', 'right');
    const res = S.decodeText(zwc);
    await assert.rejects(function () { return S.decryptItem(res.items[0], 'wrong'); });
  });
  await okAsync('two ciphertexts of same message differ', async function () {
    const a = await makeEnc('same', 'pw');
    const b = await makeEnc('same', 'pw');
    assert.notStrictEqual(a.zwc, b.zwc);
  });

  console.log('\nintegrity');
  ok('single flipped symbol is rejected', function () {
    const { zwc } = makePayload('integrity test', 0, false);
    const chars = [...zwc];
    const i = 40;
    chars[i] = chars[i] === S.ZW0 ? S.ZW1 : S.ZW0;
    const res = S.decodeText(chars.join(''));
    assert.strictEqual(res.items.length, 0);
    assert.ok(res.corrupt > 0, 'expected corrupt counter');
  });
  ok('truncated payload is rejected', function () {
    const { zwc } = makePayload('truncate me please', 0, false);
    const res = S.decodeText(zwc.slice(0, zwc.length - 20));
    assert.strictEqual(res.items.length, 0);
  });
  ok('stripped delimiters are still recoverable', function () {
    const { zwc } = makePayload('no markers', 0, false);
    const res = S.decodeText(zwc.slice(1, zwc.length - 1));
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].position, null);
  });
  ok('two payloads in one page', function () {
    const p1 = makePayload('first message', 0, false).zwc;
    const p2 = makePayload('second message', 0, false).zwc;
    const page = 'Intro text. ' + p1 + ' Middle text. ' + p2 + ' End text.';
    const res = S.decodeText(page);
    assert.strictEqual(res.items.length, 2);
  });
  ok('identical plain payloads at two positions both found', function () {
    const p = makePayload('dupe', 0, false).zwc;
    const res = S.decodeText('One. ' + p + ' Two. ' + p + ' Three.');
    assert.strictEqual(res.items.length, 2);
  });

  console.log('\nlegacy v1');
  await okAsync('decodes v1 payloads from the prototype', async function () {
    const zwc = await v1Encode('legacy hello', 'oldpass');
    const res = S.decodeText(zwc);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].legacy, true);
    assert.strictEqual(await S.decryptItem(res.items[0], 'oldpass'), 'legacy hello');
  });

  console.log('\nplacement validator');
  const page = [
    '== Heading ==',
    '* a list item with a sentence. still a list',
    '[[Some link|label]] is here.',
    '{{cite web|title=A sentence.}}',
    'The opening paragraph has a real sentence. It continues with more prose right here.',
    'Another paragraph, with a comma and then more words to make it long enough.',
    '| table cell with text.',
    '   indented preformatted line with a sentence.',
    '[[Category:Things]]'
  ].join('\n');

  ok('only prose lines yield slots', function () {
    const slots = S.findSlotsImpl(page);
    assert.ok(slots.length > 0);
    const lines = page.split('\n');
    for (const s of slots) {
      const line = page.slice(s.lineStart, s.lineEnd);
      assert.ok(/^[A-Z]/.test(line), 'unexpected line: ' + JSON.stringify(line));
      assert.ok(['.', ',', ';', ':', '?', '!'].includes(page[s.pos - 1]),
        'slot must follow punctuation');
      assert.strictEqual(page[s.pos], ' ', 'slot must sit before a space');
    }
  });
  ok('slots avoid links and templates', function () {
    const slots = S.findSlotsImpl(page);
    for (const s of slots) {
      const inRange = S.protectedRanges(page).some(function (r) {
        return s.pos >= r[0] && s.pos < r[1];
      });
      assert.strictEqual(inRange, false);
    }
  });
  ok('no slots in a page with no prose', function () {
    const bare = '== H ==\n* item\n{{tpl}}\n[[Category:X]]';
    assert.strictEqual(S.findSlotsImpl(bare).length, 0);
  });
  await okAsync('inserting at a slot produces a decodable page', async function () {
    const msg = 'placed message';
    const { zwc } = makePayload(msg, 0, false);
    const slots = S.findSlotsImpl(page);
    const pos = slots[0].pos;
    const patched = page.slice(0, pos) + zwc + page.slice(pos);
    const res = S.decodeText(patched);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(await S.decryptItem(res.items[0], ''), msg);
  });

  console.log('\n' + passed + ' tests passed\n');
})().catch(function (e) {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
