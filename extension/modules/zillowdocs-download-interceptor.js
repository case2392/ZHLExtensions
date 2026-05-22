// ZHL Productivity Pack — Zillow Docs download interceptor (MAIN world)
//
// Runs at document_start in the page's JS context. Observes the viewer's
// own network traffic to find the PDF URL.
//
// PRIMARY ROLE (v1.37.4+):
//   When the viewer fetches the PDF to display it in its viewer pane, this
//   script captures that URL and announces it to the content script via
//   window.postMessage({ __zhlPdfReady, url }). The content script then
//   asks background.js to download that HTTPS URL directly via
//   chrome.downloads — so the Download button never gets clicked, no native
//   download is triggered, and no Save As dialog ever appears.
//
// SECONDARY ROLE (fallback):
//   If for some reason the URL isn't captured during viewer load (e.g.
//   on-demand fetch), the content script falls back to clicking Download.
//   In that case the anchor-click intercepts here try to swallow the
//   download — but real-world viewers can route around those, so the
//   PRIMARY role is what makes the silent-download experience reliable.
(function () {
  'use strict';

  function announcePdfUrl(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, location.href).href; } catch (_) { return; }
    }
    // Stash on <html> so the content script (which runs at document_idle,
    // after the fetch has likely completed) can pick it up even if it
    // missed the live postMessage.
    try {
      var el = document.documentElement;
      if (el && !el.getAttribute('data-zhl-pdf-url')) {
        el.setAttribute('data-zhl-pdf-url', url);
      }
    } catch (_) {}
    window.postMessage({ __zhlPdfReady: true, url: url }, '*');
  }

  // ---- fetch wrapper -----------------------------------------------------
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input
          : (input instanceof Request  ? input.url : String(input));
    } catch (_) { url = ''; }
    var p = _origFetch.apply(this, arguments);
    if (url) {
      p.then(function (res) {
        if (!res || !res.ok) return;
        var ct = (res.headers && res.headers.get('content-type')) || '';
        if (/pdf|octet-stream/i.test(ct)) announcePdfUrl(url);
      }).catch(function () {});
    }
    return p;
  };

  // ---- XMLHttpRequest wrapper -------------------------------------------
  // Some viewers / vendor bundles still use XHR. Capture there too.
  var _origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__zhlUrl = url; } catch (_) {}
    return _origXhrOpen.apply(this, arguments);
  };
  var _origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    try {
      xhr.addEventListener('load', function () {
        try {
          if (xhr.status < 200 || xhr.status >= 300) return;
          var ct = xhr.getResponseHeader('content-type') || '';
          if (/pdf|octet-stream/i.test(ct)) announcePdfUrl(xhr.__zhlUrl || '');
        } catch (_) {}
      });
    } catch (_) {}
    return _origXhrSend.apply(this, arguments);
  };

  // ---- Anchor-click intercepts (fallback only) ---------------------------
  function tryIntercept(a) {
    if (!a || !a.hasAttribute('download')) return false;
    if (!document.documentElement.hasAttribute('data-zhl-bulk-armed')) return false;
    var href = a.href || '';
    if (!href) return false;
    document.documentElement.removeAttribute('data-zhl-bulk-armed');
    window.postMessage({
      __zhlDl : true,
      blobUrl : href,
      name    : a.getAttribute('download') || ''
    }, '*');
    return true;
  }
  var _origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (tryIntercept(this)) return;
    return _origClick.call(this);
  };
  var _origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (event && event.type === 'click' && event.cancelable
        && this instanceof HTMLAnchorElement) {
      if (tryIntercept(this)) return false;
    }
    return _origDispatch.call(this, event);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && tryIntercept(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
