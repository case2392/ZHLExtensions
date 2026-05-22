// ZHL Productivity Pack module — feature key: feature_taskBulkDownload
//
// Adds a "Download all docs" button to the Completed section on LOP's
// Tasks tab. Walks every zillowdocs.com link in the Completed tasks
// table, opens each one in a background tab, lets a sister content
// script (zillowdocs-bulk-download.js) click the Download button, then
// closes the tab. Sequential — one tab at a time — so the browser's
// "this site wants to download multiple files" prompt only fires once
// and the LO can see live progress.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_taskBulkDownload';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Task Bulk Download v' + VERSION + '] loaded');

  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';
  const BUTTON_ID = 'zhl-task-bulk-download-btn';
  const MODAL_ID = 'zhl-task-bulk-download-modal';

  function isOnTasksPage() {
    return /\/loan-officer-portal\/[a-f0-9-]+\/tasks(?:$|\/|\?)/i.test(location.pathname);
  }

  // The Completed section is a <h2> or similar with text "Completed"
  // followed by a table. Add the button into that heading's row.
  function findCompletedSection() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const h = headings.find(function (el) {
      return /^completed$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim());
    });
    if (!h) return null;
    const table = document.querySelector('table[data-cy="completed-tasks-table"]');
    if (!table) return null;
    return { heading: h, table: table };
  }

  // Pull every (taskName, docName, url) tuple out of the completed
  // table. Each Completed task can have 0+ documents under it; the
  // documents only show when a task row is expanded — but LOP keeps
  // their <a href="zillowdocs.com/..."> nodes in the DOM whether the
  // row is visually expanded or collapsed, so this works without
  // expanding any rows. Heavy logging so the LO can see what got
  // collected.
  function collectAllZillowDocsLinks(table) {
    console.group('[Task Bulk Download] collectAllZillowDocsLinks');
    const out = [];
    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    let currentTaskName = '';
    rows.forEach(function (tr) {
      // Top-level task rows have data-cy="task-<uuid>" and contain
      // a <td data-cy="task-name"> with the title text.
      const dc = tr.getAttribute('data-cy') || '';
      const nameCell = tr.querySelector('td[data-cy="task-name"]');
      if (nameCell) {
        currentTaskName = (nameCell.textContent || '').replace(/\s+/g, ' ').trim();
      }
      // Document links live inside the expanded edit-row, but the
      // expanded row's anchor is always in the DOM regardless of
      // visual state. Grab any zillowdocs links inside this tr's
      // descendant scope.
      const anchors = tr.querySelectorAll('a[href*="zillowdocs.com/embed/editor"]');
      anchors.forEach(function (a) {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        // The doc name is the <strong> text inside the anchor.
        const strong = a.querySelector('strong');
        const docName = (strong ? strong.textContent : (a.textContent || '')).replace(/\s+/g, ' ').trim();
        out.push({ url: href, taskName: currentTaskName, docName: docName || 'document' });
      });
    });
    // De-dup by URL — LOP sometimes renders both the collapsed and
    // expanded forms of a row, doubling the anchors.
    const seen = new Set();
    const unique = out.filter(function (e) {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });
    console.log('Collected', unique.length, 'unique documents (' + out.length + ' total anchors after de-dup):', unique);
    console.groupEnd();
    return unique;
  }

  function ensureButton(section) {
    if (document.getElementById(BUTTON_ID)) return;
    const heading = section.heading;
    if (!heading) return;
    // Insert the button next to the heading. Use the heading's
    // parent so we end up in the same Flex row.
    const host = heading.parentElement || heading;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Open each completed-task document in a background tab and click Download, one at a time.\n\n' + ZHL_TIP;
    btn.style.cssText = [
      'margin-left:12px',
      'padding:6px 12px',
      'background:#0b5cab',
      'color:#fff',
      'border:1px solid #0b5cab',
      'border-radius:6px',
      'font:600 12px/1.2 Arial, Helvetica, sans-serif',
      'cursor:pointer',
      'vertical-align:middle'
    ].join(';');
    btn.textContent = '⬇ Download all docs';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#0a4d8f'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#0b5cab'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      startBulkDownload();
    });
    host.appendChild(btn);
  }

  function showModal(html) {
    removeModal();
    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.style.cssText = [
      'position:fixed',
      'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(0,0,0,0.4)',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font:14px/1.4 Arial, Helvetica, sans-serif'
    ].join(';');
    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#fff',
      'border-radius:8px',
      'padding:18px 22px',
      'max-width:520px',
      'width:90%',
      'max-height:80vh',
      'overflow:auto',
      'box-shadow:0 8px 32px rgba(0,0,0,0.25)'
    ].join(';');
    panel.innerHTML = html;
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    return panel;
  }
  function removeModal() {
    const x = document.getElementById(MODAL_ID);
    if (x) x.remove();
  }

  // Sequentially open + download every document.
  async function startBulkDownload() {
    console.group('[Task Bulk Download] startBulkDownload');
    const section = findCompletedSection();
    if (!section) {
      console.warn('Completed section not found on this page.');
      console.groupEnd();
      alert('Could not find the Completed tasks section on this page. Re-load Tasks and try again.');
      return;
    }
    const docs = collectAllZillowDocsLinks(section.table);
    if (!docs.length) {
      console.log('No documents to download.');
      console.groupEnd();
      alert('No documents found under the Completed tasks. (Borrower-uploaded files only — Plaid pulls and form submissions don\'t have a download link.)');
      return;
    }
    // Confirm before opening 10+ background tabs.
    if (!window.confirm('Download all ' + docs.length + ' completed documents?\n\n' +
        'Each one will open in a background tab and auto-click Download, then close.\n' +
        'Your browser may prompt once to allow multiple downloads — click Allow.')) {
      console.log('User cancelled.');
      console.groupEnd();
      return;
    }

    const panel = showModal(renderProgress(0, docs.length, docs[0]));
    const results = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      panel.innerHTML = renderProgress(i, docs.length, d);
      console.group('[Task Bulk Download] ' + (i + 1) + '/' + docs.length + ' — ' + d.docName);
      console.log('Task:', d.taskName);
      console.log('URL:', d.url.slice(0, 120) + '…');
      const r = await downloadOne(d.url, d.docName, d.taskName);
      console.log('Result:', r);
      console.groupEnd();
      results.push({ doc: d, result: r });
    }
    panel.innerHTML = renderDone(results);
    const ok = results.filter(function (r) { return r.result && r.result.ok; });
    const bad = results.filter(function (r) { return !r.result || !r.result.ok; });
    console.log('Bulk download finished. OK:', ok.length, 'Failed:', bad.length);
    // Wire close
    const closeBtn = panel.querySelector('#zhl-bd-close');
    if (closeBtn) closeBtn.addEventListener('click', removeModal);
    console.groupEnd();
  }

  function downloadOne(url, docName, taskName) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({
          type: 'ZHL_BULK_DOWNLOAD_OPEN',
          url: url,
          docName: docName,
          taskName: taskName
        }, function (response) {
          if (chrome.runtime.lastError) {
            console.warn('sendMessage error:', chrome.runtime.lastError.message);
            resolve({ ok: false, reason: 'background message error: ' + chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, reason: 'empty response' });
        });
      } catch (e) {
        resolve({ ok: false, reason: 'sendMessage threw: ' + (e && e.message || e) });
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderProgress(doneCount, total, current) {
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    return '<h3 style="margin:0 0 8px;font-size:16px;color:#0b5cab;">Downloading documents… ' + doneCount + ' / ' + total + '</h3>' +
      '<div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin:8px 0 12px;">' +
        '<div style="width:' + pct + '%;height:100%;background:#0b5cab;transition:width 200ms;"></div>' +
      '</div>' +
      '<p style="margin:0 0 4px;color:#374151;font-size:13px;"><strong>Now:</strong> ' + escapeHtml(current ? current.docName : '') + '</p>' +
      '<p style="margin:0;color:#6b7280;font-size:12px;">Task: ' + escapeHtml(current ? current.taskName : '') + '</p>' +
      '<p style="margin:10px 0 0;color:#6b7280;font-size:11px;font-style:italic;">' +
        'Tip: keep this tab focused while downloads run. Each file opens in a background tab, auto-clicks Download, and closes.' +
      '</p>';
  }
  function renderDone(results) {
    const ok = results.filter(function (r) { return r.result && r.result.ok; });
    const bad = results.filter(function (r) { return !r.result || !r.result.ok; });
    const okList = ok.map(function (r) {
      return '<li style="color:#15803d;">' + escapeHtml(r.doc.docName) +
        ' <span style="color:#6b7280;">(' + escapeHtml(r.doc.taskName) + ')</span></li>';
    }).join('');
    const badList = bad.map(function (r) {
      return '<li style="color:#991b1b;">' + escapeHtml(r.doc.docName) +
        ' <span style="color:#6b7280;">(' + escapeHtml(r.doc.taskName) + ')</span>' +
        '<div style="font-size:11px;color:#7f1d1d;margin-left:0;">' +
          escapeHtml((r.result && r.result.reason) || 'unknown error') +
        '</div></li>';
    }).join('');
    return '<h3 style="margin:0 0 8px;font-size:16px;color:#15803d;">✓ Done — ' + ok.length + ' of ' + results.length + ' downloaded</h3>' +
      '<p style="margin:0 0 8px;color:#374151;font-size:13px;">Files are in your browser\'s Downloads folder (named by Zillow Docs).</p>' +
      (okList ? '<details open style="margin:8px 0;font-size:12px;"><summary style="cursor:pointer;color:#15803d;font-weight:600;">Downloaded (' + ok.length + ')</summary>' +
        '<ul style="margin:6px 0 0 18px;padding:0;">' + okList + '</ul></details>' : '') +
      (badList ? '<details open style="margin:8px 0;font-size:12px;"><summary style="cursor:pointer;color:#991b1b;font-weight:600;">Failed (' + bad.length + ')</summary>' +
        '<ul style="margin:6px 0 0 18px;padding:0;">' + badList + '</ul>' +
        '<p style="margin:6px 0 0;color:#6b7280;font-size:11px;">Open these manually from the Completed tasks section.</p>' +
        '</details>' : '') +
      '<div style="text-align:right;margin-top:12px;">' +
        '<button id="zhl-bd-close" style="background:#006aff;color:#fff;border:1px solid #006aff;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;">OK</button>' +
      '</div>';
  }

  function scan() {
    if (!isOnTasksPage()) {
      const b = document.getElementById(BUTTON_ID);
      if (b) b.remove();
      return;
    }
    const section = findCompletedSection();
    if (!section) return;
    try { ensureButton(section); }
    catch (e) { console.warn('[Task Bulk Download] ensureButton error', e); }
  }

  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  setInterval(scan, 1500);
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
