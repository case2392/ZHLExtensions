// ZHL Productivity Pack module — feature key: feature_taskBulkDelete
//
// Adds a checkbox column to LOP's Unsent tasks table and a "Delete
// Selected" button in the section header so multiple unsent tasks can
// be deleted in one click instead of one-at-a-time trash + confirm.
//
// LOP's per-task delete opens a confirm dialog; this module clicks it
// automatically for each selected task so the user only confirms once
// (via our own JS confirm() up front).
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_taskBulkDelete';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Task Bulk Delete v' + VERSION + '] loaded');

  const ROW_CHECKBOX_ATTR = 'data-zhl-task-checkbox';
  const HEADER_CHECKBOX_ATTR = 'data-zhl-task-header-checkbox';
  const BULK_BUTTON_ATTR = 'data-zhl-bulk-delete-btn';
  const HEADER_CELL_ATTR = 'data-zhl-checkbox-th';

  function findUnsentTable() {
    return document.querySelector('table[data-cy="unsent-tasks-table"]');
  }

  function hasAnyDeletableRows(table) {
    return !!(table && table.querySelector('tbody button[data-cy="delete-task-btn"]'));
  }

  // Returns the Flex that contains the "Unsent" heading + gleam (left
  // side of the section header bar). We anchor our Delete Selected
  // button here so it sits next to the heading and aligns vertically
  // with the leftmost (checkbox) column of the table — instead of all
  // the way on the right next to "Send unsent tasks", which made the
  // UI annoying to use.
  function findUnsentTitleArea() {
    const gleam = document.querySelector('[data-cy="unsent-gleam"]');
    if (gleam && gleam.parentElement) return gleam.parentElement;
    const h4s = document.querySelectorAll('h4');
    for (const h of h4s) {
      if ((h.textContent || '').trim() === 'Unsent') return h.parentElement;
    }
    return null;
  }

  function ensureCheckboxColumn(table) {
    const thead = table.querySelector('thead tr');
    const hasTasks = hasAnyDeletableRows(table);
    if (!hasTasks) {
      // No deletable rows — tear down our header cell so the table
      // looks like stock LOP when the section is empty.
      const existingTh = thead && thead.querySelector('[' + HEADER_CELL_ATTR + ']');
      if (existingTh) existingTh.remove();
      return;
    }
    if (thead && !thead.querySelector('[' + HEADER_CELL_ATTR + ']')) {
      const th = document.createElement('th');
      th.setAttribute(HEADER_CELL_ATTR, '1');
      th.setAttribute('scope', 'col');
      th.style.cssText = 'width:36px;padding:8px 4px;text-align:center;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute(HEADER_CHECKBOX_ATTR, '1');
      cb.title = 'Select all unsent';
      cb.style.cssText = 'cursor:pointer;';
      cb.addEventListener('change', function () {
        const rowCbs = table.querySelectorAll('tbody input[' + ROW_CHECKBOX_ATTR + ']');
        rowCbs.forEach(function (rcb) { rcb.checked = cb.checked; });
      });
      th.appendChild(cb);
      thead.insertBefore(th, thead.firstChild);
    }
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (tr) {
      if (tr.querySelector('[' + ROW_CHECKBOX_ATTR + ']')) return;
      // Skip rows that don't have a delete button (e.g. an empty-state
      // "No tasks added" row).
      if (!tr.querySelector('button[data-cy="delete-task-btn"]')) return;
      const td = document.createElement('td');
      td.style.cssText = 'width:36px;padding:8px 4px;text-align:center;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute(ROW_CHECKBOX_ATTR, '1');
      cb.style.cssText = 'cursor:pointer;';
      // Stop propagation so checking the box doesn't also toggle the
      // row-expand chevron sitting in the adjacent cell.
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      td.appendChild(cb);
      tr.insertBefore(td, tr.firstChild);
    });
  }

  function ensureBulkButton(table) {
    const titleArea = findUnsentTitleArea();
    if (!titleArea) return;
    const hasTasks = hasAnyDeletableRows(table);
    const existing = titleArea.querySelector('[' + BULK_BUTTON_ATTR + ']');
    if (!hasTasks) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.setAttribute(BULK_BUTTON_ATTR, '1');
    btn.type = 'button';
    btn.textContent = 'Delete Selected';
    btn.title = 'Delete every checked unsent task';
    btn.style.cssText =
      'display:inline-flex;align-items:center;margin-left:16px;' +
      'padding:6px 12px;background:#b91c1c;color:#fff;border:none;' +
      'border-radius:4px;font:600 13px/1 Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#991b1b'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#b91c1c'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      bulkDelete(table, btn);
    });
    titleArea.appendChild(btn);
  }

  function waitMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // After clicking a row's delete trash-can, LOP opens a confirm
  // dialog ("Delete task" title, "Are you sure…" body, Cancel +
  // Delete task buttons). Find the primary "Delete task" button.
  // Priority:
  //   1. button text exactly "Delete task" (the confirmed UX text)
  //   2. button data-cy containing "confirm" (NEVER the trash-can's
  //      "delete-task-btn" — that's the row button we just clicked)
  //   3. loose text matches as a safety net
  async function findConfirmButton(maxMs) {
    const start = Date.now();
    const max = maxMs || 2500;
    while (Date.now() - start < max) {
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      for (const d of dialogs) {
        if (d.offsetParent === null) continue;
        const buttons = Array.from(d.querySelectorAll('button'));
        // 1. Exact text match.
        for (const b of buttons) {
          if (b.disabled) continue;
          const txt = (b.textContent || '').trim();
          if (/^delete task$/i.test(txt)) return b;
        }
        // 2. data-cy containing "confirm" — skipping the row trash-can.
        for (const b of buttons) {
          if (b.disabled) continue;
          const dc = (b.getAttribute('data-cy') || '').toLowerCase();
          if (dc === 'delete-task-btn') continue;
          if (/confirm/i.test(dc)) return b;
        }
        // 3. Loose text matches (other dialog wording variants).
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

  async function bulkDelete(table, btn) {
    // Snapshot the rows to delete BY UUID. The table re-renders after
    // each delete, so any direct row reference goes stale immediately.
    const checked = Array.from(table.querySelectorAll('tbody input[' + ROW_CHECKBOX_ATTR + ']:checked'));
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
    if (!confirm('Delete ' + taskIds.length + ' selected unsent task' + (taskIds.length === 1 ? '' : 's') + '?')) return;

    const origText = btn.textContent;
    btn.disabled = true;
    let okCount = 0;
    let failCount = 0;
    console.group('[Task Bulk Delete] run started; ' + taskIds.length + ' task(s)');
    try {
      for (let i = 0; i < taskIds.length; i++) {
        const id = taskIds[i];
        btn.textContent = 'Deleting ' + (i + 1) + '/' + taskIds.length + '…';
        const row = document.querySelector('tr[data-cy="task-' + CSS.escape(id) + '"]');
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
          // Try to dismiss whatever's on screen so the next iteration isn't blocked.
          document.body.click();
          await waitMs(200);
          continue;
        }
        console.log('[' + (i + 1) + '/' + taskIds.length + '] clicking confirm', confirmBtn);
        confirmBtn.click();
        const closed = await waitForDialogClose(2500);
        if (!closed) console.warn('[' + (i + 1) + '/' + taskIds.length + '] dialog did not close within 2.5s');
        // Settle so LOP's table can re-render before we hit the next id.
        await waitMs(350);
        okCount++;
      }
    } catch (e) {
      console.error('[Task Bulk Delete] run failed:', e);
      alert('Bulk delete error: ' + (e && e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      console.log('[Task Bulk Delete] done. ok=' + okCount + ' failed=' + failCount);
      console.groupEnd();
    }
    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'task_bulk_delete',
        props: { requested: taskIds.length, ok: okCount, failed: failCount }
      });
    } catch (_) {}
    if (failCount) {
      alert('Deleted ' + okCount + ' of ' + taskIds.length + ' tasks. ' + failCount + ' failed — see console.');
    }
  }

  function scan() {
    const table = findUnsentTable();
    if (!table) return;
    try { ensureCheckboxColumn(table); } catch (e) { console.warn('[Task Bulk Delete] checkbox col error', e); }
    try { ensureBulkButton(table); } catch (e) { console.warn('[Task Bulk Delete] button error', e); }
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
