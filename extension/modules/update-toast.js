// ZHL Productivity Pack module — feature key: feature_updateToast
//
// Bottom-right toast that appears once per release on LOP / Gmail /
// Salesforce tabs so users see what's new without having to visit the
// setup page. Reads the headline for the current version from
// changelog.js (loaded as a separate script — we just look at the
// pre-baked CHANGELOG_HEADLINES below since content scripts can't
// import each other).
//
// Dismissal tracked per-version in chrome.storage.local under
// `_zhl_last_seen_version`. After the user clicks View or Dismiss the
// stored value bumps to the current version and the toast won't reshow
// until the NEXT update.
//
// Auto-dismiss after 14 seconds if untouched (still stores the version,
// so we don't pester).
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_updateToast';
  function __zhlRunModule() {
(function () {
  'use strict';

  // We can't `import` changelog.js into a content script, so the toast
  // ships with a tiny hard-coded headline map keyed by version. Keep this
  // in sync with changelog.js on every release — only headlines for
  // versions we actually want a toast on need to live here.
  const CHANGELOG_HEADLINES = {
    "1.41.0": "NEW Add Loan Officer button in the SMS Quick-Add row on Salesforce Leads — one-click adds the Lead Owner to the SMS thread.",
    "1.40.4": "Pricing Exception Workflow: ZHL and Competitor cards now line up row-for-row (Competitor lender name moved above the cards).",
    "1.40.3": "Pricing Exception Workflow BUG FIX: 'Open in Gmail' auto-paste now actually fires — was gated on a URL param Gmail strips on redirect.",
    "1.40.2": "PE Workflow: rate-lock status now obvious in the email — [LOCKED] / [NOT LOCKED] in the subject, plus a colored banner at the top of the body.",
    "1.40.1": "Pricing Exception Workflow: Open in Gmail now AUTO-PASTES the formatted body — no Ctrl+V needed.",
    "1.40.0": "Pricing Exception Workflow: NEW 'Reason / description' step on the unlocked path — included on every email so the RM can approve without coming back.",
    "1.39.5": "Pricing Exception Workflow BUG FIX: the Closing Costs popup auto-fill now actually closes the popup again (the close button detector wasn't matching LOP's 'Close' text button).",
    "1.39.4": "Net Proceeds calc button now sits to the left of 'Add asset or credit' (was on the far right).",
    "1.39.3": "Pricing Exception Workflow: Open in Gmail now opens AND copies the formatted email (just Ctrl+V in Gmail body), RM email is sticky, comp form auto-fills nearly everything from LOP (including ZHL Box A from the Closing Costs popup), and new Competitor lender name field.",
    "1.39.2": "Pricing Exception Workflow: new header 'PE request for <Borrowers> by <LO>', auto-detects ZG# and LO name, and Copy body now copies a formatted HTML version that pastes nicely into Gmail.",
    "1.39.1": "Pricing Exception Workflow: button now opens the email directly in Gmail (was handing off to Outlook via the OS default mail client).",
    "1.39.0": "NEW Pricing Exception Workflow — '⚖ Pricing Exception Workflow' button on the LOP toolbar walks the PE checklist and builds the RM email for you.",
    "1.38.1": "Net Proceeds calc now auto-detects Mortgage/HELOC liens from LOP's Liabilities table and pre-fills them as checkboxes — no more manual lookup.",
    "1.38.0": "NEW Net Proceeds from Sale calculator — click '🏠 Net proceeds calc' in the Assets section to estimate seller proceeds after fees and payoffs.",
    "1.37.10": "Bulk-download: ~10x faster — skipped the 20s wait per file (Zillow Docs never pre-fetches) and now runs 4 downloads in parallel.",
    "1.37.9": "Bulk-download: NEW 'Save to folder' path that bypasses Chrome's Save As dialog entirely — pick a folder once and every PDF saves silently. Works with the PromptForDownloadLocation enterprise policy.",
    "1.37.8": "Bulk-download: confirmation prompt now warns you to disable Chrome's 'Ask where to save' setting — the Save As dialog can't be bypassed by extensions when that's on.",
    "1.37.7": "Bulk-download Save As dialog actually fixed — override Chrome's prompt-each-time preference by passing conflictAction in onDeterminingFilename's suggest() call.",
    "1.37.6": "Bulk-download: diagnostic logging + DNR rule fix (broadened to all URLs, properly awaited before tab open). Open the service worker console to see what's happening.",
    "1.37.5": "Bulk-download BUG FIX: Save As dialog gone for real now — Content-Disposition header is stripped during the run so Chrome doesn't treat responses as attachments.",
    "1.37.4": "Bulk-download BUG FIX: Save As dialog truly gone now. The Download button is never clicked — we capture the PDF URL from the viewer's own fetch and route it through chrome.downloads silently.",
    "1.37.3": "Bulk-download BUG FIXES: files now save with correct PDF names (not UUID.tmp) and the Save As dialog is fully gone.",
    "1.37.2": "Bulk-download: files now save automatically to Downloads — no 'Save As' dialog on each file.",
    "1.37.1": "Bulk-download BUG FIX: was collecting 0 documents every time — task rows are collapsed by default, so links weren't in the DOM yet. Now expands each row, grabs links, then collapses it again.",
    "1.37.0": "NEW Bulk-download completed-task documents — one click opens each Zillow Docs link in a background tab, auto-clicks Download, and closes. Sequential, with progress.",
    "1.36.6": "Copy LOP file: 'leave Justin karma' on the success modal is now a clickable link to my Zall Wall (was plain text in v1.36.5).",
    "1.36.5": "Copy LOP file: cheerier success modal at the end — 'Congrats on cloning your LOP file!' instead of the old 'credit reissue triggered, watch the right rail.'",
    "1.36.4": "Copy LOP file BUG FIX: liability edits now gated on every borrower having a credit score (not just stable-row-count on the table side) so we don't start before CoreLogic finishes streaming.",
    "1.36.3": "Copy LOP file BUG FIX: liability edits now wait for every staged account to stream in from CoreLogic before trying to match (90s cap, 4-tick stable exit, per-row 12s retry).",
    "1.36.2": "Copy LOP file BUG FIXES: credit detect now reads LOP's per-borrower data-cy grids (was missing the scores) + ZIP autocomplete / date picker poppers get dismissed before Run pricing.",
    "1.36.1": "Copy LOP file BUG FIX: pricing ZIP gets stripped to 5 digits (was failing on ZIP+4) + credit wait now requires a score for EVERY borrower before pricing fires.",
    "1.36.0": "Copy LOP file: NEW auto-run pricing + auto-assign — paste now drives Pricing & Scenarios after credit lands and picks the same product + rate the source had. Heavy console debug at every step.",
    "1.35.1": "Walkthrough: added the Copy LOP file card (it's been missing since v1.29) so the feature shows up under New features and the toast's 'View what's new' actually deep-links to it.",
    "1.35.0": "Copy LOP file: when paste auto-adds a co-borrower, it now reloads the page before credit so LOP's eligibility cache picks up the new consent — credit then fires automatically once the page comes back.",
    "1.34.6": "Copy LOP file BUG FIX: double-save + 4.5s settle so LOP's credit endpoint sees the new co-borrower's Verbal consent before credit fires.",
    "1.34.5": "Copy LOP file BUG FIX: credit pull no longer races the new co-borrower's consent commit — verify consent + 1.5s settle after save before credit fires.",
    "1.34.4": "Copy LOP file BUG FIX: Real Estate source-side scrape no longer defeated by nested liabilities table — Property type / Current occupancy / Pending-sale date now capture on stage.",
    "1.34.3": "Copy LOP file: Borrower multi-select now verifies the chip committed (tries checkbox/label/option/typed in turn) + re-stage hint when Real Estate details are missing.",
    "1.34.2": "Copy LOP file BUG FIX: Real Estate now saves on paste — handles pre-expanded source rows + multi-select Borrower(s) checkboxes + Existing-address dropdown.",
    "1.34.1": "Copy LOP file BUG FIX: Add-a-new-borrower dialog detector is now permissive — auto-add co-borrower no longer falsely aborts when the dialog is open.",
    "1.34.0": "Copy LOP file BUG FIX: multi-borrower files now auto-add the missing co-borrower via the + tab before pasting (was dumping co-borrower data onto primary).",
    "1.33.2": "Copy LOP file BUG FIX: soft credit pull now saves the file first (was skipping save → Choose action stayed disabled).",
    "1.33.1": "Copy LOP file: liability stage only opens rows that need it — much faster on files with lots of credit cards.",
    "1.33.0": "Copy LOP file: NEW source-side form scrape for Real Estate + Liabilities — Property type / Payoff / Exclude+Reason / Property link all copy automatically.",
    "1.32.1": "Copy LOP file: real-estate financial-status defaults to With liabilities when source has a mortgage + clearer failure reason.",
    "1.32.0": "Copy LOP file: ONE click covers every borrower — per-borrower tables, soft credit gets fresh pull, pre-credit verify.",
    "1.31.2": "Copy LOP file BUG FIX: credit-report tabs you open manually are no longer auto-closed + CR02 error context added.",
    "1.31.1": "Copy LOP file: save before credit reissue + asset borrower picker now drives the combobox + employment income subtable wait.",
    "1.31.0": "Copy LOP file: NEW auto-reads CoreLogic ref ID + auto-adds rows for Addresses, Employment, Income, Assets, Gifts, Real Estate.",
    "1.30.2": "Copy LOP file: deep console logging — every field decision (written / skipped / no match) shown in DevTools.",
    "1.30.1": "Copy LOP file: progress overlay during paste with per-pass + credit-reissue status.",
    "1.30.0": "Copy LOP file: NEW auto-reissue credit on paste + full row data captured for every Full App table.",
    "1.29.3": "Copy LOP file: full row data now captured for tables (addresses, employment, income, assets, gifts, real estate). Auto-fill of the + Add forms is the next step.",
    "1.29.2": "Copy LOP file: bar now lives inline in the subnav, right after the Premier Agent tab.",
    "1.29.1": "Copy LOP file: bar moved to top, Loan & Property skipped, cascading fields (Decl A1/A2/A3) fix, picker shows borrower names.",
    "1.29.0": "New: Copy LOP file — stage every Full App field on the source loan, paste it into a new file. Co-borrower aware.",
    "1.28.3": "ZHL Comparison PDF: itemized closing costs in two columns — each scenario now fits on a single page.",
    "1.28.2": "ZHL Comparison PDF: no more blank pages, itemized costs restyled in ZHL blue to match page 1.",
    "1.28.1": "ZHL Comparison PDF: page 2 now includes the full itemized closing-cost breakdown for every scenario.",
    "1.28.0": "New: ZHL Comparison PDF on the Scenarios page — seller credit broken out, bigger monthly + cash, page 2 cost summary.",
    "1.27.4": "Max-PP estimator: BIG MATH FIX — holds down payment $ fixed (not %) + pill stops shifting until Run pricing.",
    "1.27.3": "Max-PP estimator: decomposes taxes/HOI/HOA properly + warns when estimate crosses conforming limit into jumbo.",
    "1.27.2": "Max-PP pill now reads \"Est.\" with a ⚠ — confirm AUS approval at the new price before quoting.",
    "1.27.1": "Max-purchase-price pill: bumped up to a readable size.",
    "1.27.0": "New: max-purchase-price pill in Eligibility Details — back-solves to the DTI cap for each loan type.",
    "1.26.8": "FHA Flip Rule: stop reading the borrower's residence as the subject property address.",
    "1.26.7": "FHA Flip Rule: lookup-failure diagnostics now visible in the page console.",
    "1.26.6": "FHA Flip Rule: Subject Property address now auto-detected on the Full Application page.",
    "1.26.5": "FHA Flip Rule: Zillow auto-fill now actually pulls the sale date (parser fix).",
    "1.26.3": "FHA Flip Rule: pill click now works even when LOP re-renders Loan Details.",
    "1.26.2": "FHA Flip Rule: clicking the pill now reliably opens the popup.",
    "1.26.1": "FHA Flip Rule is now a compact pill (click for details) + better Zillow parsing.",
    "1.26.0": "FHA Flip Rule card now auto-reads the address and auto-fills last sold date from Zillow.",
    "1.25.1": "Loan amount field fix — typing now actually updates LOP's pricing engine.",
    "1.25.0": "New: FHA 90-Day Flip Rule checker under Loan Details on the right rail.",
    "1.24.0": "Drag Gmail attachments straight into Slack — now works on slack.com.",
    "1.23.4": "Gmail compose fix: scrollbar no longer disappears when typing past the visible area.",
    "1.23.3": "FHA Analyzer fix: cash reserves now subtract cash-to-close from total assets.",
    "1.23.2": "BUG FIX: VA Calc was filling 'VA total deductions' with too much, causing DU to report wrong residual income. Re-run on open files.",
    "1.23.1": "FHA Analyzer: auto-evaluates VA residual income + tier ✓/✗ now reflects comp-factor count.",
    "1.23.0": "New: one-click FHA Manual UW analyzer with ✓/✗ on every check.",
    "1.22.1": "VA Calc: enter square footage instead of doing the maintenance math yourself.",
    "1.22.0": "Plain-English changelog + a karma link to my Zall Wall on every update screen.",
    "1.21.4": "The Walkthrough's 'New features' section now lists the freshest items first.",
    "1.21.3": "Mark All As Read now catches unread messages scrolled out of view.",
    "1.21.2": "Mark All As Read: accurate counts and a cleaner look during the run.",
    "1.21.1": "Several Salesforce features now work across multiple open Lead tabs.",
    "1.21.0": "New: one-click Mark All As Read button in the Salesforce Messaging panel.",
    "1.20.3": "Update toast 'View' button now opens reliably for users with ad blockers.",
    "1.20.2": "Update notification toast now actually appears after an update.",
    "1.20.0": "New: in-extension walkthrough page so you can find every feature.",
    "1.19.8": "Drag Gmail attachments straight into your inline reply.",
    "1.19.0": "New: FHA Manual eligibility pill + one-click Copy Addresses to co-borrower.",
    "1.18.0": "Branded 2-1 Buydown PDF + LO Profile auto-fills from Salesforce.",
    "1.15.0": "Warning banner when a Lead is FHA + Non-Permanent Resident Alien.",
    "1.12.0": "FHA Collections / Disputed cumulative-cap badges on Liabilities."
  };

  // Justin's Zall Wall — shown as a karma link at the bottom of the toast.
  const ZALL_WALL_URL = 'https://zallwall.zillowgroup.com/justinca';

  const STORAGE_KEY = '_zhl_last_seen_version';
  const TOAST_ID = 'zhl-update-toast';
  const AUTO_DISMISS_MS = 14000;
  const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';

  console.log('[Update Toast v' + VERSION + '] loaded');

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: event, props: props || {} }); } catch (_) {}
  }

  // Only show on top-level frames — don't double-toast in nested iframes.
  if (window.top !== window.self) {
    console.log('[Update Toast] in iframe, skipping');
    return;
  }

  // Defer until DOM ready (we run at document_idle but Gmail can still
  // be assembling its shell when we fire — wait until body is there).
  function whenBodyReady(cb) {
    if (document.body) return cb();
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  }

  whenBodyReady(function () {
    chrome.storage.local.get([STORAGE_KEY], function (data) {
      const last = data && data[STORAGE_KEY];
      // Same version already seen — nothing to do.
      if (last === VERSION) {
        console.log('[Update Toast] last seen version is current (' + VERSION + ') — not showing');
        return;
      }
      // No stored version: either a fresh install (handled by
      // chrome.runtime.onInstalled which stamps the key before any
      // content script runs) OR an existing user upgrading from
      // before the toast feature existed. In the latter case we
      // SHOULD show the toast. Fresh installs will have already
      // been stamped by background.js's onInstalled handler, so
      // they'll hit the early-return above and skip this branch.
      console.log('[Update Toast] showing — lastSeen=' + (last || '<none>') + ' current=' + VERSION);
      showToast(last || 'previous version');
    });
  });

  function showToast(prevVersion) {
    if (document.getElementById(TOAST_ID)) return;
    const headline = CHANGELOG_HEADLINES[VERSION] || ('Updated from v' + prevVersion + ' to v' + VERSION + '.');

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('style', [
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647',
      'max-width: 360px',
      'background: #ffffff',
      'border: 1px solid #d1d5db',
      'border-left: 4px solid #0b5cab',
      'border-radius: 8px',
      'box-shadow: 0 8px 24px rgba(0,0,0,.18)',
      'padding: 14px 16px',
      'font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'color: #111',
      'opacity: 0',
      'transform: translateY(8px)',
      'transition: opacity .2s, transform .2s'
    ].join(';'));

    const header = document.createElement('div');
    header.setAttribute('style', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
    const badge = document.createElement('span');
    badge.textContent = 'NEW';
    badge.setAttribute('style', 'background:#16a34a;color:#fff;font:700 10px/1.2 Arial,sans-serif;letter-spacing:.04em;padding:2px 6px;border-radius:3px;');
    const ver = document.createElement('strong');
    ver.textContent = 'ZHL Pack v' + VERSION;
    ver.style.cssText = 'color:#0b5cab;';
    const closeX = document.createElement('button');
    closeX.textContent = '×';
    closeX.setAttribute('aria-label', 'Dismiss');
    closeX.setAttribute('style', 'margin-left:auto;background:transparent;border:none;font:400 18px/1 sans-serif;color:#6b7280;cursor:pointer;padding:0 4px;');
    closeX.addEventListener('click', function () { dismiss('x'); });
    header.appendChild(badge);
    header.appendChild(ver);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.textContent = headline;
    body.setAttribute('style', 'margin-bottom:10px;');

    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end;');

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.setAttribute('style', 'background:transparent;border:none;color:#6b7280;font:500 12px/1.2 Arial,sans-serif;cursor:pointer;padding:6px 10px;border-radius:4px;');
    dismissBtn.addEventListener('click', function () { dismiss('dismiss'); });

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View what’s new';
    viewBtn.setAttribute('style', 'background:#0b5cab;border:none;color:#fff;font:600 12px/1.2 Arial,sans-serif;cursor:pointer;padding:7px 12px;border-radius:4px;');
    viewBtn.addEventListener('click', function () {
      track('update_toast_clicked', { from: prevVersion, to: VERSION });
      // Route the tab-open through the SW. Some users have uBlock /
      // privacy extensions that block content-script window.open() to
      // chrome-extension:// URLs (the same target works fine when
      // clicked from a normal anchor on the setup page). chrome.tabs
      // .create from the SW bypasses that block.
      // No #whats-new hash — the walkthrough auto-scrolls to a hash if
      // present, and users prefer landing at the top of the page so
      // they see the karma banner + the freshest NEW cards first.
      const url = chrome.runtime.getURL('walkthrough.html?from=update_toast');
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url }, function () {
          // Best-effort fallback if SW didn't respond — try direct.
          if (chrome.runtime.lastError) {
            try { window.open(url, '_blank'); } catch (_) {}
          }
        });
      } catch (_) {
        try { window.open(url, '_blank'); } catch (__) {}
      }
      stampSeen();
      removeToast();
    });

    actions.appendChild(dismissBtn);
    actions.appendChild(viewBtn);

    // Karma footer — a small "💛 Like what you see? Drop karma" line
    // with a clickable link to Justin's Zall Wall. Opened via the SW
    // (same path as the View button) so adblockers don't intercept
    // window.open from a content script.
    const karma = document.createElement('div');
    karma.setAttribute('style',
      'margin-top:10px;padding-top:10px;border-top:1px dashed #e5e7eb;' +
      'font:500 11.5px/1.4 Arial,sans-serif;color:#6b7280;text-align:center;');
    karma.innerHTML = 'Built by <strong>Justin Case</strong>. Like the pack? ' +
      '<a href="' + ZALL_WALL_URL + '" target="_blank" rel="noopener" ' +
      'style="color:#0b5cab;text-decoration:underline;font-weight:600;" ' +
      'data-zhl-karma-link="1">Drop me karma 💛</a>';
    // Route the karma link through the SW too — same adblocker
    // resilience as the View button.
    const karmaLink = karma.querySelector('a[data-zhl-karma-link]');
    if (karmaLink) {
      karmaLink.addEventListener('click', function (e) {
        e.preventDefault();
        track('karma_link_clicked', { source: 'update_toast', version: VERSION });
        try {
          chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: ZALL_WALL_URL }, function () {
            if (chrome.runtime.lastError) {
              try { window.open(ZALL_WALL_URL, '_blank'); } catch (_) {}
            }
          });
        } catch (_) {
          try { window.open(ZALL_WALL_URL, '_blank'); } catch (__) {}
        }
      });
    }

    toast.appendChild(header);
    toast.appendChild(body);
    toast.appendChild(actions);
    toast.appendChild(karma);
    toast.title = 'Built by Justin Case. Karma appreciated 💛';
    document.body.appendChild(toast);

    // Animate in.
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    track('update_toast_shown', { from: prevVersion, to: VERSION });

    const autoDismissTimer = setTimeout(function () { dismiss('auto'); }, AUTO_DISMISS_MS);

    function dismiss(reason) {
      clearTimeout(autoDismissTimer);
      track('update_toast_dismissed', { from: prevVersion, to: VERSION, reason: reason });
      stampSeen();
      removeToast();
    }
  }

  function stampSeen() {
    chrome.storage.local.set({ [STORAGE_KEY]: VERSION });
  }

  function removeToast() {
    const t = document.getElementById(TOAST_ID);
    if (!t) return;
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(function () { try { t.remove(); } catch (_) {} }, 250);
  }
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
