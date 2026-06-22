// ZHL Productivity Pack module — feature key: feature_calendarReminders
//
// Outlook-style meeting reminders for Gmail. Google Calendar / Gmail has
// no equivalent of Outlook's reminder window that pops up "this meeting
// starts in 30 minutes" with Snooze / Dismiss. This module recreates it:
//
//   - The background service worker polls the LO's PRIVATE Google
//     Calendar ICS feed (pasted once in Setup) every few minutes and
//     stores the upcoming events in chrome.storage.local.
//   - This Gmail content script reads those events on a short tick and,
//     at each configured lead time (default 30 min AND 5 min before
//     start), renders a floating reminder card in the corner of Gmail.
//   - Each reminder can be Dismissed (gone for good) or Snoozed (comes
//     back after the chosen interval). Dismiss All clears everything.
//   - Snooze / dismiss state lives in chrome.storage.local so it's
//     consistent across every open Gmail tab and survives reloads.
//
// Lead-time model: the configured lead times are sorted descending
// (e.g. [30, 5]). At any moment the "active" reminder for an event is
// the SMALLEST lead time already reached. So a 30-minute reminder fires
// first; if the LO dismisses it, a fresh 5-minute reminder still fires
// at T-5 (different instance key), giving the "heads-up + final nudge"
// behavior the LO asked for. A reminder auto-expires 60 minutes after
// the meeting starts so stale cards don't linger.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_calendarReminders';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Calendar Reminders v' + VERSION + '] loaded on', location.href);

  const EVENTS_KEY    = 'zhlCalEvents';      // [{uid,startMs,endMs,title,location,meet}]
  const DISMISS_KEY   = 'zhlCalDismissed';   // { instanceKey: eventStartMs }
  const SNOOZE_KEY    = 'zhlCalSnooze';      // { instanceKey: snoozeUntilMs }
  const LEADS_KEY     = 'cal_lead_times';    // string "30,5"
  const URL_KEY       = 'cal_ics_url';
  const PANEL_ID      = 'zhl-cal-reminder-panel';
  const ZHL_TIP       = 'Built by Justin Case. Karma appreciated 💛';

  const EXPIRE_AFTER_START_MS = 60 * 60 * 1000; // stop nagging 1h after start
  const TICK_MS = 15000;

  // Snooze dropdown options (minutes).
  const SNOOZE_OPTIONS = [
    { label: '1 minute',  min: 1 },
    { label: '5 minutes', min: 5 },
    { label: '10 minutes', min: 10 },
    { label: '15 minutes', min: 15 },
    { label: '30 minutes', min: 30 },
    { label: '1 hour', min: 60 }
  ];
  let snoozeChoiceMin = 5; // default snooze duration

  // -------- helpers ----------------------------------------------
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseLeads(str) {
    const out = [];
    String(str || '').split(/[,\s]+/).forEach(function (t) {
      const n = parseInt(t, 10);
      if (isFinite(n) && n >= 0) out.push(n);
    });
    if (!out.length) return [30, 5];
    // unique, descending
    return Array.from(new Set(out)).sort(function (a, b) { return b - a; });
  }

  function getStorage(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (d) { resolve(d || {}); }); }
      catch (_) { resolve({}); }
    });
  }
  function setStorage(obj) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.set(obj, function () { resolve(); }); }
      catch (_) { resolve(); }
    });
  }

  function fmtClock(ms) {
    try {
      const d = new Date(ms);
      const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const date = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      return time + ', ' + date;
    } catch (_) { return ''; }
  }

  function relLabel(startMs, now) {
    const mins = Math.round((startMs - now) / 60000);
    if (mins > 1) return 'in ' + mins + ' minutes';
    if (mins === 1) return 'in 1 minute';
    if (mins === 0) return 'now';
    if (mins === -1) return '1 minute ago';
    return (-mins) + ' minutes ago';
  }

  function instanceKey(ev, lead) {
    return ev.uid + '|' + ev.startMs + '|' + lead;
  }

  // -------- core: which reminders are due ------------------------
  async function computeDue() {
    const data = await getStorage([EVENTS_KEY, DISMISS_KEY, SNOOZE_KEY, LEADS_KEY]);
    const events = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    const dismissed = data[DISMISS_KEY] || {};
    const snooze = data[SNOOZE_KEY] || {};
    const leads = parseLeads(data[LEADS_KEY]);
    const now = Date.now();

    const due = [];
    for (const ev of events) {
      if (!ev || !isFinite(ev.startMs)) continue;
      if (now > ev.startMs + EXPIRE_AFTER_START_MS) continue;
      // Which lead times have we reached? Active = smallest reached.
      let activeLead = null;
      for (const L of leads) {
        if (now >= ev.startMs - L * 60000) {
          if (activeLead === null || L < activeLead) activeLead = L;
        }
      }
      if (activeLead === null) continue;
      const key = instanceKey(ev, activeLead);
      if (dismissed[key]) continue;
      if (snooze[key] && snooze[key] > now) continue;
      due.push({ ev: ev, lead: activeLead, key: key });
    }
    due.sort(function (a, b) { return a.ev.startMs - b.ev.startMs; });
    return due;
  }

  // -------- dismiss / snooze actions -----------------------------
  async function dismissOne(key, startMs) {
    const data = await getStorage([DISMISS_KEY]);
    const dismissed = data[DISMISS_KEY] || {};
    dismissed[key] = startMs;
    pruneMap(dismissed);
    await setStorage({ [DISMISS_KEY]: dismissed });
    render();
  }
  async function dismissAll(dueList) {
    const data = await getStorage([DISMISS_KEY]);
    const dismissed = data[DISMISS_KEY] || {};
    dueList.forEach(function (d) { dismissed[d.key] = d.ev.startMs; });
    pruneMap(dismissed);
    await setStorage({ [DISMISS_KEY]: dismissed });
    render();
  }
  async function snoozeOne(key, minutes) {
    const data = await getStorage([SNOOZE_KEY]);
    const snooze = data[SNOOZE_KEY] || {};
    snooze[key] = Date.now() + minutes * 60000;
    pruneMap(snooze);
    await setStorage({ [SNOOZE_KEY]: snooze });
    render();
  }
  async function snoozeAll(dueList, minutes) {
    const data = await getStorage([SNOOZE_KEY]);
    const snooze = data[SNOOZE_KEY] || {};
    const until = Date.now() + minutes * 60000;
    dueList.forEach(function (d) { snooze[d.key] = until; });
    pruneMap(snooze);
    await setStorage({ [SNOOZE_KEY]: snooze });
    render();
  }
  // Drop entries whose meeting was >2h ago so the maps don't grow forever.
  function pruneMap(map) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    Object.keys(map).forEach(function (k) {
      // instanceKey is uid|startMs|lead — pull the startMs segment.
      const parts = k.split('|');
      const startMs = parseInt(parts[parts.length - 2], 10);
      const val = map[k];
      // dismissed stores startMs; snooze stores snoozeUntil. Either way,
      // if both the meeting time and the stored value are well past, drop.
      const ref = isFinite(startMs) ? startMs : (isFinite(val) ? val : 0);
      if (ref && ref < cutoff && (!isFinite(val) || val < Date.now())) delete map[k];
    });
  }

  // -------- render the reminder panel ----------------------------
  let lastSignature = '';

  async function render() {
    const due = await computeDue();
    if (!due.length) {
      const ex = document.getElementById(PANEL_ID);
      if (ex) ex.remove();
      lastSignature = '';
      return;
    }
    // Cheap signature so we don't rebuild the DOM every 15s tick when
    // nothing meaningful changed (which would reset the snooze dropdown
    // and any hover state). Recompute when the set of due items OR their
    // minute-label changes.
    const now = Date.now();
    const sig = due.map(function (d) {
      return d.key + '@' + Math.round((d.ev.startMs - now) / 60000);
    }).join(';') + '#snz=' + snoozeChoiceMin;
    if (sig === lastSignature && document.getElementById(PANEL_ID)) return;
    lastSignature = sig;

    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'top:70px', 'right:24px', 'z-index:2147483647',
      'width:380px', 'max-width:92vw',
      'background:#ffffff', 'border:1px solid #c7ccd1', 'border-radius:10px',
      'box-shadow:0 16px 40px rgba(0,0,0,0.22)',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color:#1f2937', 'overflow:hidden'
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;background:#1d4ed8;color:#fff;';
    header.innerHTML =
      '<span style="font-size:16px;">🔔</span>' +
      '<span style="font-weight:700;">' + due.length + ' Reminder' + (due.length === 1 ? '' : 's') + '</span>' +
      '<span style="margin-left:auto;font-size:11px;opacity:.85;">ZHL Meeting Reminders</span>';
    panel.appendChild(header);

    // Reminder rows
    const list = document.createElement('div');
    list.style.cssText = 'max-height:300px;overflow-y:auto;';
    due.forEach(function (d) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:12px 14px;border-bottom:1px solid #eef0f2;';
      const inProgress = now >= d.ev.startMs && now <= (d.ev.endMs || d.ev.startMs);
      const rel = relLabel(d.ev.startMs, now);
      const relColor = (d.ev.startMs - now) <= 5 * 60000 ? '#b91c1c' : '#1d4ed8';

      const meetBtn = d.ev.meet
        ? '<a href="' + escHtml(d.ev.meet) + '" target="_blank" rel="noreferrer" ' +
          'style="display:inline-block;margin-top:6px;padding:5px 10px;background:#16a34a;color:#fff;border-radius:5px;font:600 12px Arial,sans-serif;text-decoration:none;">📹 Join</a>'
        : '';
      const loc = d.ev.location
        ? '<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">📍 ' + escHtml(d.ev.location) + '</div>'
        : '';

      row.innerHTML =
        '<div style="display:flex;align-items:flex-start;gap:8px;">' +
          '<span style="font-size:15px;line-height:1.2;">📅</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:700;color:#0f172a;word-break:break-word;">' + escHtml(d.ev.title || '(no title)') + '</div>' +
            '<div style="font-size:11.5px;color:#6b7280;margin-top:1px;">' + escHtml(fmtClock(d.ev.startMs)) + '</div>' +
            loc +
            '<div style="font-weight:700;color:' + relColor + ';margin-top:4px;">' +
              (inProgress ? 'In progress' : rel) +
            '</div>' +
            meetBtn +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">' +
          '<button data-act="snooze" style="padding:5px 10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;">Snooze</button>' +
          '<button data-act="dismiss" style="padding:5px 10px;background:#1d4ed8;color:#fff;border:none;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;">Dismiss</button>' +
        '</div>';
      row.querySelector('[data-act="snooze"]').addEventListener('click', function () {
        snoozeOne(d.key, snoozeChoiceMin);
      });
      row.querySelector('[data-act="dismiss"]').addEventListener('click', function () {
        dismissOne(d.key, d.ev.startMs);
      });
      list.appendChild(row);
    });
    panel.appendChild(list);

    // Footer: snooze duration + Snooze All / Dismiss All
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;background:#f8fafc;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    const snzLabel = document.createElement('span');
    snzLabel.textContent = 'Snooze for:';
    snzLabel.style.cssText = 'font-size:11.5px;color:#6b7280;';
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font:12px Arial,sans-serif;';
    SNOOZE_OPTIONS.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = String(o.min);
      opt.textContent = o.label;
      if (o.min === snoozeChoiceMin) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      snoozeChoiceMin = parseInt(select.value, 10) || 5;
    });
    const snoozeAllBtn = document.createElement('button');
    snoozeAllBtn.textContent = 'Snooze all';
    snoozeAllBtn.style.cssText = 'margin-left:auto;padding:6px 10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;';
    snoozeAllBtn.addEventListener('click', function () { snoozeAll(due, snoozeChoiceMin); });
    const dismissAllBtn = document.createElement('button');
    dismissAllBtn.textContent = 'Dismiss all';
    dismissAllBtn.style.cssText = 'padding:6px 10px;background:#0f172a;color:#fff;border:none;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;';
    dismissAllBtn.addEventListener('click', function () { dismissAll(due); });
    footer.appendChild(snzLabel);
    footer.appendChild(select);
    footer.appendChild(snoozeAllBtn);
    footer.appendChild(dismissAllBtn);
    panel.appendChild(footer);

    const tip = document.createElement('div');
    tip.style.cssText = 'padding:6px 14px;background:#f8fafc;font-size:10px;color:#94a3b8;border-top:1px solid #eef0f2;';
    tip.textContent = ZHL_TIP;
    panel.appendChild(tip);

    document.body.appendChild(panel);
  }

  // -------- ask background to refresh the calendar feed ----------
  function requestRefresh() {
    try {
      chrome.runtime.sendMessage({ type: 'ZHL_CAL_REFRESH_NOW' }, function () {
        // touch lastError so Chrome doesn't warn if SW was asleep
        const _ = chrome.runtime && chrome.runtime.lastError;
      });
    } catch (_) {}
  }

  // -------- boot -------------------------------------------------
  // Warn (once) in the console if no ICS URL is configured yet — the
  // feature is on but will never show anything until the LO pastes
  // their private calendar address in Setup.
  getStorage([URL_KEY]).then(function (d) {
    if (!d[URL_KEY]) {
      console.log('[ZHL Calendar Reminders] no calendar ICS URL set — paste your Google Calendar "Secret address in iCal format" in the extension Setup page to enable meeting reminders.');
    }
  });

  requestRefresh();
  render();
  setInterval(function () { try { render(); } catch (_) {} }, TICK_MS);
  // Re-poll the feed every 4 minutes from the Gmail side too, as a
  // backstop in case the background alarm was throttled while the SW
  // slept. The background dedups by only re-fetching when stale.
  setInterval(requestRefresh, 4 * 60 * 1000);

  // React immediately when the background updates events, or when the
  // LO dismisses/snoozes in another Gmail tab.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes[EVENTS_KEY] || changes[DISMISS_KEY] || changes[SNOOZE_KEY] ||
          changes[LEADS_KEY]) {
        try { render(); } catch (_) {}
      }
    });
  } catch (_) {}

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
