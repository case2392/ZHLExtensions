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

  // Dedup key that's robust to title variation. The SAME meeting can be
  // scraped from several DOM representations (week grid + agenda + the
  // side-panel iframe) and even from a stale store entry produced by an
  // older parser — sometimes a clean title, sometimes word-salad. We key
  // on the start time plus the first 16 alphanumerics of the title, so
  // "dxfghnfcvgbncvbn" and "dxfghnfcvgbncvbn, Justin Case, No location…"
  // collapse to the same key while two genuinely different meetings at
  // the same time stay distinct.
  function eventKey(e) {
    const t = String(e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
    return e.startMs + '|' + t;
  }
  // Prefer the cleaner title when collapsing duplicates (shorter usually
  // == the real title vs the comma-salad variant).
  function preferTitle(a, b) {
    return (String(b.title || '').length < String(a.title || '').length) ? b : a;
  }

  async function scrapeAndStore() {
    const now = Date.now();
    const fresh = scrapeOnce();
    fresh.forEach(function (e) { e._tab = tabTag; e._seenAt = now; });
    const freshKeys = {};
    fresh.forEach(function (e) { freshKeys[eventKey(e)] = true; });

    const data = await getStorage([EVENTS_KEY]);
    const prev = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    // Keep events contributed by OTHER frames/tabs, but only if they're
    // (a) still fresh — re-seen within the last 90s, so a closed tab's
    // events stop lingering — and (b) NOT a duplicate of something we
    // just scraped (drops the stale old-parser salad copy in favor of
    // the fresh clean one). Test-preview events (no _seenAt) are exempt
    // from the freshness check so the Setup test button still works.
    const otherTabs = prev.filter(function (e) {
      if (!e || !e._tab || e._tab === tabTag) return false;
      if (freshKeys[eventKey(e)]) return false;
      const isPreview = String(e.uid || '').indexOf('zhl-test') === 0;
      if (!isPreview && e._seenAt && (now - e._seenAt) > 90000) return false;
      return true;
    });

    const merged = otherTabs.concat(fresh)
      .filter(function (e) { return isFinite(e.startMs) && (e.startMs + 60 * 60000) > now; });

    // Final dedup by eventKey, keeping the cleaner-titled copy.
    const byKey = {};
    merged.forEach(function (e) {
      const k = eventKey(e);
      byKey[k] = byKey[k] ? preferTitle(byKey[k], e) : e;
    });
    const live = Object.keys(byKey).map(function (k) { return byKey[k]; });
    live.sort(function (a, b) { return a.startMs - b.startMs; });

    await setStorage({
      [EVENTS_KEY]: live.slice(0, 200),
      [META_KEY]: { lastScrapeMs: now, count: fresh.length, source: 'tab-scrape' }
    });
  }

  // Opportunistic conferencing-link harvest from whatever's visible on
  // the calendar surface. Week/agenda chips don't expose the Zoom/Meet
  // URL — it only lives inside the full event-details panel Google
  // opens when you click an event. Older Calendar layouts used a
  // role="dialog"/"region" container that was easy to find; the
  // current layout (June 2026+) is a plain <div> with no special role,
  // which is why the role-anchored harvester missed the Laila Working
  // Sessions popover even though the Zoom link was right there in the
  // DOM. The strategy is now anchor-anchored: find every visible
  // Zoom/Meet <a href>, walk up to the nearest heading (event title),
  // and stamp that mapping onto matching stored events.
  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  }
  function isElVisible(el) {
    if (!el) return false;
    try {
      if (el.offsetParent !== null) return true;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) { return false; }
  }
  // Find a likely event-title within a popover panel. Tries (in order):
  //   1. Real semantic headings — h1/h2/h3/h4 or role=heading / aria-level.
  //   2. The largest-font leaf text element near the top of the panel.
  // The fallback is what catches Google Calendar's current event-
  // details panel, where the title is just a styled <div> (no semantic
  // heading) — which is why "ZHL -Preferred Sales Huddle" was missed
  // even with the popover clearly visible and the Zoom link present.
  function findPanelTitle(panel) {
    if (!panel || !panel.querySelector) return '';
    // Path 1: semantic.
    const h = panel.querySelector('h1, h2, h3, h4, [role="heading"], [aria-level]');
    if (h) {
      const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length >= 2 && t.length <= 200) return t;
    }
    // Path 2: biggest-font leaf-ish text node near the top. We cap
    // iteration at 600 elements so a freakishly large popover doesn't
    // tank the page; titles always live near the top so we walk in
    // document order and stop once we have a strong candidate.
    let best = '';
    let bestSize = 0;
    let scanned = 0;
    const walker = panel.querySelectorAll('div, span, p, header');
    for (const el of walker) {
      if (++scanned > 600) break;
      // Skip elements that contain another candidate's text — we want
      // the leaf-most node, not a wrapper.
      let hasChildText = false;
      for (const c of el.children) {
        if ((c.textContent || '').trim().length >= 2) { hasChildText = true; break; }
      }
      if (hasChildText) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 2 || t.length > 200) continue;
      // Skip obvious non-titles by quick text fingerprint.
      if (/^https?:\/\//i.test(t)) continue;
      if (/^(passcode|id|join|going|maybe|guests?|edit|location|description|joining instructions|view meeting insights)\b/i.test(t)) continue;
      let size = 0;
      try { size = parseFloat(window.getComputedStyle(el).fontSize) || 0; } catch (_) {}
      // Titles are visibly larger than body text; 18px is a safe floor
      // for Google Calendar's popover title in the current layout.
      if (size < 18) continue;
      if (size > bestSize) {
        bestSize = size;
        best = t;
        // Once we have a 22px+ candidate near the top, we're confident.
        if (size >= 22) break;
      }
    }
    return best;
  }

  async function harvestDetailPopovers() {
    const matches = {}; // normTitle -> link
    // Path A (modern): scan visible Zoom/Meet anchors. For each one,
    // walk up the DOM looking for the popover container, then extract
    // the title via findPanelTitle (semantic heading first, largest-
    // font leaf text as fallback).
    const anchors = document.querySelectorAll(
      'a[href*="zoom.us"], a[href*="meet.google.com"], a[href*="zoomgov.com"]'
    );
    anchors.forEach(function (a) {
      const href = a.getAttribute('href') || '';
      if (!LINK_RE.test(href)) return;
      if (!isElVisible(a)) return;
      let node = a.parentElement;
      // Walk up until we find a panel-sized container OR a recognized
      // dialog/region role. Bounded so we don't bubble out to the
      // whole document.
      for (let depth = 0; depth < 18 && node; depth++) {
        const role = node.getAttribute && (node.getAttribute('role') || '');
        const isDialog = role === 'dialog' || role === 'region';
        let bigEnough = false;
        try {
          const r = node.getBoundingClientRect();
          bigEnough = r.width >= 320 && r.height >= 240;
        } catch (_) {}
        if (isDialog || bigEnough) {
          const title = findPanelTitle(node);
          if (title) {
            const k = normTitle(title);
            if (k && !matches[k]) matches[k] = href;
            return; // done with this anchor
          }
          // Panel found but no title resolved — keep walking up in
          // case the title is in a wider ancestor.
        }
        node = node.parentElement;
      }
    });
    // Path B (older / fallback): role=dialog/region popovers with a
    // heading + body text containing the link. Cheap to keep as a
    // backstop for Calendar layouts that DO use a real dialog.
    const popovers = document.querySelectorAll('[role="dialog"], [role="region"]');
    popovers.forEach(function (dlg) {
      if (!isElVisible(dlg)) return;
      let area = 0;
      try { const r = dlg.getBoundingClientRect(); area = r.width * r.height; } catch (_) {}
      if (area < 30000) return;
      const txt = (dlg.textContent || '').replace(/\s+/g, ' ');
      const link = (txt.match(LINK_RE) || [null])[0]
        || (function () {
          const a = dlg.querySelector('a[href*="zoom.us"], a[href*="meet.google.com"], a[href*="zoomgov.com"]');
          return a ? a.getAttribute('href') : null;
        })();
      if (!link) return;
      const title = findPanelTitle(dlg);
      if (!title) return;
      const k = normTitle(title);
      if (k && !matches[k]) matches[k] = link;
    });

    if (!Object.keys(matches).length) return;

    // Stamp harvested links onto stored events whose normalized title
    // matches. Multiple events can share a title (recurring meetings)
    // — attach the link to all of them. Don't overwrite an existing
    // link.
    const data = await getStorage([EVENTS_KEY]);
    const evs = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    let changed = false;
    for (const ev of evs) {
      if (ev.meet) continue;
      const nt = normTitle(ev.title);
      if (matches[nt]) { ev.meet = matches[nt]; changed = true; }
    }
    if (changed) await setStorage({ [EVENTS_KEY]: evs });
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      try { scrapeAndStore().then(function () {
        // After each scrape, try to attach any buffered fetch-hook
        // links to newly-stored events. Runs after scrapeAndStore so
        // the events store is fresh.
        try { attachBufferedLinks(); } catch (_) {}
        try { applyAuthoritativeEvents(); } catch (_) {}
      }); } catch (e) { console.warn('[ZHL Calendar Scraper] scrape failed', e); }
      try { harvestDetailPopovers(); } catch (e) { console.warn('[ZHL Calendar Scraper] popover harvest failed', e); }
    }, DEBOUNCE_MS);
  }

  // ---- Fetch-hook bridge (page-world → isolated-world) ------------
  // The MAIN-world calendar-fetch-hook.js intercepts Google's internal
  // calendar API responses and posts {link, titleHint} pairs to the
  // page via postMessage. titleHint is extracted from the closest
  // preceding "summary":"..." / "title":"..." field, so each link is
  // already attributed to one specific event title — no fuzzy
  // proximity matching, no false-positive attachments. We buffer them
  // here (TTL ~10 min) and stamp each link onto stored events whose
  // normalized title matches the hint. Matched entries are removed
  // from the buffer so we don't keep retrying forever.
  const linkBuffer = []; // [{link, titleHint, ts}]
  const LINK_BUFFER_TTL_MS = 10 * 60 * 1000;
  const LINK_BUFFER_MAX = 500;

  function pruneLinkBuffer() {
    const now = Date.now();
    let i = 0;
    while (i < linkBuffer.length) {
      if (now - linkBuffer[i].ts > LINK_BUFFER_TTL_MS) linkBuffer.splice(i, 1);
      else i++;
    }
    if (linkBuffer.length > LINK_BUFFER_MAX) linkBuffer.splice(0, linkBuffer.length - LINK_BUFFER_MAX);
  }

  async function attachBufferedLinks() {
    pruneLinkBuffer();
    if (!linkBuffer.length) return;
    const data = await getStorage([EVENTS_KEY]);
    const evs = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    if (!evs.length) return;
    // Index stored events by normalized title (multiple events may
    // share a title for recurring meetings — attach the link to all).
    const byTitle = {};
    for (const ev of evs) {
      if (!ev.meet) {
        const k = normTitle(ev.title);
        if (k) (byTitle[k] = byTitle[k] || []).push(ev);
      }
    }
    if (!Object.keys(byTitle).length) return;
    let changed = false;
    let i = 0;
    while (i < linkBuffer.length) {
      const entry = linkBuffer[i];
      const k = normTitle(entry.titleHint);
      const targets = k ? byTitle[k] : null;
      if (targets) {
        targets.forEach(function (ev) { if (!ev.meet) { ev.meet = entry.link; changed = true; } });
        linkBuffer.splice(i, 1);
      } else {
        i++;
      }
    }
    if (changed) await setStorage({ [EVENTS_KEY]: evs });
  }

  // ---- Authoritative event records from fetch hook ----------------
  // The fetch hook also emits full event records harvested from
  // Google's internal API responses ({title, startMs, endMs, link}).
  // We match these to stored events by startMs (±60s tolerance) and
  // use the authoritative title to OVERWRITE titles produced by the
  // DOM scraper, which can be wrong for events whose chip aria-label
  // doesn't carry the title in the expected position (e.g. "Busy"
  // events where the aria-label only has owner-name and time, so the
  // scraper would land on the owner's name or come up empty).
  const eventsBuffer = []; // [{title, startMs, endMs, link, ts}]
  const EVENTS_BUFFER_TTL_MS = 10 * 60 * 1000;
  const EVENTS_BUFFER_MAX = 1000;

  function pruneEventsBuffer() {
    const now = Date.now();
    let i = 0;
    while (i < eventsBuffer.length) {
      if (now - eventsBuffer[i].ts > EVENTS_BUFFER_TTL_MS) eventsBuffer.splice(i, 1);
      else i++;
    }
    if (eventsBuffer.length > EVENTS_BUFFER_MAX) {
      eventsBuffer.splice(0, eventsBuffer.length - EVENTS_BUFFER_MAX);
    }
  }

  async function applyAuthoritativeEvents() {
    pruneEventsBuffer();
    if (!eventsBuffer.length) return;
    const data = await getStorage([EVENTS_KEY]);
    const evs = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
    if (!evs.length) return;
    let changed = false;
    for (const fhe of eventsBuffer) {
      if (!fhe || !isFinite(fhe.startMs)) continue;
      for (const ev of evs) {
        if (!ev || !isFinite(ev.startMs)) continue;
        // Same event = startMs within 60s. (Cross-tz / encoder rounding
        // is the only realistic drift; events legitimately starting at
        // the same minute are typically distinct meetings, which we
        // disambiguate below by also requiring an empty/junk title or
        // matching title prefix.)
        if (Math.abs(ev.startMs - fhe.startMs) > 60000) continue;
        // Always prefer the authoritative title — DOM-scraped titles
        // for the same event can be "(no title)", "Justin Case" (the
        // calendar owner), etc. The fetch hook reads Google's own
        // `summary` field which is the source of truth.
        if (fhe.title && ev.title !== fhe.title) {
          ev.title = fhe.title;
          changed = true;
        }
        // Fill in missing endMs from the authoritative record so the
        // reminder card can show the time range.
        if (fhe.endMs && (!isFinite(ev.endMs) || ev.endMs <= ev.startMs)) {
          ev.endMs = fhe.endMs;
          changed = true;
        }
        // Attach link too (covers the case where titleHint failed).
        if (fhe.link && !ev.meet) {
          ev.meet = fhe.link;
          changed = true;
        }
      }
    }
    if (changed) {
      // Re-dedup the array using the same key the renderer uses
      // (startMs + title prefix). Two scraped copies of the same
      // event that previously had different DOM-derived titles will
      // collapse now that the authoritative title is applied to both.
      const byKey = {};
      evs.forEach(function (e) {
        const t = String(e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
        const k = e.startMs + '|' + t;
        const cur = byKey[k];
        if (!cur) byKey[k] = e;
        else {
          // Keep the one with the link / endMs / fresher _seenAt.
          if (!cur.meet && e.meet) cur.meet = e.meet;
          if (!cur.endMs && e.endMs) cur.endMs = e.endMs;
          if ((e._seenAt || 0) > (cur._seenAt || 0)) cur._seenAt = e._seenAt;
        }
      });
      const collapsed = Object.keys(byKey).map(function (k) { return byKey[k]; });
      collapsed.sort(function (a, b) { return a.startMs - b.startMs; });
      await setStorage({ [EVENTS_KEY]: collapsed });
    }
  }

  window.addEventListener('message', function (e) {
    try {
      if (e.source !== window) return;
      const msg = e.data;
      if (!msg || msg.source !== 'zhl-cal-fetch-hook') return;
      const harvest = (msg.payload && msg.payload.harvest) || [];
      const events = (msg.payload && msg.payload.events) || [];
      const now = Date.now();
      for (const h of harvest) {
        if (!h || !h.link || !h.titleHint) continue;
        linkBuffer.push({ link: h.link, titleHint: h.titleHint, ts: now });
      }
      for (const fhe of events) {
        if (!fhe || !isFinite(fhe.startMs)) continue;
        eventsBuffer.push({
          title: fhe.title || '',
          startMs: fhe.startMs,
          endMs: fhe.endMs || null,
          link: fhe.link || null,
          ts: now
        });
      }
      // Apply right away — most often the events store is already
      // populated by the time the first calendar fetch lands.
      attachBufferedLinks();
      applyAuthoritativeEvents();
    } catch (_) {}
  });

  // First-pass slight delay so Calendar finishes its initial render.
  setTimeout(function () { try { scrapeAndStore(); } catch (_) {} }, 1500);

  // ---- Auto-open popovers to harvest Zoom links --------------------
  // The fetch hook (calendar-fetch-hook.js) is the primary path —
  // it reads conferencing URLs straight from Google's internal API
  // responses without touching the UI. But for some events the link
  // is in a place the fetch hook doesn't reach (recurring events
  // with hidden guest lists, response shapes that don't follow the
  // standard `summary` → `dateTime` → conferenceData layout). For
  // those, this routine briefly opens each upcoming event's details
  // popover so harvestDetailPopovers can extract the link from the
  // rendered DOM, then closes the popover with Escape.
  //
  // Defensive limits to keep this from being annoying:
  //   - Top-level Calendar tab only (not the Gmail side-panel iframe).
  //   - Only events that have NO meet link yet.
  //   - Only events starting within the next 4 hours (covers reminder
  //     lead times comfortably without scanning the whole calendar).
  //   - At most ONE event per tick.
  //   - Skip if the user clicked anywhere in the last 5 seconds (so
  //     a popover doesn't flash up while they're actively reading
  //     their calendar).
  //   - Per-event tried-timestamp persisted so a failed lookup isn't
  //     retried for an hour.

  const LOOKUP_TRIED_KEY = 'zhlCalLookupTried';
  const LOOKUP_RETRY_MS = 60 * 60 * 1000;
  const LOOKUP_LOOKAHEAD_MS = 4 * 60 * 60 * 1000;

  function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function findChipForEvent(ev) {
    const title = ev && ev.title;
    if (!title || title === '(no title)') return null;
    const chips = document.querySelectorAll('[role="button"][aria-label], [data-eventid][aria-label]');
    for (const chip of chips) {
      const aria = chip.getAttribute('aria-label') || '';
      if (aria.indexOf(title) === -1) continue;
      try {
        const r = chip.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
      } catch (_) { continue; }
      return chip;
    }
    return null;
  }

  function simulateChipClick(el) {
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = {
        bubbles: true, cancelable: true, composed: true, view: window,
        button: 0, buttons: 1, clientX: x, clientY: y
      };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {}
  }

  function findOpenPopover() {
    // Marker: a visible close button ("X") inside a panel-sized
    // ancestor. Multiple selectors because Google has shipped this
    // button with different aria-labels over time.
    const closeBtns = document.querySelectorAll(
      '[aria-label="Close"], [aria-label="Dismiss"], button[data-tooltip="Close"]'
    );
    for (const btn of closeBtns) {
      try {
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
      } catch (_) { continue; }
      let panel = btn;
      for (let i = 0; i < 15 && panel; i++) {
        try {
          const pr = panel.getBoundingClientRect();
          if (pr.width >= 320 && pr.height >= 240) return panel;
        } catch (_) {}
        panel = panel.parentElement;
      }
    }
    return null;
  }

  function closeOpenPopover() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    try { document.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (_) {}
    try { document.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch (_) {}
  }

  // Suppress auto-open right after the user clicks something — we
  // don't want a popover flashing while they're reading.
  let lastUserActivityMs = 0;
  document.addEventListener('click', function () { lastUserActivityMs = Date.now(); }, true);
  document.addEventListener('keydown', function () { lastUserActivityMs = Date.now(); }, true);

  async function autoOpenUpcoming() {
    if (Date.now() - lastUserActivityMs < 5000) return;
    try {
      const data = await getStorage([EVENTS_KEY, LOOKUP_TRIED_KEY]);
      const evs = Array.isArray(data[EVENTS_KEY]) ? data[EVENTS_KEY] : [];
      const tried = data[LOOKUP_TRIED_KEY] || {};
      const now = Date.now();

      const candidate = evs.find(function (ev) {
        if (!ev || ev.meet || ev.allDay) return false;
        if (!isFinite(ev.startMs)) return false;
        if (ev.startMs - now > LOOKUP_LOOKAHEAD_MS) return false;
        if (ev.startMs + 60 * 60 * 1000 < now) return false;
        const key = (ev.uid || '') + '|' + ev.startMs;
        if (tried[key] && now - tried[key] < LOOKUP_RETRY_MS) return false;
        return true;
      });
      if (!candidate) return;

      const chip = findChipForEvent(candidate);
      if (!chip) return; // not in the current visible view — try later

      // Mark as tried before clicking, so a failed open doesn't loop.
      const key = (candidate.uid || '') + '|' + candidate.startMs;
      tried[key] = now;
      // Prune entries > 24h old to keep the map bounded.
      Object.keys(tried).forEach(function (k) {
        if (now - tried[k] > 24 * 60 * 60 * 1000) delete tried[k];
      });
      await setStorage({ [LOOKUP_TRIED_KEY]: tried });

      console.log('[ZHL Calendar Scraper] auto-opening popover for', candidate.title);
      simulateChipClick(chip);

      // Wait for popover (up to 2.5s).
      let popover = null;
      for (let i = 0; i < 25; i++) {
        await _sleep(100);
        popover = findOpenPopover();
        if (popover) break;
      }
      if (popover) {
        // Let it settle before harvesting.
        await _sleep(350);
        try { await harvestDetailPopovers(); } catch (_) {}
      }
      // Always close — even if no popover detected, an Escape is safe.
      closeOpenPopover();
    } catch (e) {
      console.warn('[ZHL Calendar Scraper] autoOpenUpcoming failed', e);
    }
  }

  // Top-level Calendar tab only (skip iframes — the Gmail side panel
  // shares this content script via all_frames, but auto-opening
  // popovers inside that tiny iframe would be jarring).
  if (window === window.top) {
    // First attempt 8 seconds after page load (gives Calendar time to
    // render and the fetch hook time to harvest links the easy way),
    // then every 3 minutes.
    setTimeout(function () { autoOpenUpcoming(); }, 8000);
    setInterval(function () { autoOpenUpcoming(); }, 3 * 60 * 1000);
  }

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
