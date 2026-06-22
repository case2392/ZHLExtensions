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

  // Guard against double-injection. The manifest content_script injects
  // this on page load, but the background ALSO injects it into already-
  // open Calendar tabs on startup (so a tab opened before the extension
  // reloaded still gets scraped). Without this guard, both copies would
  // run with different tab tags and write duplicate events.
  if (window.__zhlCalScraperLoaded) {
    console.log('[ZHL Calendar Scraper] already loaded in this tab — skipping duplicate injection');
    return;
  }
  window.__zhlCalScraperLoaded = true;

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
  //
  // Google Calendar event chips carry an aria-label that bundles the
  // time, title, and (usually) date together. The exact wording varies
  // by view and locale, so this parser is deliberately permissive:
  //   - DATE is required (we will not guess a day — guessing risks
  //     firing reminders for the wrong day). Matches "Wednesday,
  //     July 15", "Jul 15", "July 15, 2026", "on July 15", etc.
  //   - TIME accepts either a range ("10:15 – 11:15am", "1 to 2pm")
  //     OR a single start time ("10:15am") in which case we assume a
  //     30-minute duration.
  function to24h(h, ampm, fallbackAmPm) {
    const tag = (ampm || fallbackAmPm || '').toLowerCase();
    let H = h;
    if (tag) {
      const isPM = tag === 'pm';
      if (isPM && H < 12) H += 12;
      if (!isPM && H === 12) H = 0;
    }
    return H;
  }

  function parseAria(aria) {
    if (!aria) return null;
    if (/all[- ]day/i.test(aria)) return null;

    // ---- Date (required) ----
    const dRe = /(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i;
    const dm = aria.match(dRe);
    if (!dm) return null;
    const month = MONTH_IDX[dm[1].toLowerCase()];
    if (month == null) return null;
    const day = +dm[2];
    let year = dm[3] ? +dm[3] : new Date().getFullYear();
    let candidate = new Date(year, month, day);
    const now = Date.now();
    if (candidate.getTime() < now - 14 * 86400000) candidate = new Date(year + 1, month, day);
    year = candidate.getFullYear();

    // ---- Time: try a range first, then a single start time ----
    let startH, startM, endH, endM, matchedTime;
    const tr = aria.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|–|—|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (tr) {
      const sTag = tr[3] || tr[6] || '';
      const eTag = tr[6] || '';
      startH = to24h(+tr[1], sTag, eTag);
      startM = +(tr[2] || 0);
      endH   = to24h(+tr[4], eTag, sTag);
      endM   = +(tr[5] || 0);
      matchedTime = tr[0];
    } else {
      const ts = aria.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
      if (!ts) return null;
      startH = to24h(+ts[1], ts[3], ts[3]);
      startM = +(ts[2] || 0);
      endH = null; endM = null;
      matchedTime = ts[0];
    }

    const startMs = new Date(year, month, day, startH, startM).getTime();
    let endMs = (endH == null)
      ? startMs + 30 * 60000
      : new Date(year, month, day, endH, endM).getTime();
    if (endMs <= startMs) endMs += 86400000; // cross-midnight

    // ---- Title: aria minus the matched time + date fragments ----
    let title = aria.replace(matchedTime, ' ').replace(dm[0], ' ');
    title = title.replace(/,\s*(busy|free|tentative)\b.*$/i, '');
    title = title.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').trim();
    if (!title) title = '(no title)';

    return { startMs: startMs, endMs: endMs, title: title };
  }

  // ---- Scrape pass ------------------------------------------------
  // Returns events de-duplicated by (uid OR title+startMs).
  // Set window.__zhlCalDebug = true in the Calendar tab's console to see
  // every candidate chip's aria-label, which makes it easy to share a
  // sample if the parser ever needs tuning for a new Calendar layout.
  function scrapeOnce() {
    const seen = new Set();
    const out = [];

    // Selectors are intentionally broad. Google Calendar event chips
    // typically have role=button + a data-eventid (week/day view) or
    // role=gridcell with an aria-label (month view). We also fall back
    // to ANY element carrying both data-eventid and an aria-label, plus
    // anything with a data-eventchip attribute, to survive markup drift.
    const chips = document.querySelectorAll(
      '[data-eventid][aria-label], [data-eventchip][aria-label], ' +
      '[role="button"][aria-label][jslog*="event"], ' +
      '[role="gridcell"][aria-label]'
    );

    const samples = [];
    let considered = 0;

    chips.forEach(function (el) {
      const aria = el.getAttribute('aria-label');
      if (!aria) return;
      // Must contain at least one clock time, otherwise it's an empty
      // month-view grid cell ("Tuesday, July 15") — skip fast.
      if (!/\d\s*(am|pm)/i.test(aria) && !/\d:\d{2}/.test(aria)) return;
      considered++;
      if (samples.length < 6) samples.push(aria);

      const parsed = parseAria(aria);
      if (!parsed) return;

      const eid = el.getAttribute('data-eventid') || '';
      const key = eid || (parsed.title.toLowerCase() + '|' + parsed.startMs);
      if (seen.has(key)) return;
      seen.add(key);

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

    // Always log a one-line summary; dump samples when nothing parsed
    // (or when debug is on) so the actual aria-label format is visible.
    if (out.length === 0 || window.__zhlCalDebug) {
      console.log('[ZHL Calendar Scraper] chips matched=' + chips.length +
        ', with-time=' + considered + ', parsed=' + out.length +
        (samples.length ? '\n  sample aria-labels:\n   • ' + samples.join('\n   • ') : ''));
    }

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
