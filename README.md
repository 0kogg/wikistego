# WikiStego

Source: <https://github.com/0kogg/wikistego> · Live: <https://wikistego.pages.dev>

Hide a message inside a MediaWiki page using zero-width characters, so the page looks
unchanged in the rendered article and in the visual diff.

* **`wikistego.html`** — the whole tool: encode, decode, placement helper and FAQ. One file, no
  build step, no dependencies. Open it directly in a browser.
* **`decode.html`** — a decode-only page for people who only need to read a payload. It is
  generated from the same core as `wikistego.html`, so the two can never drift apart.
* **`wikistego.min.html` / `decode.min.html`** — generated, minified builds of the same two
  pages: comments dropped, whitespace collapsed, JS identifiers mangled. Functionally identical
  and much smaller, but awkward to read. See *Minified build* below.
* **`extension/`** — a Manifest V3 add-on for Chrome/Chromium and Firefox that decodes plain
  payloads automatically on MediaWiki pages. See *Browser extension* below.

Nothing is stored: no cookies, no analytics, no `localStorage`. The only network request happens
if you explicitly press *import* on the decode tab, and it goes straight from your browser to the
wiki you named.

There are **two options**:

| | plain | encrypted |
|---|---|---|
| password | not needed | required (PBKDF2 → AES-256-GCM) |
| who can read it | anyone who knows the scheme | only holders of the passphrase |
| use when | you just want text hidden from casual readers | the message is actually secret |

Neither option hides the *existence* of the characters from someone who inspects the raw
wikitext — `?action=raw` shows them. Only the encrypted option makes the content unreadable.
Payloads on a public wiki are public; treat the passphrase as the only protection.

## Quick start

1. **encode** — type the message. Leave *encrypt with password* on, or turn it off for plain.
   The tool runs a self-test and prints the number of zero-width characters and the bytes it
   will add to the page. The counter under the box updates as you type.
2. **place** — paste the destination page's wikitext, press *find safe slots*, pick one, then
   *insert here →* and *copy patched wikitext*. This returns the whole page with the payload
   inserted at a safe spot.
3. In the wiki: **edit source** (not the visual editor) → select all → paste → save.
4. **decode** — paste `?action=raw` (or the source editor contents) and confirm it decodes. You
   can also drop a `.wiki`/`.txt` file onto the box, or paste a page URL and press *import* to
   fetch the wikitext straight from the wiki.

Step 4 is not optional on a wiki you do not control. See *Survival* below.

## Interface

* **Tabs** — encode / decode / place / faq. The FAQ contains the alphabet table, the privacy
  policy and the terms of use.
* **Themes** — *auto* (follows your OS), *light*, *midnight* and *gotham*. The choice is not
  saved anywhere, by design.
* **Stealth defaults** — midnight is the dark default; gotham is a warmer, lower-contrast
  alternative.

Quality-of-life touches: live size counter, password show/hide, `Ctrl`/`Cmd`+`Enter` to run the
active tab, drag-and-drop of source files, and a *copy* button on every decoded result. Motion
respects `prefers-reduced-motion`.

## Frame format

```
U+2060 | "WSG2" | flags | length (2B, big-endian) | payload | crc32 (4B, big-endian) | U+2060
```

* alphabet: `U+200B` = bit 0, `U+200C` = bit 1, most-significant bit first, 8 symbols per byte
* flags: bit 0 = encrypted, bits 1–3 = alphabet id, bit 4 = whitened
* the `U+2060` WORD JOINER delimiters are outside the alphabet, so they can never be confused
  with payload bits

The decoder tries three things in order:

1. every `U+2060 … U+2060` span, using each alphabet
2. if the delimiters were stripped, it scans the raw `U+200B`/`U+200C` stream for the magic
   value at any bit offset
3. as a last resort, the original prototype's format (`U+200D … U+200D`, encrypted only)

The CRC is what lets the decoder tell *"wrong password"* apart from *"the payload was
truncated or altered"* — a distinction the prototype could not make.

## Why placement matters

MediaWiki and Parsoid trim separator characters at text-node boundaries. A payload pasted at
the very start or end of a paragraph, or on a line of its own, can lose its leading or trailing
character. That is why the *place* tab refuses these locations:

* list, indent, definition and heading lines
* table syntax
* inside `[[links]]`, `{{templates}}`, `<ref>`, `<nowiki>`, HTML tags and URLs
* anything within one visible character of the start or end of a line

It prefers a position straight after a sentence-ending `.`/`!`/`?` and before a space, in the
middle of a normal paragraph — a span of ordinary running text, protected on both sides.

## Survival on a public wiki

You do not control the wiki, so assume your payload can be deleted by an edit filter, a
cleanup bot, or a human patroller. Before trusting the tool:

1. Save to **your own userspace** — `User:<you>/sandbox`. Do not put this in mainspace articles:
   it is vandalism by most wikis' rules and is reverted on sight.
2. Encode a tiny test message, place it, save, and check each channel:
   * `?action=raw`
   * `api.php?action=parse&page=…&prop=wikitext&format=json&origin=*`
   * open the page in **VisualEditor**, save with no changes, then check `?action=raw` again
3. Only if the payload survives the VisualEditor round-trip is the recipe safe to reuse.
4. Keep a local copy of the plaintext. If a bot strips the characters, nothing can recover it.

## Encryption details

* PBKDF2-HMAC-SHA256, 600 000 iterations, 16-byte random salt
* AES-256-GCM, 12-byte random IV, 128-bit tag
* blob layout: `salt(16) || iv(12) || ciphertext || tag`
* plain mode can optionally XOR the bytes with a fixed keystream ("whiten"). This only removes
  the obvious ASCII bit pattern — it is obfuscation, not encryption.

A short or reused passphrase is the weak point, since the ciphertext is public. The tool warns
below 12 characters. A typo in the passphrase is unrecoverable, which is why encode asks for it
twice.

## Size

Each byte costs 8 zero-width characters, and each character is 3 bytes in UTF-8, so a payload
adds **24 bytes to the page per byte of message** (plus an 11-byte frame, and 44 more bytes for
the salt/IV/tag when encrypted). A 60-character message is roughly 2 KB of history. Page history
shows the growth with no visible diff.

## Building the decoder

`decode.html` is generated; do not edit it by hand. After changing the core of
`wikistego.html` (the block between the `constants` and `placement` markers), rebuild it:

```sh
python3 tools/build_decode.py
```

Then run the decode tests to confirm the two files still agree.

## Minified build

`wikistego.min.html` and `decode.min.html` are generated from the readable sources with
[terser](https://terser.org/). Build the decoder first, then the minified pages:

```sh
npm install          # once — installs terser and jsdom
npm run build        # python3 tools/build_decode.py && node tools/build_min.js
```

The minified pages are behaviourally identical; the test suite encodes with the minified tool and
decodes with the minified decoder to prove it.

Obfuscation here is cosmetic. A client-side tool can always be read in devtools, and the
payload's secrecy still depends entirely on the passphrase. Use the minified files when you want a
small, hard-to-copy file to hand out — not as a security boundary.

## Browser extension

`extension/` is a Manifest V3 add-on for Chrome/Chromium and Firefox that reveals **plain**
payloads automatically.

* It runs on http(s) pages but exits immediately unless the document is MediaWiki (meta
  generator, `body.mediawiki`, or `mw.config`).
* On article views it asks the same origin for that page's `?action=raw` wikitext, decodes plain
  payloads, and shows them in a small floating panel. If `action=raw` is unavailable it falls
  back to scanning the rendered text.
* Encrypted payloads are counted in the toolbar popup but never guessed at — decryption needs the
  passphrase, so the popup links to the full tool.
* No storage, no telemetry, no third-party requests. The only fetch is same-origin, to the wiki
  already open in the tab.

Load it unpacked:

* **Chrome/Chromium** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
  select `extension/`.
* **Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → select
  `extension/manifest.json`.

Build the store zip (this also regenerates `extension/decoder.js` from the page core):

```sh
npm run build:extension
# → dist-ext/wikistego-extension.zip
```

`extension/decoder.js` is generated; edit the core in `wikistego.html` and rebuild rather than
editing it by hand. For Firefox signing, set your own `browser_specific_settings.gecko.id` in
`extension/manifest.json` first.

## Deploy to Cloudflare Pages

The site is plain static files: no Functions, no server, no runtime dependencies.

1. Push this folder to a Git repository.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Settings:
   * Framework preset: **None**
   * Build command: `node tools/build_pages.js`
   * Build output directory: `dist`
   * `npm install` is **not** needed — the script only copies files.
4. Deploy. `/` serves the full tool, `/decode.html` the decoder, and `dist/_headers` adds the
   security headers.

The build command assumes the generated files (`decode.html`, `*.min.html`) are committed. If you
edited `wikistego.html`, run `npm run build` before pushing so the derived files are fresh.

Command-line alternative:

```sh
npm run build          # regenerate decode.html + minified pages
npm run build:pages    # assemble dist/
npx wrangler pages deploy dist
```

`wrangler.toml` already points at `dist`, so `npx wrangler pages deploy` works without arguments.

### Headers

`tools/build_pages.js` writes `dist/_headers`, which Cloudflare applies to every response:

* `Content-Security-Policy` — no external assets; `connect-src https:` exists only for the
  optional page import, which may target any wiki
* `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`
* `Permissions-Policy` — camera, microphone, geolocation, payment and USB disabled
* `Cache-Control: max-age=0, must-revalidate` — HTML is always revalidated

If you ever add an external asset (font, logo, CDN), update the CSP in
`tools/build_pages.js` at the same time.

A `404.html` is generated too: Cloudflare serves it automatically for unknown paths.

## Tests

```sh
node tests/run.js        # 21 checks: crc, frame, modes, integrity, placement, legacy v1
npm install jsdom        # once
node tests/ui.js         # 31 checks: drives the real UI in a simulated browser
node tests/decode.js     # 13 checks: cross-checks decode.html against wikistego.html
node tests/min.js        # 17 checks: cross-checks the minified builds against both sources
node tests/extension.js  # 18 checks: extension manifest + content-script flow
```

`tests/run.js` needs no dependencies. The other four use jsdom to exercise the actual
encode → place → decode flow, including the wrong-password, stripped-delimiter,
page-URL-parsing and extension-panel paths. `npm test` runs all five in order (100 checks).

## License

MIT — see [LICENSE](LICENSE).
