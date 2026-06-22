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

  // Snooze options are RELATIVE TO THE EVENT (offset in minutes from the
  // meeting's start; negative = before, 0 = at start, positive = after).
  // Snoozing hides the reminder until start + offset, then it pops again.
  const SNOOZE_OPTIONS = [
    { label: '15 min before event', off: -15 },
    { label: '5 min before event',  off: -5 },
    { label: '1 min before event',  off: -1 },
    { label: 'At start time',       off: 0 },
    { label: '1 min after event',   off: 1 },
    { label: '5 min after event',   off: 5 },
    { label: '15 min after event',  off: 15 }
  ];
  let snoozeChoiceOff = -5; // default: remind again 5 min before the event

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

  // Final-guard dedup, mirroring the scraper's eventKey: collapse the
  // same meeting (same start + same title prefix) so a messy store can
  // never surface the same reminder twice. Keeps the cleaner title.
  function dedupEvents(events) {
    const byKey = {};
    events.forEach(function (e) {
      if (!e || !isFinite(e.startMs)) return;
      const t = String(e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
      const k = e.startMs + '|' + t;
      const cur = byKey[k];
      if (!cur || String(e.title || '').length < String(cur.title || '').length) byKey[k] = e;
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; });
  }

  // -------- core: which reminders are due ------------------------
  async function computeDue() {
    const data = await getStorage([EVENTS_KEY, DISMISS_KEY, SNOOZE_KEY, LEADS_KEY]);
    const events = dedupEvents(Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : []);
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
      // Snooze is keyed to the event OCCURRENCE (uid|startMs), not the
      // per-lead instance — so "remind me 5 min before the event"
      // suppresses every lead's reminder until that moment, then pops.
      const occ = ev.uid + '|' + ev.startMs;
      if (snooze[occ] && snooze[occ] > now) continue;
      due.push({ ev: ev, lead: activeLead, key: key, occKey: occ });
    }
    due.sort(function (a, b) { return a.ev.startMs - b.ev.startMs; });
    return due;
  }

  // -------- dismiss / snooze actions -----------------------------
  // An instance key is "uid|startMs|lead" — the uid is everything before
  // the final two segments.
  function uidFromKey(key) {
    const parts = String(key).split('|');
    return parts.slice(0, parts.length - 2).join('|');
  }
  // Synthetic preview events (uid starts with "zhl-test", created by the
  // "Show test reminder" button in Setup) are removed from the event
  // store on dismiss so they don't linger for the hour-long expiry. We
  // remove ONLY the specific dismissed event(s) — not every test event —
  // so dismissing one of the three previews leaves the other two showing.
  async function removeTestEventsByUid(uids) {
    if (!uids || !uids.length) return;
    const set = {};
    uids.forEach(function (u) { set[u] = true; });
    const d = await getStorage([EVENTS_KEY]);
    const evs = Array.isArray(d[EVENTS_KEY]) ? d[EVENTS_KEY] : [];
    const kept = evs.filter(function (e) { return !(e && set[e.uid]); });
    if (kept.length !== evs.length) await setStorage({ [EVENTS_KEY]: kept });
  }
  async function dismissOne(key, startMs) {
    const data = await getStorage([DISMISS_KEY]);
    const dismissed = data[DISMISS_KEY] || {};
    dismissed[key] = startMs;
    pruneMap(dismissed);
    await setStorage({ [DISMISS_KEY]: dismissed });
    if (key.indexOf('zhl-test') === 0) await removeTestEventsByUid([uidFromKey(key)]);
    render();
  }
  async function dismissAll(dueList) {
    const data = await getStorage([DISMISS_KEY]);
    const dismissed = data[DISMISS_KEY] || {};
    const testUids = [];
    dueList.forEach(function (d) {
      dismissed[d.key] = d.ev.startMs;
      if (d.key.indexOf('zhl-test') === 0) testUids.push(uidFromKey(d.key));
    });
    pruneMap(dismissed);
    await setStorage({ [DISMISS_KEY]: dismissed });
    if (testUids.length) await removeTestEventsByUid(testUids);
    render();
  }
  // Snooze until the event's start time plus `offsetMin` (negative =
  // before start). Keyed by the occurrence (occKey = uid|startMs) so it
  // suppresses all of that event's lead-time reminders until then.
  // If the chosen relative time has already passed (e.g. "5 min before"
  // picked when it's already 2 min before), floor the snooze to 1 minute
  // from now so the reminder at least goes away briefly instead of
  // re-appearing on the very next tick.
  function snoozeTarget(startMs, offsetMin) {
    const t = startMs + offsetMin * 60000;
    return Math.max(t, Date.now() + 60000);
  }
  async function snoozeOne(occKey, startMs, offsetMin) {
    const data = await getStorage([SNOOZE_KEY]);
    const snooze = data[SNOOZE_KEY] || {};
    snooze[occKey] = snoozeTarget(startMs, offsetMin);
    pruneMap(snooze);
    await setStorage({ [SNOOZE_KEY]: snooze });
    render();
  }
  async function snoozeAll(dueList, offsetMin) {
    const data = await getStorage([SNOOZE_KEY]);
    const snooze = data[SNOOZE_KEY] || {};
    dueList.forEach(function (d) { snooze[d.occKey] = snoozeTarget(d.ev.startMs, offsetMin); });
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
  // Set of due keys at the moment the LO clicked the X close button.
  // While this is non-null, render() suppresses the panel as long as
  // the current due set is a SUBSET of these keys. Any new key (a
  // freshly-due reminder, a snoozed one waking up, etc.) clears the
  // suppression so the panel reappears. In-memory only — matches the
  // Outlook close-X semantics (close for now, reappears on next fire).
  let closedKeysSnapshot = null;

  // Keys we've already brought Gmail to the front for. We only request
  // window focus when a NEW reminder key appears (not on every 15s
  // re-render), so we don't repeatedly yank the LO's focus while a
  // reminder is just sitting there. A key that leaves the due list and
  // later returns (e.g. after snooze) counts as new again.
  let focusedKeys = new Set();
  function requestWindowFocus() {
    try {
      chrome.runtime.sendMessage({ type: 'ZHL_CAL_FOCUS_TAB' }, function () {
        const _ = chrome.runtime && chrome.runtime.lastError; // swallow if SW asleep
      });
    } catch (_) {}
  }

  // Drag state for the panel header. Listeners installed once at
  // module init below so they don't accumulate across renders.
  let drag = null;
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    let nl = drag.panelLeft + dx;
    let nt = drag.panelTop + dy;
    // Clamp inside the viewport so a panel can't get lost off-screen.
    const w = drag.panel.offsetWidth || 380;
    const h = drag.panel.offsetHeight || 200;
    nl = Math.max(8, Math.min(nl, window.innerWidth - w - 8));
    nt = Math.max(8, Math.min(nt, window.innerHeight - h - 8));
    drag.panel.style.left = nl + 'px';
    drag.panel.style.top = nt + 'px';
    drag.lastLeft = nl;
    drag.lastTop = nt;
  });
  document.addEventListener('mouseup', function () {
    if (!drag) return;
    const d = drag;
    drag = null;
    // Persist position so the panel reopens where the LO left it.
    try {
      setStorage({ zhlCalPanelPos: { left: d.lastLeft, top: d.lastTop } });
    } catch (_) {}
  });

  async function render() {
    const due = await computeDue();
    if (!due.length) {
      const ex = document.getElementById(PANEL_ID);
      if (ex) ex.remove();
      lastSignature = '';
      closedKeysSnapshot = null; // nothing due — clear any prior X-suppression
      focusedKeys = new Set();   // reset focus tracking so a re-fire focuses again
      return;
    }
    // X-close suppression: if every due key was already present when
    // the LO clicked X, keep the panel hidden. A single new key breaks
    // the snapshot and the panel re-appears.
    if (closedKeysSnapshot) {
      const allSeen = due.every(function (d) { return closedKeysSnapshot.has(d.key); });
      if (allSeen) {
        const ex = document.getElementById(PANEL_ID);
        if (ex) ex.remove();
        return;
      }
      closedKeysSnapshot = null;
    }

    // Bring Gmail to the front when a NEW reminder appears (a due key we
    // haven't already surfaced). Only on new keys, so we don't yank
    // focus on every 15s re-render while a reminder just sits there.
    const dueKeys = due.map(function (d) { return d.key; });
    const hasNew = dueKeys.some(function (k) { return !focusedKeys.has(k); });
    focusedKeys = new Set(dueKeys);
    if (hasNew) requestWindowFocus();
    // Cheap signature so we don't rebuild the DOM every 15s tick when
    // nothing meaningful changed (which would reset the snooze dropdown
    // and any hover state). Recompute when the set of due items OR their
    // minute-label changes.
    const now = Date.now();
    const sig = due.map(function (d) {
      return d.key + '@' + Math.round((d.ev.startMs - now) / 60000);
    }).join(';') + '#snz=' + snoozeChoiceOff;
    if (sig === lastSignature && document.getElementById(PANEL_ID)) return;
    lastSignature = sig;

    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'z-index:2147483647',
      'width:380px', 'max-width:92vw',
      'background:#ffffff', 'border:1px solid #c7ccd1', 'border-radius:10px',
      'box-shadow:0 16px 40px rgba(0,0,0,0.22)',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color:#1f2937', 'overflow:hidden'
    ].join(';');
    // Position: use the LO's last-dragged spot if one is saved,
    // otherwise center the panel in the viewport on first show.
    const posData = await getStorage(['zhlCalPanelPos']);
    const savedPos = posData && posData.zhlCalPanelPos;
    if (savedPos && isFinite(savedPos.left) && isFinite(savedPos.top)) {
      panel.style.left = savedPos.left + 'px';
      panel.style.top = savedPos.top + 'px';
    } else {
      // True centering via transform — switches to pixel coords on
      // first drag (see startPanelDrag).
      panel.style.left = '50%';
      panel.style.top = '50%';
      panel.style.transform = 'translate(-50%, -50%)';
    }

    // Header — draggable handle + close-X.
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;background:#1d4ed8;color:#fff;cursor:move;user-select:none;';
    header.innerHTML =
      '<span style="font-size:16px;">🔔</span>' +
      '<span style="font-weight:700;">' + due.length + ' Reminder' + (due.length === 1 ? '' : 's') + '</span>' +
      '<span style="margin-left:auto;font-size:11px;opacity:.85;margin-right:8px;">ZHL Meeting Reminders</span>' +
      '<button id="zhl-cal-close" title="Close (reappears on next reminder)" ' +
        'style="background:rgba(255,255,255,0.18);color:#fff;border:none;width:22px;height:22px;border-radius:4px;cursor:pointer;font:700 14px/1 Arial,sans-serif;display:inline-flex;align-items:center;justify-content:center;">&times;</button>';
    panel.appendChild(header);

    // Wire X close: snapshot the currently-due keys so we know what's
    // "already seen" — render() suppresses the panel until a NEW key
    // appears (i.e. a different reminder fires). Stop the click from
    // bubbling into the drag-start handler on the header.
    header.querySelector('#zhl-cal-close').addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    header.querySelector('#zhl-cal-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closedKeysSnapshot = new Set(due.map(function (d) { return d.key; }));
      try { panel.remove(); } catch (_) {}
      lastSignature = '';
    });

    // Wire drag on the header (anywhere except inside a button).
    header.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      // Switch from centered-transform to pixel coords so the move
      // math stays simple (no transform offset to subtract).
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.transform = 'none';
      drag = {
        panel: panel,
        startX: e.clientX, startY: e.clientY,
        panelLeft: rect.left, panelTop: rect.top,
        lastLeft: rect.left, lastTop: rect.top
      };
      e.preventDefault();
    });

    // Reminder rows
    const list = document.createElement('div');
    list.style.cssText = 'max-height:300px;overflow-y:auto;';
    due.forEach(function (d) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:12px 14px;border-bottom:1px solid #eef0f2;';
      const inProgress = now >= d.ev.startMs && now <= (d.ev.endMs || d.ev.startMs);
      // All-day events get an "ALL DAY" badge instead of a countdown.
      const rel = d.ev.allDay ? 'ALL DAY' : relLabel(d.ev.startMs, now);
      const relColor = d.ev.allDay
        ? '#7c3aed'
        : ((d.ev.startMs - now) <= 5 * 60000 ? '#b91c1c' : '#1d4ed8');

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
              (d.ev.allDay ? 'ALL DAY' : (inProgress ? 'In progress' : rel)) +
            '</div>' +
            meetBtn +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">' +
          '<button data-act="snooze" style="padding:5px 10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;">Snooze</button>' +
          '<button data-act="dismiss" style="padding:5px 10px;background:#1d4ed8;color:#fff;border:none;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;">Dismiss</button>' +
        '</div>';
      row.querySelector('[data-act="snooze"]').addEventListener('click', function () {
        snoozeOne(d.occKey, d.ev.startMs, snoozeChoiceOff);
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
    snzLabel.textContent = 'Snooze until:';
    snzLabel.style.cssText = 'font-size:11.5px;color:#6b7280;';
    const select = document.createElement('select');
    select.style.cssText = 'padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font:12px Arial,sans-serif;';
    SNOOZE_OPTIONS.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = String(o.off);
      opt.textContent = o.label;
      if (o.off === snoozeChoiceOff) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      snoozeChoiceOff = parseInt(select.value, 10);
      if (isNaN(snoozeChoiceOff)) snoozeChoiceOff = -5;
    });
    const snoozeAllBtn = document.createElement('button');
    snoozeAllBtn.textContent = 'Snooze all';
    snoozeAllBtn.style.cssText = 'margin-left:auto;padding:6px 10px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 11.5px Arial,sans-serif;cursor:pointer;';
    snoozeAllBtn.addEventListener('click', function () { snoozeAll(due, snoozeChoiceOff); });
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
