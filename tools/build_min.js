#!/usr/bin/env node
/*
 * Build wikistego.min.html and decode.min.html.
 *
 * Style and script are run through a minifier (comments dropped, whitespace
 * collapsed, JS identifiers mangled) and the markup is squeezed, so the result
 * is a single, hard-to-read file that behaves exactly like the original.
 *
 * These are build artefacts. Never edit them by hand — edit the readable
 * sources and re-run:
 *
 *     npm install          # once, pulls in terser
 *     npm run build        # decode.html + the two .min.html files
 *
 * The readable sources stay the source of truth; this script only shrinks them.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let terser;
try {
  terser = require('terser');
} catch (e) {
  console.error(
    'terser is not installed.\n' +
    'Run `npm install` in the project root first, then `npm run build:min`.'
  );
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');

/* ── css ─────────────────────────────────────────────────────────────── */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/* ── html ────────────────────────────────────────────────────────────── */
function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s*\n\s*</g, '><')   // join tags that sat on their own line
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/* ── js ──────────────────────────────────────────────────────────────── */
async function minifyJs(code, label) {
  const res = await terser.minify(code, {
    compress: { passes: 2, drop_debugger: true },
    mangle: true,                 // locals only: DOM ids and WS.* survive
    format: { comments: false, semicolons: true }
  });
  if (res.error) throw res.error;

  const out = res.code;
  // keep the inline script from being seen as an HTML comment or closing early;
  // `\!` and `\/` are identity escapes, so regexes and strings keep their meaning
  return out
    .replace(/<!--/g, '<\\!--')
    .replace(/<\/script/gi, '<\\/script');
}

/* ── one file ────────────────────────────────────────────────────────── */
async function build(srcName, outName) {
  const src = fs.readFileSync(path.join(ROOT, srcName), 'utf8');

  const styles = [];
  const scripts = [];
  let html = src
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
      styles.push(css);
      return '\u0000STYLE' + (styles.length - 1) + '\u0000';
    })
    .replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
      scripts.push(js);
      return '\u0000SCRIPT' + (scripts.length - 1) + '\u0000';
    });

  const css = styles.map(minifyCss);
  const js = [];
  for (let i = 0; i < scripts.length; i++) {
    js.push(await minifyJs(scripts[i], srcName));
  }

  html = minifyHtml(html);
  html = html
    .replace(/\u0000STYLE(\d+)\u0000/g, (_, i) => '<style>' + css[i] + '</style>')
    .replace(/\u0000SCRIPT(\d+)\u0000/g, (_, i) => '<script>' + js[i] + '</script>');

  const outPath = path.join(ROOT, outName);
  fs.writeFileSync(outPath, html, 'utf8');

  const saved = Math.round((1 - html.length / src.length) * 100);
  console.log(
    'wrote ' + outName + ' — ' +
    src.length + ' → ' + html.length + ' bytes (' + saved + '% smaller, ' +
    css.length + ' style, ' + js.length + ' script)'
  );
}

(async function main() {
  await build('wikistego.html', 'wikistego.min.html');
  await build('decode.html', 'decode.min.html');
})().catch((e) => {
  console.error('build failed:', e && e.message ? e.message : e);
  process.exit(1);
});
