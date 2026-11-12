'use strict';
/* Toolbar popup: report what the content script found on the active tab. */
(function () {
  var status = document.getElementById('status');
  var detail = document.getElementById('detail');

  function say(text, dim) {
    status.textContent = text;
    status.className = 'status' + (dim ? ' dim' : '');
  }

  function counts(plain, encrypted) {
    detail.innerHTML = '';
    if (plain > 0) {
      var p = document.createElement('span');
      p.className = 'plain';
      p.textContent = plain + (plain === 1 ? ' plain message' : ' plain messages');
      detail.appendChild(p);
    }
    if (encrypted > 0) {
      if (plain > 0) detail.appendChild(document.createTextNode(' · '));
      var e = document.createElement('span');
      e.className = 'enc';
      e.textContent = encrypted + ' encrypted';
      detail.appendChild(e);
      detail.appendChild(document.createTextNode(' — needs a password'));
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab) { say('no active tab', true); return; }

    chrome.tabs.sendMessage(tab.id, { type: 'wsg-status' }, function (res) {
      if (chrome.runtime.lastError || !res) {
        say('not a MediaWiki page', true);
        return;
      }
      if (!res.wiki) {
        say('not a MediaWiki page', true);
        return;
      }
      if (res.scanning) {
        say('scanning this page…', true);
        return;
      }
      if (!res.plain && !res.encrypted) {
        say('no hidden message found', true);
        return;
      }
      say(res.plain ? 'decoded on this page' : 'encrypted payload only', false);
      counts(res.plain, res.encrypted);
    });
  });
})();
