#!/usr/bin/env node
/*
 * Assemble the static site for Cloudflare Pages.
 *
 * Output: ./dist
 *   index.html          the full tool (a copy of wikistego.html)
 *   wikistego.html      same file, kept so the in-page links resolve
 *   decode.html         readable decode-only page
 *   wikistego.min.html  minified full tool
 *   decode.min.html     minified decode-only page
 *   404.html            styled not-found page
 *   _headers            security + cache headers
 *
 * No dependencies — it only copies and writes small text files, so the
 * Cloudflare Pages build needs nothing but a Node runtime.
 *
 *   node tools/build_pages.js
 *
 * Regenerate the derived sources first if you edited wikistego.html:
 *   python3 tools/build_decode.py && node tools/build_min.js
 * (or `npm run build`). `npm run build:pages` does both, then assembles.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PAGES = [
  ['wikistego.html', 'index.html'],
  ['wikistego.html', 'wikistego.html'],
  ['decode.html', 'decode.html'],
  ['wikistego.min.html', 'wikistego.min.html'],
  ['decode.min.html', 'decode.min.html']
];

const HEADERS = `# WikiStego — Cloudflare Pages headers
#
# The pages are self-contained (inline style + script, no external assets),
# so the policy can be strict. connect-src stays open to https: because the
# optional "import a page" feature fetches a wiki API chosen by the user.

/*
  Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Cache-Control: public, max-age=0, must-revalidate
`;

const NOT_FOUND = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>404 — WikiStego</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230c1120'/%3E%3Ccircle cx='16' cy='16' r='5' fill='%237c9cff'/%3E%3C/svg%3E">
<style>
:root { --bg:#070a12; --surface:#0c1120; --accent:#7c9cff; --text:#dce4f8; --muted:#7f8cae; --dim:#4d5878;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace }
@media (prefers-color-scheme: light) {
  :root { --bg:#eef1f8; --surface:#ffffff; --accent:#4c5fd5; --text:#171a2b; --muted:#545e7a; --dim:#949db9 }
}
* { margin:0; padding:0; box-sizing:border-box }
body { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
  background:var(--bg); color:var(--text); font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
.card { background:var(--surface); border:1px solid var(--dim); border-radius:10px; padding:26px 28px;
  max-width:340px; width:100%; text-align:center }
.code { font-family:var(--mono); font-size:34px; font-weight:600; color:var(--accent); letter-spacing:-.02em }
.msg { font-family:var(--mono); font-size:12px; color:var(--muted); margin:10px 0 18px; line-height:1.7 }
a { font-family:var(--mono); font-size:12px; color:var(--accent); text-decoration:none }
a:hover { text-decoration:underline }
</style>
</head>
<body>
<div class="card">
  <div class="code">404</div>
  <div class="msg">nothing at this address —<br>maybe the payload was already stripped.</div>
  <a href="/">← back to wikistego</a>
</div>
</body>
</html>
`;

function read(name) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) {
    throw new Error(
      'missing ' + name + ' — run `npm run build` first ' +
      '(python3 tools/build_decode.py && node tools/build_min.js)'
    );
  }
  return fs.readFileSync(p);
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const written = [];
  for (const [src, dest] of PAGES) {
    fs.writeFileSync(path.join(DIST, dest), read(src));
    written.push(dest);
  }
  fs.writeFileSync(path.join(DIST, '404.html'), NOT_FOUND, 'utf8');
  fs.writeFileSync(path.join(DIST, '_headers'), HEADERS, 'utf8');
  written.push('404.html', '_headers');

  console.log('assembled dist/ for Cloudflare Pages:');
  for (const f of written.sort()) {
    const size = fs.statSync(path.join(DIST, f)).size;
    console.log('  ' + f.padEnd(20) + (size / 1024).toFixed(1) + ' KB');
  }
  console.log('\nCloudflare Pages settings:');
  console.log('  build command    node tools/build_pages.js');
  console.log('  output directory dist');
}

try {
  main();
} catch (e) {
  console.error('build failed:', e && e.message ? e.message : e);
  process.exit(1);
}
