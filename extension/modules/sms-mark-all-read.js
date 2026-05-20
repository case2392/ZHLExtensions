// ZHL Productivity Pack module — feature key: feature_smsMarkAllRead
//
// Adds a "Mark All As Read" button next to "New thread" inside the
// Salesforce Messaging utility panel. Clicking it walks every unread
// thread in the inbox, opens each one (which is how Salesforce marks
// a thread as read), then clicks Back to return to the inbox. After
// all unread threads are processed, the panel is left on the inbox
// view with zero bold/unread rows.
//
// Detection: a thread is "unread" if any of these are true on its
// rendered list item:
//   - descendant element has class `unread-count` or `unread-countZuid`
//     (the "1" / "2" pill on the right side)
//   - descendant `.preview` has class `slds-text-title_bold` (the
//     subject text is shown bold)
//   - any descendant has class `unread` (the row container c11n stamps
//     on unread rows)
//
// Heavy console logging throughout — this module touches third-party
// LWC components whose internals can shift, so failure-mode visibility
// is more valuable than terse output. Every step logs what it
// found / didn't find / clicked / waited on so the user can paste the
// console back if anything misbehaves.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_smsMarkAllRead';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  const TAG = '[SMS Mark Read v' + VERSION + ']';
  console.log(TAG, 'loaded');

  const BUTTON_ATTR = 'data-zhl-sms-mark-all-read';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Re-use the click pattern that contact-sms.js settled on — Salesforce
  // LWCs sometimes ignore a bare .click() until they see the pointer/
  // mouse sequence, so we fire all four.
  function realClick(el) {
    try {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch (e) {
      console.warn(TAG, 'realClick pointer/mouse events threw', e);
    }
    try { el.click(); } catch (e) { console.warn(TAG, 'realClick .click() threw', e); }
  }

  function findMessagingPanel() {
    const dialogs = document.querySelectorAll('div.oneUtilityBarPanel[role="dialog"]');
    for (const d of dialogs) {
      const titleEl = d.querySelector('h2.panelTitle, .panelTitle');
      if (titleEl && /messaging/i.test(titleEl.textContent || '')) return d;
    }
    return null;
  }

  function findInbox(panel) {
    // The inbox component hosts the <ul> of threads.
    return panel.querySelector('c-slds-sms-inbox') || panel.querySelector('section[role="log"]');
  }

  // Returns the visible unread thread <li> elements in DOM order, with
  // detection reasons for each (logged for debugging).
  function findUnreadThreads(panel) {
    const inbox = findInbox(panel);
    if (!inbox) {
      console.warn(TAG, 'findUnreadThreads: inbox container not found inside panel');
      return [];
    }
    const all = inbox.querySelectorAll('li.thread-line-item, li[data-conversation-id]');
    console.log(TAG, 'findUnreadThreads: total thread items =', all.length);
    const unread = [];
    all.forEach(function (li, i) {
      const reasons = [];
      if (li.querySelector('.unread-count'))      reasons.push('.unread-count');
      if (li.querySelector('.unread-countZuid'))  reasons.push('.unread-countZuid');
      if (li.querySelector('.preview.slds-text-title_bold')) reasons.push('preview is bold');
      // Some rows also carry a sibling div with class 'unread' on the
      // row container (visible in the screenshot DOM).
      if (li.querySelector('.unread:not(.slds-truncate)') ||
          li.querySelector('[class*=" unread "]') ||
          li.querySelector('[class^="unread "]')) {
        // Avoid double-counting the slds-truncate-wrapper that just has
        // the literal word "unread" in a longer class list.
      }
      if (reasons.length) {
        const convId = li.getAttribute('data-conversation-id') || ('(no id, idx=' + i + ')');
        const previewEl = li.querySelector('.preview');
        const preview = previewEl ? (previewEl.textContent || '').trim().slice(0, 60) : '';
        unread.push({ li: li, convId: convId, preview: preview, reasons: reasons });
      }
    });
    console.log(TAG, 'findUnreadThreads: unread =', unread.length,
      unread.map(function (u) { return u.convId + ' [' + u.reasons.join(', ') + '] ' + u.preview; }));
    return unread;
  }

  function findBackButton(panel) {
    return panel.querySelector('button[title="Back"], lightning-button-icon button[title="Back"]');
  }

  async function backToInbox(panel) {
    let tries = 0;
    while (tries < 5) {
      const back = findBackButton(panel);
      if (!back || back.offsetParent === null || back.disabled) {
        if (tries === 0) console.log(TAG, '  back: no back button visible — assuming already in inbox');
        return true;
      }
      console.log(TAG, '  back: clicking Back button (try ' + (tries + 1) + ')', back);
      realClick(back);
      await wait(220);
      tries++;
    }
    console.warn(TAG, '  back: gave up after 5 tries');
    return false;
  }

  // Wait until a thread is no longer "unread" (Salesforce stamps over
  // the bold/unread-count classes once the read receipt registers).
  async function waitUntilRead(li, maxMs) {
    const start = Date.now();
    const limit = maxMs || 1500;
    while (Date.now() - start < limit) {
      const stillBold = !!li.querySelector('.preview.slds-text-title_bold');
      const stillCount = !!(li.querySelector('.unread-count') || li.querySelector('.unread-countZuid'));
      if (!stillBold && !stillCount) return true;
      await wait(80);
    }
    return false;
  }

  async function markOneRead(panel, info, idx, total) {
    console.group(TAG + ' ' + (idx + 1) + '/' + total + ' — ' + info.convId);
    try {
      console.log('preview:', info.preview);
      console.log('reasons:', info.reasons);
      // The thread's row container is the click target. contact-sms.js
      // already settled on c-slds-sms-inbox-thread or .row-container.
      const target = info.li.querySelector('c-slds-sms-inbox-thread, .row-container') || info.li;
      console.log('click target:', target);
      realClick(target);
      // Give the thread-view a moment to mount + read receipt to fire.
      await wait(400);
      const settled = await waitUntilRead(info.li, 1500);
      console.log('settled (no longer bold / no count):', settled);
      // Return to inbox so we can find the next unread.
      const backOk = await backToInbox(panel);
      console.log('back to inbox:', backOk);
      // Brief settle so the next iteration's findUnreadThreads sees the
      // updated state.
      await wait(180);
      return settled;
    } catch (e) {
      console.error('threw:', e);
      return false;
    } finally {
      console.groupEnd();
    }
  }

  async function markAllReadFlow(panel, btn) {
    const initial = findUnreadThreads(panel);
    if (!initial.length) {
      alert('No unread threads in this Messaging panel.');
      return;
    }

    const origText = btn.textContent;
    btn.disabled = true;
    let ok = 0, fail = 0, attempted = 0;

    console.group(TAG + ' run started; initial unread = ' + initial.length);
    try {
      // Re-query unread threads each iteration in case the DOM
      // reorders / removes the row as it transitions to read.
      let guard = 0;
      while (guard < initial.length + 5) {
        const current = findUnreadThreads(panel);
        if (!current.length) {
          console.log(TAG, 'no more unread — done');
          break;
        }
        const next = current[0];
        attempted++;
        btn.textContent = 'Marking ' + attempted + '/' + initial.length + '…';
        const success = await markOneRead(panel, next, attempted - 1, initial.length);
        if (success) ok++; else fail++;
        if (fail >= 3) {
          console.warn(TAG, 'bailing after 3 failures');
          break;
        }
        guard++;
      }
    } catch (e) {
      console.error(TAG, 'run failed:', e);
      alert('Mark all as read error: ' + (e && e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      console.log(TAG, 'done. ok=' + ok + ' failed=' + fail + ' attempted=' + attempted);
      console.groupEnd();
    }

    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'sms_mark_all_read',
        props: { initialUnread: initial.length, ok: ok, failed: fail, attempted: attempted }
      });
    } catch (_) {}

    if (fail) {
      alert('Marked ' + ok + ' of ' + initial.length + ' threads as read. ' + fail + ' failed — see browser console.');
    }
  }

  // ---- Button injection ---------------------------------------------------

  // Find the header bar inside the messaging panel where "New thread"
  // lives, then inject our button right after it.
  function findHeaderHost(panel) {
    const header = panel.querySelector('c-slds-sms-header');
    if (!header) return null;
    // The "New thread" button itself is inside a lightning-button.
    const newThreadBtn = header.querySelector('lightning-button button, button');
    if (!newThreadBtn) return null;
    // Walk up to the lightning-layout-item that holds it so we can
    // insertAfter (rather than wedging it into the button's own
    // shadow-host slot).
    let host = newThreadBtn.closest('lightning-layout-item') || newThreadBtn.parentElement;
    return { host: host, header: header, newThreadBtn: newThreadBtn };
  }

  function injectButton(panel) {
    if (panel.querySelector('[' + BUTTON_ATTR + ']')) return;
    const target = findHeaderHost(panel);
    if (!target) {
      // Header not mounted yet — silent skip; scan() will retry.
      return;
    }
    const btn = document.createElement('button');
    btn.setAttribute(BUTTON_ATTR, '1');
    btn.type = 'button';
    btn.textContent = 'Mark All As Read';
    btn.title = 'Open every unread thread to mark it as read, then return to the inbox.\n\n' + ZHL_TIP;
    btn.style.cssText =
      'margin-left:8px;padding:6px 12px;' +
      'background:#0b5cab;color:#fff;border:1px solid #0b5cab;' +
      'border-radius:4px;font:600 12px/1 Arial,sans-serif;cursor:pointer;' +
      'vertical-align:middle;';
    btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#084a8c'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#0b5cab'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(TAG, 'button clicked');
      markAllReadFlow(panel, btn);
    });
    // Insert after the "New thread" lightning-layout-item so we sit
    // next to it in the header row.
    if (target.host && target.host.parentElement) {
      target.host.parentElement.insertBefore(btn, target.host.nextSibling);
      console.log(TAG, 'button injected next to "New thread"');
    } else {
      target.header.appendChild(btn);
      console.log(TAG, 'button appended to header (fallback)');
    }
  }

  // ---- Scan loop ----------------------------------------------------------
  // The Messaging panel can open/close/re-render; keep looking for it
  // and inject our button when it's mounted. Cheap — early-returns when
  // the button is already present.
  function scan() {
    const panel = findMessagingPanel();
    if (!panel) return;
    try { injectButton(panel); } catch (e) { console.warn(TAG, 'inject error', e); }
  }

  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 2000);
  scan();
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
