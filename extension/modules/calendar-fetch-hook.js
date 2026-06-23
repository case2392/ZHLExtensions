// ZHL Productivity Pack — Calendar fetch/XHR hook (MAIN world)
//
// Runs in the page's main JS world on calendar.google.com (at document_
// start, before Google's app code) and hooks window.fetch + XMLHttp
// Request so it can peek at the bodies of Google's internal calendar
// API responses. Those responses contain conferenceData / hangoutLink
// for every event — info that NEVER appears on the rendered week/day
// chip, which is why the previous DOM-only scraper couldn't find Zoom
// links without the LO opening each event manually.
//
// Output: for each Meet/Zoom URL found in a calendar.google.com
// response body, we post a message {source:'zhl-cal-fetch-hook',
// payload:{harvest:[{link, candidates:[titles]}]}} to the page. The
// isolated-world scraper (calendar-events-scraper.js) listens, matches
// each link's candidate titles against stored events by normalized
// title, and stamps the link onto the event.
//
// Why text-scan instead of JSON.parse: Google Calendar's web client
// uses an internal Closure-RPC protocol that is NOT strict JSON (it
// embeds protobuf-encoded payloads as arrays). A robust JSON parse
// would fail on most responses. Text-scanning for URLs + nearby
// quoted strings is format-agnostic and survives Google's protocol
// changes — false-positives are bounded because we only attach links
// to events whose stored titles match one of the link's candidates.

(function () {
  'use strict';
  if (window.__zhlCalFetchHookLoaded) return;
  window.__zhlCalFetchHookLoaded = true;

  // Same link regex used elsewhere — Meet, *.zoom.us, *.zoomgov.com.
  const LINK_RE = /https?:\/\/(?:meet\.google\.com\/[a-z0-9\-]+|[a-z0-9.\-]*zoom\.us\/[^\s"'<>\\]+|[a-z0-9.\-]*zoomgov\.com\/[^\s"'<>\\]+)/gi;

  // For each conferencing URL in `text`, find the closest preceding
  // "summary":"..." / "title":"..." / "name":"..." field — Google's
  // own event-title fields — within 2000 chars before the URL. That
  // string is almost certainly the title of the EVENT this link
  // belongs to. Skipping the link entirely when no such field is
  // present is the right call: matching by free-text candidates ran
  // into false positives where the link of one event would attach to
  // a different event whose title happened to be nearby in the JSON
  // (e.g. the next item in an events array).
  //
  // Also recognizes ICS-format "SUMMARY:..." for endpoints that
  // return iCalendar text.
  const TITLE_JSON_FIELDS = ['summary', 'title', 'name'];
  function extractTitleHint(text, linkIdx) {
    const start = Math.max(0, linkIdx - 2000);
    const back = text.slice(start, linkIdx);
    let bestTitle = null;
    let bestPos = -1;
    for (const field of TITLE_JSON_FIELDS) {
      const re = new RegExp('"' + field + '"\\s*:\\s*"((?:\\\\.|[^"\\\\]){1,200})"', 'gi');
      let m;
      while ((m = re.exec(back)) !== null) {
        if (m.index > bestPos) { bestPos = m.index; bestTitle = m[1]; }
      }
    }
    // ICS "SUMMARY:foo" form (Google iCal endpoints).
    const icsRe = /SUMMARY:([^\r\n]{1,200})/g;
    let im;
    while ((im = icsRe.exec(back)) !== null) {
      if (im.index > bestPos) { bestPos = im.index; bestTitle = im[1].trim(); }
    }
    if (!bestTitle) return null;
    // Unescape common JSON escapes so titles match the rendered chip.
    return bestTitle
      .replace(/\\"/g, '"').replace(/\\'/g, "'")
      .replace(/\\n/g, ' ').replace(/\\t/g, ' ')
      .replace(/\\\\/g, '\\').trim();
  }

  function harvestFromText(text) {
    if (!text || text.length < 50) return [];
    const out = [];
    const linkRe = new RegExp(LINK_RE.source, 'gi');
    let m;
    while ((m = linkRe.exec(text)) !== null) {
      const link = m[0];
      const titleHint = extractTitleHint(text, m.index);
      if (!titleHint) continue; // skip ambiguous matches
      out.push({ link: link, titleHint: titleHint });
    }
    return out;
  }

  function dispatch(harvest, url) {
    if (!harvest || !harvest.length) return;
    try {
      window.postMessage({
        source: 'zhl-cal-fetch-hook',
        payload: { harvest: harvest, url: String(url || '') }
      }, '*');
    } catch (_) {}
  }

  // ---- fetch() hook -----------------------------------------------
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        const args = arguments;
        const p = origFetch.apply(this, args);
        p.then(function (resp) {
          try {
            const url = (resp && resp.url) ||
              (args[0] && typeof args[0] === 'object' && args[0].url) ||
              (typeof args[0] === 'string' ? args[0] : '');
            if (typeof url !== 'string' || !/calendar\.google\.com/.test(url)) return;
            // clone() so we don't consume the body the app needs.
            const clone = resp.clone();
            clone.text().then(function (text) {
              const h = harvestFromText(text);
              if (h.length) dispatch(h, url);
            }).catch(function () {});
          } catch (_) {}
        }).catch(function () {});
        return p;
      };
    }
  } catch (_) {}

  // ---- XMLHttpRequest hook ----------------------------------------
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__zhlUrl = String(url || ''); } catch (_) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const xhr = this;
      try {
        xhr.addEventListener('load', function () {
          try {
            const url = xhr.__zhlUrl || '';
            if (!/calendar\.google\.com/.test(url)) return;
            // responseType '' or 'text' is readable as responseText.
            let text = '';
            try { text = xhr.responseText || ''; } catch (_) {}
            if (!text) return;
            const h = harvestFromText(text);
            if (h.length) dispatch(h, url);
          } catch (_) {}
        });
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
  } catch (_) {}
})();
