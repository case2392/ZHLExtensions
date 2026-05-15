// ZHL Productivity Pack module — feature key: feature_taskBulkDelete
//
// Adds a checkbox column + a "Delete Selected" button to LOP's task
// sections that have per-row trash-can delete buttons. Currently
// wired up for both:
//   - Unsent (top of the Tasks tab)
//   - Awaiting borrower (lower on the Tasks tab)
//
// Each section gets its own independent checkbox state and Delete
// Selected button — selecting rows in one section does not affect the
// other. The bulk-delete flow opens LOP's per-task confirm dialog and
// auto-clicks the confirm button for each selected task, so the user
// only confirms once (via our own JS confirm() up front).
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_taskBulkDelete';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Task Bulk Delete v' + VERSION + '] loaded');

  // Per-section attribute keys keep the checkbox/header/button DOM for
  // each section independent. We could share attribute names since all
  // queries are scoped to a specific <table> anyway, but distinct
  // attributes make the rendered DOM easier to inspect.
  const SECTIONS = [
    {
      key: 'unsent',
      label: 'unsent',
      tableSelector: 'table[data-cy="unsent-tasks-table"]',
      gleamSelector: '[data-cy="unsent-gleam"]',
      heading: 'Unsent',
      rowCbAttr:    'data-zhl-task-checkbox',
      headerCbAttr: 'data-zhl-task-header-checkbox',
      buttonAttr:   'data-zhl-bulk-delete-btn',
      headerCellAttr: 'data-zhl-checkbox-th'
    },
    {
      key: 'awaiting',
      label: 'awaiting borrower',
      tableSelector: 'table[data-cy="awaiting-borrower-tasks-table"]',
      gleamSelector: '[data-cy="awaiting-borrower-gleam"]',
      heading: 'Awaiting borrower',
      rowCbAttr:    'data-zhl-ab-checkbox',
      headerCbAttr: 'data-zhl-ab-header-checkbox',
      buttonAttr:   'data-zhl-ab-bulk-delete-btn',
      headerCellAttr: 'data-zhl-ab-checkbox-th'
    }
  ];

  function hasAnyDeletableRows(table) {
    return !!(table && table.querySelector('tbody button[data-cy="delete-task-btn"]'));
  }

  // Returns the Flex containing the section heading + gleam (left side
  // of the section header bar). Anchors our Delete Selected button
  // here so it sits next to the heading instead of on the far right.
  function findTitleArea(section) {
    const gleam = document.querySelector(section.gleamSelector);
    if (gleam && gleam.parentElement) return gleam.parentElement;
    const h4s = document.querySelectorAll('h4');
    for (const h of h4s) {
      if ((h.textContent || '').trim() === section.heading) return h.parentElement;
    }
    return null;
  }

  function ensureCheckboxColumn(section, table) {
    const thead = table.querySelector('thead tr');
    const hasTasks = hasAnyDeletableRows(table);
    if (!hasTasks) {
      const existingTh = thead && thead.querySelector('[' + section.headerCellAttr + ']');
      if (existingTh) existingTh.remove();
      return;
    }
    if (thead && !thead.querySelector('[' + section.headerCellAttr + ']')) {
      const th = document.createElement('th');
      th.setAttribute(section.headerCellAttr, '1');
      th.setAttribute('scope', 'col');
      th.style.cssText = 'width:36px;padding:8px 4px;text-align:center;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute(section.headerCbAttr, '1');
      cb.title = 'Select all ' + section.label;
      cb.style.cssText = 'cursor:pointer;';
      cb.addEventListener('change', function () {
        const rowCbs = table.querySelectorAll('tbody input[' + section.rowCbAttr + ']');
        rowCbs.forEach(function (rcb) { rcb.checked = cb.checked; });
      });
      th.appendChild(cb);
      thead.insertBefore(th, thead.firstChild);
    }
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (tr) {
      if (tr.querySelector('[' + section.rowCbAttr + ']')) return;
      if (!tr.querySelector('button[data-cy="delete-task-btn"]')) return;
      const td = document.createElement('td');
      td.style.cssText = 'width:36px;padding:8px 4px;text-align:center;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute(section.rowCbAttr, '1');
      cb.style.cssText = 'cursor:pointer;';
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      td.appendChild(cb);
      tr.insertBefore(td, tr.firstChild);
    });
  }

  function ensureBulkButton(section, table) {
    const titleArea = findTitleArea(section);
    if (!titleArea) return;
    const hasTasks = hasAnyDeletableRows(table);
    const existing = titleArea.querySelector('[' + section.buttonAttr + ']');
    if (!hasTasks) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.setAttribute(section.buttonAttr, '1');
    btn.type = 'button';
    btn.textContent = 'Delete Selected';
    btn.title = 'Delete every checked ' + section.label + ' task';
    btn.style.cssText =
      'display:inline-flex;align-items:center;margin-left:16px;' +
      'padding:6px 12px;background:#b91c1c;color:#fff;border:none;' +
      'border-radius:4px;font:600 13px/1 Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#991b1b'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#b91c1c'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      bulkDelete(section, table, btn);
    });
    titleArea.appendChild(btn);
  }

  function waitMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // After clicking a row's delete trash-can, LOP opens a confirm
  // dialog ("Delete task" title, Cancel + Delete task buttons). Find
  // the primary "Delete task" button.
  //   1. button text exactly "Delete task"
  //   2. button data-cy containing "confirm" (NEVER the row's
  //      "delete-task-btn" — that's the trash-can we just clicked)
  //   3. loose text matches as a safety net
  async function findConfirmButton(maxMs) {
    const start = Date.now();
    const max = maxMs || 2500;
    while (Date.now() - start < max) {
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      for (const d of dialogs) {
        if (d.offsetParent === null) continue;
        const buttons = Array.from(d.querySelectorAll('button'));
        for (const b of buttons) {
          if (b.disabled) continue;
          const txt = (b.textContent || '').trim();
          if (/^delete task$/i.test(txt)) return b;
        }
        for (const b of buttons) {
          if (b.disabled) continue;
          const dc = (b.getAttribute('data-cy') || '').toLowerCase();
          if (dc === 'delete-task-btn') continue;
          if (/confirm/i.test(dc)) return b;
        }
        for (const b of buttons) {
          if (b.disabled) continue;
          const txt = (b.textContent || '').trim().toLowerCase();
          if (!txt) continue;
          if (/cancel|close|back|nevermind|no,/i.test(txt)) continue;
          if (/^(delete|confirm|yes|remove)$/.test(txt)) return b;
          if (/(yes,\s*delete|delete\s+task|confirm\s+delete)/i.test(txt)) return b;
        }
      }
      await waitMs(80);
    }
    return null;
  }

  async function waitForDialogClose(maxMs) {
    const start = Date.now();
    const max = maxMs || 2500;
    while (Date.now() - start < max) {
      const open = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
        .some(function (d) { return d.offsetParent !== null; });
      if (!open) return true;
      await waitMs(80);
    }
    return false;
  }

  async function bulkDelete(section, table, btn) {
    // Snapshot the rows to delete BY UUID. The table re-renders after
    // each delete, so any direct row reference goes stale immediately.
    const checked = Array.from(table.querySelectorAll('tbody input[' + section.rowCbAttr + ']:checked'));
    if (!checked.length) {
      alert('No tasks selected. Check the boxes next to the tasks you want to delete.');
      return;
    }
    const taskIds = [];
    for (const cb of checked) {
      const row = cb.closest('tr');
      if (!row) continue;
      const dataCy = row.getAttribute('data-cy') || '';
      const m = /^task-(.+)$/.exec(dataCy);
      if (m) taskIds.push(m[1]);
    }
    if (!taskIds.length) {
      alert('Could not identify the selected tasks (no data-cy uuids). See console.');
      console.warn('[Task Bulk Delete] checked rows had no task-* data-cy attributes');
      return;
    }
    if (!confirm('Delete ' + taskIds.length + ' selected ' + section.label + ' task' + (taskIds.length === 1 ? '' : 's') + '?')) return;

    const origText = btn.textContent;
    btn.disabled = true;
    let okCount = 0;
    let failCount = 0;
    console.group('[Task Bulk Delete:' + section.key + '] run started; ' + taskIds.length + ' task(s)');
    try {
      for (let i = 0; i < taskIds.length; i++) {
        const id = taskIds[i];
        btn.textContent = 'Deleting ' + (i + 1) + '/' + taskIds.length + '…';
        // Re-resolve the row inside the section's table each iteration —
        // a global lookup could match the same task id rendered in a
        // different section if LOP ever shows duplicates.
        const row = table.querySelector('tr[data-cy="task-' + CSS.escape(id) + '"]');
        if (!row) {
          console.warn('[' + (i + 1) + '/' + taskIds.length + '] row not found for id=' + id + ' (already removed?)');
          failCount++;
          continue;
        }
        const deleteBtn = row.querySelector('button[data-cy="delete-task-btn"]');
        if (!deleteBtn) {
          console.warn('[' + (i + 1) + '/' + taskIds.length + '] delete button not found for id=' + id);
          failCount++;
          continue;
        }
        console.log('[' + (i + 1) + '/' + taskIds.length + '] clicking delete for id=' + id);
        deleteBtn.click();
        const confirmBtn = await findConfirmButton(2500);
        if (!confirmBtn) {
          console.warn('[' + (i + 1) + '/' + taskIds.length + '] confirm dialog never appeared');
          failCount++;
          document.body.click();
          await waitMs(200);
          continue;
        }
        console.log('[' + (i + 1) + '/' + taskIds.length + '] clicking confirm', confirmBtn);
        confirmBtn.click();
        const closed = await waitForDialogClose(2500);
        if (!closed) console.warn('[' + (i + 1) + '/' + taskIds.length + '] dialog did not close within 2.5s');
        await waitMs(350);
        okCount++;
      }
    } catch (e) {
      console.error('[Task Bulk Delete:' + section.key + '] run failed:', e);
      alert('Bulk delete error: ' + (e && e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      console.log('[Task Bulk Delete:' + section.key + '] done. ok=' + okCount + ' failed=' + failCount);
      console.groupEnd();
    }
    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'task_bulk_delete',
        props: { section: section.key, requested: taskIds.length, ok: okCount, failed: failCount }
      });
    } catch (_) {}
    if (failCount) {
      alert('Deleted ' + okCount + ' of ' + taskIds.length + ' tasks. ' + failCount + ' failed — see console.');
    }
  }

  function scan() {
    for (const section of SECTIONS) {
      const table = document.querySelector(section.tableSelector);
      if (!table) continue;
      try { ensureCheckboxColumn(section, table); } catch (e) { console.warn('[Task Bulk Delete:' + section.key + '] checkbox col error', e); }
      try { ensureBulkButton(section, table); } catch (e) { console.warn('[Task Bulk Delete:' + section.key + '] button error', e); }
    }
  }

  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  // Heartbeat backstop for re-renders the observer might coalesce away.
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
