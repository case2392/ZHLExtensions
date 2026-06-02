// ZHL Productivity Pack module — feature key: feature_hardPullGuardrail
//
// HIDDEN / PREVIEW FEATURE — disabled by default. Enable in Setup or
// via: chrome.storage.local.set({ feature_hardPullGuardrail: true })
//
// Hard Pull Guardrail: when the LO opens LOP's Pull Credit dialog and
// selects "Hard," this module checks the worst soft credit score
// across borrowers + the most recent DU result against ZHL's hard-pull
// guidance matrix. If the combination indicates an unnecessary hard
// pull (soft > 620 + DU Approval, outside the 680-719 optional pricing
// window), the click on "Pull credit" is intercepted and a warning
// dialog surfaces showing the matrix + LO can Confirm or Cancel.
//
// Not a hard stop — the LO can always proceed after confirmation. The
// guardrail is about catching the absent-minded case, not blocking
// legitimate edge cases.
//
// Guidance matrix encoded:
//   No soft on file            → Hard OK
//   Soft < 620                 → Hard OK
//   Soft 620-679 + DU Approval → WARN  (use soft instead)
//   Soft 620-679 + DU Deny     → Hard OK
//   Soft 680-699               → Optional Hard (LLPA at 700 — no warn)
//   Soft 700-719               → Optional Hard (LLPA at 720 — no warn)
//   Soft ≥ 720 + DU Approval   → WARN  (no benefit; already top tier)
//   Soft ≥ 720 + DU Deny       → Hard OK

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_hardPullGuardrail';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Hard Pull Guardrail v' + VERSION + '] loaded');

  const SKIP_FLAG = '__zhl_skip_hard_pull_warning';

  // ---- Score parsing ----------------------------------------------
  // Each borrower has Soft and Hard rows under [data-cy="<Name>"].
  // Within each row, the score cells appear as <span>721</span>,
  // <span>709</span>, <span>687</span> (and a "-" for missing bureaus).
  // We collect numeric scores, ignoring dashes, and take the qualifying
  // value (middle of 3, lower of 2, single if only one bureau).
  function parseScoresFromRow(rowEl) {
    if (!rowEl) return null;
    const spans = rowEl.querySelectorAll('span');
    const nums = [];
    spans.forEach(function (s) {
      // Skip nested elements that contain children (those wrap the
      // bureau-link button); we want leaf score spans only.
      if (s.children && s.children.length > 0) return;
      const txt = (s.textContent || '').trim();
      const n = parseInt(txt, 10);
      if (!isNaN(n) && n >= 300 && n <= 850) nums.push(n);
    });
    if (nums.length === 0) return null;
    if (nums.length === 1) return nums[0];
    nums.sort(function (a, b) { return a - b; });
    if (nums.length >= 3) return nums[1]; // middle of three
    return nums[0]; // lower of two — conservative
  }

  function findCreditPanel() {
    // The credit panel contains per-borrower [data-cy] blocks with
    // Soft / Hard child rows. Find the deepest common ancestor of any
    // two adjacent Soft rows. Cheapest path: just look for any
    // [data-cy="Soft"] in the page and walk up to its enclosing
    // borrower container.
    return document;
  }

  // Returns the WORST (lowest) soft qualifying score across all
  // borrowers on the page. Null if no soft scores are available.
  function readWorstSoftScore() {
    const borrowerBlocks = document.querySelectorAll('[data-cy] > [data-cy="Soft"]');
    let worst = null;
    borrowerBlocks.forEach(function (softRow) {
      const score = parseScoresFromRow(softRow);
      if (score == null) return;
      if (worst == null || score < worst) worst = score;
    });
    return worst;
  }

  // ---- AUS / DU status --------------------------------------------
  // Most recent DU result appears as the first <button> under the DU
  // <li> in the AUS panel. Format: "Approve/Eligible - 5/30/2026 4:58 PM"
  // The header status badge ([data-cy="DesktopUnderwriter-status"])
  // reflects the most recent run including errors. We prefer the
  // most recent NON-ERROR result so a freshly-errored re-run doesn't
  // mask the LO's actual standing.
  function readMostRecentDuStatus() {
    // Find the DU <li> by scanning for the inner "DU" label.
    const labels = document.querySelectorAll('span');
    let duLi = null;
    for (const span of labels) {
      const txt = (span.textContent || '').trim();
      if (txt !== 'DU') continue;
      const li = span.closest('li');
      if (li) { duLi = li; break; }
    }
    if (!duLi) return null;
    const historyButtons = duLi.querySelectorAll('button');
    for (const btn of historyButtons) {
      const txt = (btn.textContent || '').trim();
      // Skip the "Select" / "See More" action buttons.
      if (/^(select|selected|see more|choose action)$/i.test(txt)) continue;
      // Result lines look like "Approve/Eligible - 5/30/2026 4:58 PM"
      const m = txt.match(/^([A-Za-z/\s]+?)\s+-\s+\d/);
      if (!m) continue;
      const status = m[1].trim();
      if (/^error$/i.test(status)) continue; // skip errors, keep looking
      return status;
    }
    return null;
  }

  // ---- Decision logic ---------------------------------------------
  function shouldWarnOnHardPull(softScore, duStatus) {
    if (softScore == null) return false;          // No soft → can't second-guess
    if (softScore < 620) return false;            // Hard appropriate
    // Optional pricing windows — hard might pick up LLPA tier improvement,
    // so don't warn even with DU approval.
    if (softScore >= 680 && softScore <= 719) return false;
    // 620-679 OR 720+: warn ONLY when DU shows approval.
    if (!duStatus) return false;                  // No DU read → can't warn confidently
    const isApproval = /^approve/i.test(duStatus);
    return isApproval;
  }

  function buildReason(softScore, duStatus) {
    const parts = [];
    parts.push('Worst soft score across borrowers: <b>' + softScore + '</b>');
    parts.push('Most recent DU result: <b>' + (duStatus || 'unknown') + '</b>');
    return parts.join(' &nbsp;·&nbsp; ');
  }

  // ---- Warning dialog ---------------------------------------------
  const DIALOG_ID = 'zhl-hard-pull-guardrail-dialog';
  function showWarningDialog(softScore, duStatus, onProceed, onCancel) {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = DIALOG_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(15,23,42,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:10px',
      'max-width:540px', 'width:90vw',
      'padding:22px 24px',
      'box-shadow:0 18px 48px rgba(0,0,0,0.3)',
      'color:#0f172a'
    ].join(';');
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:100px;background:#fef3c7;color:#92400e;font-weight:700;font-size:16px;">!</span>' +
        '<h3 style="margin:0;font:700 17px/1.2 inherit;color:#92400e;">Hard pull may be outside ZHL guidance</h3>' +
      '</div>' +
      '<div style="font:13px/1.45 inherit;color:#334155;margin-bottom:12px;">' + buildReason(softScore, duStatus) + '</div>' +
      '<div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;padding:10px 12px;font:12px/1.5 inherit;color:#78350f;margin-bottom:14px;">' +
        '<b>ZHL guidance:</b> Hard credit should not be pulled prior to VPA when the soft credit score is greater than 620 and DU is approved — unless it\'s an edge case (e.g. pricing improvement at the 680→700 or 700→720 LLPA tier).' +
      '</div>' +
      '<div style="overflow:hidden;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:16px;">' +
        '<table style="width:100%;border-collapse:collapse;font:11.5px/1.4 inherit;">' +
        '<thead><tr style="background:#f8fafc;color:#0b3a73;font-weight:700;">' +
          '<th style="padding:7px 10px;text-align:left;border-bottom:1px solid #e5e7eb;">Credit score</th>' +
          '<th style="padding:7px 10px;text-align:left;border-bottom:1px solid #e5e7eb;">Soft or Hard</th>' +
        '</tr></thead>' +
        '<tbody>' +
          row('No soft on file', 'Hard', '#dcfce7') +
          row('Less than 620', 'Hard', '#fed7aa') +
          row('Higher than 620 + DU Approval', 'Soft', '#dcfce7') +
          row('Higher than 620 + DU Deny', 'Hard', '#fed7aa') +
          row('Optional 680–699 (near 700 LLPA)', 'Hard for pricing', '#fef9c3') +
          row('Optional 700–719 (near 720 LLPA)', 'Hard for pricing', '#fef9c3') +
        '</tbody></table>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button id="zhl-hpg-cancel" style="padding:8px 14px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:5px;font:600 13px inherit;cursor:pointer;">Cancel — don\'t pull</button>' +
        '<button id="zhl-hpg-proceed" style="padding:8px 14px;background:#b45309;color:#fff;border:1px solid #b45309;border-radius:5px;font:600 13px inherit;cursor:pointer;">Proceed with Hard Pull anyway</button>' +
      '</div>' +
      '<div style="margin-top:10px;font:11px/1.4 inherit;color:#94a3b8;">Built by Justin Case. Karma appreciated 💛</div>';
    function row(label, suggested, bg) {
      return '<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">' + label + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;background:' + bg + ';font-weight:600;">' + suggested + '</td></tr>';
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cancelBtn = card.querySelector('#zhl-hpg-cancel');
    const proceedBtn = card.querySelector('#zhl-hpg-proceed');
    cancelBtn.addEventListener('click', function () {
      overlay.remove();
      try { onCancel && onCancel(); } catch (_) {}
    });
    proceedBtn.addEventListener('click', function () {
      overlay.remove();
      try { onProceed && onProceed(); } catch (_) {}
    });
    // Click outside the card → cancel
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        overlay.remove();
        try { onCancel && onCancel(); } catch (_) {}
      }
    });
  }

  // ---- Click interceptor on the Pull credit button ---------------
  // Capture phase so we intercept BEFORE LOP's React handler.
  document.addEventListener('click', function (e) {
    if (window[SKIP_FLAG]) return; // post-confirmation re-click
    const btn = e.target && e.target.closest && e.target.closest('button[data-cy="run-credit"]');
    if (!btn) return;
    const dialog = btn.closest('section[role="dialog"]');
    if (!dialog) return;
    const pullTypeSelect = dialog.querySelector('select[name="pullType"]');
    if (!pullTypeSelect || pullTypeSelect.value !== 'Hard') return;

    const softScore = readWorstSoftScore();
    const duStatus = readMostRecentDuStatus();
    console.log('[ZHL Hard Pull Guardrail] Hard pull intercepted. Worst soft=' + softScore + ', DU=' + duStatus);

    if (!shouldWarnOnHardPull(softScore, duStatus)) {
      console.log('[ZHL Hard Pull Guardrail] Within guidance — allowing pull.');
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    showWarningDialog(softScore, duStatus,
      function onProceed() {
        console.log('[ZHL Hard Pull Guardrail] LO confirmed override — proceeding.');
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'hard_pull_guardrail', props: { decision: 'proceed', softScore: softScore, du: duStatus } }); } catch (_) {}
        window[SKIP_FLAG] = true;
        try { btn.click(); } finally {
          setTimeout(function () { window[SKIP_FLAG] = false; }, 1500);
        }
      },
      function onCancel() {
        console.log('[ZHL Hard Pull Guardrail] LO cancelled — Pull credit dialog stays open.');
        try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'hard_pull_guardrail', props: { decision: 'cancel', softScore: softScore, du: duStatus } }); } catch (_) {}
      });
  }, true);
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      // Default OFF (hidden / preview feature). Must be explicitly enabled.
      if (data[__ZHL_FEATURE_KEY] !== true) return;
      __zhlRunModule();
    });
  }
})();
