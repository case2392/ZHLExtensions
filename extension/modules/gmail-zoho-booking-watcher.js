// ZHL Productivity Pack — Gmail Zoho Booking Watcher
//
// When a ZHL-hosted Zoho booking confirmation email arrives in Gmail
// (sender scheduling@booking.zillowgroup.com, subject "New Appointment
// with <Name>"), this module:
//
//   1. Parses borrower name, date, time, and phone from the email body.
//   2. Shows a 5-second confirmation toast at the top-right of Gmail
//      saying "Detected booking from <Name> — opening Salesforce in 5s.
//      Cancel?" with an explicit Cancel button. If the LO clicks Cancel
//      OR clicks anywhere else in Gmail that signals "no, this is not a
//      booking", we abort.
//   3. Stashes the parsed payload to chrome.storage.local under
//      zhlPendingZohoBookingNote and opens a Salesforce tab. The Gmail
//      side's job is done; the Salesforce companion module
//      (sf-zoho-booking-paster.js) takes over from there.
//
// Safety rails:
//   - Per-message dedup (we record the Gmail messageId of every email
//     we've already processed in chrome.storage.local).
//   - Daily limit (10 fires / 24h / LO) so a misdetection can't loop.
//   - Explicit Cancel button on every confirmation toast.
//   - Feature can be toggled off entirely from Setup.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_zohoBookingAutoNote';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Zoho Booking Watcher v' + VERSION + '] loaded on', location.href);

  // Detection patterns. Conservative on purpose — we want false negatives
  // (LO has to log manually) much more than false positives (extension
  // creates an unwanted disposition entry in Salesforce).
  const SENDER_PATTERN  = /scheduling@booking\.zillowgroup\.com/i;
  const SUBJECT_PATTERN = /^New Appointment with\s+(.+?)$/i;
  // Field patterns inside the body. All required to fire.
  const DATE_PATTERN    = /Date:\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/;
  const TIME_PATTERN    = /Time:\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i;
  const PHONE_PATTERN   = /Contact Number:\s*([+\d][\d\s().-]{8,})/;

  const STORAGE_KEY  = 'zhlPendingZohoBookingNote';
  const DEDUP_KEY    = 'zhlZohoBookingSeenIds';   // array of recent Gmail messageIds
  const COUNT_KEY    = 'zhlZohoBookingDailyCount'; // { dayKey: 'YYYY-MM-DD', count: n }
  const DEDUP_MAX    = 200;
  const DAILY_LIMIT  = 10;
  const STASH_TTL_MS = 10 * 60 * 1000;
  const COUNTDOWN_MS = 5000;

  const SALESFORCE_HOME = 'https://zillowhomeloans.lightning.force.com/lightning/page/home';

  // ---- Helpers ----------------------------------------------------
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function getStorage(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (data) { resolve(data || {}); }); }
      catch (_) { resolve({}); }
    });
  }
  function setStorage(payload) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.set(payload, function () { resolve(); }); }
      catch (_) { resolve(); }
    });
  }

  // Friendly format helpers.
  function formatFriendlyDate(rawDate) {
    // rawDate like "11 Jun 2026" — JS Date parses this directly.
    try {
      const d = new Date(rawDate);
      if (isNaN(d.getTime())) return rawDate;
      const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dow    = days[d.getDay()];
      const month  = months[d.getMonth()];
      const day    = d.getDate();
      // Ordinal suffix
      const j = day % 10, k = day % 100;
      let suffix = 'th';
      if (j === 1 && k !== 11) suffix = 'st';
      else if (j === 2 && k !== 12) suffix = 'nd';
      else if (j === 3 && k !== 13) suffix = 'rd';
      return dow + ', ' + month + ' ' + day + suffix;
    } catch (_) { return rawDate; }
  }
  function formatFriendlyTime(rawTime) {
    // rawTime like "09:30 AM" — drop the leading zero on the hour.
    try {
      const m = String(rawTime).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!m) return rawTime;
      const h = parseInt(m[1], 10);
      const mm = m[2];
      const ampm = m[3].toLowerCase();
      // Show as "9:30am" if minutes are :00 → "9am", else "9:30am".
      if (mm === '00') return h + ampm;
      return h + ':' + mm + ampm;
    } catch (_) { return rawTime; }
  }
  function firstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || '';
  }

  // ---- Email DOM scraping -----------------------------------------
  // Gmail opens an individual email as an article[role="listitem"] (or
  // similar) inside the conversation pane. We walk the visible message
  // headers + body. Conservative selectors so future Gmail tweaks don't
  // randomly trigger on unrelated emails.

  function findOpenMessages() {
    // Each open message in the conversation view is a div with class h7
    // (Gmail's internal) OR a role="listitem" article. Use textContent
    // as the safety net — we still only fire on sender + subject match.
    return Array.from(document.querySelectorAll('div.adn, div.h7, article[role="listitem"]'));
  }

  function getMessageId(msgEl) {
    // Gmail sets data-message-id="msg-f:NUMBER" on the message container.
    if (!msgEl) return null;
    const wrap = msgEl.querySelector('[data-message-id]') || msgEl.closest('[data-message-id]');
    if (wrap) return wrap.getAttribute('data-message-id');
    // Fallback: hash the (sender + subject + body slice) so we still get
    // some dedup signal even if Gmail's data attribute changes.
    const txt = (msgEl.textContent || '').slice(0, 800);
    let h = 0; for (let i = 0; i < txt.length; i++) h = ((h << 5) - h + txt.charCodeAt(i)) | 0;
    return 'hash:' + h;
  }

  function getSenderEmail(msgEl) {
    // Sender lives inside .gD span[email] or .go span[email].
    const el = msgEl.querySelector('span[email]');
    if (el) return el.getAttribute('email') || '';
    return '';
  }

  function getSubject() {
    // Subject is on the conversation header at the top of the thread —
    // shared across all messages in the open thread.
    const el = document.querySelector('h2.hP, [data-thread-perm-id] h2');
    return el ? (el.textContent || '').trim() : '';
  }

  function getBodyText(msgEl) {
    const el = msgEl.querySelector('div.a3s, div[dir="ltr"]');
    if (!el) return '';
    return (el.innerText || el.textContent || '');
  }

  function parseBooking(msgEl) {
    const sender = getSenderEmail(msgEl);
    if (!SENDER_PATTERN.test(sender)) return null;
    const subject = getSubject();
    const subjectMatch = subject.match(SUBJECT_PATTERN);
    if (!subjectMatch) return null;
    const borrowerName = subjectMatch[1].trim();
    const body = getBodyText(msgEl);
    if (!body) return null;
    const dateM  = body.match(DATE_PATTERN);
    const timeM  = body.match(TIME_PATTERN);
    const phoneM = body.match(PHONE_PATTERN);
    if (!dateM || !timeM || !phoneM) return null;
    return {
      borrowerName: borrowerName,
      borrowerFirst: firstName(borrowerName),
      rawDate: dateM[1].trim(),
      rawTime: timeM[1].trim(),
      friendlyDate: formatFriendlyDate(dateM[1].trim()),
      friendlyTime: formatFriendlyTime(timeM[1].trim()),
      phoneRaw: phoneM[1].trim(),
      phoneDigits: phoneM[1].replace(/\D+/g, '').replace(/^1(?=\d{10}$)/, ''),
      messageId: getMessageId(msgEl),
      detectedAt: Date.now()
    };
  }

  // ---- Confirmation toast -----------------------------------------
  const TOAST_ID = 'zhl-zoho-booking-toast';
  function showConfirmationToast(booking, onConfirm, onCancel) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = TOAST_ID;
    wrap.style.cssText = [
      'position:fixed', 'top:80px', 'right:24px',
      'z-index:2147483647',
      'background:#fff', 'border:2px solid #1d4ed8', 'border-radius:10px',
      'box-shadow:0 14px 32px rgba(0,0,0,0.18)',
      'padding:14px 16px', 'min-width:320px', 'max-width:380px',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color:#0f172a'
    ].join(';');

    const note = '“' + booking.borrowerFirst + ' scheduled an appointment with me for ' +
                 booking.friendlyTime + ' on ' + booking.friendlyDate + '.”';

    wrap.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#dbeafe;color:#1d4ed8;font-weight:800;font-size:11px;letter-spacing:0.5px;">ZHL</span>' +
        '<span style="font-weight:700;color:#1d4ed8;">Booking detected</span>' +
        '<button id="zhl-zb-x" style="margin-left:auto;background:none;border:none;font-size:18px;line-height:1;color:#94a3b8;cursor:pointer;padding:0;">×</button>' +
      '</div>' +
      '<div style="margin-bottom:6px;color:#1f2937;"><b>' + escapeHtml(booking.borrowerName) + '</b> · ' + escapeHtml(booking.friendlyDate) + ' at ' + escapeHtml(booking.friendlyTime) + '</div>' +
      '<div style="margin-bottom:10px;font-style:italic;color:#64748b;font-size:12px;">' + escapeHtml(note) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
        '<button id="zhl-zb-go" style="flex:1;padding:8px 12px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font:600 12px Arial,sans-serif;cursor:pointer;">Open Salesforce &amp; paste <span id="zhl-zb-count">(5)</span></button>' +
        '<button id="zhl-zb-cancel" style="padding:8px 12px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;font:600 12px Arial,sans-serif;cursor:pointer;">Cancel</button>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#94a3b8;">Built by Justin Case. Karma appreciated 💛</div>';
    document.body.appendChild(wrap);

    let cancelled = false;
    let remaining = COUNTDOWN_MS / 1000;
    const countEl = wrap.querySelector('#zhl-zb-count');
    const tick = setInterval(function () {
      remaining--;
      if (countEl) countEl.textContent = '(' + Math.max(0, remaining) + ')';
      if (remaining <= 0) {
        clearInterval(tick);
        if (!cancelled) { try { wrap.remove(); } catch (_) {} onConfirm && onConfirm(); }
      }
    }, 1000);

    function cancel() {
      cancelled = true;
      clearInterval(tick);
      try { wrap.remove(); } catch (_) {}
      onCancel && onCancel();
    }
    wrap.querySelector('#zhl-zb-cancel').addEventListener('click', cancel);
    wrap.querySelector('#zhl-zb-x').addEventListener('click', cancel);
    wrap.querySelector('#zhl-zb-go').addEventListener('click', function () {
      cancelled = true;
      clearInterval(tick);
      try { wrap.remove(); } catch (_) {}
      onConfirm && onConfirm();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Main flow --------------------------------------------------
  let firingInThisTab = false;

  async function consumeBooking(booking) {
    if (firingInThisTab) return;
    firingInThisTab = true;
    try {
      // Dedup + daily limit. Per-messageId dedup so the same Gmail
      // message can't fire twice. Daily limit caps a misdetection
      // loop at DAILY_LIMIT fires per LO per day.
      const data = await getStorage([DEDUP_KEY, COUNT_KEY]);
      const seen = Array.isArray(data[DEDUP_KEY]) ? data[DEDUP_KEY] : [];
      if (booking.messageId && seen.indexOf(booking.messageId) >= 0) {
        console.log('[ZHL Zoho Booking Watcher] messageId already processed, skipping');
        firingInThisTab = false;
        return;
      }
      const today = todayKey();
      const count = data[COUNT_KEY] && data[COUNT_KEY].dayKey === today ? (data[COUNT_KEY].count || 0) : 0;
      if (count >= DAILY_LIMIT) {
        console.warn('[ZHL Zoho Booking Watcher] daily limit of ' + DAILY_LIMIT + ' reached, skipping');
        firingInThisTab = false;
        return;
      }

      // Confirmation toast.
      showConfirmationToast(booking,
        async function onConfirm() {
          // Bump dedup + counter, stash payload, open Salesforce.
          const trimmedSeen = (booking.messageId ? seen.concat([booking.messageId]) : seen).slice(-DEDUP_MAX);
          const payload = {};
          payload[DEDUP_KEY] = trimmedSeen;
          payload[COUNT_KEY] = { dayKey: today, count: count + 1 };
          payload[STORAGE_KEY] = Object.assign({}, booking, { ts: Date.now() });
          await setStorage(payload);
          console.log('[ZHL Zoho Booking Watcher] stashed booking, asking SW to open-or-focus Salesforce');
          try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_detected', props: { dayKey: today } }); } catch (_) {}
          // Prefer reusing an existing Salesforce tab. The service worker
          // queries chrome.tabs.query for lightning.force.com/salesforce.com
          // tabs, focuses the most recent if found, and falls back to opening
          // a new tab to fallbackUrl if none are open. On reuse, the SW also
          // sends a ZHL_BOOKING_CHECK_PENDING message to that tab so the
          // paster wakes up immediately.
          // The service worker is the SOLE authority for tab handling:
          // it focuses an existing Salesforce tab if one is open, or
          // creates a new one if not. We deliberately do NOT window.open
          // from here on a falsy callback — in MV3 the sendMessage
          // callback frequently fires with chrome.runtime.lastError set
          // even when the SW DID successfully focus the existing tab,
          // and an extra window.open would then pop a redundant blank
          // tab that steals focus. The only place we fall back is the
          // synchronous catch (extension context genuinely gone), where
          // the SW could not have run at all.
          try {
            chrome.runtime.sendMessage(
              { type: 'ZHL_OPEN_OR_FOCUS_SF', fallbackUrl: SALESFORCE_HOME },
              function (resp) {
                // Touch lastError so Chrome doesn't log "unchecked
                // runtime.lastError"; do NOT window.open on a falsy resp.
                const _ = chrome.runtime && chrome.runtime.lastError;
                console.log('[ZHL Zoho Booking Watcher] SW open-or-focus result:', resp, _ ? ('(lastError: ' + _.message + ')') : '');
              }
            );
          } catch (_) {
            // Extension context invalidated — SW unreachable. Only here
            // do we open directly, because nothing else can.
            try { window.open(SALESFORCE_HOME, '_blank'); } catch (__) {}
          }
          firingInThisTab = false;
        },
        function onCancel() {
          console.log('[ZHL Zoho Booking Watcher] LO cancelled — booking not auto-logged');
          try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'zoho_booking_cancelled' }); } catch (_) {}
          firingInThisTab = false;
        }
      );
    } catch (e) {
      console.error('[ZHL Zoho Booking Watcher] consumeBooking error', e);
      firingInThisTab = false;
    }
  }

  function scanOnce() {
    if (firingInThisTab) return;
    const msgs = findOpenMessages();
    for (const m of msgs) {
      const booking = parseBooking(m);
      if (booking) {
        console.log('[ZHL Zoho Booking Watcher] detected booking', booking);
        consumeBooking(booking);
        return;
      }
    }
  }

  // Debounced MutationObserver — Gmail's React re-renders constantly, so
  // we throttle to one scan per ~600ms.
  let scanTimer = null;
  function schedule() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; try { scanOnce(); } catch (_) {} }, 600);
  }
  const obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(schedule, 800);
  setInterval(schedule, 4000);
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
