// ZHL Productivity Pack module — feature key: feature_calendarReminders
//
// Calendar tab event scraper. Runs on calendar.google.com pages and
// extracts upcoming events from the rendered Calendar UI, writing them
// to chrome.storage.local under zhlCalEvents. The Gmail content script
// (gmail-calendar-reminders.js) reads that storage key and pops the
// Outlook-style reminder cards before each meeting.
//
// Why DOM-scrape instead of polling an ICS URL? Zillow's Workspace
// admin has disabled the per-user "Secret address in iCal format"
// option (common security policy on corporate Google accounts), and
// the only available iCal URL is the Public one — which would require
// making the LO's calendar fully public, exposing borrower info. So
// the only practical zero-OAuth, zero-public-exposure path is reading
// events off a Calendar tab the LO already has open.
//
// Caveat the LO is warned about in Setup: this only works WHILE a
// calendar.google.com tab is open in this browser. Close every
// Calendar tab and reminders stop until one is reopened.
//
// Parse strategy: each event chip in week/day/day-3 view has an
// aria-label of the form "<start> to <end>am/pm, <title>, [<location>,]
// <weekday>, <month> <day>". We extract the time range + date via
// regex and treat the remainder as the title. This is intentionally
// permissive so localized variants ("dim", "lun" etc. for non-English)
// still produce SOME usable data — though English aria-labels are the
// happy path. Recurring events are scraped per-occurrence by Calendar
// itself (each instance renders its own chip), so we don't need to
// expand RRULEs here.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_calendarReminders';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Calendar Scraper v' + VERSION + '] loaded on', location.href);

  const EVENTS_KEY = 'zhlCalEvents';
  const META_KEY   = 'zhlCalMeta';
  const RESCAN_MS  = 8000;          // periodic backstop
  const DEBOUNCE_MS = 800;          // MutationObserver debounce

  const MONTH_IDX = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

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

  // ---- Aria-label parsing ----------------------------------------
  // Returns { startMs, endMs, title } or null.
  function parseAria(aria) {
    if (!aria) return null;
    // Strip "All day" / "All-day" markers — we skip all-day events
    // (they have no useful "X minutes before" reminder time).
    if (/all[- ]day/i.test(aria)) return null;

    // Time range. Each end may carry its own am/pm; the start may
    // omit am/pm and borrow from the end ("9 to 10am").
    const tm = aria.match(
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|–|—|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
    );
    if (!tm) return null;
    const sH = +tm[1], sM = +(tm[2] || 0);
    const sAmPm = (tm[3] || tm[6] || '').toLowerCase();
    const eH = +tm[4], eM = +(tm[5] || 0);
    const eAmPm = (tm[6] || '').toLowerCase();

    // Date: "Wednesday, July 15" / "Wed, Jul 15" / "Jul 15, 2026".
    // Capture both the weekday-led and the month-led variants.
    const dRe = /(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i;
    const dm = aria.match(dRe);
    if (!dm) return null;
    const month = MONTH_IDX[dm[1].toLowerCase()];
    if (month == null) return null;
    const day = +dm[2];
    let year = dm[3] ? +dm[3] : new Date().getFullYear();
    // Roll forward if the parsed date is far in the past — Calendar
    // doesn't include the year for current-year events, so a January
    // event read in December needs to be year+1, not the current
    // year (which is now in the past).
    let candidate = new Date(year, month, day);
    const now = Date.now();
    if (candidate.getTime() < now - 14 * 86400000) {
      candidate = new Date(year + 1, month, day);
    }
    year = candidate.getFullYear();

    function to24h(h, ampm, fallbackAmPm) {
      const tag = ampm || fallbackAmPm || '';
      let H = h;
      if (tag) {
        const isPM = tag === 'pm';
        if (isPM && H < 12) H += 12;
        if (!isPM && H === 12) H = 0;
      }
      return H;
    }
    const startH = to24h(sH, sAmPm, eAmPm);
    const endH   = to24h(eH, eAmPm, sAmPm);
    const startMs = new Date(year, month, day, startH, sM).getTime();
    let endMs     = new Date(year, month, day, endH,   eM).getTime();
    // Cross-midnight events: end wraps to next day.
    if (endMs <= startMs) endMs += 86400000;

    // Title: aria minus time + date strings. Trim leading/trailing
    // punctuation/commas the locale leaves behind.
    let title = aria.replace(tm[0], ' ').replace(dm[0], ' ');
    // Common trailing fragments like ", Calendar of Justin" / ", busy" —
    // drop short tail fragments after the last comma if they look
    // status-y. Conservative: only strip the well-known ones.
    title = title.replace(/,\s*(busy|free|tentative)\b.*$/i, '');
    title = title.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').trim();
    if (!title) title = '(no title)';

    return { startMs: startMs, endMs: endMs, title: title };
  }

  // ---- Scrape pass ------------------------------------------------
  // Returns events de-duplicated by (uid OR title+startMs).
  function scrapeOnce() {
    const seen = new Set();
    const out = [];

    // Selectors are intentionally broad. Google Calendar event chips
    // typically have role=button + a data-eventid (week/day view) or
    // role=gridcell with an aria-label that contains the same shape
    // (month view). Both are accepted.
    const chips = document.querySelectorAll(
      '[role="button"][data-eventid], [role="button"][data-eventchip], ' +
      '[role="button"][jsaction*="eventchip"], [role="button"][jslog*="eventchip"], ' +
      '[role="gridcell"][aria-label]'
    );

    chips.forEach(function (el) {
      const aria = el.getAttribute('aria-label');
      if (!aria) return;
      // Skip the empty grid cells of the month view (their aria-label
      // is "Tuesday, July 15" with no time component) — parseAria
      // already returns null when there's no time range, so this is
      // just a fast-path.
      if (!/(am|pm)\s*(?:to|–|—|-)/i.test(aria) && !/\d:\d{2}\s*(?:to|–|—|-)/.test(aria)) return;

      const parsed = parseAria(aria);
      if (!parsed) return;

      const eid = el.getAttribute('data-eventid') || '';
      const key = eid || (parsed.title.toLowerCase() + '|' + parsed.startMs);
      if (seen.has(key)) return;
      seen.add(key);

      // Cheap location + Meet-link detection: look inside the chip's
      // own text for a recognizable Meet URL or a "Location:" line.
      // Most week-view chips don't expose this; the LO can still see
      // the event title and time, which is the critical part.
      const txt = (el.textContent || '').replace(/\s+/g, ' ');
      const meetM = txt.match(/https?:\/\/meet\.google\.com\/[a-z0-9\-]+/i);

      out.push({
        uid: eid || ('aria-' + parsed.startMs + '-' + parsed.title.slice(0, 24)),
        startMs: parsed.startMs,
        endMs: parsed.endMs,
        title: parsed.title,
        location: '',
        meet: meetM ? meetM[0] : ''
      });
    });

    out.sort(function (a, b) { return a.startMs - b.startMs; });
    return out;
  }

  // Merge scraped events into the existing zhlCalEvents store. We
  // KEEP events from other open Calendar tabs (different account /
  // different view) and only overwrite OUR tab's contributions.
  // Strategy: events touched in this scrape are tagged with this
  // tab's transient id; the merge drops any existing entry that
  // shares the same tagged-tab AND isn't in the new list.
  let tabTag = 'tab-' + Math.random().toString(36).slice(2, 10);
  let scanTimer = null;

  async function scrapeAndStore() {
    const fresh = scrapeOnce();
    fresh.forEach(function (e) { e._tab = tabTag; });

    const data = await getStorage([EVENTS_KEY]);
    const prev = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    // Keep events from OTHER tabs as-is; replace ours wholesale.
    const otherTabs = prev.filter(function (e) { return e && e._tab && e._tab !== tabTag; });
    const merged = otherTabs.concat(fresh);

    // Drop anything more than 1h past its start time — saves the
    // Gmail-side renderer from filtering stale events.
    const now = Date.now();
    const live = merged.filter(function (e) { return isFinite(e.startMs) && (e.startMs + 60 * 60000) > now; });
    live.sort(function (a, b) { return a.startMs - b.startMs; });

    await setStorage({
      [EVENTS_KEY]: live.slice(0, 200),
      [META_KEY]: { lastScrapeMs: Date.now(), count: fresh.length, source: 'tab-scrape' }
    });
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      try { scrapeAndStore(); } catch (e) { console.warn('[ZHL Calendar Scraper] scrape failed', e); }
    }, DEBOUNCE_MS);
  }

  // First-pass slight delay so Calendar finishes its initial render.
  setTimeout(function () { try { scrapeAndStore(); } catch (_) {} }, 1500);

  const obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Periodic backstop — Calendar's React app sometimes mutates inside
  // a single chip without firing observable subtree changes; this
  // catches drift.
  setInterval(schedule, RESCAN_MS);

  // When the tab is about to unload, mark our slot empty so stale
  // events don't linger after the LO closes the Calendar tab.
  window.addEventListener('beforeunload', function () {
    try {
      chrome.storage.local.get([EVENTS_KEY], function (data) {
        const prev = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
        const cleaned = prev.filter(function (e) { return e && e._tab !== tabTag; });
        chrome.storage.local.set({ [EVENTS_KEY]: cleaned });
      });
    } catch (_) {}
  });

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
