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

  // Poll until predicate() returns a truthy value or timeout elapses.
  function waitFor(predicate, timeout) {
    return new Promise(function (resolve) {
      const r = predicate();
      if (r) { resolve(r); return; }
      const start = Date.now();
      const interval = setInterval(function () {
        const v = predicate();
        if (v) { clearInterval(interval); resolve(v); }
        else if (Date.now() - start >= timeout) { clearInterval(interval); resolve(null); }
      }, 100);
    });
  }

  // Pull every (taskName, docName, url) tuple out of the completed table.
  // Document links live inside <tr data-cy="edit-task-row-{uuid}"> which
  // LOP only renders once the task row has been expanded. We therefore
  // expand each collapsed row by clicking its toggle cell, wait up to 3 s
  // for the edit-row to appear, collect links, then collapse again.
  async function collectAllZillowDocsLinks(table) {
    console.group('[Task Bulk Download] collectAllZillowDocsLinks');
    const out = [];
    const taskRows = Array.from(table.querySelectorAll('tbody > tr[data-cy^="task-"]'));
    console.log('Found', taskRows.length, 'task rows to inspect');

    for (const taskRow of taskRows) {
      const nameCell = taskRow.querySelector('td[data-cy="task-name"]');
      const taskName = nameCell ? (nameCell.textContent || '').replace(/\s+/g, ' ').trim() : '';
      // Extract uuid — data-cy is "task-<uuid>", strip only the first "task-" prefix.
      const taskUuid = (taskRow.getAttribute('data-cy') || '').replace(/^task-/, '');

      // Check whether the edit-row is already present in the DOM.
      let editRow = table.querySelector('tr[data-cy="edit-task-row-' + taskUuid + '"]');
      const wasExpanded = !!editRow;

      if (!editRow) {
        const toggle = taskRow.querySelector('td[data-cy="toggle-task-row"]');
        if (toggle) {
          toggle.click();
          editRow = await waitFor(function () {
            return table.querySelector('tr[data-cy="edit-task-row-' + taskUuid + '"]');
          }, 3000);
        }
      }

      if (!editRow) {
        console.warn('[Task Bulk Download] Could not expand task row:', taskName, '(uuid:', taskUuid + ')');
        continue;
      }

      // Collect all zillowdocs links from the expanded detail row.
      const anchors = editRow.querySelectorAll('a[href*="zillowdocs.com/embed/editor"]');
      anchors.forEach(function (a) {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        const strong = a.querySelector('strong');
        const docName = (strong ? strong.textContent : (a.textContent || '')).replace(/\s+/g, ' ').trim();
        out.push({ url: href, taskName: taskName, docName: docName || 'document' });
      });
      console.log('  Task "' + taskName + '":', anchors.length, 'doc link(s)');

      // Collapse again only if we expanded it, to leave the page tidy.
      if (!wasExpanded) {
        const toggle = taskRow.querySelector('td[data-cy="toggle-task-row"]');
        if (toggle) toggle.click();
      }
    }

    // De-dup by URL in case LOP renders a link in multiple places.
    const seen = new Set();
    const unique = out.filter(function (e) {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });
    console.log('Collected', unique.length, 'unique documents (' + out.length + ' total):', unique);
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

  function sanitizeFilenameLOP(name) {
    return (name || 'document')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'document';
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'application/pdf' });
  }

  // Render the "pick a folder" intro modal. Returns a promise that
  // resolves to { mode: 'folder', folderHandle } | { mode: 'downloads' } | null.
  function chooseDestinationModal(count, fsaAvailable) {
    return new Promise(function (resolve) {
      const fsaSection = fsaAvailable
        ? '<button id="zhl-bd-folder" style="background:#0b5cab;color:#fff;border:1px solid #0b5cab;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer;font-size:13px;">📁 Save to a folder (recommended)</button>' +
          '<p style="margin:6px 0 14px;color:#6b7280;font-size:11px;">Pick a folder once. Every PDF saves silently into it — no Save As prompts. Works even if your IT has locked Chrome\'s download prompt setting.</p>'
        : '<p style="margin:0 0 14px;color:#991b1b;font-size:12px;">Your browser doesn\'t support the File System Access API. Falling back to the Downloads folder path below.</p>';
      const panel = showModal(
        '<h3 style="margin:0 0 10px;font-size:16px;color:#0b5cab;">Download ' + count + ' documents</h3>' +
        '<p style="margin:0 0 14px;color:#374151;font-size:13px;">Two options for where to save:</p>' +
        '<div style="margin:0 0 6px;">' + fsaSection + '</div>' +
        '<button id="zhl-bd-downloads" style="background:#fff;color:#0b5cab;border:1px solid #0b5cab;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer;font-size:13px;">⬇ Save to Downloads (Chrome\'s download manager)</button>' +
        '<p style="margin:6px 0 14px;color:#6b7280;font-size:11px;">' +
          'Goes through Chrome\'s downloads. If your Chrome is configured (or IT-locked) to ask where to save each file, you\'ll get a Save As prompt PER file. Check chrome://settings/downloads first.' +
        '</p>' +
        '<div style="text-align:right;margin-top:8px;">' +
          '<button id="zhl-bd-cancel" style="background:#fff;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;font-size:12px;">Cancel</button>' +
        '</div>'
      );
      function cleanup(v) {
        removeModal();
        resolve(v);
      }
      const folderBtn = panel.querySelector('#zhl-bd-folder');
      if (folderBtn) folderBtn.addEventListener('click', async function () {
        try {
          // Must be inside the user-gesture event handler for showDirectoryPicker.
          const handle = await window.showDirectoryPicker({
            id: 'zhl-bulk-download',
            mode: 'readwrite',
            startIn: 'downloads'
          });
          cleanup({ mode: 'folder', folderHandle: handle });
        } catch (e) {
          if (e && e.name === 'AbortError') {
            // User cancelled the picker — leave the modal up.
            return;
          }
          console.warn('[Task Bulk Download] showDirectoryPicker error:', e);
          alert('Could not open the folder picker: ' + (e && e.message || e) + '\n\nFalling back to Chrome\'s download manager.');
          cleanup({ mode: 'downloads' });
        }
      });
      panel.querySelector('#zhl-bd-downloads').addEventListener('click', function () {
        cleanup({ mode: 'downloads' });
      });
      panel.querySelector('#zhl-bd-cancel').addEventListener('click', function () {
        cleanup(null);
      });
    });
  }

  // Pick a unique filename inside the folder by checking existence and
  // appending (1), (2)... when needed. Returns the actual filename used.
  async function writeBlobToFolder(folderHandle, baseFilename, blob) {
    const dotIdx = baseFilename.lastIndexOf('.');
    const base = dotIdx > 0 ? baseFilename.slice(0, dotIdx) : baseFilename;
    const ext  = dotIdx > 0 ? baseFilename.slice(dotIdx) : '';
    let actual = baseFilename;
    for (let i = 1; i <= 100; i++) {
      let exists = false;
      try {
        await folderHandle.getFileHandle(actual, { create: false });
        exists = true;
      } catch (e) {
        exists = false; // NotFoundError — good, name is free
      }
      if (!exists) break;
      actual = base + ' (' + i + ')' + ext;
    }
    const fileHandle = await folderHandle.getFileHandle(actual, { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return actual;
  }

  // ----- TWO download paths --------------------------------------------------
  // (A) File System Access API: zillowdocs content script fetches the PDF in
  //     its tab (with cookies), sends base64 back, we write to user-picked
  //     folder via FileSystemDirectoryHandle. No chrome.downloads, no policy.
  // (B) Chrome downloads: existing flow — chrome.downloads.download() which
  //     respects PromptForDownloadLocation policy → may show Save As per file.
  // ---------------------------------------------------------------------------
  function downloadOneAsBlob(url, docName, taskName) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({
          type: 'ZHL_BULK_DOWNLOAD_FETCH_BLOB',
          url: url,
          docName: docName,
          taskName: taskName
        }, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, reason: 'background error: ' + chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, reason: 'empty response' });
        });
      } catch (e) {
        resolve({ ok: false, reason: 'sendMessage threw: ' + (e && e.message || e) });
      }
    });
  }

  function downloadOneViaChromeDownloads(url, docName, taskName) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({
          type: 'ZHL_BULK_DOWNLOAD_OPEN',
          url: url,
          docName: docName,
          taskName: taskName
        }, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, reason: 'background error: ' + chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, reason: 'empty response' });
        });
      } catch (e) {
        resolve({ ok: false, reason: 'sendMessage threw: ' + (e && e.message || e) });
      }
    });
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
    const docs = await collectAllZillowDocsLinks(section.table);
    if (!docs.length) {
      console.log('No documents to download.');
      console.groupEnd();
      alert('No documents found under the Completed tasks. (Borrower-uploaded files only — Plaid pulls and form submissions don\'t have a download link.)');
      return;
    }

    const fsaAvailable = typeof window.showDirectoryPicker === 'function';
    const choice = await chooseDestinationModal(docs.length, fsaAvailable);
    if (!choice) {
      console.log('User cancelled.');
      console.groupEnd();
      return;
    }
    console.log('User chose:', choice.mode);

    const panel = showModal(renderProgress(0, docs.length, docs[0]));
    const results = new Array(docs.length);
    let nextIdx = 0;
    let doneCount = 0;
    let lastStartedDoc = docs[0];

    // For one doc: run the configured download path.
    async function processOne(d) {
      if (choice.mode === 'folder') {
        const blobResp = await downloadOneAsBlob(d.url, d.docName, d.taskName);
        if (!blobResp || !blobResp.ok || !blobResp.base64) {
          return { ok: false, reason: (blobResp && blobResp.reason) || 'no blob' };
        }
        try {
          const blob = base64ToBlob(blobResp.base64, blobResp.mimeType);
          let fn = sanitizeFilenameLOP((d.docName || 'document').trim());
          if (!/\.[a-z0-9]{2,5}$/i.test(fn)) fn += '.pdf';
          const actualName = await writeBlobToFolder(choice.folderHandle, fn, blob);
          return { ok: true, savedAs: actualName, bytes: blob.size };
        } catch (e) {
          return { ok: false, reason: 'write failed: ' + (e && e.message || e) };
        }
      }
      return await downloadOneViaChromeDownloads(d.url, d.docName, d.taskName);
    }

    // Worker loop: pulls next index, runs, records result.
    async function worker(workerId) {
      while (true) {
        const myIdx = nextIdx++;
        if (myIdx >= docs.length) return;
        const d = docs[myIdx];
        lastStartedDoc = d;
        panel.innerHTML = renderProgress(doneCount, docs.length, d, workerId);
        console.log('[Task Bulk Download] worker' + workerId + ' starting ' + (myIdx + 1) + '/' + docs.length + ' — ' + d.docName);
        const r = await processOne(d);
        results[myIdx] = { doc: d, result: r };
        doneCount++;
        console.log('[Task Bulk Download] worker' + workerId + ' done ' + (myIdx + 1) + '/' + docs.length + ' — ' + d.docName, r);
        panel.innerHTML = renderProgress(doneCount, docs.length, lastStartedDoc);
      }
    }

    // Folder mode = parallel (FSA + per-tab arming via tabs.sendMessage —
    // no shared storage key, safe to run concurrently).
    // chrome-downloads mode = sequential (each download may trigger Save As
    // dialog; parallel would just stack dialogs).
    const CONCURRENCY = choice.mode === 'folder' ? 4 : 1;
    console.log('[Task Bulk Download] starting with concurrency=' + CONCURRENCY);
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(worker(w + 1));
    await Promise.all(workers);

    panel.innerHTML = renderDone(results, choice.mode);
    const ok = results.filter(function (r) { return r.result && r.result.ok; });
    const bad = results.filter(function (r) { return !r.result || !r.result.ok; });
    console.log('Bulk download finished. OK:', ok.length, 'Failed:', bad.length);
    // Time-saved: ~1 minute per successful download (open viewer, click
    // Download, navigate back). Render into the done modal.
    if (ok.length > 0 && window.__zhlTimeSaved) {
      const mins = ok.length;
      window.__zhlTimeSaved.record('task-bulk-download', mins).then(function (r) {
        const slot = panel.querySelector('#zhl-bd-time-saved');
        if (slot) slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }
    const closeBtn = panel.querySelector('#zhl-bd-close');
    if (closeBtn) closeBtn.addEventListener('click', removeModal);
    console.groupEnd();
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
  function renderDone(results, mode) {
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
    const locationLine = mode === 'folder'
      ? 'Files saved to the folder you picked.'
      : 'Files are in your browser\'s Downloads folder (named by Zillow Docs).';
    return '<h3 style="margin:0 0 8px;font-size:16px;color:#15803d;">✓ Done — ' + ok.length + ' of ' + results.length + ' downloaded</h3>' +
      '<p style="margin:0 0 8px;color:#374151;font-size:13px;">' + escapeHtml(locationLine) + '</p>' +
      (okList ? '<details open style="margin:8px 0;font-size:12px;"><summary style="cursor:pointer;color:#15803d;font-weight:600;">Downloaded (' + ok.length + ')</summary>' +
        '<ul style="margin:6px 0 0 18px;padding:0;">' + okList + '</ul></details>' : '') +
      (badList ? '<details open style="margin:8px 0;font-size:12px;"><summary style="cursor:pointer;color:#991b1b;font-weight:600;">Failed (' + bad.length + ')</summary>' +
        '<ul style="margin:6px 0 0 18px;padding:0;">' + badList + '</ul>' +
        '<p style="margin:6px 0 0;color:#6b7280;font-size:11px;">Open these manually from the Completed tasks section.</p>' +
        '</details>' : '') +
      // Slot the time-saved tracker writes into asynchronously once it
      // gets back the user + global totals from the background.
      '<div id="zhl-bd-time-saved"></div>' +
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
