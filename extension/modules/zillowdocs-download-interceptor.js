// ZHL Productivity Pack — Zillow Docs download interceptor (MAIN world)
//
// Runs at document_start in the page's JS context on every Zillow Docs
// embed/editor tab. Sits dormant until zillowdocs-bulk-download.js (the
// companion content script) arms it by setting data-zhl-bulk-armed on
// <html>. When armed, intercepts the viewer's programmatic anchor.click()
// download trigger (fetch → createObjectURL → <a download>.click()) and
// routes the blob URL back to the content script via window.postMessage so
// chrome.downloads (with saveAs:false) can save silently — bypassing the
// browser's "where do you want to save?" dialog.
(function () {
  'use strict';

  var _revokeObjectURL = URL.revokeObjectURL.bind(URL);
  var _pendingRevoke = Object.create(null);

  // Delay revokeObjectURL on intercepted blobs so the content script
  // has 10 s to fetch the blob before it is released.
  URL.revokeObjectURL = function (url) {
    if (url && _pendingRevoke[url]) {
      setTimeout(function () {
        delete _pendingRevoke[url];
        _revokeObjectURL(url);
      }, 10000);
      return;
    }
    _revokeObjectURL(url);
  };

  function tryIntercept(a) {
    if (!a || !a.hasAttribute('download')) return false;
    if (!document.documentElement.hasAttribute('data-zhl-bulk-armed')) return false;
    var href = a.href || '';
    if (!href) return false;
    // Disarm immediately — one download per arm cycle.
    document.documentElement.removeAttribute('data-zhl-bulk-armed');
    _pendingRevoke[href] = true;
    window.postMessage({ __zhlDl: true, url: href, name: a.getAttribute('download') || '' }, '*');
    return true;
  }

  var _anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (tryIntercept(this)) return;
    return _anchorClick.call(this);
  };

  // Belt + suspenders: also catch dispatchEvent-style programmatic clicks.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a') : null;
    if (a && tryIntercept(a)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
