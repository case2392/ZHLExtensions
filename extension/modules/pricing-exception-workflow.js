// ZHL Productivity Pack module — feature key: feature_pricingExceptionWorkflow
//
// Adds a "Pricing Exception Workflow" button to LOP's loan toolbar (next to
// Copy LOP file / Stage / Paste-from-staged). Click → opens a guided
// multi-step modal that walks the LO through the PE submission checklist
// per the manager's spec:
//
//   Q: Is this loan locked?
//      Yes → Imported pricing? → Comp PE fields? → No lock-diff alert? →
//            Comp LE in eFolder? → < 2.5 pts? →
//              under 2.5: email RM "ZG#### is ready for PE request"
//              over  2.5: surface 3 justification questions, include in email
//      No  → Updated scenario assigned? → Comp LE on tasks? →
//            Enter ZHL + Comp pricing details → compute PE $ + points →
//            < 2.5 pts? → same email branches
//
// Output is a previewable email body the LO can Copy or Open in mail.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_pricingExceptionWorkflow';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Pricing Exception Workflow v' + VERSION + '] loaded');

  const ZHL_TIP    = 'Built by Justin Case. Karma appreciated 💛';
  const BUTTON_ID  = 'zhl-pe-workflow-btn';
  const MODAL_ID   = 'zhl-pe-workflow-modal';
  const STORAGE_KEY_RM = 'zhlPeWorkflowRmEmail';

  // ---- helpers ------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function parseNum(s) {
    if (s == null) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function formatMoney(n) {
    if (n == null || isNaN(n)) n = 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatPctDisplay(n) {
    return (Math.round(Number(n) * 1000) / 1000).toFixed(3) + '%';
  }

  // ---- page data extraction -----------------------------------------------
  function extractBorrowerNames() {
    // Look for the "X Primary borrower" / "X Co-borrower" labels in the
    // borrower header. Falls back to empty if not on a page that shows them.
    const out = { primary: '', coborrower: '' };
    try {
      const all = document.querySelectorAll('span, div');
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (/Primary borrower$/i.test(t) && el.previousSibling) {
          const name = (el.previousSibling.textContent || '').trim();
          if (name && !out.primary) out.primary = name;
        }
        if (out.primary && out.coborrower) break;
      }
      // Fallback: scan for tab labels like "Mark Malone & Sarah Malone"
      if (!out.primary) {
        const tab = document.querySelector('[role="tab"][aria-selected="true"], [class*="tab"][aria-selected="true"]');
        if (tab) {
          const txt = (tab.textContent || '').trim();
          const m = txt.match(/^([^&]+?)(?:\s*&\s*(.+))?$/);
          if (m) {
            out.primary    = (m[1] || '').trim();
            out.coborrower = (m[2] || '').trim();
          }
        }
      }
    } catch (_) {}
    return out;
  }

  function extractLoanIdFromUrl() {
    const m = location.pathname.match(/\/loan-officer-portal\/([a-f0-9-]{8,})/i);
    return m ? m[1] : '';
  }

  // LOP shows the Encompass ZG# in a span near the borrower name
  // ("#ZG001260248246"). Pull it so the email auto-uses the ZG# instead of
  // the LOP UUID.
  function extractZgNumberFromDom() {
    try {
      const all = document.querySelectorAll('span, a, button');
      for (const el of all) {
        if (el.children && el.children.length > 0) continue; // leaf only
        const t = (el.textContent || '').trim();
        const m = t.match(/^#?(ZG\d{6,})$/i);
        if (m) return m[1].toUpperCase();
      }
    } catch (_) {}
    return '';
  }

  // Walk LOP's "Loan Details" right-rail card and return a { label: value }
  // map. Each row is a <div> with a <span> label and a <p> value (sometimes
  // wrapped in a <button>). Lets us pre-fill purchase price / loan amount /
  // rate / loan type into the unlocked-path comp pricing form.
  function extractLoanDetails() {
    const out = {};
    try {
      const headings = document.querySelectorAll('h6, h5, h4');
      let host = null;
      for (const h of headings) {
        if (/^\s*loan\s*details\s*$/i.test((h.textContent || '').replace(/\s+/g, ' '))) {
          // Walk up to a container that holds the grid of rows.
          let p = h.parentElement;
          for (let i = 0; i < 5 && p; i++) {
            if (p.querySelector('[class*="Grid"]')) { host = p; break; }
            p = p.parentElement;
          }
          if (!host) host = h.parentElement && h.parentElement.parentElement;
          break;
        }
      }
      if (!host) return out;
      const rows = host.querySelectorAll('div');
      for (const row of rows) {
        const span = row.querySelector(':scope > span');
        const valueEl = row.querySelector(':scope > p, :scope > button > p');
        if (!span || !valueEl) continue;
        const label = (span.textContent || '').trim();
        const value = (valueEl.textContent || '').trim();
        if (label && value && !out[label]) out[label] = value;
      }
    } catch (_) {}
    return out;
  }

  // ---- Closing-costs popup scrape -----------------------------------------
  // LOP's Loan Details card has a "Total closing costs" link that opens a
  // "Detailed cost summary" dialog. Inside, the "Lender costs" section's
  // Total = LE Section A (Box A) — discount points + origination fee — and
  // the "Credits" section's "Lender credit" is the lender credit value.
  // We click the link, wait for the dialog, scrape, then close it. To
  // avoid a visible flash we inject CSS that hides any LOP dialog while
  // the scrape runs.
  function findClosingCostsButton() {
    try {
      const headings = document.querySelectorAll('h6');
      let host = null;
      for (const h of headings) {
        if (/^\s*loan\s*details\s*$/i.test((h.textContent || '').replace(/\s+/g, ' '))) {
          host = h.closest('div').parentElement;
          let p = h.parentElement;
          for (let i = 0; i < 6 && p; i++) {
            if (p.querySelectorAll('button').length > 0) { host = p; break; }
            p = p.parentElement;
          }
          break;
        }
      }
      if (!host) return null;
      const rows = host.querySelectorAll('div');
      for (const row of rows) {
        const span = row.querySelector(':scope > span');
        if (!span) continue;
        const t = (span.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^total\s*closing\s*costs$/i.test(t)) {
          return row.querySelector('button');
        }
      }
    } catch (_) {}
    return null;
  }

  function scrapeClosingCostsDialog(dialog) {
    const out = { boxA: 0, lenderCredits: 0 };
    try {
      // We walk through the rows; track which section we're in by header
      // text. The Lender costs section's Total row is Box A. The Credits
      // section's "Lender credit" row is the lender credit.
      const all = dialog.querySelectorAll('span');
      const arr = [];
      for (const s of all) arr.push((s.textContent || '').replace(/\s+/g, ' ').trim());
      let section = null;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (/^lender\s*costs$/i.test(t))                                  { section = 'lender_costs'; continue; }
        if (/^fees\s+you\s+cannot\s+shop\s+for$/i.test(t))                { section = 'other_loan';   continue; }
        if (/^third[-\s]?party\s+costs$/i.test(t))                        { section = 'other_loan';   continue; }
        if (/^other\s+costs$/i.test(t))                                   { section = 'other';        continue; }
        if (/^taxes\s+and\s+other\s+government\s+fees$/i.test(t))         { section = 'taxes';        continue; }
        if (/^prepaids$/i.test(t))                                        { section = 'prepaids';     continue; }
        if (/^initial\s+escrow\s+payment\s+at\s+closing$/i.test(t))       { section = 'escrow';       continue; }
        if (/^credits$/i.test(t))                                         { section = 'credits';      continue; }
        if (section === 'lender_costs' && /^total$/i.test(t)) {
          out.boxA = parseNum(arr[i + 1] || '');
          section = null;
        }
        if (section === 'credits' && /^lender\s*credit$/i.test(t)) {
          out.lenderCredits = Math.abs(parseNum(arr[i + 1] || ''));
        }
      }
    } catch (_) {}
    return out;
  }

  function findCloseButton(dialog) {
    if (!dialog) return null;
    // Walk up to the dialog root to find the close button. We match four
    // patterns LOP uses across components:
    //   1. aria-label containing "close" or "dismiss" (icon-only X button)
    //   2. a VisuallyHidden child <span>Close</span> (LOP's a11y pattern
    //      where the icon button has a screen-reader-only label inside)
    //   3. a visible text button with label "Close" (the blue button at
    //      the bottom-right of the Detailed cost summary popup)
    //   4. literal × / X / ✕ characters as fallback
    let root = dialog;
    for (let i = 0; i < 8 && root; i++) {
      const cands = root.querySelectorAll('button');
      for (const b of cands) {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (/\b(close|dismiss)\b/.test(aria)) return b;
        const vh = b.querySelector('[class*="VisuallyHidden"]');
        if (vh && /^\s*close\s*$/i.test(vh.textContent || '')) return b;
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^close$/i.test(t)) return b;
        if (t === '×' || t === 'X' || t === '✕') return b;
      }
      root = root.parentElement;
    }
    return null;
  }

  // Walk up until we hit an ancestor with position:fixed. That's typically
  // the topmost modal container (overlay + backdrop) — hiding it via inline
  // style is more reliable than CSS-injection rules vs LOP's own stacking.
  function findFixedAncestor(el) {
    let n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      try {
        const cs = window.getComputedStyle(n);
        if (cs && cs.position === 'fixed') return n;
      } catch (_) {}
      n = n.parentElement;
    }
    return null;
  }
  function clickWithMouseEvents(el) {
    try {
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window, button: 0
        }));
      });
    } catch (_) {
      try { el.click(); } catch (_) {}
    }
  }

  // Returns a Promise resolving to { boxA, lenderCredits } (zeros on failure).
  function extractClosingCostsViaPopup() {
    return new Promise(function (resolve) {
      const trigger = findClosingCostsButton();
      if (!trigger) { resolve({ boxA: 0, lenderCredits: 0 }); return; }

      // Belt: CSS injection covers the case where the dialog renders before
      // our polling sees it. Suspenders: inline visibility on the fixed
      // ancestor once we find the dialog (more reliable vs LOP's stacking).
      const styleEl = document.createElement('style');
      styleEl.id = 'zhl-pe-hide-dialog';
      styleEl.textContent =
        '[role="dialog"]:not([id^="zhl-"]), ' +
        '[class*="DialogBody"]:not([id^="zhl-"]), ' +
        '[class*="DialogOverlay"]:not([id^="zhl-"]), ' +
        '[class*="ModalOverlay"]:not([id^="zhl-"]), ' +
        '[class*="Backdrop"]:not([id^="zhl-"]) { ' +
          'visibility:hidden !important; opacity:0 !important; ' +
        '}';
      document.head.appendChild(styleEl);
      let hiddenInline = null;
      function cleanup() {
        try { styleEl.remove(); } catch (_) {}
        if (hiddenInline) {
          try { hiddenInline.el.style.cssText = hiddenInline.prev; } catch (_) {}
          hiddenInline = null;
        }
      }

      clickWithMouseEvents(trigger);

      const start = Date.now();
      const poll = setInterval(function () {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"], [class*="DialogBody"]'))
          .find(function (d) { return /lender\s*costs/i.test(d.textContent || ''); });
        if (dialog) {
          clearInterval(poll);
          // Scrape BEFORE we hide / close so neither styling nor a slow
          // close transition can race the read.
          const values = scrapeClosingCostsDialog(dialog);
          // Hide via inline style on the topmost fixed ancestor — beats
          // LOP's specificity and any animations.
          const fixedRoot = findFixedAncestor(dialog);
          if (fixedRoot) {
            hiddenInline = { el: fixedRoot, prev: fixedRoot.getAttribute('style') || '' };
            fixedRoot.style.setProperty('visibility', 'hidden', 'important');
            fixedRoot.style.setProperty('opacity', '0', 'important');
          }
          // Find and click the Close button via full mouse events (some
          // React click handlers ignore a bare .click()).
          const closeBtn = findCloseButton(dialog);
          if (closeBtn) {
            clickWithMouseEvents(closeBtn);
          } else {
            try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } catch (_) {}
          }
          // Give LOP a moment to remove the dialog from the DOM, then
          // clean up our styles. We use a slight delay because LOP's
          // close-then-unmount sequence can take ~200ms.
          setTimeout(function () { cleanup(); resolve(values); }, 250);
          return;
        }
        if (Date.now() - start > 4000) {
          clearInterval(poll);
          cleanup();
          resolve({ boxA: 0, lenderCredits: 0 });
        }
      }, 80);
    });
  }

  // Map LOP's "Product name" (e.g. "Conf Home Poss 30 Yr Fixed", "FHA 30 Yr
  // Fixed", "VA 30 Yr ARM 5/6") onto the form's Loan type + FRM/ARM selects.
  function deriveLoanTypeFromProduct(productName) {
    const p = (productName || '').toLowerCase();
    if (!p) return { loanType: 'Conventional', armOrFrm: 'FRM' };
    let loanType = 'Conventional';
    if (/\bfha\b/.test(p))         loanType = 'FHA';
    else if (/\bva\b/.test(p))     loanType = 'VA';
    else if (/\busda\b/.test(p))   loanType = 'USDA';
    else if (/\bjumbo\b/.test(p))  loanType = 'Jumbo';
    else if (/\bconf?\b|\bconv\b|\bconventional\b|home\s*poss|home\s*ready/.test(p)) loanType = 'Conventional';
    const armOrFrm = /\barm\b|\d+\/\d+/.test(p) ? 'ARM'
                    : /\bfixed\b|\bfrm\b/.test(p) ? 'FRM'
                    : 'FRM';
    return { loanType: loanType, armOrFrm: armOrFrm };
  }

  // ---- Scenario details snip capture --------------------------------------
  // The RM team requires a snip of the assigned scenario's "View details"
  // modal attached to the PE email. This helper does it programmatically:
  // find the ASSIGNED TO LOAN card → click its three-dots → click "View
  // details" → wait for the modal → capture the visible tab → crop to the
  // modal's bounding box → save as PNG to the user's Downloads folder.
  // The PE modal is hidden during capture so the screenshot only contains
  // the View details modal (not the PE workflow's own overlay on top of it).
  function peSnipWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function findAssignedScenarioCard() {
    // The ASSIGNED TO LOAN label is a <span> with that exact text. Walk up
    // until we hit a container that ALSO holds a three-dots button.
    const labels = document.querySelectorAll('span');
    for (const span of labels) {
      const t = (span.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!/ASSIGNED TO LOAN/.test(t)) continue;
      let node = span.parentElement;
      while (node && node !== document.body) {
        if (findThreeDotsButton(node)) return node;
        node = node.parentElement;
      }
    }
    return null;
  }

  function findThreeDotsButton(scope) {
    // The three-dots icon is an inline SVG with 3 <circle> elements at
    // cy=16, r=3, cx=7/16/25. We match on that geometry so we don't tie
    // ourselves to c11n's hashed class names.
    const buttons = scope.querySelectorAll('button');
    for (const btn of buttons) {
      const circles = btn.querySelectorAll('svg circle');
      if (circles.length !== 3) continue;
      let ok = true;
      for (const c of circles) {
        if (c.getAttribute('cy') !== '16' || c.getAttribute('r') !== '3') { ok = false; break; }
      }
      if (ok) return btn;
    }
    return null;
  }

  async function clickViewDetailsMenuItem(maxMs) {
    const max = maxMs || 1500;
    const start = Date.now();
    while (Date.now() - start < max) {
      const items = document.querySelectorAll('button[role="menuitem"]');
      for (const item of items) {
        if (/^view\s*details$/i.test((item.textContent || '').trim())) {
          item.click();
          return true;
        }
      }
      await peSnipWait(50);
    }
    return false;
  }

  async function waitForScenarioDetailsModal(maxMs) {
    const max = maxMs || 3000;
    const start = Date.now();
    while (Date.now() - start < max) {
      const dialogs = document.querySelectorAll('section[role="dialog"][aria-modal="true"]');
      for (const d of dialogs) {
        const h = d.querySelector('header h4');
        if (h && /scenario\s*details/i.test(h.textContent || '')) return d;
      }
      await peSnipWait(80);
    }
    return null;
  }

  function closeScenarioDetailsModal(modal) {
    // Try the X close button first (top-right), then the footer Close.
    const closeBtns = modal.querySelectorAll('button');
    for (const b of closeBtns) {
      const hidden = b.querySelector('.VisuallyHidden-c11n-8-111-2__sc-t8tewe-0, [class*="VisuallyHidden"]');
      if (hidden && /close/i.test(hidden.textContent || '')) { b.click(); return true; }
    }
    for (const b of closeBtns) {
      if (/^close$/i.test((b.textContent || '').trim())) { b.click(); return true; }
    }
    return false;
  }

  async function captureModalAsPng(modal, filename) {
    const rect = modal.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const capture = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'ZHL_PE_CAPTURE_VISIBLE_TAB' }, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, reason: 'no response' });
        }
      });
    });
    if (!capture.ok) throw new Error('captureVisibleTab failed: ' + capture.reason);
    const img = new Image();
    await new Promise(function (resolve, reject) {
      img.onload = resolve;
      img.onerror = function () { reject(new Error('failed to decode captured PNG')); };
      img.src = capture.dataUrl;
    });
    // captureVisibleTab returns pixels at the device-pixel resolution. Map
    // the CSS-pixel rect into device-pixel coords with devicePixelRatio.
    const sx = Math.max(0, Math.round(rect.left * dpr));
    const sy = Math.max(0, Math.round(rect.top  * dpr));
    const sw = Math.min(img.width  - sx, Math.round(rect.width  * dpr));
    const sh = Math.min(img.height - sy, Math.round(rect.height * dpr));
    if (sw <= 0 || sh <= 0) throw new Error('modal is offscreen; cannot crop');
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedDataUrl = canvas.toDataURL('image/png');
    const dl = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({
        type: 'ZHL_PE_DOWNLOAD_PNG',
        dataUrl: croppedDataUrl,
        filename: filename
      }, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, reason: 'no response' });
        }
      });
    });
    if (!dl.ok) throw new Error('download failed: ' + dl.reason);
    return { downloadId: dl.downloadId, filename: filename };
  }

  // Click a nav link / tab by its exact (trimmed, whitespace-collapsed)
  // text content. Returns the element if found-and-clicked, else null.
  // Used to drive the SPA to the Scenarios tab when the LO triggers the
  // PE workflow from a different page (Full application, Pricing, etc.).
  function clickNavByText(text) {
    const candidates = document.querySelectorAll('a, button');
    for (const c of candidates) {
      if (c.offsetParent === null) continue; // not visible
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === text) { c.click(); return c; }
    }
    return null;
  }

  // The Scenarios sub-tab usually renders as "N Scenarios" (with a count
  // prefix) or just "Scenarios". Match either.
  function clickScenariosSubTab() {
    const candidates = document.querySelectorAll('a, button');
    for (const c of candidates) {
      if (c.offsetParent === null) continue;
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^\d*\s*Scenarios$/i.test(t) && t !== 'Pricing & Scenarios') {
        c.click();
        return c;
      }
    }
    return null;
  }

  async function navigateToScenariosTabIfNeeded() {
    // Already on a page where the assigned card is mounted — nothing to do.
    if (findAssignedScenarioCard()) return { navigated: false, ok: true };
    // Step 1: top-nav → Pricing & Scenarios.
    const ps = clickNavByText('Pricing & Scenarios');
    if (ps) await peSnipWait(450);
    // Step 2: sub-tab → Scenarios (in case the top-nav landed on the
    // Pricing sub-tab by default).
    clickScenariosSubTab();
    await peSnipWait(450);
    // Wait up to 5s for the ASSIGNED TO LOAN card to appear.
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (findAssignedScenarioCard()) return { navigated: true, ok: true };
      await peSnipWait(150);
    }
    return { navigated: true, ok: false };
  }

  async function captureAssignedScenarioSnip(zgNumber) {
    console.group('[ZHL PE Snip] capturing assigned scenario');
    // Hide the PE workflow modal so the captured screenshot shows only
    // the View details modal underneath. We use visibility:hidden so the
    // overlay's layout / scroll position is preserved while we're hidden.
    const peOverlay = document.getElementById(MODAL_ID);
    const prevVisibility = peOverlay ? peOverlay.style.visibility : '';
    if (peOverlay) peOverlay.style.visibility = 'hidden';
    let modalOpened = null;
    try {
      // If we're not on Scenarios, drive the SPA there first. We don't
      // navigate back afterwards — the LO is about to open Gmail anyway,
      // and history.back() in LOP's SPA is unreliable. The LO can
      // navigate back to Full application themselves when they return.
      const nav = await navigateToScenariosTabIfNeeded();
      if (!nav.ok) {
        return { ok: false, reason: 'Could not navigate to the Scenarios tab — no ASSIGNED TO LOAN card appeared after 5s.' };
      }
      const card = findAssignedScenarioCard();
      if (!card) {
        return { ok: false, reason: 'No "ASSIGNED TO LOAN" scenario found after navigating to Scenarios.' };
      }
      const dots = findThreeDotsButton(card);
      if (!dots) {
        return { ok: false, reason: 'Three-dots menu button not found on the assigned scenario card' };
      }
      dots.click();
      const clicked = await clickViewDetailsMenuItem(1500);
      if (!clicked) {
        return { ok: false, reason: 'View details menu item did not appear after clicking the three-dots' };
      }
      modalOpened = await waitForScenarioDetailsModal(3000);
      if (!modalOpened) {
        return { ok: false, reason: 'Scenario details modal did not render within 3s' };
      }
      // Settle: let any open animation finish before capturing.
      await peSnipWait(350);
      const safeZg = String(zgNumber || '').replace(/[^A-Za-z0-9_-]/g, '');
      const stamp  = (safeZg || new Date().toISOString().slice(0, 10).replace(/-/g, ''));
      const filename = 'Scenario_Details_' + stamp + '.png';
      const result = await captureModalAsPng(modalOpened, filename);
      return { ok: true, filename: result.filename, downloadId: result.downloadId };
    } catch (e) {
      console.error('[ZHL PE Snip] failed:', e);
      return { ok: false, reason: (e && e.message) || String(e) };
    } finally {
      if (modalOpened) {
        try { closeScenarioDetailsModal(modalOpened); } catch (_) {}
      }
      if (peOverlay) peOverlay.style.visibility = prevVisibility;
      console.groupEnd();
    }
  }

  // ---- button injection ---------------------------------------------------
  function findToolbarHost() {
    // Strategy 1: look for the "Paste from staged" button and use its parent.
    const buttons = document.querySelectorAll('button, a');
    for (const b of buttons) {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Paste from staged$/i.test(t)) return b.parentElement;
      if (/^Stage from this file$/i.test(t)) return b.parentElement;
    }
    // Strategy 2: find "Copy LOP file" text and use its container.
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Copy LOP file:?$/i.test(t)) return el.parentElement;
    }
    return null;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const host = findToolbarHost();
    if (!host) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Walk through the Pricing Exception submission checklist and generate the RM email.\n\n' + ZHL_TIP;
    btn.style.cssText = [
      'margin-left:10px',
      'padding:6px 12px',
      'background:#fff',
      'color:#b45309',
      'border:1px solid #b45309',
      'border-radius:4px',
      'font:600 12px/1.2 Arial, Helvetica, sans-serif',
      'cursor:pointer',
      'vertical-align:middle'
    ].join(';');
    btn.textContent = '⚖ Pricing Exception Workflow';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#fef3c7'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#fff'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openWorkflow();
    });
    host.appendChild(btn);
  }

  // ---- modal --------------------------------------------------------------
  let workflowState = null;

  function defaultState() {
    const names = extractBorrowerNames();
    const details = extractLoanDetails();
    const productMap = deriveLoanTypeFromProduct(details['Product name'] || '');
    return {
      step: 'start',
      history: [],
      locked: null,             // true | false
      borrowerName: names.primary || '',
      coborrowerName: names.coborrower || '',
      loName: '',               // set in openWorkflow() from chrome.storage
      loanId: extractLoanIdFromUrl(),
      loanLink: location.href,
      zgNumber: extractZgNumberFromDom(),
      // unlocked-path comp details — pre-filled from LOP's Loan Details
      // right-rail card when available.
      purchasePrice: parseNum(details['Purchase price']),
      loanAmount:    parseNum(details['Total loan amt.'] || details['Base loan amt.']),
      loanType:      productMap.loanType,
      armOrFrm:      productMap.armOrFrm,
      zhlRate:       parseNum(details['Interest Rate']),
      zhlBoxA:       0,
      zhlCredits:    0,
      compLender:    '',
      compRate:      0,
      compBoxA:      0,
      compCredits:   0,
      peDollars:     0,
      pePoints:      0,
      // big-PE answers
      reason:        '',
      expectations:  '',
      agentRel:      '',
      isOver25:      null,      // true | false (set at points-check)
      rmEmail:       ''
    };
  }

  function openWorkflow() {
    workflowState = defaultState();
    try {
      chrome.storage.local.get([STORAGE_KEY_RM, 'lo_name', '_zhl_tlm_user'], function (data) {
        workflowState.rmEmail = (data && data[STORAGE_KEY_RM]) || '';
        // LO name: prefer the explicit setup-page setting, fall back to
        // the Salesforce-captured identity name.
        const fromSetup = (data && data.lo_name) || '';
        const fromTlm   = (data && data._zhl_tlm_user && data._zhl_tlm_user.name) || '';
        workflowState.loName = fromSetup || fromTlm || '';
        renderModal();
      });
    } catch (_) { renderModal(); }
  }

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function renderModal() {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(0,0,0,0.45)',
      'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font:14px/1.4 Arial, Helvetica, sans-serif'
    ].join(';');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#fff',
      'border-radius:8px',
      'padding:20px 24px',
      'max-width:640px',
      'width:94%',
      'max-height:92vh',
      'overflow:auto',
      'box-shadow:0 14px 44px rgba(0,0,0,0.32)'
    ].join(';');

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">' +
        '<h3 style="margin:0;font-size:18px;color:#b45309;">⚖ Pricing Exception Workflow</h3>' +
        '<button id="zhl-pe-close" style="background:none;border:none;font-size:24px;color:#6b7280;cursor:pointer;line-height:1;padding:0 4px;margin-top:-4px;">×</button>' +
      '</div>' +
      '<div id="zhl-pe-body"></div>' +
      '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e5e7eb;padding-top:12px;">' +
        '<button id="zhl-pe-back" type="button" style="background:#fff;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;">← Back</button>' +
        '<span style="color:#6b7280;font-size:11px;font-style:italic;">' + ZHL_TIP + '</span>' +
      '</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector('#zhl-pe-close').addEventListener('click', closeModal);
    panel.querySelector('#zhl-pe-back').addEventListener('click', goBack);
    renderStep();
  }

  function renderStep() {
    const body = document.getElementById('zhl-pe-body');
    const backBtn = document.getElementById('zhl-pe-back');
    if (!body) return;
    backBtn.style.visibility = workflowState.history.length > 0 ? 'visible' : 'hidden';
    const renderer = STEPS[workflowState.step];
    if (!renderer) {
      body.innerHTML = '<p style="color:#b91c1c;">Unknown step: ' + escapeHtml(workflowState.step) + '</p>';
      return;
    }
    renderer(body);
  }

  function goTo(step) {
    workflowState.history.push(workflowState.step);
    workflowState.step = step;
    renderStep();
  }
  function goBack() {
    if (workflowState.history.length === 0) return;
    workflowState.step = workflowState.history.pop();
    renderStep();
  }

  // ---- step renderers -----------------------------------------------------
  function btnPrimary(label, id) {
    return '<button type="button" id="' + id + '" style="background:#0b5cab;color:#fff;border:1px solid #0b5cab;border-radius:4px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-right:8px;">' + escapeHtml(label) + '</button>';
  }
  function btnSecondary(label, id) {
    return '<button type="button" id="' + id + '" style="background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:4px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;margin-right:8px;">' + escapeHtml(label) + '</button>';
  }
  function htmlChoice(title, yesLabel, noLabel) {
    return '<h4 style="margin:0 0 16px;font-size:15px;color:#111827;">' + escapeHtml(title) + '</h4>' +
      '<div style="display:flex;gap:8px;">' +
        btnPrimary(yesLabel, 'zhl-pe-yes') +
        btnSecondary(noLabel, 'zhl-pe-no') +
      '</div>';
  }
  function htmlBlocker(title, helpText) {
    return '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">' + escapeHtml(title) + '</h4>' +
      '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:10px 12px;color:#78350f;font-size:13px;margin:10px 0;">' +
        '<strong>Action needed:</strong> ' + escapeHtml(helpText) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        btnPrimary('I\'ve done it — continue', 'zhl-pe-done') +
        btnSecondary('Close — I\'ll do this first', 'zhl-pe-cancel') +
      '</div>';
  }
  function makeCheckStep(question, blockerHelpIfNo, nextStep) {
    return function (body) {
      body.innerHTML = htmlChoice(question, 'Yes', 'Not yet');
      body.querySelector('#zhl-pe-yes').addEventListener('click', function () { goTo(nextStep); });
      body.querySelector('#zhl-pe-no').addEventListener('click', function () {
        body.innerHTML = htmlBlocker(question, blockerHelpIfNo);
        body.querySelector('#zhl-pe-done').addEventListener('click', function () { goTo(nextStep); });
        body.querySelector('#zhl-pe-cancel').addEventListener('click', closeModal);
      });
    };
  }

  const STEPS = {
    // --------- Q1: locked? ----------------------------------------------
    'start': function (body) {
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Is this loan currently locked?</h4>' +
        '<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">The required workflow differs depending on whether the loan is locked. Pick the matching path.</p>' +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Yes — locked', 'zhl-pe-yes') +
          btnSecondary('No — not locked', 'zhl-pe-no') +
        '</div>';
      body.querySelector('#zhl-pe-yes').addEventListener('click', function () {
        workflowState.locked = true; goTo('L-import-pricing');
      });
      body.querySelector('#zhl-pe-no').addEventListener('click', function () {
        workflowState.locked = false; goTo('U-assigned-scenario');
      });
    },

    // --------- LOCKED PATH ----------------------------------------------
    'L-import-pricing': makeCheckStep(
      'Have you imported current pricing?',
      'Import current pricing in Encompass before submitting the PE request.',
      'L-comp-pe-fields'
    ),
    'L-comp-pe-fields': makeCheckStep(
      'Have you completed the required Comp PE fields in ENC Lock / Pricing Screen?',
      'Fill in the Comp PE fields on the ENC Lock / Pricing Screen (comp rate, comp credits, etc.).',
      'L-lock-alert'
    ),
    'L-lock-alert': makeCheckStep(
      'Have you confirmed there is NO lock-difference alert?',
      'Resolve any lock-difference alert before submitting. If it persists, contact lock desk.',
      'L-comp-le'
    ),
    'L-comp-le': makeCheckStep(
      'Have you uploaded the Comp LE to the eFolder?',
      'Upload the competitor LE to the loan\'s eFolder so the RM and lock desk can review it.',
      'points-check'
    ),

    // --------- UNLOCKED PATH -------------------------------------------
    'U-assigned-scenario': makeCheckStep(
      'Have you assigned an updated scenario / pricing?',
      'Assign the borrower\'s scenario / pricing in Pricing & Scenarios before requesting a PE.',
      'U-enter-pricing'
    ),
    'U-enter-pricing': function (body) {
      const inputStyle = 'padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;width:100%;box-sizing:border-box;';
      const labelStyle = 'display:block;font-size:11px;color:#6b7280;margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;';
      const fieldWrap = 'margin-bottom:10px;';
      function field(name, label, value, type) {
        return '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">' + label + '</label>' +
          '<input id="' + name + '" type="text" ' + (type === 'select' ? '' : 'inputmode="decimal" ') +
          'value="' + escapeHtml(value) + '" style="' + inputStyle + '" /></div>';
      }
      function select(name, label, value, opts) {
        const options = opts.map(function (o) {
          return '<option value="' + escapeHtml(o) + '"' + (o === value ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
        }).join('');
        return '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">' + label + '</label>' +
          '<select id="' + name + '" style="' + inputStyle + '">' + options + '</select></div>';
      }
      const s = workflowState;
      const autofilled = s.purchasePrice > 0 || s.loanAmount > 0 || s.zhlRate > 0;
      body.innerHTML =
        '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">Enter ZHL + competitor pricing</h4>' +
        '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">' +
          (autofilled ? '<span style="color:#15803d;font-weight:600;">✓ Auto-filled from LOP&rsquo;s Loan Details card</span> — verify and complete the Box A / lender-credits fields. ' : '') +
          'Net cost = Box A charges − Lender credits. PE $ = (ZHL net cost − Comp net cost).' +
        '</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
          '<div>' + field('pe-purchase', 'Purchase price', s.purchasePrice || '') + field('pe-loan-amt', 'Loan amount', s.loanAmount || '') + '</div>' +
          '<div>' + select('pe-loan-type', 'Loan type', s.loanType, ['Conventional','FHA','VA','USDA','Jumbo']) +
                   select('pe-arm', 'FRM / ARM', s.armOrFrm, ['FRM','ARM']) + '</div>' +
        '</div>' +
        // Competitor lender name lives ABOVE the two pricing cards so the
        // card rows (Interest rate / Box A / Credits) line up across ZHL
        // and Competitor instead of being shifted down on the comp side.
        '<div style="margin-top:8px;">' +
          '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Competitor lender name</label>' +
            '<input id="pe-comp-lender" type="text" value="' + escapeHtml(s.compLender || '') +
            '" placeholder="e.g. Rocket, Better.com, local CU" style="' + inputStyle + '" /></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px;">' +
          '<div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;">' +
            '<div style="font-weight:700;color:#0b5cab;margin-bottom:6px;font-size:12px;">ZHL pricing</div>' +
            field('pe-zhl-rate',    'Interest rate %',         s.zhlRate    || '') +
            field('pe-zhl-boxa',    'Total Box A charges ($)', s.zhlBoxA    || '') +
            field('pe-zhl-credits', 'Lender + other credits ($)', s.zhlCredits || '') +
          '</div>' +
          '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:10px;">' +
            '<div style="font-weight:700;color:#b45309;margin-bottom:6px;font-size:12px;">Competitor</div>' +
            field('pe-comp-rate',    'Interest rate %',         s.compRate    || '') +
            field('pe-comp-boxa',    'Total Box A charges ($)', s.compBoxA    || '') +
            field('pe-comp-credits', 'Lender + other credits ($)', s.compCredits || '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          btnPrimary('Calculate PE', 'zhl-pe-calc') +
        '</div>';

      body.querySelector('#zhl-pe-calc').addEventListener('click', function () {
        const s = workflowState;
        s.purchasePrice = parseNum(body.querySelector('#pe-purchase').value);
        s.loanAmount    = parseNum(body.querySelector('#pe-loan-amt').value);
        s.loanType      = body.querySelector('#pe-loan-type').value;
        s.armOrFrm      = body.querySelector('#pe-arm').value;
        s.zhlRate       = parseNum(body.querySelector('#pe-zhl-rate').value);
        s.zhlBoxA       = parseNum(body.querySelector('#pe-zhl-boxa').value);
        s.zhlCredits    = parseNum(body.querySelector('#pe-zhl-credits').value);
        s.compLender    = (body.querySelector('#pe-comp-lender').value || '').trim();
        s.compRate      = parseNum(body.querySelector('#pe-comp-rate').value);
        s.compBoxA      = parseNum(body.querySelector('#pe-comp-boxa').value);
        s.compCredits   = parseNum(body.querySelector('#pe-comp-credits').value);
        const zhlNet  = s.zhlBoxA  - s.zhlCredits;
        const compNet = s.compBoxA - s.compCredits;
        s.peDollars = zhlNet - compNet;
        s.pePoints  = s.loanAmount > 0 ? (s.peDollars / s.loanAmount) * 100 : 0;
        goTo('U-pe-result');
      });

      // Auto-fill ZHL Box A + lender credits from LOP's "Total closing
      // costs" popup if they're still empty. Opens/closes the popup
      // invisibly via injected CSS so the LO doesn't see a flash.
      if (!s.zhlBoxA && !s.zhlCredits) {
        const boxaInput = body.querySelector('#pe-zhl-boxa');
        const credInput = body.querySelector('#pe-zhl-credits');
        if (boxaInput && credInput) {
          boxaInput.placeholder    = 'Auto-filling from LOP…';
          credInput.placeholder    = 'Auto-filling from LOP…';
          extractClosingCostsViaPopup().then(function (vals) {
            if (vals && vals.boxA > 0) {
              s.zhlBoxA = vals.boxA;
              boxaInput.value = String(vals.boxA);
            } else {
              boxaInput.placeholder = '';
            }
            if (vals && (vals.lenderCredits || vals.lenderCredits === 0)) {
              s.zhlCredits = vals.lenderCredits;
              credInput.value = vals.lenderCredits > 0 ? String(vals.lenderCredits) : '';
            } else {
              credInput.placeholder = '';
            }
          }).catch(function () {
            boxaInput.placeholder = '';
            credInput.placeholder = '';
          });
        }
      }
    },
    'U-pe-result': function (body) {
      const s = workflowState;
      const isPositive = s.peDollars > 0;
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">PE amount calculation</h4>' +
        '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px;margin-bottom:14px;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#374151;">' +
            '<div>ZHL net cost (Box A − credits):</div><div style="text-align:right;">' + formatMoney(s.zhlBoxA - s.zhlCredits) + '</div>' +
            '<div>Comp net cost (Box A − credits):</div><div style="text-align:right;">' + formatMoney(s.compBoxA - s.compCredits) + '</div>' +
            '<div style="border-top:1px solid #d1d5db;padding-top:6px;margin-top:4px;font-weight:700;color:#b45309;">PE $ needed (ZHL − Comp):</div>' +
            '<div style="border-top:1px solid #d1d5db;padding-top:6px;margin-top:4px;text-align:right;font-weight:700;color:' + (isPositive ? '#b91c1c' : '#15803d') + ';">' + formatMoney(s.peDollars) + '</div>' +
            '<div style="font-weight:700;color:#b45309;">PE in points (PE $ / loan amount):</div>' +
            '<div style="text-align:right;font-weight:700;color:' + (isPositive ? '#b91c1c' : '#15803d') + ';">' + formatPctDisplay(s.pePoints) + '</div>' +
          '</div>' +
        '</div>' +
        (s.peDollars <= 0
          ? '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px;color:#14532d;font-size:12px;margin-bottom:14px;">PE calc came back ≤ $0 — ZHL is already at or beating the competitor on net cost. No PE needed unless the rate gap justifies it separately.</div>'
          : '') +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Continue', 'zhl-pe-continue') +
          btnSecondary('Edit numbers', 'zhl-pe-edit') +
        '</div>';
      body.querySelector('#zhl-pe-continue').addEventListener('click', function () { goTo('U-reason'); });
      body.querySelector('#zhl-pe-edit').addEventListener('click', goBack);
    },

    // --------- unlocked-only: reason / description ----------------------
    // RM wants a description on every unlocked PE request (not just
    // > 2.5 pts). Writes to s.reason so if the request later turns out
    // to be > 2.5 pts, the big-25 form's "Main reason" textarea
    // pre-fills with whatever was typed here.
    'U-reason': function (body) {
      const s = workflowState;
      const ta = 'padding:8px 10px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;width:100%;box-sizing:border-box;min-height:110px;resize:vertical;';
      body.innerHTML =
        '<h4 style="margin:0 0 8px;font-size:15px;color:#111827;">Reason / description for this PE</h4>' +
        '<p style="margin:0 0 12px;color:#6b7280;font-size:12px;">Briefly describe why this PE is needed. This goes on the email to the RM — be specific so they can approve without coming back to ask.</p>' +
        '<textarea id="pe-u-reason" placeholder="e.g. Borrower brought a competing LE from Rocket with a 0.25% lower rate at similar Box A. Need 1.2 pts to match." style="' + ta + '">' + escapeHtml(s.reason || '') + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-top:14px;">' +
          btnPrimary('Continue', 'zhl-pe-reason-continue') +
        '</div>';
      body.querySelector('#zhl-pe-reason-continue').addEventListener('click', function () {
        s.reason = (body.querySelector('#pe-u-reason').value || '').trim();
        goTo('points-check');
      });
    },

    // --------- shared: < 2.5 pts? ---------------------------------------
    // In the UNLOCKED path we already computed s.pePoints from the
    // ZHL/comp pricing inputs — no reason to ask the LO a question we
    // already know the answer to. Auto-route: if pePoints >= 2.5,
    // straight to the justification step; otherwise straight to the
    // email step. The LOCKED path still gets the manual question
    // because we never calculate the PE size in that branch.
    'points-check': function (body) {
      const s = workflowState;
      if (s.locked === false && s.loanAmount > 0) {
        s.isOver25 = (s.pePoints || 0) >= 2.5;
        goTo(s.isOver25 ? 'big-pe-questions' : 'email');
        return;
      }
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Is your PE request under 2.5 points?</h4>' +
        '<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">If you don\'t know, check the PE points field on the ENC Lock screen.</p>' +
        '<div style="display:flex;gap:8px;">' +
          btnPrimary('Yes — under 2.5', 'zhl-pe-under') +
          btnSecondary('No — 2.5 or over', 'zhl-pe-over') +
        '</div>';
      body.querySelector('#zhl-pe-under').addEventListener('click', function () {
        s.isOver25 = false; goTo('email');
      });
      body.querySelector('#zhl-pe-over').addEventListener('click', function () {
        s.isOver25 = true; goTo('big-pe-questions');
      });
    },

    'big-pe-questions': function (body) {
      const s = workflowState;
      const ta = 'padding:8px 10px;border:1px solid #d1d5db;border-radius:4px;font:13px Arial,sans-serif;width:100%;box-sizing:border-box;min-height:60px;resize:vertical;';
      const label = 'display:block;font-size:12px;color:#374151;font-weight:600;margin-bottom:4px;';
      const wrap  = 'margin-bottom:12px;';
      const brName = (s.borrowerName || 'the borrower').trim();
      body.innerHTML =
        '<h4 style="margin:0 0 6px;font-size:15px;color:#111827;">PE > 2.5 points — additional justification required</h4>' +
        '<p style="margin:0 0 14px;color:#6b7280;font-size:12px;">Your manager wants these three answers included in the PE email.</p>' +
        '<div style="' + wrap + '"><label style="' + label + '">1. What is the main reason for needing this PE? Please be specific.</label>' +
          '<textarea id="pe-reason" style="' + ta + '">' + escapeHtml(s.reason) + '</textarea></div>' +
        '<div style="' + wrap + '"><label style="' + label + '">2. Have we set proper expectations with ' + escapeHtml(brName) + ' that any further price exceptions, including rate extensions, will be at their expense?</label>' +
          '<textarea id="pe-expectations" style="' + ta + '" placeholder="Yes — they understand additional PEs / extensions are at their cost. (or no, with detail)">' + escapeHtml(s.expectations) + '</textarea></div>' +
        '<div style="' + wrap + '"><label style="' + label + '">3. What is the relationship with the agent / partner?</label>' +
          '<textarea id="pe-agent" style="' + ta + '">' + escapeHtml(s.agentRel) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;">' + btnPrimary('Generate email', 'zhl-pe-build-email') + '</div>';
      body.querySelector('#zhl-pe-build-email').addEventListener('click', function () {
        s.reason       = body.querySelector('#pe-reason').value.trim();
        s.expectations = body.querySelector('#pe-expectations').value.trim();
        s.agentRel     = body.querySelector('#pe-agent').value.trim();
        goTo('email');
      });
    },

    'email': function (body) {
      const s = workflowState;
      const email = buildEmail(s);

      // Optional: editable ZG# + borrower name + RM email row before output
      const fieldStyle = 'padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;font:12px Arial,sans-serif;width:100%;box-sizing:border-box;';
      const loNameMissing = !((s.loName || '').trim());
      body.innerHTML =
        '<h4 style="margin:0 0 12px;font-size:15px;color:#111827;">Email to RM</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">' +
          '<div><label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">Your name' +
            (loNameMissing ? ' <span style="color:#b91c1c;font-weight:700;">←  fill in</span>' : '') + '</label>' +
            '<input id="pe-lo-name" type="text" value="' + escapeHtml(s.loName || '') + '" placeholder="e.g. Justin Case" style="' + fieldStyle +
              (loNameMissing ? 'border-color:#b91c1c;background:#fef2f2;' : '') + '" /></div>' +
          '<div><label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">RM email</label>' +
            '<input id="pe-rm-email" type="email" value="' + escapeHtml(s.rmEmail) + '" placeholder="rm@zillowhomeloans.com" style="' + fieldStyle + '" /></div>' +
          '<div><label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">ZG # (Encompass loan #)</label>' +
            '<input id="pe-zg-number" type="text" value="' + escapeHtml(s.zgNumber) + '" placeholder="ZGxxxxxxxx" style="' + fieldStyle + '" /></div>' +
        '</div>' +
        '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">Subject</label>' +
        '<input id="pe-subject" type="text" value="' + escapeHtml(email.subject) + '" style="' + fieldStyle + 'margin-bottom:10px;" />' +
        '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:2px;">Body</label>' +
        '<textarea id="pe-body" style="' + fieldStyle + 'min-height:280px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;">' + escapeHtml(email.body) + '</textarea>' +
        '<p style="margin:8px 0 0;color:#6b7280;font-size:11px;font-style:italic;">Tip: <strong>Open in Gmail</strong> opens a new Gmail compose tab and <strong>auto-pastes the formatted email body</strong> for you — no Ctrl+V needed. If auto-paste ever fails, the body is still on your clipboard (Ctrl+V) and the plain-text version is in the Gmail URL as a backup. RM email is auto-saved for next time.</p>' +
        // Big, unmissable attachment reminder. The PE submission requires
        // exactly two files; the Scenario details snip is auto-captured
        // for the LO but Gmail compose attachments still need a manual
        // drag-in, so this callout has to be impossible to miss.
        '<div style="margin-top:14px;padding:12px 14px;background:#fef3c7;border:2px solid #b45309;border-radius:6px;color:#7c2d12;">' +
          '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">⚠ Don\'t forget to attach 2 files before sending:</div>' +
          '<ol style="margin:0;padding-left:22px;font-size:12px;line-height:1.6;">' +
            '<li><strong>Scenario details snip</strong> — auto-saved to your Downloads when you click <em>Open in Gmail</em> (we hop to the Scenarios tab to grab it, so don\'t panic if the page changes). Just drag it from the Downloads bar into the Gmail compose.</li>' +
            '<li><strong>Competitor LE / worksheet</strong> — drag in the loan estimate or pricing worksheet from the other lender.</li>' +
          '</ol>' +
          '<div id="zhl-pe-snip-status" style="margin-top:8px;font-size:11px;font-weight:600;"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
          btnPrimary('Open in Gmail + copy body', 'zhl-pe-mailto') +
          btnSecondary('Capture scenario snip', 'zhl-pe-snip') +
          btnSecondary('Copy body only', 'zhl-pe-copy-body') +
          btnSecondary('Copy subject only', 'zhl-pe-copy-subj') +
        '</div>' +
        // Time-saved tracker — appears once the user reaches the email
        // step (i.e. they've completed the workflow).
        '<div id="zhl-pe-time-saved"></div>';

      // Time saved: ~12 minutes (data gathering + email composition).
      if (window.__zhlTimeSaved) {
        const mins = 12;
        window.__zhlTimeSaved.record('pricing-exception-workflow', mins).then(function (r) {
          const slot = body.querySelector('#zhl-pe-time-saved');
          if (slot) slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
        });
      }

      // wire
      function read() {
        s.rmEmail   = body.querySelector('#pe-rm-email').value.trim();
        s.zgNumber  = body.querySelector('#pe-zg-number').value.trim();
        s.loName    = body.querySelector('#pe-lo-name').value.trim();
        return {
          to: s.rmEmail,
          subject: body.querySelector('#pe-subject').value,
          body: body.querySelector('#pe-body').value
        };
      }
      // Re-render subject + body when ZG# or LO name changes (only if user hasn't manually edited them)
      let subjectAuto = true;
      let bodyAuto    = true;
      function rebuildIfAuto() {
        const rebuilt = buildEmail(s);
        if (subjectAuto) body.querySelector('#pe-subject').value = rebuilt.subject;
        if (bodyAuto)    body.querySelector('#pe-body').value    = rebuilt.body;
      }
      body.querySelector('#pe-zg-number').addEventListener('input', function () {
        s.zgNumber = body.querySelector('#pe-zg-number').value.trim();
        rebuildIfAuto();
      });
      body.querySelector('#pe-lo-name').addEventListener('input', function () {
        s.loName = body.querySelector('#pe-lo-name').value.trim();
        rebuildIfAuto();
      });
      body.querySelector('#pe-subject').addEventListener('input', function () { subjectAuto = false; });
      body.querySelector('#pe-body').addEventListener('input',    function () { bodyAuto    = false; });

      // Auto-save the RM email whenever the field loses focus, so once
      // the LO types it they never have to type it again.
      function persistRmEmail() {
        const v = (body.querySelector('#pe-rm-email').value || '').trim();
        if (!v) return;
        try { chrome.storage.local.set({ [STORAGE_KEY_RM]: v }); } catch (_) {}
      }
      function persistLoName() {
        const v = (body.querySelector('#pe-lo-name').value || '').trim();
        if (!v) return;
        try { chrome.storage.local.set({ lo_name: v }); } catch (_) {}
      }
      body.querySelector('#pe-rm-email').addEventListener('blur', persistRmEmail);
      body.querySelector('#pe-lo-name').addEventListener('blur',  persistLoName);

      function setSnipStatus(text, color) {
        const slot = body.querySelector('#zhl-pe-snip-status');
        if (!slot) return;
        slot.textContent = text || '';
        slot.style.color = color || '#7c2d12';
      }

      async function captureSnipForOpenInGmail() {
        setSnipStatus('Capturing scenario details snip…', '#7c2d12');
        const zg = (body.querySelector('#pe-zg-number').value || '').trim();
        const result = await captureAssignedScenarioSnip(zg);
        if (result.ok) {
          setSnipStatus('✓ Saved ' + result.filename + ' to Downloads — drag it into Gmail to attach.', '#166534');
        } else {
          setSnipStatus('⚠ Could not auto-snip: ' + result.reason + ' — open View details on the assigned scenario and snip manually.', '#b91c1c');
        }
        return result;
      }

      body.querySelector('#zhl-pe-snip').addEventListener('click', async function () {
        const btn = this;
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Snipping…';
        try { await captureSnipForOpenInGmail(); }
        finally { btn.disabled = false; btn.textContent = orig; }
      });

      body.querySelector('#zhl-pe-mailto').addEventListener('click', async function () {
        const btn = this;
        read();
        persistRmEmail();
        persistLoName();
        const rebuilt = buildEmail(workflowState);
        const plain   = body.querySelector('#pe-body').value;
        const e       = read();
        // Belt: stash HTML in chrome.storage so the companion Gmail
        // content script (gmail-pe-paste.js) can auto-paste it into the
        // compose body when the new Gmail tab loads.
        // Suspenders: also copy HTML+plain to the clipboard so Ctrl+V
        // works if the auto-paste fails for any reason.
        // Belt-and-suspenders: include the plain text in the Gmail URL's
        // &body= param so even if both above fail, the LO still has the
        // (plain) email body sitting in the new compose tab.
        function openGmail() {
          const url = 'https://mail.google.com/mail/?view=cm&fs=1' +
            '&to=' + encodeURIComponent(e.to) +
            '&su=' + encodeURIComponent(e.subject) +
            '&body=' + encodeURIComponent(plain);
          try { window.open(url, '_blank'); }
          catch (_) { window.location.href = url; }
        }
        function stashThenOpen() {
          try {
            chrome.storage.local.set({
              zhlPePendingPaste: { html: rebuilt.html, plain: plain, ts: Date.now() }
            }, function () {
              copyHtmlAndPlain(btn, rebuilt.html, plain, function () { openGmail(); });
            });
          } catch (_) {
            copyHtmlAndPlain(btn, rebuilt.html, plain, function () { openGmail(); });
          }
        }
        // Capture the scenario snip BEFORE we navigate, so the PNG is
        // sitting in Downloads by the time the Gmail compose tab mounts
        // and the LO is ready to drag it in. We don't block opening Gmail
        // if the capture fails — the warning callout already tells the
        // LO to attach the snip manually if it didn't work.
        const origText = btn.textContent;
        btn.disabled = true; btn.textContent = 'Capturing snip…';
        try { await captureSnipForOpenInGmail(); }
        catch (_) {}
        btn.disabled = false; btn.textContent = origText;
        stashThenOpen();
      });
      body.querySelector('#zhl-pe-copy-body').addEventListener('click', function () {
        read();
        persistRmEmail();
        persistLoName();
        const rebuilt = buildEmail(workflowState);
        const plain   = body.querySelector('#pe-body').value;
        copyHtmlAndPlain(this, rebuilt.html, plain);
      });
      body.querySelector('#zhl-pe-copy-subj').addEventListener('click', function () {
        const e = read();
        persistRmEmail();
        persistLoName();
        flashCopy(this, e.subject);
      });
    }
  };

  function flashCopy(btn, text) {
    try {
      navigator.clipboard.writeText(text).then(
        function () { flashLabel(btn, '✓ Copied'); },
        function () { flashLabel(btn, '✗ Failed'); }
      );
    } catch (_) {
      flashLabel(btn, '✗ Failed');
    }
  }
  // Put BOTH text/html and text/plain on the clipboard so a paste into
  // Gmail's body field (which accepts HTML) renders the formatted table,
  // while a paste into a plain-text target still gets the plain version.
  // Optional onDone callback fires after the write completes (or fails) so
  // the caller can chain a window.open() that needs to happen after.
  function copyHtmlAndPlain(btn, html, plain, onDone) {
    function done(ok, msg) {
      flashLabel(btn, msg);
      if (typeof onDone === 'function') onDone(ok);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/html':  new Blob([html],  { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(
          function () { done(true, '✓ Copied (formatted)'); },
          function () {
            navigator.clipboard.writeText(plain).then(
              function () { done(true, '✓ Copied (plain)'); },
              function () { done(false, '✗ Copy failed'); }
            );
          }
        );
        return;
      }
    } catch (_) {}
    try {
      navigator.clipboard.writeText(plain).then(
        function () { done(true, '✓ Copied'); },
        function () { done(false, '✗ Failed'); }
      );
    } catch (_) { done(false, '✗ Failed'); }
  }
  function flashLabel(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }

  // ---- email template -----------------------------------------------------
  function borrowerLabel(s) {
    const p = (s.borrowerName || '').trim();
    const c = (s.coborrowerName || '').trim();
    if (p && c) return p + ' & ' + c;
    return p || 'the borrower';
  }
  function loLabel(s) { return (s.loName || '').trim() || '(your name)'; }
  function loanIdForEmail(s) { return (s.zgNumber || s.loanId || '(loan id)').trim(); }
  function sizeLabel(s) { return s.isOver25 ? '2.5 points or over' : 'under 2.5 points'; }
  function compLabel(s)     { return (s.compLender || '').trim() || 'Competitor'; }
  // Rate-lock status surfaced in the subject and as the first sentence of
  // the email body. RM asked for this to be obvious — locked vs unlocked
  // changes the whole approval workflow on their end.
  function lockedTag(s)        { return s.locked === true ? '[LOCKED]' : '[NOT LOCKED]'; }
  function lockedSentence(s)   { return s.locked === true ? 'Rate is currently LOCKED.' : 'Rate is NOT LOCKED.'; }
  function lockedColor(s)      { return s.locked === true ? '#15803d' : '#b91c1c'; }
  function lockedBg(s)         { return s.locked === true ? '#dcfce7' : '#fee2e2'; }
  function lockedBorderColor(s){ return s.locked === true ? '#86efac' : '#fca5a5'; }

  // Build a complete email — returns { subject, body, html }.
  // body  = plain text (used by Open-in-Gmail compose URL, and as the
  //         text/plain on the clipboard)
  // html  = formatted version (used as text/html on the clipboard so Gmail's
  //         body field renders tables / bold / hyperlinks correctly)
  function buildEmail(s) {
    const id = loanIdForEmail(s);
    const heading = 'PE request for ' + borrowerLabel(s) + ' by ' + loLabel(s);
    if (s.locked === true) {
      return buildEmailLocked(s, id, heading);
    }
    return buildEmailUnlocked(s, id, heading);
  }

  function buildEmailLocked(s, id, heading) {
    // ----- plain text -----
    const lines = [
      'Hi,',
      '',
      lockedSentence(s),
      '',
      heading,
      '',
      'LOP link: ' + s.loanLink,
      '',
      id + ' is ready for PE request.',
      '',
      'Pre-submission checklist (all complete):',
      '  ✓ Current pricing imported',
      '  ✓ Comp PE fields completed in ENC Lock / Pricing Screen',
      '  ✓ No lock-difference alert',
      '  ✓ Comp LE uploaded to eFolder',
      '',
      'PE request size: ' + sizeLabel(s),
      ''
    ];
    if (s.isOver25) lines.push.apply(lines, big25SectionPlain(s));
    lines.push('Thanks.');
    // ----- html -----
    const html = wrapHtml(
      htmlLockBanner(s) +
      htmlHeader(heading, id, s.loanLink) +
      '<p style="margin:14px 0 8px;">' + escapeHtml(id) + ' is ready for PE request.</p>' +
      '<p style="margin:14px 0 6px;font-weight:600;color:' + COLORS.accent + ';">Pre-submission checklist (all complete):</p>' +
      '<ul style="margin:0 0 14px;padding-left:22px;line-height:1.7;">' +
        '<li>Current pricing imported</li>' +
        '<li>Comp PE fields completed in ENC Lock / Pricing Screen</li>' +
        '<li>No lock-difference alert</li>' +
        '<li>Comp LE uploaded to eFolder</li>' +
      '</ul>' +
      '<p style="margin:14px 0;"><strong>PE request size:</strong> ' + escapeHtml(sizeLabel(s)) + '</p>' +
      (s.isOver25 ? big25SectionHtml(s) : '') +
      '<p style="margin-top:18px;">Thanks.</p>'
    );
    return {
      subject: lockedTag(s) + ' PE Request for ' + borrowerLabel(s) + ' (' + id + ')' + (s.isOver25 ? ' — >2.5 pts' : ''),
      body: lines.join('\n'),
      html: html
    };
  }

  function buildEmailUnlocked(s, id, heading) {
    const zhlNet  = s.zhlBoxA  - s.zhlCredits;
    const compNet = s.compBoxA - s.compCredits;
    // ----- plain text -----
    const lines = [
      'Hi,',
      '',
      lockedSentence(s),
      '',
      heading,
      '',
      'LOP link: ' + s.loanLink,
      '',
      'Loan scenario:',
      '  Purchase price:     ' + formatMoney(s.purchasePrice),
      '  Loan amount:        ' + formatMoney(s.loanAmount),
      '  Loan type:          ' + s.loanType + ' (' + s.armOrFrm + ')',
      '',
      'ZHL pricing:',
      '  Interest rate:      ' + formatPctDisplay(s.zhlRate),
      '  Total Box A:        ' + formatMoney(s.zhlBoxA),
      '  Lender credits:     ' + formatMoney(s.zhlCredits),
      '  Net cost (A − cr.): ' + formatMoney(zhlNet),
      '',
      'Competitor pricing (' + compLabel(s) + '):',
      '  Interest rate:      ' + formatPctDisplay(s.compRate),
      '  Total Box A:        ' + formatMoney(s.compBoxA),
      '  Lender credits:     ' + formatMoney(s.compCredits),
      '  Net cost (A − cr.): ' + formatMoney(compNet),
      '',
      'PE amount requested: ' + formatMoney(s.peDollars) + '  (' + formatPctDisplay(s.pePoints) + ')',
      'PE request size:     ' + sizeLabel(s),
      ''
    ];
    // Reason / description — always included on the unlocked path. If we're
    // over 2.5 pts, the big-25 section's #1 question already includes it,
    // so we suppress the standalone section here to avoid duplication.
    if (!s.isOver25 && (s.reason || '').trim()) {
      lines.push('Reason for PE request:');
      lines.push('  ' + s.reason.trim());
      lines.push('');
    }
    if (s.isOver25) lines.push.apply(lines, big25SectionPlain(s));
    lines.push('Attached: Scenario details (View details snip), competitor LE / worksheet.');
    lines.push('');
    lines.push('Thanks.');
    // ----- html -----
    const html = wrapHtml(
      htmlLockBanner(s) +
      htmlHeader(heading, id, s.loanLink) +
      htmlSectionHeading('Loan scenario') +
      htmlKvTable([
        ['Purchase price', formatMoney(s.purchasePrice)],
        ['Loan amount',    formatMoney(s.loanAmount)],
        ['Loan type',      escapeHtml(s.loanType) + ' (' + escapeHtml(s.armOrFrm) + ')']
      ]) +
      htmlSectionHeading('Pricing comparison') +
      htmlComparisonTable(s, zhlNet, compNet) +
      '<p style="margin:16px 0;font-size:15px;line-height:1.6;">' +
        '<strong>PE amount requested:</strong> ' + escapeHtml(formatMoney(s.peDollars)) +
        ' <span style="color:#6b7280;">(' + escapeHtml(formatPctDisplay(s.pePoints)) + ')</span><br>' +
        '<strong>PE request size:</strong> ' + escapeHtml(sizeLabel(s)) +
      '</p>' +
      (!s.isOver25 && (s.reason || '').trim()
        ? htmlSectionHeading('Reason for PE request') +
          '<p style="margin:0 0 14px;color:#374151;line-height:1.5;white-space:pre-wrap;">' + escapeHtml((s.reason || '').trim()) + '</p>'
        : '') +
      (s.isOver25 ? big25SectionHtml(s) : '') +
      '<p style="margin:18px 0 0;color:#6b7280;font-size:12px;font-style:italic;">Attached: Scenario details (View details snip), competitor LE / worksheet.</p>' +
      '<p style="margin-top:14px;">Thanks.</p>'
    );
    const compForSubject = (s.compLender || '').trim() ? ' vs ' + (s.compLender || '').trim() : '';
    return {
      subject: lockedTag(s) + ' PE Request for ' + borrowerLabel(s) + ' (' + id + ')' + compForSubject + (s.isOver25 ? ' — >2.5 pts' : ''),
      body: lines.join('\n'),
      html: html
    };
  }

  function big25SectionPlain(s) {
    const brName = (s.borrowerName || 'the borrower').trim();
    return [
      'Justification (PE > 2.5 pts):',
      '',
      '  1) Main reason for PE:',
      '     ' + (s.reason || '(not provided)'),
      '',
      '  2) Expectations set with ' + brName + ' that further PEs / rate extensions are at their cost:',
      '     ' + (s.expectations || '(not provided)'),
      '',
      '  3) Relationship with agent / partner:',
      '     ' + (s.agentRel || '(not provided)'),
      ''
    ];
  }
  function big25SectionHtml(s) {
    const brName = (s.borrowerName || 'the borrower').trim();
    return htmlSectionHeading('Justification (PE > 2.5 pts)') +
      '<ol style="margin:0 0 14px;padding-left:22px;line-height:1.6;">' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Main reason for PE:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.reason || '(not provided)') + '</span>' +
        '</li>' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Expectations set with ' + escapeHtml(brName) + ' that further PEs / rate extensions are at their cost:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.expectations || '(not provided)') + '</span>' +
        '</li>' +
        '<li style="margin-bottom:10px;">' +
          '<strong>Relationship with agent / partner:</strong><br>' +
          '<span style="color:#374151;">' + escapeHtml(s.agentRel || '(not provided)') + '</span>' +
        '</li>' +
      '</ol>';
  }

  // ---- HTML email helpers -------------------------------------------------
  // Brand palette: section headers + competitor column now use Zillow
  // blue (matches the ZHL column) so the email reads on-brand. Was a
  // ZHL-blue vs amber two-tone before; the LO asked for blue everywhere.
  const COLORS = { accent: '#0b5cab', zhl: '#0b5cab', comp: '#0b5cab', muted: '#6b7280', divider: '#bfdbfe' };
  function wrapHtml(inner) {
    return '<div style="font:14px Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5;">' +
      '<p style="margin:0 0 10px;">Hi,</p>' +
      inner +
    '</div>';
  }
  // Big colored banner at the very top of the HTML email so the RM
  // sees LOCKED vs NOT LOCKED at a glance.
  function htmlLockBanner(s) {
    return '<div style="margin:0 0 16px;padding:10px 14px;border:1px solid ' +
        lockedBorderColor(s) + ';background:' + lockedBg(s) + ';border-radius:6px;' +
        'color:' + lockedColor(s) + ';font-weight:700;font-size:14px;">' +
      escapeHtml(lockedSentence(s)) +
    '</div>';
  }
  function htmlHeader(heading, id, link) {
    return '<p style="margin:0 0 4px;font-size:15px;"><strong>' + escapeHtml(heading) + '</strong></p>' +
      '<p style="margin:0 0 14px;color:' + COLORS.muted + ';font-size:13px;">' +
        'LOP link: <a href="' + escapeHtml(link) + '" style="color:' + COLORS.zhl + ';">' + escapeHtml(link) + '</a>' +
      '</p>';
  }
  function htmlSectionHeading(title) {
    return '<h3 style="margin:18px 0 8px;font-size:14px;color:' + COLORS.accent + ';' +
      'border-bottom:2px solid ' + COLORS.divider + ';padding-bottom:4px;">' + escapeHtml(title) + '</h3>';
  }
  function htmlKvTable(rows) {
    return '<table style="border-collapse:collapse;margin-top:6px;">' +
      rows.map(function (r) {
        return '<tr>' +
          '<td style="padding:3px 16px 3px 0;color:' + COLORS.muted + ';">' + escapeHtml(r[0]) + '</td>' +
          '<td style="padding:3px 0;font-weight:600;">' + r[1] + '</td>' +
        '</tr>';
      }).join('') +
    '</table>';
  }
  function htmlComparisonTable(s, zhlNet, compNet) {
    const th = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;';
    const td = 'padding:5px 12px;';
    const numericRight = 'text-align:right;';
    function row(label, zhl, comp) {
      return '<tr>' +
        '<td style="' + td + 'color:' + COLORS.muted + ';">' + escapeHtml(label) + '</td>' +
        '<td style="' + td + numericRight + '">' + escapeHtml(zhl) + '</td>' +
        '<td style="' + td + numericRight + '">' + escapeHtml(comp) + '</td>' +
      '</tr>';
    }
    return '<table style="border-collapse:collapse;border:1px solid #e5e7eb;margin-top:8px;">' +
      '<thead><tr style="background:#f9fafb;">' +
        '<th style="' + th + 'text-align:left;">&nbsp;</th>' +
        '<th style="' + th + numericRight + 'color:' + COLORS.zhl + ';">ZHL</th>' +
        '<th style="' + th + numericRight + 'color:' + COLORS.comp + ';">' + escapeHtml(compLabel(s)) + '</th>' +
      '</tr></thead>' +
      '<tbody>' +
        row('Interest rate',  formatPctDisplay(s.zhlRate),    formatPctDisplay(s.compRate)) +
        row('Total Box A',    formatMoney(s.zhlBoxA),         formatMoney(s.compBoxA)) +
        row('Lender credits', formatMoney(s.zhlCredits),      formatMoney(s.compCredits)) +
        '<tr style="background:#f9fafb;font-weight:700;">' +
          '<td style="' + td + 'border-top:1px solid #e5e7eb;">Net cost</td>' +
          '<td style="' + td + numericRight + 'border-top:1px solid #e5e7eb;color:' + COLORS.zhl + ';">' + escapeHtml(formatMoney(zhlNet)) + '</td>' +
          '<td style="' + td + numericRight + 'border-top:1px solid #e5e7eb;color:' + COLORS.comp + ';">' + escapeHtml(formatMoney(compNet)) + '</td>' +
        '</tr>' +
      '</tbody>' +
    '</table>';
  }

  // ---- scan loop ----------------------------------------------------------
  function scan() {
    try { ensureButton(); } catch (_) {}
  }
  const observer = new MutationObserver(function () { scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  setInterval(scan, 1500);
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
