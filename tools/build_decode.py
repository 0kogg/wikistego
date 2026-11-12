#!/usr/bin/env python3
"""Build decode.html — a decode-only page that shares wikistego.html's core.

The decoder is generated from wikistego.html so the carrier, CRC and crypto
code cannot drift apart. Re-run this after editing the core:

    python3 tools/build_decode.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "wikistego.html"
OUT = ROOT / "decode.html"


def main():
    html = SRC.read_text(encoding="utf-8")

    style = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
    core = re.search(
        r"(  /\* ─+ constants ─+ \*/.*?)"
        r"(  /\* ─+ placement ─+ \*/)",
        html, re.S,
    )
    if not core:
        raise SystemExit("could not find the core block in wikistego.html")
    core_js = core.group(1)

    page = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>WikiStego — decode</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230c1120'/%3E%3Ccircle cx='16' cy='16' r='5' fill='%237c9cff'/%3E%3C/svg%3E">
<style>{style}
.tag {{ font-family:var(--mono);font-size:8.5px;color:var(--muted);border:1px solid var(--border);
  border-radius:99px;padding:1px 6px;letter-spacing:.06em;text-transform:uppercase;margin-left:3px }}
a {{ color:var(--accent);text-decoration:none;font-family:var(--mono) }}
a:hover {{ text-decoration:underline }}
</style>
</head>
<body>
<div class="shell">
  <div class="hdr">
    <div>
      <div class="hdr-name"><div class="pip"></div>wikistego<span class="tag">decode</span></div>
      <div class="hdr-sub">decoder only — this file cannot encode</div>
    </div>
    <div class="hdr-tools">
      <span class="local"><span class="dot"></span>local · no tracking</span>
      <select id="theme" class="theme" onchange="WS.setTheme(this.value)" title="theme">
        <option value="auto">auto</option>
        <option value="light">light</option>
        <option value="midnight">midnight</option>
        <option value="gotham">gotham</option>
      </select>
    </div>
  </div>

  <div id="crypto-warn" class="banner"></div>

  <div class="field">
    <label>wikitext source</label>
    <textarea id="d-wiki" class="mono" placeholder="paste the page source — not the rendered page" spellcheck="false" style="min-height:150px"></textarea>
    <div class="hint">or drop a .wiki / .txt file here</div>
  </div>

  <div class="field">
    <label>import a page</label>
    <div class="inline">
      <input id="d-page" type="text" placeholder="https://en.wikipedia.org/wiki/Page">
      <button class="btn btn-s" onclick="WS.importPage()">import</button>
    </div>
    <div class="hint" id="d-import-note">fetches that page's wikitext straight from the wiki</div>
  </div>

  <div class="field pw">
    <label>password — only for encrypted</label>
    <input id="d-pw" type="password" placeholder="leave empty for plain">
    <button type="button" class="eye" onclick="WS.togglePw('d-pw',this)">show</button>
  </div>

  <div class="row">
    <button class="btn btn-p" onclick="WS.doDecode()">decode →</button>
    <button class="btn btn-s" onclick="WS.clrD()">clear</button>
  </div>

  <div id="d-err" class="errmsg" style="display:none"></div>
  <div id="d-out" class="out"></div>

  <div class="foot">
    <span><code>U+2060</code> · WSG2 · crc32 · AES-256-GCM</span>
    <span><a href="wikistego.html">full tool →</a> ·
      <a href="https://github.com/0kogg/wikistego" target="_blank" rel="noopener noreferrer">github ↗</a></span>
  </div>
</div>

<div id="toast" class="toast" role="status"></div>

<script>
(function () {{
  'use strict';

{core}
  /* ─────────────────────────── decode ui ─────────────────────────── */
  var toastTimer = null;

  function $(id) {{ return document.getElementById(id); }}
  function esc(s) {{
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }}
  function showErr(id, msg) {{ var e = $(id); e.textContent = msg; e.style.display = 'block'; }}
  function hideErr(id) {{ $(id).style.display = 'none'; }}

  function toast(msg) {{
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {{ t.classList.remove('on'); }}, 1800);
  }}

  function setTheme(v) {{
    if (!v || v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
  }}

  function togglePw(id, btn) {{
    var el = $(id);
    var show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    btn.textContent = show ? 'hide' : 'show';
  }}

  async function copyText(s) {{
    try {{ await navigator.clipboard.writeText(s); return true; }} catch (e) {{ /* fall through */ }}
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    var ok = false;
    try {{ ok = document.execCommand('copy'); }} catch (e2) {{ /* ignore */ }}
    document.body.removeChild(ta);
    return ok;
  }}

  function parsePageUrl(raw) {{
    var m = raw.match(/^https?:\\/\\/([^\\/]+)\\/wiki\\/(.+?)(?:[?#].*)?$/);
    if (m) return {{ endpoint: 'https://' + m[1] + '/w/api.php', title: decodeURIComponent(m[2]).replace(/_/g, ' ') }};
    m = raw.match(/^https?:\\/\\/([^\\/]+)\\/w\\/index\\.php\\?(?:.*&)?title=([^&#]+)/);
    if (m) return {{ endpoint: 'https://' + m[1] + '/w/api.php', title: decodeURIComponent(m[2]).replace(/_/g, ' ') }};
    m = raw.match(/^https?:\\/\\/([^\\/]+)\\/api\\.php\\?(?:.*&)?page=([^&#]+)/);
    if (m) return {{ endpoint: 'https://' + m[1] + '/api.php', title: decodeURIComponent(m[2]) }};
    return null;
  }}

  async function importPage() {{
    hideErr('d-err');
    var note = $('d-import-note');
    var raw = $('d-page').value.trim();
    if (!raw) return showErr('d-err', 'paste a wiki page URL');

    var target = parsePageUrl(raw);
    if (!target) return showErr('d-err', 'need a full page URL, e.g. https://en.wikipedia.org/wiki/Example');

    note.textContent = 'importing…';
    var url = target.endpoint + '?action=parse&page=' + encodeURIComponent(target.title) +
      '&prop=wikitext&format=json&formatversion=2&origin=*';

    try {{
      var r = await fetch(url, {{ credentials: 'omit' }});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var data = await r.json();
      if (data.error) throw new Error(data.error.info || data.error.code);
      var w = data.parse && data.parse.wikitext;
      if (w && typeof w === 'object') w = w['*'];
      if (typeof w !== 'string') throw new Error('no wikitext in response');
      $('d-wiki').value = w;
      note.textContent = 'imported "' + target.title + '" · ' + w.length + ' chars';
      toast('page imported');
    }} catch (e) {{
      note.textContent = 'fetches that page\\'s wikitext straight from the wiki';
      showErr('d-err', 'import failed: ' + e.message +
        ' — if it is CORS, open the page\\'s ?action=raw and paste it');
    }}
  }}

  function wireDrop(id) {{
    var el = $(id);
    if (!el) return;
    ['dragenter', 'dragover'].forEach(function (ev) {{
      el.addEventListener(ev, function (e) {{ e.preventDefault(); el.classList.add('drop-hover'); }});
    }});
    ['dragleave', 'drop'].forEach(function (ev) {{
      el.addEventListener(ev, function (e) {{ e.preventDefault(); el.classList.remove('drop-hover'); }});
    }});
    el.addEventListener('drop', function (e) {{
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {{ el.value = String(rd.result); toast('loaded ' + f.name); }};
      rd.readAsText(f);
    }});
  }}

  async function doDecode() {{
    hideErr('d-err');
    var out = $('d-out');
    out.innerHTML = ''; out.classList.remove('on');

    var text = $('d-wiki').value;
    var pw = $('d-pw').value;
    if (!text) return showErr('d-err', 'paste the wikitext source first');

    var res = decodeText(text);
    if (!res.items.length) {{
      if (res.corrupt) return showErr('d-err', 'a frame was found but its checksum failed — the payload was altered');
      return showErr('d-err', 'no hidden payload found');
    }}

    out.classList.add('on');
    out.innerHTML = '<div class="out-lbl">' + res.items.length +
      ' payload' + (res.items.length > 1 ? 's' : '') + ' found</div>';

    for (var i = 0; i < res.items.length; i++) {{
      var it = res.items[i];
      var card = document.createElement('div');
      card.className = 'item';

      var kind, cls;
      if (it.legacy) {{ kind = 'legacy v1'; cls = 'leg'; }}
      else if (it.flags & F_ENC) {{ kind = 'encrypted'; cls = 'enc'; }}
      else {{ kind = 'plain'; cls = 'plain'; }}

      var meta = 'alphabet ' + (ALPHABETS[it.alphabet] ? ALPHABETS[it.alphabet].label : '?') +
        ' · ' + (it.position != null ? 'at char ' + it.position : 'bit offset ' + it.bitOffset) +
        ' · ' + it.payloadBytes.length + ' bytes';

      var head = document.createElement('div');
      head.className = 'item-head';
      head.innerHTML = '<span class="badge ' + cls + '">' + kind + '</span>' +
        '<span class="meta">' + esc(meta) + '</span>';
      card.appendChild(head);

      var body = document.createElement('div');
      try {{
        if ((it.flags & F_ENC) && !pw) {{
          body.className = 'item-err';
          body.textContent = 'encrypted — enter the password';
        }} else {{
          body.className = 'revealed';
          body.textContent = await decryptItem(it, pw);
        }}
      }} catch (e) {{
        body.className = 'item-err';
        if (e.code === 'nopw') body.textContent = 'encrypted — enter the password';
        else if (it.flags & F_ENC) body.textContent = 'could not decrypt — wrong password or altered ciphertext';
        else body.textContent = 'not valid UTF-8 (' + e.message + ')';
      }}

      card.appendChild(body);

      if (body.className === 'revealed') {{
        var actions = document.createElement('div');
        actions.className = 'item-actions';
        var cp = document.createElement('button');
        cp.className = 'btn-cp';
        cp.textContent = 'copy';
        (function (txt) {{
          cp.addEventListener('click', async function () {{
            var ok = await copyText(txt);
            cp.textContent = ok ? 'copied ✓' : 'copy failed';
            cp.classList.toggle('ok', ok);
            if (ok) setTimeout(function () {{ cp.textContent = 'copy'; cp.classList.remove('ok'); }}, 1600);
          }});
        }})(body.textContent);
        actions.appendChild(cp);
        card.appendChild(actions);
      }}

      out.appendChild(card);
    }}
  }}

  function clrD() {{
    $('d-wiki').value = ''; $('d-pw').value = ''; $('d-page').value = '';
    $('d-out').innerHTML = ''; $('d-out').classList.remove('on');
    $('d-import-note').textContent = 'fetches that page\\'s wikitext straight from the wiki';
    hideErr('d-err');
  }}

  function checkCrypto() {{
    var b = $('crypto-warn');
    if (typeof crypto === 'undefined' || !crypto.subtle) {{
      b.textContent = 'WebCrypto is unavailable here. Encrypted payloads need it — open this file ' +
        'directly (file://) or serve it over https.';
      b.classList.add('on');
    }}
  }}

  window.WS = {{ setTheme: setTheme, togglePw: togglePw, doDecode: doDecode, importPage: importPage, clrD: clrD }};
  globalThis.__stego = {{
    decodeText: decodeText, decryptItem: decryptItem, parsePageUrl: parsePageUrl,
    ALPHABETS: ALPHABETS, F_ENC: F_ENC
  }};

  if (typeof document !== 'undefined' && document.getElementById) {{
    checkCrypto();
    wireDrop('d-wiki');
    $('theme').value = document.documentElement.getAttribute('data-theme') || 'auto';
    document.addEventListener('keydown', function (e) {{
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doDecode();
    }});
    $('d-wiki').focus();
  }}
}})();
</script>
</body>
</html>
""".format(style=style, core=core_js)

    OUT.write_text(page, encoding="utf-8")
    print("wrote", OUT, len(page), "bytes")


if __name__ == "__main__":
    main()
