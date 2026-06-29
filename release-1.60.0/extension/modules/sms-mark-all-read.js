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

  // Salesforce LWCs ignore bare .click() in many cases and care about
  // the full pointer/mouse/click sequence — and the events MUST be
  // composed:true so they cross shadow DOM boundaries to reach the
  // delegated listeners that handle conversation-open. Without
  // composed:true an event dispatched on a shadow-host element stops at
  // the shadow boundary and the LWC never sees it, which is the failure
  // mode we hit in v1.21.0: pointerdown / mousedown / mouseup all fired
  // but nothing navigated.
  function realClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) { console.warn(TAG, 'pointerdown threw', e); }
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) { console.warn(TAG, 'mousedown threw', e); }
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) { console.warn(TAG, 'pointerup threw', e); }
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) { console.warn(TAG, 'mouseup threw', e); }
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (e) { console.warn(TAG, 'click threw', e); }
    try { el.click(); } catch (e) { console.warn(TAG, '.click() threw', e); }
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

  // ---- "Unread" filter toggle --------------------------------------------
  //
  // The messaging panel header has a Unread on/off toggle next to the
  // search input. Flipping it ON collapses the list to ONLY unread
  // threads, which both:
  //   - massively shrinks the number of rows we need to walk
  //   - bypasses the virtualization problem (a typical unread set is
  //     small enough to render in full)
  //
  // We save the user's original state on entry and restore on exit so
  // the panel looks the same after a run.
  function findUnreadToggle(panel) {
    // The lightning-input wrapper carries the class "unread-toggle".
    const wrapper = panel.querySelector('lightning-input.unread-toggle');
    if (wrapper) {
      // The actual input + clickable label live inside the wrapper.
      const input = wrapper.querySelector('input[type="checkbox"][role="switch"], input[type="checkbox"]');
      const label = wrapper.querySelector('label.slds-checkbox_toggle');
      if (input) return { input: input, label: label, wrapper: wrapper };
    }
    // Fallback: walk by label text.
    const spans = panel.querySelectorAll('span.slds-form-element__label');
    for (const s of spans) {
      if ((s.textContent || '').trim() !== 'Unread') continue;
      const lbl = s.closest('label.slds-checkbox_toggle');
      if (!lbl) continue;
      const inp = lbl.querySelector('input[type="checkbox"]') ||
                  (lbl.parentElement && lbl.parentElement.querySelector('input[type="checkbox"]'));
      if (inp) return { input: inp, label: lbl, wrapper: lbl.closest('lightning-input') };
    }
    return null;
  }

  async function setUnreadFilter(panel, wantOn) {
    const t = findUnreadToggle(panel);
    if (!t) {
      console.warn(TAG, 'unread toggle not found — proceeding without filter');
      return { changed: false, was: null };
    }
    const was = !!t.input.checked;
    if (was === !!wantOn) {
      console.log(TAG, 'unread toggle already', was ? 'on' : 'off', '— no change');
      return { changed: false, was: was };
    }
    // Clicking the label is the most reliable trigger for LWC toggles;
    // direct input.click() sometimes skips the LWC change handler.
    const target = t.label || t.input;
    console.log(TAG, 'flipping unread toggle', was ? 'on→off' : 'off→on', 'via', target);
    realClick(target);
    // Wait for the filter to apply and the inbox to re-render.
    await wait(400);
    console.log(TAG, 'unread toggle now', t.input.checked ? 'on' : 'off');
    return { changed: true, was: was };
  }

  // ---- Inbox auto-scroll (in case filtered list also virtualizes) --------
  function findScrollContainer(start) {
    let p = start;
    while (p && p !== document.body) {
      const cs = p.style && (p.style.overflowY || '') ||
                 (window.getComputedStyle ? window.getComputedStyle(p).overflowY : '');
      if (p.scrollHeight - p.clientHeight > 4 &&
          (cs === 'auto' || cs === 'scroll' || cs === 'overlay' || p.scrollTop > 0)) {
        return p;
      }
      p = p.parentElement;
    }
    return null;
  }
  async function scrollInboxDown(panel) {
    const inbox = findInbox(panel);
    if (!inbox) return false;
    const container = findScrollContainer(inbox) ||
                      inbox.querySelector('section') ||
                      inbox;
    if (!container || container.scrollHeight <= container.clientHeight) return false;
    const before = container.scrollTop;
    container.scrollTop = container.scrollHeight;
    await wait(350); // let lazy-load fire
    const after = container.scrollTop;
    console.log(TAG, 'scrolled inbox', before, '→', after, '(maxScroll=', (container.scrollHeight - container.clientHeight), ')');
    return after > before;
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

  // Wait until the Back button becomes visible — confirms the thread
  // view actually mounted (which is when Salesforce fires the READ
  // status update over PubNub).
  async function waitForThreadView(panel, maxMs) {
    const start = Date.now();
    const max = maxMs || 2500;
    while (Date.now() - start < max) {
      const back = findBackButton(panel);
      if (back && back.offsetParent !== null) return back;
      await wait(80);
    }
    return null;
  }

  // Markdown a thread by clicking it open, letting the PubNub READ
  // status update broadcast, then clicking Back to return to the inbox.
  // SUCCESS is detected by re-querying the inbox AFTER returning and
  // confirming our conversation id is no longer in the unread list —
  // checking the original li mid-flight doesn't work because Salesforce
  // only re-renders the row's bold/count classes once the inbox view is
  // active again.
  async function markOneRead(panel, info, idx, total) {
    console.group(TAG + ' ' + (idx + 1) + '/' + total + ' — ' + info.convId);
    try {
      console.log('preview:', info.preview);
      console.log('reasons:', info.reasons);

      // Click target priority: .row-container is the visual row,
      // c-slds-sms-inbox-thread is the LWC host, then the visible label
      // elements as fallback.
      const target = info.li.querySelector('.row-container')
        || info.li.querySelector('c-slds-sms-inbox-thread')
        || info.li.querySelector('h3')
        || info.li.querySelector('.preview')
        || info.li;
      console.log('clicking:', target);
      realClick(target);

      // Wait for thread view to mount — confirms the click actually
      // navigated and the LWC fired its handleThreadClick.
      const back = await waitForThreadView(panel, 2500);
      if (!back) {
        console.warn('thread view never opened (Back button not visible after 2.5s)');
        // Best-effort: try clicking back anyway in case we're in some
        // weird half-state.
        await backToInbox(panel);
        return false;
      }
      console.log('thread view mounted — waiting 500ms for PubNub READ broadcast');
      // PubNub round-trip — the log shows the READ statusUpdate fires
      // almost immediately, but 500ms gives Salesforce time to commit
      // the local state change too.
      await wait(500);

      // Return to inbox so we can both verify success AND find the next
      // unread thread on the next iteration.
      console.log('clicking Back to return to inbox');
      await backToInbox(panel);
      await wait(250);

      // SUCCESS check: is our conversation still in the unread list?
      const stillUnread = findUnreadThreads(panel).some(function (u) {
        return u.convId === info.convId;
      });
      if (stillUnread) {
        console.warn('still appears unread in the inbox after click+back — Salesforce did not commit the read receipt');
        return false;
      }
      console.log('SUCCESS — conversation no longer in unread list');
      return true;
    } catch (e) {
      console.error('threw:', e);
      return false;
    } finally {
      console.groupEnd();
    }
  }

  async function markAllReadFlow(panel, btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    let ok = 0, fail = 0, attempted = 0;
    let initialUnreadCount = 0;
    let toggleRestore = { changed: false, was: null };

    // Paint the overlay BEFORE we flip the Unread filter — the filter
    // flip causes a visible re-render of the inbox and we don't want
    // the user to see it.
    showOverlay(panel, 'Finding unread threads…');

    console.group(TAG + ' run started');
    try {
      // 1. Flip Salesforce's Unread filter ON so the inbox renders
      //    only unread threads. Without this, the panel's virtualized
      //    thread list only mounts the visible window of (read +
      //    unread) rows, and any unread thread scrolled out of view
      //    is invisible to our scan.
      toggleRestore = await setUnreadFilter(panel, true);

      // 2. Scroll the filtered list down a few times so any
      //    virtualized rows mount into the DOM.
      let scrolledAny = true;
      let scrollGuard = 0;
      while (scrolledAny && scrollGuard < 10) {
        scrolledAny = await scrollInboxDown(panel);
        scrollGuard++;
      }
      // 3. Snap back to top so the first iteration starts on the
      //    first unread row in the visible viewport.
      const inbox = findInbox(panel);
      if (inbox) {
        const sc = findScrollContainer(inbox);
        if (sc) sc.scrollTop = 0;
      }
      await wait(200);

      // 4. NOW count unread.
      const initial = findUnreadThreads(panel);
      initialUnreadCount = initial.length;
      if (!initial.length) {
        hideOverlay(panel);
        alert('No unread threads in this Messaging panel.');
        return;
      }

      // 5. Run the marking loop.
      showOverlay(panel, 'Marking 0/' + initial.length + ' threads as read…');
      let guard = 0;
      while (guard < initial.length + 5) {
        let current = findUnreadThreads(panel);
        if (!current.length) {
          // Try scrolling down in case more unread rows are below the
          // fold. If scroll moves at all, re-scan.
          const moved = await scrollInboxDown(panel);
          if (moved) {
            current = findUnreadThreads(panel);
          }
        }
        if (!current.length) {
          console.log(TAG, 'no more unread visible after scroll — done');
          break;
        }
        const next = current[0];
        attempted++;
        btn.textContent = 'Marking ' + attempted + '/' + initial.length + '…';
        updateOverlayText(panel, 'Marking ' + attempted + '/' + initial.length + ' threads as read…');
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
      // Restore the Unread toggle to the user's original state so the
      // panel looks the same as before we started.
      if (toggleRestore.changed) {
        try { await setUnreadFilter(panel, !!toggleRestore.was); }
        catch (e) { console.warn(TAG, 'failed to restore unread toggle', e); }
      }
      btn.disabled = false;
      btn.textContent = origText;
      hideOverlay(panel);
      console.log(TAG, 'done. ok=' + ok + ' failed=' + fail + ' attempted=' + attempted);
      console.groupEnd();
    }

    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'sms_mark_all_read',
        props: { initialUnread: initialUnreadCount, ok: ok, failed: fail, attempted: attempted }
      });
    } catch (_) {}

    if (fail) {
      alert('Marked ' + ok + ' of ' + initialUnreadCount + ' threads as read. ' + fail + ' failed — see browser console.');
    }
  }

  // ---- Button injection ---------------------------------------------------

  // We're "in the inbox view" when the New thread button is visible.
  // When a thread is opened, Salesforce swaps the header to show a Back
  // arrow + the conversation participant instead, and the New thread
  // button disappears. Mark All As Read only makes sense in the inbox
  // view, so we toggle the button's display based on that signal.
  function isInboxView(panel) {
    const header = panel.querySelector('c-slds-sms-header');
    if (!header) return false;
    // Look for a button whose text is exactly "New thread" — that's
    // the canonical inbox-view marker.
    const buttons = header.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim();
      if (t === 'New thread' && b.offsetParent !== null) return true;
    }
    return false;
  }

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

  // Show/hide the button based on inbox-vs-thread view. Called every
  // scan tick so the toggle stays in sync as the user navigates around
  // the messaging panel without us needing a per-thread event listener.
  function updateButtonVisibility(panel) {
    const btn = panel.querySelector('[' + BUTTON_ATTR + ']');
    if (!btn) return;
    const shouldShow = isInboxView(panel);
    const isShowing = btn.style.display !== 'none';
    if (shouldShow && !isShowing) {
      btn.style.display = '';
    } else if (!shouldShow && isShowing) {
      btn.style.display = 'none';
    }
  }

  // ---- "Marking..." overlay -----------------------------------------------
  // While the run is in progress we paint a semi-opaque overlay on top
  // of the messaging panel so the user doesn't see threads flickering
  // open and closed. The overlay shows "Marking N/M..." text and the
  // user can't interact with the messaging panel until the run
  // finishes (then we remove it). The actual marking still happens on
  // the live DOM underneath — Salesforce needs to render the thread
  // view to fire its PubNub READ receipt — but the overlay hides it.
  function showOverlay(panel, text) {
    let overlay = panel.querySelector('[data-zhl-mark-overlay]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-zhl-mark-overlay', '1');
      overlay.style.cssText = [
        'position: absolute',
        'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
        'background: rgba(255,255,255,0.96)',
        'z-index: 9999',
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'justify-content: center',
        'gap: 12px',
        'font: 600 14px/1.4 Arial,Helvetica,sans-serif',
        'color: #0b5cab',
        'text-align: center',
        'pointer-events: all',
        'cursor: wait',
        'padding: 24px'
      ].join(';');
      const spinner = document.createElement('div');
      spinner.style.cssText = [
        'width: 28px', 'height: 28px',
        'border: 3px solid #cfe1f5',
        'border-top-color: #0b5cab',
        'border-radius: 50%',
        'animation: zhl-mark-spin 0.8s linear infinite'
      ].join(';');
      const msg = document.createElement('div');
      msg.setAttribute('data-zhl-mark-msg', '1');
      msg.textContent = text;
      const sub = document.createElement('div');
      sub.style.cssText = 'font: 500 12px/1.4 Arial,sans-serif;color:#6b7280;max-width:240px;';
      sub.textContent = 'Salesforce only marks threads read by opening them — please don\'t interact with the panel until this finishes.';
      overlay.appendChild(spinner);
      overlay.appendChild(msg);
      overlay.appendChild(sub);
      // Ensure the panel can host an absolutely-positioned overlay.
      if (getComputedStyle(panel).position === 'static') {
        panel.style.position = 'relative';
      }
      panel.appendChild(overlay);

      // Inject the spinner keyframes once.
      if (!document.getElementById('zhl-mark-spin-style')) {
        const style = document.createElement('style');
        style.id = 'zhl-mark-spin-style';
        style.textContent = '@keyframes zhl-mark-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }
    } else {
      const msg = overlay.querySelector('[data-zhl-mark-msg]');
      if (msg) msg.textContent = text;
    }
    return overlay;
  }
  function updateOverlayText(panel, text) {
    const msg = panel.querySelector('[data-zhl-mark-overlay] [data-zhl-mark-msg]');
    if (msg) msg.textContent = text;
  }
  function hideOverlay(panel) {
    const overlay = panel.querySelector('[data-zhl-mark-overlay]');
    if (overlay) overlay.remove();
  }

  // ---- Scan loop ----------------------------------------------------------
  // The Messaging panel can open/close/re-render; keep looking for it
  // and inject our button when it's mounted. Cheap — early-returns when
  // the button is already present.
  function scan() {
    const panel = findMessagingPanel();
    if (!panel) return;
    try { injectButton(panel); } catch (e) { console.warn(TAG, 'inject error', e); }
    try { updateButtonVisibility(panel); } catch (e) { console.warn(TAG, 'visibility error', e); }
  }

  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 2000);
  scan();
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
