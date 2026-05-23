// ZHL Productivity Pack — shared "Time saved" tracker
//
// Loaded as the FIRST entry in each tool's content_scripts js array, so it
// lands in the same isolated world as that tool and exposes the
// window.__zhlTimeSaved API. The tool then calls it from its completion
// modal to record time saved and render the standard "🕒 You just saved
// X" section.
//
// Three numbers shown:
//   1. minutes saved by this particular invocation
//   2. running total saved by THIS user (chrome.storage.local)
//   3. running total saved by ALL users (fetched from the telemetry Apps
//      Script's ?action=totalTimeSaved endpoint, cached 1 h in
//      chrome.storage.local). If the endpoint isn't deployed yet the
//      third line just hides.
//
// Usage:
//   window.__zhlTimeSaved.record('copy-lop-file', 15).then(function(r) {
//     panel.innerHTML += window.__zhlTimeSaved.renderHtml(15, r.userTotal, r.globalTotal);
//   });
(function () {
  'use strict';
  // Idempotent: if another content_scripts entry in the same isolated
  // world already loaded this file, don't redefine the API.
  if (window.__zhlTimeSaved) return;

  function formatDuration(mins) {
    const n = Math.max(0, Math.round(Number(mins) || 0));
    if (n === 0)      return '0m';
    if (n < 60)       return n + 'm';
    if (n < 24 * 60) {
      const h = Math.floor(n / 60);
      const m = n % 60;
      return h + 'h' + (m ? ' ' + m + 'm' : '');
    }
    const d = Math.floor(n / (24 * 60));
    const remain = n - d * 24 * 60;
    const h = Math.floor(remain / 60);
    const m = remain % 60;
    let out = d + 'd';
    if (h) out += ' ' + h + 'h';
    if (m) out += ' ' + m + 'm';
    return out;
  }

  function record(tool, minutes) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: 'ZHL_TIME_SAVED_RECORD', tool: String(tool || ''), minutes: Number(minutes) || 0 },
          function (resp) {
            if (chrome.runtime.lastError) { resolve({ userTotal: 0, globalTotal: null }); return; }
            resolve(resp || { userTotal: 0, globalTotal: null });
          }
        );
      } catch (_) { resolve({ userTotal: 0, globalTotal: null }); }
    });
  }

  // For tools that want only persistence + telemetry (no popup section).
  function recordAndForget(tool, minutes) {
    try {
      chrome.runtime.sendMessage({
        type: 'ZHL_TIME_SAVED_RECORD',
        tool: String(tool || ''), minutes: Number(minutes) || 0
      });
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderHtml(justSavedMin, userTotalMin, globalTotalMin) {
    const just  = formatDuration(justSavedMin);
    const user  = formatDuration(userTotalMin);
    const lines = [
      '<div style="margin-top:14px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font:13px Arial,sans-serif;color:#78350f;">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:6px;">🕒 You just saved ' + escapeHtml(just) + '</div>' +
        '<div style="font-size:12px;">Your total with ZHL Pack: <strong>' + escapeHtml(user) + '</strong></div>'
    ];
    if (typeof globalTotalMin === 'number' && globalTotalMin > 0) {
      lines.push('<div style="font-size:12px;">Across all users: <strong>' + escapeHtml(formatDuration(globalTotalMin)) + '</strong></div>');
    }
    lines.push('</div>');
    return lines.join('');
  }

  window.__zhlTimeSaved = {
    record:          record,
    recordAndForget: recordAndForget,
    formatDuration:  formatDuration,
    renderHtml:      renderHtml
  };
})();
