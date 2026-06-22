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

  // ---- Chip parsing ----------------------------------------------
  // Returns { startMs, endMs, title, allDay } or null.
  //
  // Key fix (v1.64.5): in WEEK/DAY view a Google Calendar event chip's
  // aria-label usually carries only the time + title — NOT the date
  // (the date lives in the day-column header). The previous parser
  // required a date in the aria-label, so every week-view event was
  // rejected and nothing got scraped. We now resolve the date from the
  // chip's nearest `data-datekey` ancestor (Google encodes the column
  // date there) and only fall back to text parsing when there's no
  // datekey. We search BOTH the aria-label and the chip's visible text
  // for the time, since the time sometimes only shows in the text.
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

  // Google Calendar's data-datekey integer encodes the date as
  // (year << 9) | (month << 5) | day, month 1-indexed. Some builds use
  // (year-1970) instead of the full year, so we add 1970 back if the
  // decoded year looks too small, and validate plausibility.
  function decodeDateKey(dk) {
    dk = parseInt(dk, 10);
    if (!isFinite(dk) || dk <= 0) return null;
    const day = dk & 31;
    const month = (dk >> 5) & 15;     // 1-indexed
    let year = dk >> 9;
    if (year < 1970) year += 1970;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
    return { year: year, month: month - 1, day: day }; // month 0-indexed for Date()
  }

  function findDateKeyDate(el) {
    let cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      if (cur.getAttribute) {
        const dk = cur.getAttribute('data-datekey');
        if (dk) { const d = decodeDateKey(dk); if (d) return d; }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Month-name date from free text. Returns {year,month(0-idx),day,matched} or null.
  function parseDateFromText(text) {
    const dRe = /(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i;
    const dm = text.match(dRe);
    if (!dm) return null;
    const month = MONTH_IDX[dm[1].toLowerCase()];
    if (month == null) return null;
    const day = +dm[2];
    let year = dm[3] ? +dm[3] : new Date().getFullYear();
    let cand = new Date(year, month, day);
    if (cand.getTime() < Date.now() - 14 * 86400000) cand = new Date(year + 1, month, day);
    return { year: cand.getFullYear(), month: month, day: day, matched: dm[0] };
  }

  // Agenda / Schedule view fallback: events there are grouped under a
  // day-header row ("Mon, Jun 22" / "Tuesday, June 23") with no
  // data-datekey on the chip. Walk backward through previous siblings
  // (and up the tree) to the nearest element whose text parses as a
  // date header. Bounded so it can't run away on a huge DOM.
  function findAgendaHeaderDate(el) {
    let node = el;
    for (let hops = 0; hops < 60 && node; hops++) {
      let sib = node.previousElementSibling;
      let scanned = 0;
      while (sib && scanned < 40) {
        // Use the element's OWN short text (headers are short); skip
        // big containers so we don't accidentally read an event's text.
        const txt = (sib.textContent || '').trim();
        if (txt && txt.length <= 40) {
          const d = parseDateFromText(txt);
          if (d) return d;
        }
        sib = sib.previousElementSibling;
        scanned++;
      }
      node = node.parentElement;
    }
    return null;
  }

  // Time range or single start time from free text.
  function parseTimeFromText(text) {
    const tr = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|–|—|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (tr) {
      const sTag = tr[3] || tr[6] || '';
      const eTag = tr[6] || '';
      return { startH: to24h(+tr[1], sTag, eTag), startM: +(tr[2] || 0),
               endH: to24h(+tr[4], eTag, sTag), endM: +(tr[5] || 0), matched: tr[0] };
    }
    const ts = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (ts) {
      return { startH: to24h(+ts[1], ts[3], ts[3]), startM: +(ts[2] || 0),
               endH: null, endM: null, matched: ts[0] };
    }
    return null;
  }

  // Conferencing link: Google Meet OR Zoom (incl. corporate subdomains
  // and zoomgov). Searched in the chip's text + aria + any <a href>.
  const LINK_RE = /https?:\/\/(?:meet\.google\.com\/[a-z0-9\-]+|[a-z0-9.\-]*zoom\.us\/[^\s"'<>]+|[a-z0-9.\-]*zoomgov\.com\/[^\s"'<>]+)/i;
  function findJoinLink(el, hay) {
    const m = hay.match(LINK_RE);
    if (m) return m[0];
    const a = el.querySelector && el.querySelector('a[href*="zoom.us"], a[href*="meet.google.com"], a[href*="zoomgov.com"]');
    if (a) return a.getAttribute('href') || '';
    return '';
  }

  // Google Calendar week/day-view aria-labels are comma-segmented:
  //   "<title>, <organizer>, <RSVP status>, <location|No location>,
  //    <title again>, <time>"
  // The old title logic just stripped the time/date and kept everything
  // else, producing word-salad like "Melynda Florea and 15-minute
  // meeting, Justin Case, Accepted, No location, Melynda Florea and
  // 15-minute meeting, 3:45pm". Instead, pick the FIRST comma-segment
  // that isn't a time, a date, an RSVP status, or a location marker —
  // that's the event title.
  const STATUS_SEG_RE = /^(accepted|declined|maybe|tentative|going|not going|no response|needs action|awaiting reply|busy|free|no location|location|organizer|guests?)\b/i;
  function isTimeSeg(s) {
    return /^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:(?:to|–|—|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\s*$/i.test(s) &&
           /\d/.test(s);
  }
  function isDateSeg(s) {
    return /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i.test(s) ||
           /^(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.test(s.trim());
  }
  function extractTitle(base, timeMatched) {
    const segs = String(base || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    let chosen = '';
    for (const s of segs) {
      if (isTimeSeg(s) || isDateSeg(s) || STATUS_SEG_RE.test(s)) continue;
      chosen = s;
      break;
    }
    if (!chosen) chosen = segs[0] || String(base || '');
    // Clean any embedded time/link/all-day fragments out of the chosen
    // segment. The time regex requires a colon or am/pm so it never eats
    // a bare number like the "15" in "15-minute meeting".
    let t = chosen;
    if (timeMatched) t = t.split(timeMatched).join(' ');
    t = t.replace(LINK_RE, ' ').replace(/\ball[- ]day\b/i, ' ');
    t = t.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*(?:to|–|—|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\b\d{1,2}\s*(?:am|pm)\b/gi, ' ');
    t = t.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—•]+|[\s,;:.\-–—•]+$/g, '').trim();
    return t || '(no title)';
  }

  function parseChip(el) {
    const aria = el.getAttribute('aria-label') || '';
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const hay = aria + ' • ' + text;
    const isAllDay = /\ball[- ]day\b/i.test(hay);

    // ---- Date resolution, in priority order:
    //   1. a date inside the chip's own aria-label / text
    //   2. the data-datekey on a column ancestor (week/day view)
    //   3. the nearest agenda/schedule day-header date (Schedule view
    //      and the Gmail Calendar side panel)
    let dateInfo = parseDateFromText(aria) || parseDateFromText(text);
    const dateMatched = dateInfo ? dateInfo.matched : '';
    if (!dateInfo) {
      const dk = findDateKeyDate(el);
      if (dk) dateInfo = { year: dk.year, month: dk.month, day: dk.day, matched: '' };
    }
    if (!dateInfo) {
      const hd = findAgendaHeaderDate(el);
      if (hd) dateInfo = hd;
    }
    if (!dateInfo) return null; // can't place it on a day — skip rather than guess

    // ---- Time ----
    const time = parseTimeFromText(hay);
    let startMs, endMs, allDay = false;
    if (time) {
      startMs = new Date(dateInfo.year, dateInfo.month, dateInfo.day, time.startH, time.startM).getTime();
      endMs = (time.endH == null)
        ? startMs + 30 * 60000
        : new Date(dateInfo.year, dateInfo.month, dateInfo.day, time.endH, time.endM).getTime();
      if (endMs <= startMs) endMs += 86400000; // cross-midnight
    } else if (isAllDay) {
      // All-day event: anchor the reminder at 8:00am local on its date.
      startMs = new Date(dateInfo.year, dateInfo.month, dateInfo.day, 8, 0).getTime();
      endMs = startMs + 30 * 60000;
      allDay = true;
    } else {
      return null; // no time and not all-day — not a usable event chip
    }

    // ---- Title ---- (prefer aria's segments; fall back to chip text)
    let title = extractTitle(aria, time && time.matched);
    if (title === '(no title)' && text) title = extractTitle(text, time && time.matched);

    return { startMs: startMs, endMs: endMs, title: title, allDay: allDay };
  }

  // ---- Scrape pass ------------------------------------------------
  // Returns events de-duplicated by (uid OR title+startMs).
  // Set window.__zhlCalDebug = true in the Calendar tab's console to see
  // every candidate chip's aria-label, which makes it easy to share a
  // sample if the parser ever needs tuning for a new Calendar layout.
  function scrapeOnce() {
    const seen = new Set();
    const out = [];

    // Broad selector — any element Google tags as an event chip. We read
    // the date from a data-datekey ancestor now, so we no longer require
    // an aria-label up front (some chips carry the info only in text).
    const chips = document.querySelectorAll(
      '[data-eventid], [data-eventchip], ' +
      '[role="button"][jslog*="event"], ' +
      '[role="gridcell"][aria-label]'
    );

    const samples = [];
    let considered = 0;

    chips.forEach(function (el) {
      const aria = el.getAttribute('aria-label') || '';
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const hay = aria + ' • ' + text;
      // Needs either a clock time or an all-day marker to be an event.
      if (!/\d\s*(am|pm)/i.test(hay) && !/\d:\d{2}/.test(hay) && !/\ball[- ]day\b/i.test(hay)) return;
      considered++;
      if (samples.length < 6) samples.push((aria || text).slice(0, 120));

      const parsed = parseChip(el);
      if (!parsed) return;

      const eid = el.getAttribute('data-eventid') || '';
      const key = eid || (parsed.title.toLowerCase() + '|' + parsed.startMs);
      if (seen.has(key)) return;
      seen.add(key);

      out.push({
        uid: eid || ('chip-' + parsed.startMs + '-' + parsed.title.slice(0, 24)),
        startMs: parsed.startMs,
        endMs: parsed.endMs,
        title: parsed.title,
        location: '',
        meet: findJoinLink(el, hay),
        allDay: !!parsed.allDay
      });
    });

    // Always log a one-line summary; dump samples when nothing parsed
    // (or when window.__zhlCalDebug is set) so the actual chip format is
    // visible for tuning.
    if (out.length === 0 || window.__zhlCalDebug) {
      console.log('[ZHL Calendar Scraper] chips matched=' + chips.length +
        ', candidates=' + considered + ', parsed=' + out.length +
        (samples.length ? '\n  samples:\n   • ' + samples.join('\n   • ') : ''));
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
    const filtered = merged.filter(function (e) { return isFinite(e.startMs) && (e.startMs + 60 * 60000) > now; });
    // Dedup by uid|startMs so the SAME event seen in two frames (e.g.
    // a full Calendar tab AND the Gmail side-panel iframe, both running
    // the scraper via all_frames) doesn't produce duplicate reminders.
    const live = [];
    const seenKeys = {};
    filtered.forEach(function (e) {
      const k = (e.uid || '') + '|' + e.startMs;
      if (seenKeys[k]) return;
      seenKeys[k] = true;
      live.push(e);
    });
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
