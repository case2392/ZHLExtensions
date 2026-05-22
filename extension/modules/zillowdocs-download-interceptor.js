// ZHL Productivity Pack — Zillow Docs download interceptor (MAIN world)
//
// Runs at document_start in the page's JS context. Sits dormant until
// zillowdocs-bulk-download.js sets data-zhl-bulk-armed on <html>.
//
// Three-layer intercept so we catch every mechanism the viewer might use:
//   1. fetch wrapper     — captures the original HTTPS PDF URL so
//                          chrome.downloads can use it directly (avoids
//                          the Windows UUID.tmp filename bug with data URLs)
//   2. prototype.click   — catches a.click() on download anchors
//   3. dispatchEvent     — catches a.dispatchEvent(new MouseEvent('click'))
//                          on anchors that are NOT in the DOM (most common
//                          SPA pattern — doesn't bubble to document)
//   4. capture listener  — catches bubbled clicks on in-DOM anchors
//
// Posts { __zhlDl:true, blobUrl, pdfUrl, name } via window.postMessage
// and prevents the native browser download from starting.
(function () {
  'use strict';

  var _blobToSrc    = Object.create(null); // blob URL → original HTTPS URL
  var _pendingRevoke = Object.create(null); // blob URLs whose revoke is delayed
  var _lastPdfUrl   = null;               // most recent PDF-typed fetch URL

  // ---- 1. Intercept fetch to capture the PDF source URL ------------------
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input
          : (input instanceof Request  ? input.url : String(input));
      if (url && !/^https?:\/\//i.test(url)) url = new URL(url, location.href).href;
    } catch (_) { url = ''; }
    var p = _origFetch.apply(this, arguments);
    if (url) {
      p.then(function (res) {
        if (!res || !res.ok) return;
        var ct = (res.headers && res.headers.get('content-type')) || '';
        if (/pdf|octet-stream/i.test(ct)) _lastPdfUrl = url;
      }).catch(function () {});
    }
    return p;
  };

  // ---- 2. Intercept URL.createObjectURL to map blob → fetch URL ----------
  var _origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    var url = _origCreate(obj);
    if (obj instanceof Blob) {
      _blobToSrc[url]     = _lastPdfUrl || '';
      _pendingRevoke[url] = true;
    }
    return url;
  };

  // Delay revoke on intercepted blobs so the content script can fetch them.
  var _origRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function (url) {
    if (url && _pendingRevoke[url]) {
      setTimeout(function () {
        delete _pendingRevoke[url];
        delete _blobToSrc[url];
        _origRevoke(url);
      }, 10000);
      return;
    }
    _origRevoke(url);
  };

  // ---- Core: swallow the anchor download, post details to content script --
  function tryIntercept(a) {
    if (!a || !a.hasAttribute('download')) return false;
    if (!document.documentElement.hasAttribute('data-zhl-bulk-armed')) return false;
    var blobUrl = a.href || '';
    if (!blobUrl) return false;
    document.documentElement.removeAttribute('data-zhl-bulk-armed');
    var pdfUrl = (_blobToSrc[blobUrl] !== undefined ? _blobToSrc[blobUrl] : null)
              || _lastPdfUrl
              || '';
    window.postMessage({
      __zhlDl : true,
      blobUrl : blobUrl,
      pdfUrl  : pdfUrl,
      name    : a.getAttribute('download') || ''
    }, '*');
    return true;
  }

  // ---- 3. Intercept a.click() -------------------------------------------
  var _origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (tryIntercept(this)) return;
    return _origClick.call(this);
  };

  // ---- 4. Intercept a.dispatchEvent(new MouseEvent('click')) --------------
  // This catches off-DOM programmatic clicks that never bubble to document.
  var _origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (event && event.type === 'click' && event.cancelable
        && this instanceof HTMLAnchorElement) {
      if (tryIntercept(this)) return false;
    }
    return _origDispatch.call(this, event);
  };

  // ---- 5. Document capture listener (in-DOM bubbled clicks) ---------------
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && tryIntercept(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
