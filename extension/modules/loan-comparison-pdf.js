// ZHL Productivity Pack module — feature key: feature_loanComparisonPdf
//
// Adds a "ZHL Loan Comparison PDF" button next to LOP's existing
// "Generate PDF" on the Pricing & Scenarios → Scenarios review
// page. Produces a borrower-facing comparison PDF (via the
// browser's native Save-as-PDF print flow) that mirrors LOP's
// standard loan-comparison output with a few requested changes:
//
//   - Shows "Seller credit" as its own line (LOP's stock PDF buries
//     it inside Cash to/from)
//   - Drops the Credit score and DTI rows (the borrower doesn't
//     need their qualifying credit pulled into a comparison
//     handout)
//   - Estimated monthly cost (PITIA) and Cash (to) / from are
//     rendered noticeably larger / heavier so they pop visually as
//     the two numbers the borrower actually anchors on
//   - Adds a Page 2 with a per-scenario itemized cost summary
//     (every PITIA component + closing-cost summary)
//
// Implementation: scrapes the saved-scenario cards on the
// Scenarios sub-page, reads borrower names from the right-rail loan
// header, pulls the LO contact line from chrome.storage (same
// fields the 2-1 Buydown PDF uses), composes a styled HTML
// document, opens it in a new tab and triggers window.print().
// User picks "Save as PDF" from the browser's print dialog.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_loanComparisonPdf';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Loan Comparison PDF v' + VERSION + '] loaded');

  const BRANDED_PDF_BUTTON_ATTR = 'data-zhl-loan-comparison-pdf-btn';
  const GRANT_PDF_BUTTON_ATTR = 'data-zhl-grant-pdf-btn';
  const STYLED_CARD_SELECTOR = '[class*="StyledCard-c11n"]';

  // ZHL 2% Grant eligibility
  const GRANT_PCT = 0.02;
  const GRANT_MAX_LOAN = 350000;
  const GRANT_ELIGIBLE_STATES = ['CA', 'DC', 'GA', 'MD', 'NJ', 'PA', 'TX', 'VA'];
  const GRANT_PRODUCT_RE = /conf\s*home\s*ready\s*30\s*yr\s*fixed/i;

  // ---- Helpers --------------------------------------------------

  function parseMoney(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/[\$,\s]/g, '').replace(/\/yr|\/mo/gi, '');
    const neg = /^\(.+\)$/.test(t);
    const n = parseFloat(t.replace(/[()]/g, ''));
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function parsePercent(s) {
    if (s == null) return NaN;
    const t = String(s).replace(/[%\s]/g, '');
    return parseFloat(t);
  }

  function isOnScenariosPage() {
    return /\/loan-officer-portal\//.test(location.pathname) &&
      (location.pathname.indexOf('pricing') !== -1 ||
        location.pathname.indexOf('scenario') !== -1 ||
        /Scenarios/i.test(document.body.textContent || ''));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoneyHtml(n) {
    if (!isFinite(n)) return '&mdash;';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtMoneyShort(n) {
    if (!isFinite(n)) return '&mdash;';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPctHtml(n, digits) {
    if (!isFinite(n)) return '&mdash;';
    return n.toFixed(digits == null ? 3 : digits) + '%';
  }

  // ---- Scenario-card scraping -----------------------------------

  function isScenarioCard(card) {
    const text = card.textContent || '';
    return text.indexOf('Loan purpose') !== -1
      && text.indexOf('Total loan amount') !== -1
      && text.indexOf('Interest rate') !== -1;
  }

  function isCardSelected(card) {
    const cb = card.querySelector('input[type="checkbox"][name="selectScenario"]');
    if (cb) return !!cb.checked;
    // Fallback: any unnamed checkbox on the card
    const anyCb = card.querySelector('input[type="checkbox"]');
    return !!(anyCb && anyCb.checked);
  }

  function getCardTitle(card) {
    const ps = card.querySelectorAll('p');
    for (const p of ps) {
      const t = (p.textContent || '').trim();
      if (/\d{1,2}\s*Yr\s*(Fixed|ARM|FHA|VA|Jumbo)/i.test(t)) return t;
    }
    return ps.length ? (ps[0].textContent || '').trim() : 'Scenario';
  }

  function findRowValue(card, labelText) {
    const target = labelText.replace(/\s+/g, ' ').trim().toLowerCase();
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const t = (span.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t !== target) continue;
      const row = span.parentElement;
      if (!row) continue;
      const p = row.querySelector('p');
      if (p) return (p.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  // Read every field we want to render. Some scenarios may not have
  // every row populated (e.g. no down payment percentage shown if
  // it's exactly 0) — every field is parsed defensively and the
  // renderer falls back to em-dash when a number is missing.
  function readScenario(card) {
    const title = getCardTitle(card);
    const loanPurpose = findRowValue(card, 'Loan purpose');
    const purchasePrice = parseMoney(findRowValue(card, 'Purchase price'));
    const downPaymentRaw = findRowValue(card, 'Down payment');
    let downPaymentAmount = NaN, downPaymentPct = NaN;
    if (downPaymentRaw) {
      // Format: "$300,000.00 / 50.000%"
      const parts = downPaymentRaw.split('/');
      if (parts[0]) downPaymentAmount = parseMoney(parts[0]);
      if (parts[1]) downPaymentPct = parsePercent(parts[1]);
    }
    const loanAmount = parseMoney(findRowValue(card, 'Total loan amount'));
    const ltv = parsePercent(findRowValue(card, 'LTV'));
    const interestRate = parsePercent(findRowValue(card, 'Interest rate'));
    const apr = parsePercent(findRowValue(card, 'APR'));
    const pointsRaw = findRowValue(card, 'Points / Price');
    let pointsPct = NaN, pointsDollar = NaN;
    if (pointsRaw) {
      const parts = pointsRaw.split('/');
      if (parts[0]) pointsPct = parsePercent(parts[0]);
      if (parts[1]) pointsDollar = parseMoney(parts[1]);
    }
    const piPitiRaw = findRowValue(card, 'Monthly P&I / PITI');
    let pi = NaN, piti = NaN;
    if (piPitiRaw) {
      const parts = piPitiRaw.split('/');
      if (parts[0]) pi = parseMoney(parts[0]);
      if (parts[1]) piti = parseMoney(parts[1]);
    }
    const closingCosts = parseMoney(findRowValue(card, 'Total closing costs'));
    const sellerCredit = parseMoney(findRowValue(card, 'Seller credit'));
    const cashToFrom = parseMoney(findRowValue(card, 'Cash (to) / from'));
    const lockPeriod = findRowValue(card, 'Lock period');

    return {
      title: title,
      loanPurpose: loanPurpose || '',
      purchasePrice: purchasePrice,
      downPaymentAmount: downPaymentAmount,
      downPaymentPct: downPaymentPct,
      loanAmount: loanAmount,
      ltv: ltv,
      interestRate: interestRate,
      apr: apr,
      pointsPct: pointsPct,
      pointsDollar: pointsDollar,
      pi: pi,
      piti: piti,
      closingCosts: closingCosts,
      sellerCredit: isFinite(sellerCredit) ? sellerCredit : 0,
      cashToFrom: cashToFrom,
      lockPeriod: lockPeriod || ''
    };
  }

  function findSelectedScenarios() {
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      if (!isCardSelected(card)) return;
      out.push(readScenario(card));
    });
    return out;
  }

  function findSelectedScenarioCards() {
    // Returns the DOM elements (not parsed data) so we can drive
    // each card's closing-costs popup individually below.
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      if (!isCardSelected(card)) return;
      out.push(card);
    });
    return out;
  }

  // ---- Closing-cost popup scraping ------------------------------
  //
  // Each scenario card has a "Total closing costs" row whose dollar
  // amount is a button. Clicking it opens LOP's "Detailed cost
  // summary" dialog, which we then scrape and close. We do this
  // sequentially across selected scenarios (LOP renders one dialog
  // at a time) before composing the PDF.

  function findClosingCostsButton(card) {
    // The "Total closing costs" span sits next to a Flex with a
    // single button. Walk to the row container and pull that button.
    const spans = card.querySelectorAll('span');
    for (const sp of spans) {
      if ((sp.textContent || '').replace(/\s+/g, ' ').trim() !== 'Total closing costs') continue;
      const row = sp.parentElement;
      if (!row) continue;
      const btn = row.querySelector('button');
      if (btn) return btn;
    }
    return null;
  }

  function findOpenDetailDialog() {
    const dialogs = document.querySelectorAll('section[role="dialog"][aria-modal="true"]');
    for (const d of dialogs) {
      const h = d.querySelector('h4, h3, h2');
      if (h && /Detailed cost summary/i.test(h.textContent || '')) return d;
    }
    return null;
  }

  function findDialogCloseButton(dialog) {
    // Footer has a Close button; there's also an X icon button in
    // the header. Prefer the footer button (more reliable in React
    // dialog implementations).
    const footer = dialog.querySelector('footer');
    if (footer) {
      const btn = footer.querySelector('button');
      if (btn) return btn;
    }
    const buttons = dialog.querySelectorAll('button');
    for (const b of buttons) {
      const t = (b.textContent || '').trim();
      if (/^Close$/i.test(t)) return b;
    }
    // Last resort: the visually-hidden "Close" inside the X button.
    for (const b of buttons) {
      const hidden = b.querySelector('.VisuallyHidden-c11n-8-111-2__sc-t8tewe-0, span');
      if (hidden && /^Close$/i.test((hidden.textContent || '').trim())) return b;
    }
    return null;
  }

  function waitFor(predicate, timeoutMs) {
    return new Promise(function (resolve) {
      const t0 = Date.now();
      const tick = function () {
        let res = null;
        try { res = predicate(); } catch (_) {}
        if (res) return resolve(res);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  // Pull the structured breakdown out of the open dialog. The
  // dialog body is a tab panel that lays out:
  //   Loan costs
  //     Lender costs        →  items, then a Total row
  //     Fees you cannot shop for  →  items, then Total
  //     Third-party costs   →  items, then Total
  //   Total loan costs  (grand total for Loan costs section)
  //   Other costs
  //     Taxes and other government fees  →  items, then Total
  //     Prepaids            →  items, then Total
  //     Initial escrow payment at closing  →  items, then Total
  //     Other               →  items, then Total
  //   Total other costs    (grand total for Other costs section)
  //   Total loan and other costs  (sum across loan + other)
  //   Credits              →  items (no Total)
  //   Total closing costs  (final grand total = total loan + other - credits)
  //
  // We rely on text matching rather than minified class names so
  // future LOP class-name churn doesn't break us.
  const SECTION_NAMES = ['Loan costs', 'Other costs', 'Credits'];
  const SUBSECTION_NAMES = [
    'Lender costs', 'Fees you cannot shop for', 'Third-party costs',
    'Taxes and other government fees', 'Prepaids',
    'Initial escrow payment at closing', 'Other'
  ];
  const GRAND_TOTAL_LABELS = [
    'Total loan costs', 'Total other costs',
    'Total loan and other costs', 'Total closing costs'
  ];

  function scrapeClosingCostsDialog(dialog) {
    const result = {
      closingCorpId: '',
      sections: [],
      grandTotalLoanAndOther: NaN,
      grandTotalClosingCosts: NaN
    };
    if (!dialog) return result;

    // Closing-corp quote ID — appears in the dialog body.
    const allSpans = Array.from(dialog.querySelectorAll('span'));
    for (const sp of allSpans) {
      const t = (sp.textContent || '').trim();
      const m = /\*?Closing corp quote ID:\s*(\S+)/i.exec(t);
      if (m) { result.closingCorpId = m[1]; break; }
    }

    const panel = dialog.querySelector('[role="tabpanel"]') || dialog;
    const spans = Array.from(panel.querySelectorAll('span'))
      .filter(function (sp) { return !sp.querySelector('span'); });  // leaves only

    let currentSection = null;
    let currentSubsection = null;

    // Pseudo-section we lazily create when items appear without a
    // named subsection (e.g. "Credits" lists items directly).
    function ensureSubsection(name) {
      if (!currentSection) return null;
      if (!currentSubsection || currentSubsection.name !== name) {
        currentSubsection = { name: name, items: [], total: NaN };
        currentSection.subsections.push(currentSubsection);
      }
      return currentSubsection;
    }

    let i = 0;
    while (i < spans.length) {
      const text = (spans[i].textContent || '').replace(/\s+/g, ' ').trim();
      const nextText = i + 1 < spans.length
        ? (spans[i + 1].textContent || '').replace(/\s+/g, ' ').trim()
        : '';

      if (SECTION_NAMES.indexOf(text) !== -1) {
        currentSection = { name: text, subsections: [], sectionTotal: null };
        currentSubsection = null;
        result.sections.push(currentSection);
        i++;
        continue;
      }

      if (SUBSECTION_NAMES.indexOf(text) !== -1 && currentSection) {
        currentSubsection = { name: text, items: [], total: NaN };
        currentSection.subsections.push(currentSubsection);
        i++;
        continue;
      }

      if (text === 'Total' && currentSubsection) {
        currentSubsection.total = parseMoney(nextText);
        i += 2;
        continue;
      }

      if (GRAND_TOTAL_LABELS.indexOf(text) !== -1) {
        const v = parseMoney(nextText);
        if (text === 'Total loan and other costs') result.grandTotalLoanAndOther = v;
        else if (text === 'Total closing costs') result.grandTotalClosingCosts = v;
        else if (currentSection) {
          currentSection.sectionTotal = { label: text, value: v };
        }
        i += 2;
        continue;
      }

      // "% of loan amount" is a placeholder header with no value
      // (LOP renders it as a label with an empty value span). Skip
      // both spans together.
      if (text === '% of loan amount') { i += 2; continue; }

      // Treat anything else as a (label, value) item if the next
      // span looks like a money amount.
      if (nextText && /^-?\$?\(?[\d,]/.test(nextText) && currentSection) {
        // For the Credits section, items live directly under the
        // section with no named subsection — synthesize one.
        const sub = currentSubsection || ensureSubsection('');
        if (sub) sub.items.push({ label: text, value: parseMoney(nextText) });
        i += 2;
        continue;
      }

      // Unknown / decorative — skip.
      i++;
    }

    return result;
  }

  async function scrapeClosingDetail(card) {
    const closingBtn = findClosingCostsButton(card);
    if (!closingBtn) return null;
    // If a dialog is already open (from a previous failed close /
    // user click), try to close it first so we open a fresh one for
    // this card.
    const existing = findOpenDetailDialog();
    if (existing) {
      const closeBtn = findDialogCloseButton(existing);
      if (closeBtn) closeBtn.click();
      await waitFor(function () { return !findOpenDetailDialog(); }, 1500);
    }
    closingBtn.click();
    const dialog = await waitFor(findOpenDetailDialog, 5000);
    if (!dialog) return null;
    // Give React one more frame to finish rendering the body.
    await new Promise(function (r) { setTimeout(r, 100); });
    const detail = scrapeClosingCostsDialog(dialog);
    const closeBtn = findDialogCloseButton(dialog);
    if (closeBtn) closeBtn.click();
    await waitFor(function () { return !findOpenDetailDialog(); }, 2000);
    return detail;
  }

  // ---- Payment-breakdown popup scraping --------------------------
  //
  // The "Monthly P&I / PITI" value on each scenario card is a
  // StyledTextButton that opens a "Payment breakdown" dialog. The
  // dialog body lays out six labeled rows that decompose PITIA:
  //
  //   First mortgage (P&I)
  //   Homeowner's insurance
  //   Property taxes
  //   Mortgage insurance
  //   HOA
  //   Other
  //   Total monthly payment   (= PITIA)
  //
  // Each row is a Flex div with two leaf <span> children: label,
  // value. We pair them by label match, ignoring the APR /
  // Interest-rate header row at the top of the dialog (those labels
  // aren't in our map). Scraping these components lets page 2 of
  // the comparison PDF show the truthful PITIA breakdown the
  // borrower needs to see, instead of the prior catchall
  // "MI, taxes, insurance & HOA" line.

  const PAYMENT_BREAKDOWN_LABEL_MAP = {
    'first mortgage (p&i)': 'firstMortgagePi',
    "homeowner's insurance": 'homeownersInsurance',
    'homeowners insurance': 'homeownersInsurance',
    'property taxes': 'propertyTaxes',
    'mortgage insurance': 'mortgageInsurance',
    'hoa': 'hoa',
    'other': 'other',
    'total monthly payment': 'totalMonthlyPayment'
  };

  function findMonthlyPiPitiButton(card) {
    const spans = card.querySelectorAll('span');
    for (const sp of spans) {
      if ((sp.textContent || '').replace(/\s+/g, ' ').trim() !== 'Monthly P&I / PITI') continue;
      const row = sp.parentElement;
      if (!row) continue;
      const btn = row.querySelector('button');
      if (btn) return btn;
    }
    return null;
  }

  function findOpenPaymentBreakdownDialog() {
    const dialogs = document.querySelectorAll('section[role="dialog"][aria-modal="true"]');
    for (const d of dialogs) {
      const h = d.querySelector('h4, h3, h2');
      if (h && /Payment breakdown/i.test(h.textContent || '')) return d;
    }
    return null;
  }

  function scrapePaymentBreakdownDialog(dialog) {
    const out = {
      firstMortgagePi: NaN,
      homeownersInsurance: NaN,
      propertyTaxes: NaN,
      mortgageInsurance: NaN,
      hoa: NaN,
      other: NaN,
      totalMonthlyPayment: NaN
    };
    if (!dialog) return out;
    // Leaf spans only (skip wrappers that contain other spans), in
    // document order. Class-name selectors are intentionally avoided —
    // LOP's styled-component class suffixes churn between releases.
    const spans = Array.from(dialog.querySelectorAll('span'))
      .filter(function (sp) { return !sp.querySelector('span'); });
    for (let i = 0; i < spans.length - 1; i++) {
      const label = (spans[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const key = PAYMENT_BREAKDOWN_LABEL_MAP[label];
      if (!key) continue;
      const val = parseMoney(spans[i + 1].textContent);
      if (isFinite(val)) out[key] = val;
    }
    return out;
  }

  async function scrapePaymentBreakdown(card) {
    const pitiBtn = findMonthlyPiPitiButton(card);
    if (!pitiBtn) return null;
    // Defensive: close a stale Payment-breakdown dialog if one's
    // somehow still open from a previous click.
    const existing = findOpenPaymentBreakdownDialog();
    if (existing) {
      const closeBtn = findDialogCloseButton(existing);
      if (closeBtn) closeBtn.click();
      await waitFor(function () { return !findOpenPaymentBreakdownDialog(); }, 1500);
    }
    pitiBtn.click();
    const dialog = await waitFor(findOpenPaymentBreakdownDialog, 5000);
    if (!dialog) return null;
    await new Promise(function (r) { setTimeout(r, 100); });
    const detail = scrapePaymentBreakdownDialog(dialog);
    const closeBtn = findDialogCloseButton(dialog);
    if (closeBtn) closeBtn.click();
    await waitFor(function () { return !findOpenPaymentBreakdownDialog(); }, 2000);
    return detail;
  }

  function findAnyScenarios() {
    const out = [];
    document.querySelectorAll(STYLED_CARD_SELECTOR).forEach(function (card) {
      if (!isScenarioCard(card)) return;
      out.push(readScenario(card));
    });
    return out;
  }

  // ---- Borrower / property header scraping ----------------------

  // Property state (2-letter) from the loan header. The header chip
  // shows either "City, ST" or just "ST", so accept both — validated
  // against the real state/territory list to avoid matching stray
  // 2-letter words. Anchored on the "Open in Salesforce" link's
  // container (the loan header) so we don't pick up a borrower
  // address elsewhere.
  var US_STATES = ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD ' +
    'MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA ' +
    'WA WV WI WY GU PR VI AS MP').split(' ');
  function stateFromText(t) {
    t = (t || '').replace(/\s+/g, ' ').trim();
    const m = /,\s*([A-Z]{2})$/.exec(t);
    if (m && US_STATES.indexOf(m[1]) !== -1) return m[1];
    if (/^[A-Z]{2}$/.test(t) && US_STATES.indexOf(t) !== -1) return t;
    return null;
  }
  function readPropertyState() {
    const anchor = document.querySelector('a[aria-label="Open in Salesforce"]');
    let scope = anchor && anchor.parentElement;
    for (let lvl = 0; lvl < 2 && scope; lvl++) {
      const spans = scope.querySelectorAll('span');
      for (const sp of spans) {
        const st = stateFromText(sp.textContent);
        if (st) return st;
      }
      scope = scope.parentElement;
    }
    // Fallback: a "City, ST" chip anywhere (specific enough to be safe;
    // standalone two-letter strings are NOT matched here).
    const els = document.querySelectorAll('span, div, p');
    for (const el of els) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = /^[A-Za-z .'\-]{2,40},\s*([A-Z]{2})$/.exec(t);
      if (m && US_STATES.indexOf(m[1]) !== -1) return m[1];
    }
    return null;
  }

  // Decide whether the 2% Grant PDF is allowed. Returns
  // { ok, reason }. Requires: a selection, state in the eligible
  // list, and EVERY selected scenario being Conf Home Ready 30 Yr
  // Fixed with a loan amount ≤ $350k.
  function evaluateGrantEligibility() {
    const selected = findSelectedScenarios();
    if (!selected.length) return { ok: false, reason: 'Select a Conf Home Ready 30 Yr Fixed scenario first.' };
    const state = readPropertyState();
    if (!state || GRANT_ELIGIBLE_STATES.indexOf(state) === -1) {
      return { ok: false, reason: 'ZHL 2% Grant is only available in CA, DC, GA, MD, NJ, PA, TX, or VA' +
        (state ? ' (this loan is in ' + state + ').' : ' — couldn\'t read the property state.') };
    }
    const wrongProduct = selected.some(function (s) { return !GRANT_PRODUCT_RE.test(s.title || ''); });
    if (wrongProduct) return { ok: false, reason: 'Every selected scenario must be Conf Home Ready 30 Yr Fixed.' };
    const overLimit = selected.some(function (s) { return !(isFinite(s.loanAmount) && s.loanAmount <= GRANT_MAX_LOAN); });
    if (overLimit) return { ok: false, reason: 'Loan amount must be $350,000 or less for the 2% Grant.' };
    return { ok: true, reason: '' };
  }

  function readBorrowerNames() {
    // The loan header line at the top right of LOP shows the
    // primary borrower's name (with co-borrower joined by &). It's
    // an <a> next to the property city/state. Fall back to scanning
    // for a node whose text matches a "First Last [& First Last]"
    // shape near the page header.
    const anchors = document.querySelectorAll('a, button, span, p');
    const re = /^[A-Z][a-z\-']+(?:\s[A-Z]\.?)?\s[A-Z][a-z\-']+(?:\s(?:&|and)\s[A-Z][a-z\-']+(?:\s[A-Z]\.?)?\s[A-Z][a-z\-']+)?$/;
    for (const el of anchors) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 80) continue;
      if (re.test(t)) return t;
    }
    return '';
  }

  function readLoProfile() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['lo_name', 'lo_nmls', 'lo_phone', 'lo_email'], function (data) {
          resolve({
            name: (data && data.lo_name) || '',
            nmls: (data && data.lo_nmls) || '',
            phone: (data && data.lo_phone) || '',
            email: (data && data.lo_email) || ''
          });
        });
      } catch (_) { resolve({ name: '', nmls: '', phone: '', email: '' }); }
    });
  }

  // ---- Button injection -----------------------------------------

  function findGeneratePdfButton() {
    return document.querySelector('button[data-z-analytics-identifier="ScenarioPDFCreateButton"]');
  }

  function findActionBarFor(generateBtn) {
    let anchor = generateBtn;
    let cur = generateBtn.parentElement;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'BUTTON') { anchor = cur; cur = cur.parentElement; continue; }
      return { container: cur, anchor: anchor };
    }
    return null;
  }

  function makeBrandedBtn(attr, label, onClick, ab) {
    const cs = window.getComputedStyle(ab.anchor);
    const padLeftPx = (parseFloat(cs.paddingLeft) || 20) + 8;
    const padRightPx = (parseFloat(cs.paddingRight) || 20) + 8;
    const btn = document.createElement('button');
    btn.setAttribute(attr, '1');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'background:#006aff;color:#fff;border:1px solid #006aff;' +
      'border-radius:4px;cursor:pointer;margin-right:8px;' +
      'font-family:' + (cs.fontFamily || 'Arial,Helvetica,sans-serif') + ';' +
      'font-weight:' + (cs.fontWeight || '600') + ';' +
      'font-size:' + (cs.fontSize || '14px') + ';' +
      'line-height:' + (cs.lineHeight && cs.lineHeight !== 'normal' ? cs.lineHeight : '1.2') + ';' +
      'padding:' + (cs.paddingTop || '10px') + ' ' + padRightPx + 'px ' + (cs.paddingBottom || '10px') + ' ' + padLeftPx + 'px;' +
      'min-height:' + (cs.height || '36px') + ';' +
      'box-sizing:border-box;';
    btn.addEventListener('mouseenter', function () { if (!btn.disabled) btn.style.background = '#0056d2'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = btn.disabled ? '#94a3b8' : '#006aff'; });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function ensureLoanComparisonPdfButton() {
    const generateBtn = findGeneratePdfButton();
    const existing = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    // 2% Grant PDF was retired in v1.63.18 — the program has been sunset.
    // We still clean up any stale button from older installs that the LO
    // might be running while waiting for auto-update to propagate.
    const existingGrant = document.querySelector('[' + GRANT_PDF_BUTTON_ATTR + ']');
    if (existingGrant) existingGrant.remove();
    if (!generateBtn) {
      if (existing) existing.remove();
      return;
    }
    const ab = findActionBarFor(generateBtn);
    if (ab && ab.container && ab.anchor) {
      if (!existing) {
        ab.container.insertBefore(
          makeBrandedBtn(BRANDED_PDF_BUTTON_ATTR, 'ZHL Comparison PDF', onComparisonPdfClick, ab),
          ab.anchor);
      }
    }
    updateButtonState();
  }

  // Mirror LOP's own Generate PDF disabled state (stale pricing).
  function isGenerateDisabled() {
    const generateBtn = findGeneratePdfButton();
    if (!generateBtn) return false;
    if (generateBtn.disabled === true || generateBtn.getAttribute('aria-disabled') === 'true') return true;
    let p = generateBtn.parentElement;
    while (p && p !== document.body) {
      if (p.tagName === 'BUTTON' && (p.disabled === true || p.getAttribute('aria-disabled') === 'true')) return true;
      if (p.tagName !== 'BUTTON') break;
      p = p.parentElement;
    }
    return false;
  }

  function updateGrantButtonState() {
    const btn = document.querySelector('[' + GRANT_PDF_BUTTON_ATTR + ']');
    if (!btn) return;
    function disable(reason) {
      btn.disabled = true;
      btn.style.background = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.style.cursor = 'not-allowed';
      btn.title = reason + '\n\nBuilt by Justin Case. Karma appreciated 💛';
    }
    if (isGenerateDisabled()) { disable('Update the scenarios first — LOP\'s Generate PDF is disabled (stale pricing).'); return; }
    const elig = evaluateGrantEligibility();
    if (!elig.ok) { disable(elig.reason); return; }
    btn.disabled = false;
    btn.style.background = '#006aff';
    btn.style.borderColor = '#006aff';
    btn.style.cursor = 'pointer';
    btn.title = 'Generate a ZHL 2% Grant comparison PDF — shows ZHL paying 2% of the loan toward the down payment, reducing cash to close.\n\nBuilt by Justin Case. Karma appreciated 💛';
  }

  function updateButtonState() {
    const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (!btn) return;
    const selected = findSelectedScenarios();
    // Mirror LOP's Generate PDF disabled state — when the user's
    // selection is stale, we shouldn't ship a comparison off stale
    // pricing either.
    const generateBtn = findGeneratePdfButton();
    const generateDisabled = !!generateBtn && (
      generateBtn.disabled === true ||
      generateBtn.getAttribute('aria-disabled') === 'true' ||
      (function () {
        let p = generateBtn.parentElement;
        while (p && p !== document.body) {
          if (p.tagName === 'BUTTON' && (p.disabled === true || p.getAttribute('aria-disabled') === 'true')) return true;
          if (p.tagName !== 'BUTTON') break;
          p = p.parentElement;
        }
        return false;
      })()
    );
    function disable(reason) {
      btn.disabled = true;
      btn.style.background = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.style.cursor = 'not-allowed';
      btn.title = reason + '\n\nBuilt by Justin Case. Karma appreciated 💛';
    }
    if (generateDisabled) { disable('Update the scenarios first — LOP\'s Generate PDF is disabled (stale pricing).'); return; }
    if (!selected.length) { disable('Select one or more scenarios first.'); return; }
    btn.disabled = false;
    btn.style.background = '#006aff';
    btn.style.borderColor = '#006aff';
    btn.style.cursor = 'pointer';
    btn.title = 'Generate a ZHL Loan Comparison PDF for ' + selected.length + ' selected scenario' +
      (selected.length === 1 ? '' : 's') + '.\n\nBuilt by Justin Case. Karma appreciated 💛';
  }

  // ---- PDF rendering --------------------------------------------

  function renderComparisonHtml(scenarios, lo, borrowerName, opts) {
    opts = opts || {};
    const isGrant = !!opts.grant;
    const grantFor = function (s) {
      return (s && isFinite(s.loanAmount)) ? s.loanAmount * GRANT_PCT : 0;
    };
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    }).replace(',', '');

    const colCount = scenarios.length + 1;
    const spacer = '<tr class="spacer"><td colspan="' + colCount + '">&nbsp;</td></tr>';

    function row(label, getValue, opts) {
      opts = opts || {};
      const cells = scenarios.map(function (s) {
        const v = getValue(s);
        const cls = opts.emphasis ? ' class="emphasis"' : (opts.big ? ' class="big"' : '');
        return '<td' + cls + '>' + (v == null ? '&mdash;' : v) + '</td>';
      }).join('');
      const trCls = opts.emphasis ? ' class="emphasis"' : (opts.big ? ' class="big"' : '');
      return '<tr' + trCls + '><th>' + label + '</th>' + cells + '</tr>';
    }

    // Header row: blank label cell, then one cell per scenario
    // showing the program name.
    let rowsHtml = '';
    rowsHtml += '<tr class="head"><th>Loan program</th>' +
      scenarios.map(function (s) {
        return '<th>' + escapeHtml(s.title) + '</th>';
      }).join('') + '</tr>';

    // --- Loan basics ---
    rowsHtml += row('Loan purpose', function (s) { return escapeHtml(s.loanPurpose) || '&mdash;'; });
    rowsHtml += row('Purchase price', function (s) { return fmtMoneyHtml(s.purchasePrice); });
    rowsHtml += row('Down payment', function (s) {
      const amt = fmtMoneyHtml(s.downPaymentAmount);
      const pct = isFinite(s.downPaymentPct) ? s.downPaymentPct.toFixed(3) + '%' : '';
      return pct ? amt + ' / ' + pct : amt;
    });
    rowsHtml += row('Total loan amount', function (s) { return fmtMoneyHtml(s.loanAmount); });
    rowsHtml += row('Loan-to-value (LTV)', function (s) { return fmtPctHtml(s.ltv); });
    rowsHtml += spacer;

    // --- Rate / APR ---
    rowsHtml += row('Interest rate', function (s) { return fmtPctHtml(s.interestRate); });
    rowsHtml += row('APR', function (s) { return fmtPctHtml(s.apr); });
    rowsHtml += row('Points / Price', function (s) {
      const pct = isFinite(s.pointsPct) ? s.pointsPct.toFixed(3) + '%' : '';
      const dol = isFinite(s.pointsDollar) ? fmtMoneyHtml(s.pointsDollar) : '';
      return pct && dol ? pct + ' / ' + dol : (pct || dol || '&mdash;');
    });
    rowsHtml += row('Lock period', function (s) { return escapeHtml(s.lockPeriod) || '&mdash;'; });
    rowsHtml += spacer;

    // --- Costs ---
    // Estimated monthly cost (PITIA) and Cash (to)/from rendered
    // bigger and bolder than every other row in the table — those
    // are the two numbers the borrower actually anchors on. Seller
    // credit gets its own line so it's not buried inside cash.
    // Note: LOP's "Monthly P&I / PITI" row already bundles HOA dues
    // into the right-hand number, so the truthful label is PITIA
    // (Principal + Interest + Taxes + Insurance + Association dues).
    rowsHtml += row('Total closing costs', function (s) { return fmtMoneyHtml(s.closingCosts); });
    rowsHtml += row('Seller credit', function (s) { return fmtMoneyHtml(s.sellerCredit); });
    rowsHtml += row('Estimated monthly cost (PITIA)', function (s) { return fmtMoneyHtml(s.piti); }, { big: true });
    if (isGrant) {
      // Grant path: show ZHL covering 2% of the loan toward the down
      // payment as a credit, then the reduced cash to close as the
      // headline number.
      rowsHtml += row('Cash (to) / from (before grant)', function (s) { return fmtMoneyHtml(s.cashToFrom); });
      rowsHtml += row('ZHL Grant — 2% of loan amount', function (s) {
        const g = grantFor(s);
        return g > 0 ? '&minus;' + fmtMoneyHtml(g) : '&mdash;';
      });
      rowsHtml += row('Cash to close after ZHL Grant', function (s) {
        return fmtMoneyHtml((isFinite(s.cashToFrom) ? s.cashToFrom : 0) - grantFor(s));
      }, { big: true });
    } else {
      rowsHtml += row('Cash (to) / from', function (s) { return fmtMoneyHtml(s.cashToFrom); }, { big: true });
    }

    // LO contact line
    const loSegs = [];
    if (lo.name) loSegs.push('<strong>' + escapeHtml(lo.name) + '</strong>');
    if (lo.nmls) loSegs.push('NMLS ID# ' + escapeHtml(lo.nmls));
    if (lo.phone) loSegs.push('P ' + escapeHtml(lo.phone));
    if (lo.email) loSegs.push('E ' + escapeHtml(lo.email));
    const loLine = loSegs.length
      ? '<span class="phone-icon">☎</span> Questions? ' + loSegs.join(' &nbsp;|&nbsp; ')
      : '';
    const loBox = loLine
      ? ('<div class="lo-box">' +
          '<div class="lo-line">' + loLine + '</div>' +
          '<div class="lo-tagline">Mortgage interest rates can change daily, sometimes hourly. Contact your loan officer today!</div>' +
        '</div>')
      : '';

    // ---- Page 2: per-scenario itemized cost summary --------------
    // For each scenario, render a card with: monthly cost breakdown
    // (P&I, MI, taxes, insurance, HOA, other) and a closing-costs
    // summary block. The PITIA components are scraped from LOP's
    // "Payment breakdown" popup (clickable from the Monthly P&I /
    // PITI value on the card) — see scrapePaymentBreakdown. When
    // that scrape succeeds we render one row per component; when it
    // fails we fall back to a derived (PITIA - P&I) catchall row.
    // Closing-costs summary shows total + seller credit + the
    // upfront cash impact.
    // FHA Upfront Mortgage Insurance Premium (UFMIP) is ALWAYS rolled
    // into the loan amount (LOP doesn't disclose any path where it's
    // paid at closing). Total closing costs still shows it for TRID
    // reasons, but the borrower never actually brings that money — they
    // pay it back over the life of the loan as part of the financed
    // principal. So when we render the "Net closing cost to borrower"
    // line, subtract the financed UFMIP so the math matches what LOP's
    // own "Cash (to) / from at closing" already reflects.
    //
    // Total closing costs and the itemized table stay UNCHANGED so the
    // PDF still matches the LE / disclosure docs line for line.
    function isFhaScenario(s) {
      return /\bFHA\b/i.test((s && s.title) || '');
    }
    function findFinancedMip(detail) {
      if (!detail || !detail.sections) return 0;
      for (const sec of detail.sections) {
        const subs = sec && sec.subsections;
        if (!subs) continue;
        for (const sub of subs) {
          const items = sub && sub.items;
          if (!items) continue;
          for (const item of items) {
            const label = (item && item.label) || '';
            // Match "Mortgage insurance premium" and common synonyms.
            // We intentionally don't match plain "MIP" alone (too noisy
            // in field labels); the popup uses the long form.
            if (/Mortgage\s+insurance\s+premium|Upfront\s+mortgage\s+insurance|UFMIP/i.test(label)) {
              const v = Number(item.value);
              return isFinite(v) ? v : 0;
            }
          }
        }
      }
      return 0;
    }
    function fhaMipFor(s) {
      if (!isFhaScenario(s)) return 0;
      return findFinancedMip(s && s.closingDetail);
    }

    // Itemized closing-costs table — produced when the in-page
    // "Detailed cost summary" popup was successfully scraped for
    // this scenario. Falls back to a small summary block when not.
    function itemizedClosingHtml(detail, s) {
      if (!detail || !detail.sections || !detail.sections.length) {
        const financedMip = fhaMipFor(s);
        const netClosing = (isFinite(s.closingCosts) ? s.closingCosts : 0) -
          (isFinite(s.sellerCredit) ? s.sellerCredit : 0) -
          financedMip;
        return (
          '<table class="p2tbl">' +
            '<tr><th>Total closing costs</th><td>' + fmtMoneyHtml(s.closingCosts) + '</td></tr>' +
            '<tr><th>Seller credit</th><td>' +
              (isFinite(s.sellerCredit) && s.sellerCredit > 0
                ? '&minus;' + fmtMoneyHtml(s.sellerCredit)
                : fmtMoneyHtml(s.sellerCredit)) +
            '</td></tr>' +
            (financedMip > 0
              ? '<tr><th>Less: financed FHA MIP <span class="p2note-inline">(rolled into loan)</span></th><td>&minus;' + fmtMoneyHtml(financedMip) + '</td></tr>'
              : '') +
            '<tr><th>Net closing cost to borrower</th><td>' + fmtMoneyHtml(netClosing) + '</td></tr>' +
            '<tr><th>Down payment</th><td>' + fmtMoneyHtml(s.downPaymentAmount) + '</td></tr>' +
            '<tr class="total"><th>Cash (to) / from at closing</th><td>' + fmtMoneyHtml(s.cashToFrom) + '</td></tr>' +
          '</table>' +
          '<div class="p2note">Detailed cost breakdown not available — couldn\'t read LOP\'s "Detailed cost summary" popup for this scenario.</div>'
        );
      }
      // Two-column layout: Loan costs on the left, Other costs on
      // the right (both with their own section grand total at the
      // bottom). Credits + the two roll-up totals run full-width
      // below. This halves the vertical real-estate the itemized
      // table needs so a typical scenario fits on one page.
      function renderSectionTable(sec, includeSectionTotal) {
        if (!sec || !sec.subsections.length) return '';
        let h = '<table class="p2cc">';
        h += '<tr class="cc-section"><th colspan="2">' + escapeHtml(sec.name) + '</th></tr>';
        sec.subsections.forEach(function (sub) {
          if (sub.name) {
            h += '<tr class="cc-subsection"><th colspan="2">' + escapeHtml(sub.name) + '</th></tr>';
          }
          sub.items.forEach(function (it) {
            h += '<tr><th>' + escapeHtml(it.label) + '</th><td>' + fmtMoneyHtml(it.value) + '</td></tr>';
          });
          if (isFinite(sub.total)) {
            h += '<tr class="cc-subtotal"><th>Total</th><td>' + fmtMoneyHtml(sub.total) + '</td></tr>';
          }
        });
        if (includeSectionTotal && sec.sectionTotal && isFinite(sec.sectionTotal.value)) {
          h += '<tr class="cc-sectiontotal"><th>' + escapeHtml(sec.sectionTotal.label) +
            '</th><td>' + fmtMoneyHtml(sec.sectionTotal.value) + '</td></tr>';
        }
        h += '</table>';
        return h;
      }
      const loanCostsSec = detail.sections.find(function (sec) { return sec.name === 'Loan costs'; });
      const otherCostsSec = detail.sections.find(function (sec) { return sec.name === 'Other costs'; });
      const creditsSec = detail.sections.find(function (sec) { return sec.name === 'Credits'; });

      let html = '<div class="p2cc-grid">';
      html += '<div class="p2cc-col">' + renderSectionTable(loanCostsSec, true) + '</div>';
      html += '<div class="p2cc-col">' + renderSectionTable(otherCostsSec, true) + '</div>';
      html += '</div>';

      // Footer table: Credits + grand totals at full width.
      let footHtml = '<table class="p2cc p2cc-footer">';
      let hasFoot = false;
      if (creditsSec && creditsSec.subsections.length) {
        footHtml += '<tr class="cc-section"><th colspan="2">' + escapeHtml(creditsSec.name) + '</th></tr>';
        creditsSec.subsections.forEach(function (sub) {
          if (sub.name) {
            footHtml += '<tr class="cc-subsection"><th colspan="2">' + escapeHtml(sub.name) + '</th></tr>';
          }
          sub.items.forEach(function (it) {
            footHtml += '<tr><th>' + escapeHtml(it.label) + '</th><td>' + fmtMoneyHtml(it.value) + '</td></tr>';
          });
        });
        hasFoot = true;
      }
      if (isFinite(detail.grandTotalLoanAndOther)) {
        footHtml += '<tr class="cc-grand"><th>Total loan and other costs</th><td>' +
          fmtMoneyHtml(detail.grandTotalLoanAndOther) + '</td></tr>';
        hasFoot = true;
      }
      if (isFinite(detail.grandTotalClosingCosts)) {
        footHtml += '<tr class="cc-grandtotal"><th>Total closing costs</th><td>' +
          fmtMoneyHtml(detail.grandTotalClosingCosts) + '</td></tr>';
        hasFoot = true;
      }
      footHtml += '</table>';
      if (hasFoot) html += footHtml;

      if (detail.closingCorpId) {
        html += '<div class="p2note">Closing corp quote ID: ' + escapeHtml(detail.closingCorpId) + '</div>';
      }
      return html;
    }

    // One page per scenario. Each page has the same masthead so a
    // borrower flipping through can always tell which scenario
    // they're on. Monthly cost + cash at closing sit side-by-side
    // in a compact two-column block at the top, then the full
    // itemized closing-costs table runs at full width below. No
    // page-break-inside: avoid — long itemized tables are allowed
    // to flow into a continuation page rather than triggering a
    // ghost blank page.
    // Monthly cost breakdown table. When the payment-breakdown popup
    // was scraped successfully, render every component on its own line
    // (P&I, MI, taxes, insurance, HOA, other) — hiding optional rows
    // that are $0 to avoid clutter. When the scrape failed (popup
    // didn't open, label match missed), fall back to the prior
    // two-row layout derived from (PITIA - P&I).
    function monthlyBreakdownHtml(s) {
      const pi = isFinite(s.pi) ? s.pi : NaN;
      const piti = isFinite(s.piti) ? s.piti : NaN;
      const bd = s.paymentBreakdown;
      const haveBd = bd && (
        isFinite(bd.firstMortgagePi) ||
        isFinite(bd.propertyTaxes) ||
        isFinite(bd.homeownersInsurance) ||
        isFinite(bd.mortgageInsurance)
      );
      let rows = '';
      if (haveBd) {
        // Always show the three core PITIA components even if 0;
        // hide MI / HOA / Other only when they're 0 (or NaN), so a
        // borrower who isn't paying them doesn't see a confusing
        // empty line. P&I uses the popup value when available, the
        // card-level value otherwise.
        const piVal = isFinite(bd.firstMortgagePi) ? bd.firstMortgagePi : pi;
        rows += '<tr><th>Principal &amp; interest</th><td>' + fmtMoneyHtml(piVal) + '</td></tr>';
        if (isFinite(bd.mortgageInsurance) && bd.mortgageInsurance > 0) {
          rows += '<tr><th>Mortgage insurance</th><td>' + fmtMoneyHtml(bd.mortgageInsurance) + '</td></tr>';
        }
        rows += '<tr><th>Property taxes</th><td>' + fmtMoneyHtml(bd.propertyTaxes) + '</td></tr>';
        rows += '<tr><th>Homeowner&rsquo;s insurance</th><td>' + fmtMoneyHtml(bd.homeownersInsurance) + '</td></tr>';
        if (isFinite(bd.hoa) && bd.hoa > 0) {
          rows += '<tr><th>HOA</th><td>' + fmtMoneyHtml(bd.hoa) + '</td></tr>';
        }
        if (isFinite(bd.other) && bd.other > 0) {
          rows += '<tr><th>Other</th><td>' + fmtMoneyHtml(bd.other) + '</td></tr>';
        }
        const total = isFinite(bd.totalMonthlyPayment) ? bd.totalMonthlyPayment : piti;
        rows += '<tr class="total"><th>Estimated monthly cost (PITIA)</th><td>' + fmtMoneyHtml(total) + '</td></tr>';
      } else {
        const escrows = (isFinite(pi) && isFinite(piti)) ? Math.max(0, piti - pi) : NaN;
        rows += '<tr><th>Principal &amp; interest</th><td>' + fmtMoneyHtml(pi) + '</td></tr>';
        rows += '<tr><th>MI, taxes, insurance &amp; HOA</th><td>' + fmtMoneyHtml(escrows) + '</td></tr>';
        rows += '<tr class="total"><th>Estimated monthly cost (PITIA)</th><td>' + fmtMoneyHtml(piti) + '</td></tr>';
      }
      return '<table class="p2tbl">' + rows + '</table>';
    }

    function p2Page(s, idx, total) {
      const financedMip = fhaMipFor(s);
      const netClosing = (isFinite(s.closingCosts) ? s.closingCosts : 0) -
        (isFinite(s.sellerCredit) ? s.sellerCredit : 0) -
        financedMip;
      return (
        '<section class="p2card">' +
          '<header class="p2card-hdr">' +
            '<div class="p2card-eyebrow">' +
              'Loan Comparison · Detailed cost summary' +
              (total > 1 ? ' &nbsp;·&nbsp; Scenario ' + (idx + 1) + ' of ' + total : '') +
            '</div>' +
            '<h2>' + escapeHtml(s.title) + '</h2>' +
            '<div class="p2sub">Purchase price ' + fmtMoneyHtml(s.purchasePrice) +
              ' · Loan ' + fmtMoneyHtml(s.loanAmount) +
              ' · Rate ' + fmtPctHtml(s.interestRate) +
              ' · APR ' + fmtPctHtml(s.apr) +
            '</div>' +
          '</header>' +
          '<div class="p2top">' +
            '<div class="p2top-col">' +
              '<h3>Monthly cost breakdown</h3>' +
              monthlyBreakdownHtml(s) +
            '</div>' +
            '<div class="p2top-col">' +
              '<h3>Cash at closing</h3>' +
              '<table class="p2tbl">' +
                '<tr><th>Down payment</th><td>' + fmtMoneyHtml(s.downPaymentAmount) + '</td></tr>' +
                '<tr><th>Net closing cost to borrower</th><td>' + fmtMoneyHtml(netClosing) + '</td></tr>' +
                (financedMip > 0
                  ? '<tr class="p2note-row"><td colspan="2">FHA MIP of ' + fmtMoneyHtml(financedMip) +
                    ' is financed into the loan amount &mdash; not paid at closing. (Total closing costs in the itemized table below still reflects the full amount per TRID.)</td></tr>'
                  : '') +
                '<tr class="total"><th>Cash (to) / from at closing</th><td>' + fmtMoneyHtml(s.cashToFrom) + '</td></tr>' +
              '</table>' +
            '</div>' +
          '</div>' +
          '<h3 class="p2cc-hdr">Itemized closing costs</h3>' +
          itemizedClosingHtml(s.closingDetail, s) +
          '<div class="p2foot">' +
            'Points: ' + (isFinite(s.pointsPct) ? s.pointsPct.toFixed(3) + '%' : '&mdash;') +
              (isFinite(s.pointsDollar) ? ' (' + fmtMoneyHtml(s.pointsDollar) + ')' : '') +
            ' &nbsp;·&nbsp; LTV ' + fmtPctHtml(s.ltv) +
            ' &nbsp;·&nbsp; Lock ' + escapeHtml(s.lockPeriod || '&mdash;') +
          '</div>' +
        '</section>'
      );
    }
    const page2Cards = scenarios.map(function (s, i) { return p2Page(s, i, scenarios.length); }).join('');

    const borrowerLine = borrowerName
      ? '<div class="borrower">' + escapeHtml(borrowerName) + '</div>'
      : '<div class="borrower">' + scenarios.length + ' scenario' + (scenarios.length === 1 ? '' : 's') + '</div>';

    const docTitle = isGrant ? 'ZHL 2% Grant' : 'Loan Comparison';
    const h1Text = isGrant ? 'ZHL 2% Grant Comparison' : 'Loan Comparison';
    const bannerText = isGrant
      ? 'Includes a ZHL Grant equal to 2% of the loan amount applied toward your down payment, reducing your cash to close. Your actual rate, payment and costs could be higher: get an official loan estimate before choosing a loan.'
      : 'Your actual rate, payment and costs could be higher: get an official loan estimate before choosing a loan.';
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + docTitle + ' — ' + escapeHtml(dateStr) + '</title>' +
      '<style>' +
      '@page { size: letter; margin: 0; }' +
      'body { font: 10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 0.55in 0.7in; max-width: 8.5in; box-sizing: border-box; }' +
      // Header
      '.zhl-hdr { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8pt; border-bottom: 1.5pt solid #006aff; }' +
      '.zhl-hdr h1 { margin: 0; font-size: 18pt; color: #1f2937; font-weight: 700; }' +
      '.zhl-hdr .borrower { color: #6b7280; font-size: 10pt; margin-top: 2pt; }' +
      '.zhl-hdr .brand-block { text-align: right; }' +
      '.zhl-hdr .issued { color: #6b7280; font-size: 8.5pt; margin-top: 3pt; }' +
      // Banner
      '.banner { text-align: center; padding: 8pt 4pt 12pt; color: #374151; font-size: 10pt; }' +
      // Page 1 table
      'table.cmp { width: 100%; border-collapse: collapse; margin-top: 4pt; }' +
      'table.cmp th { text-align: left; padding: 5pt 8pt; font-size: 9.5pt; font-weight: 600; color: #1f2937; }' +
      'table.cmp tr.head th { color: #1f2937; background: #f3f4f6; font-weight: 700; font-size: 10pt; padding-top: 8pt; padding-bottom: 8pt; border-bottom: 1.5pt solid #d1d5db; text-align: left; }' +
      'table.cmp tr.head th:first-child { text-align: left; }' +
      'table.cmp td { padding: 5pt 8pt; font-size: 9.5pt; text-align: right; font-variant-numeric: tabular-nums; color: #1f2937; }' +
      'table.cmp tr:nth-child(even) th, table.cmp tr:nth-child(even) td { background: #f9fafb; }' +
      // Big rows: estimated monthly cost (PITIA) and Cash (to)/from
      'table.cmp tr.big th, table.cmp tr.big td { font-size: 13pt; font-weight: 700; color: #006aff; padding-top: 8pt; padding-bottom: 8pt; border-top: 1pt solid #006aff; border-bottom: 1pt solid #006aff; background: #f5f9ff !important; }' +
      // Spacer rows
      'table.cmp tr.spacer td { background: #ffffff !important; padding: 4pt 0; border: none; height: 6pt; }' +
      // LO contact box
      '.lo-box { margin-top: 16pt; border: 1pt solid #006aff; border-radius: 4pt; padding: 10pt 14pt; text-align: center; }' +
      '.lo-box .lo-line { font-size: 10pt; color: #1f2937; }' +
      '.lo-box .lo-line strong { color: #1f2937; }' +
      '.lo-box .lo-line .phone-icon { color: #006aff; margin-right: 4pt; }' +
      '.lo-box .lo-tagline { font-size: 9pt; color: #1f2937; font-weight: 600; margin-top: 6pt; }' +
      // Compliance footer
      '.compliance { margin-top: 14pt; font-size: 7.5pt; color: #6b7280; line-height: 1.4; }' +
      // Page 2+ : one full page per scenario.
      //
      // page-break-before: always on every .p2card sends each
      // scenario to a fresh page. We deliberately do NOT set
      // page-break-inside: avoid — long itemized closing-cost
      // tables are allowed to spill into a continuation page so we
      // don't trigger a phantom blank between scenarios when a
      // card can't fit on one page.
      // Each scenario page is tuned to fit on a single letter page.
      // To stay within ~9.9in of vertical space, we (a) use a
      // tighter top margin via a smaller .p2card body padding,
      // (b) use a compact masthead, and (c) split the itemized
      // closing-cost table into two side-by-side columns so the
      // ~30 rows take ~half the vertical space.
      '.p2card { page-break-before: always; padding-top: 4pt; }' +
      '.p2card-hdr { padding-bottom: 5pt; border-bottom: 1.5pt solid #006aff; margin-bottom: 8pt; }' +
      '.p2card-hdr .p2card-eyebrow { color: #006aff; font-size: 8pt; font-weight: 600; letter-spacing: 0.5pt; text-transform: uppercase; margin-bottom: 2pt; }' +
      '.p2card h2 { margin: 0; font-size: 14pt; color: #1f2937; font-weight: 700; }' +
      '.p2card .p2sub { color: #6b7280; font-size: 9pt; margin-top: 2pt; }' +
      // Top block: monthly + cash side-by-side
      '.p2top { display: flex; gap: 18pt; margin-bottom: 10pt; }' +
      '.p2top-col { flex: 1; }' +
      '.p2top-col h3 { margin: 0 0 3pt; font-size: 9.5pt; color: #1f2937; font-weight: 700; border-bottom: 1pt solid #d1d5db; padding-bottom: 2pt; }' +
      // Small two-row tables (monthly + cash)
      'table.p2tbl { width: 100%; border-collapse: collapse; }' +
      'table.p2tbl th { text-align: left; padding: 2pt 0; font-size: 9pt; font-weight: 400; color: #374151; }' +
      'table.p2tbl td { text-align: right; padding: 2pt 0; font-size: 9pt; font-variant-numeric: tabular-nums; color: #1f2937; }' +
      'table.p2tbl tr.total th, table.p2tbl tr.total td { font-weight: 700; color: #006aff; border-top: 1pt solid #006aff; padding-top: 3pt; }' +
      // Inline note explaining the financed-MIP carve-out (FHA loans).
      'table.p2tbl tr.p2note-row td { font-size: 7.5pt; font-style: italic; color: #6b7280; padding: 1pt 0 4pt 8pt; text-align: left; }' +
      '.p2note-inline { font-size: 7.5pt; font-style: italic; font-weight: 400; color: #6b7280; }' +
      // Itemized closing-cost heading
      'h3.p2cc-hdr { margin: 0 0 5pt; font-size: 10.5pt; color: #1f2937; font-weight: 700; border-bottom: 1pt solid #006aff; padding-bottom: 3pt; }' +
      // Two-column layout for the itemized table
      '.p2cc-grid { display: flex; gap: 14pt; align-items: flex-start; margin-bottom: 6pt; }' +
      '.p2cc-col { flex: 1; min-width: 0; }' +
      // Itemized closing-cost table — ZHL blue scheme to match
      // page 1, NOT the black-block look of LOP's raw popup
      'table.p2cc { width: 100%; border-collapse: collapse; }' +
      'table.p2cc th { text-align: left; padding: 1.5pt 6pt; font-size: 8pt; font-weight: 400; color: #1f2937; line-height: 1.25; }' +
      'table.p2cc td { text-align: right; padding: 1.5pt 6pt; font-size: 8pt; font-variant-numeric: tabular-nums; color: #1f2937; line-height: 1.25; }' +
      // Section header (Loan costs / Other costs / Credits) —
      // ZHL blue background, white text.
      'table.p2cc tr.cc-section th { background: #006aff !important; color: #fff !important; font-weight: 700; font-size: 9pt; padding: 3.5pt 6pt; letter-spacing: 0.3pt; }' +
      // Subsection header (Lender costs, Prepaids, etc.)
      'table.p2cc tr.cc-subsection th { font-weight: 700; color: #1e3a8a; font-size: 8.5pt; padding-top: 4pt; padding-bottom: 1.5pt; border-bottom: 0.5pt solid #bfdbfe; }' +
      // Subsection total — bold with a hairline divider above
      'table.p2cc tr.cc-subtotal th, table.p2cc tr.cc-subtotal td { font-weight: 700; color: #1f2937; border-top: 0.5pt solid #d1d5db; padding-top: 2pt; padding-bottom: 3pt; }' +
      // Section grand total (Total loan costs, Total other costs)
      'table.p2cc tr.cc-sectiontotal th, table.p2cc tr.cc-sectiontotal td { font-weight: 700; color: #1f2937; background: #eef6ff !important; padding: 3pt 6pt; border-top: 1pt solid #bfdbfe; }' +
      // Total loan and other costs
      'table.p2cc tr.cc-grand th, table.p2cc tr.cc-grand td { font-weight: 700; color: #1f2937; background: #eef6ff !important; padding: 3pt 6pt; border-top: 1pt solid #bfdbfe; }' +
      // Final Total closing costs — the headline number, ZHL blue
      'table.p2cc tr.cc-grandtotal th, table.p2cc tr.cc-grandtotal td { font-weight: 700; color: #006aff; background: #f5f9ff !important; padding: 4.5pt 6pt; border-top: 1.5pt solid #006aff; border-bottom: 1.5pt solid #006aff; font-size: 10pt; }' +
      // Footer table (Credits + grand totals) sits below the
      // two-column grid at full width
      'table.p2cc-footer { margin-top: 6pt; }' +
      '.p2note { margin-top: 4pt; font-size: 7pt; color: #6b7280; font-style: italic; }' +
      '.p2foot { margin-top: 6pt; padding-top: 4pt; border-top: 0.5pt solid #e5e7eb; font-size: 8pt; color: #6b7280; }' +
      '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }' +
      '</style></head><body>' +
      // Page 1
      '<header class="zhl-hdr">' +
        '<div>' +
          '<h1>' + escapeHtml(h1Text) + '</h1>' +
          borrowerLine +
        '</div>' +
        '<div class="brand-block">' +
          '<div class="issued">Issued ' + escapeHtml(dateStr) + '</div>' +
        '</div>' +
      '</header>' +
      '<div class="banner">' + escapeHtml(bannerText) + '</div>' +
      '<table class="cmp">' + rowsHtml + '</table>' +
      loBox +
      '<div class="compliance">' +
        'This worksheet is for illustration only — final pricing, rate, and closing costs are subject to credit approval and underwriting review. Not a commitment to lend. ' +
        'Zillow Home Loans, LLC. NMLS # 10287.' +
      '</div>' +
      // Page 2 onward: one full page per scenario. Each .p2card
      // carries its own page-break-before: always so we don't need
      // an explicit page-break element here, AND we don't render
      // a separate (blank-looking) intro page anymore — the
      // per-card masthead carries the same context.
      page2Cards +
      '</body></html>';
  }

  function openPrintWindow(html) {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Could not open print window. Please allow popups for this site and try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (_) {}
    }, 400);
  }

  async function onComparisonPdfClick() {
    const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
    if (btn && btn.disabled) return;
    // Time saved: ~5 min vs hand-building a side-by-side comparison PDF.
    if (window.__zhlTimeSaved) window.__zhlTimeSaved.recordAndForget('loan-comparison-pdf', 5);
    const cards = findSelectedScenarioCards();
    if (!cards.length) return;

    // While we open / close each card's closing-costs popup in
    // sequence, disable the button and show progress so the user
    // knows what's happening (and doesn't double-click).
    const originalText = btn ? btn.textContent : '';
    const originalBg = btn ? btn.style.background : '';
    if (btn) {
      btn.disabled = true;
      btn.style.background = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.style.cursor = 'wait';
    }

    const scenarios = [];
    for (let i = 0; i < cards.length; i++) {
      if (btn) btn.textContent = 'Reading ' + (i + 1) + ' / ' + cards.length + '…';
      const data = readScenario(cards[i]);
      try {
        data.closingDetail = await scrapeClosingDetail(cards[i]);
      } catch (e) {
        console.warn('[ZHL Loan Comparison PDF] closing-detail scrape failed for card', i + 1, e);
        data.closingDetail = null;
      }
      try {
        data.paymentBreakdown = await scrapePaymentBreakdown(cards[i]);
      } catch (e) {
        console.warn('[ZHL Loan Comparison PDF] payment-breakdown scrape failed for card', i + 1, e);
        data.paymentBreakdown = null;
      }
      scenarios.push(data);
    }

    if (btn) {
      btn.textContent = originalText || 'ZHL Comparison PDF';
      btn.style.background = originalBg || '#006aff';
      btn.style.borderColor = '#006aff';
      btn.style.cursor = 'pointer';
      btn.disabled = false;
    }

    const lo = await readLoProfile();
    const borrowerName = readBorrowerNames();
    const html = renderComparisonHtml(scenarios, lo, borrowerName);
    openPrintWindow(html);
  }

  async function onGrantPdfClick() {
    const btn = document.querySelector('[' + GRANT_PDF_BUTTON_ATTR + ']');
    if (btn && btn.disabled) return;
    if (!evaluateGrantEligibility().ok) return;
    if (window.__zhlTimeSaved) window.__zhlTimeSaved.recordAndForget('loan-grant-pdf', 5);
    const cards = findSelectedScenarioCards();
    if (!cards.length) return;

    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.style.background = '#94a3b8';
      btn.style.borderColor = '#94a3b8';
      btn.style.cursor = 'wait';
    }
    const scenarios = [];
    for (let i = 0; i < cards.length; i++) {
      if (btn) btn.textContent = 'Reading ' + (i + 1) + ' / ' + cards.length + '…';
      const data = readScenario(cards[i]);
      try { data.closingDetail = await scrapeClosingDetail(cards[i]); }
      catch (e) { data.closingDetail = null; }
      try { data.paymentBreakdown = await scrapePaymentBreakdown(cards[i]); }
      catch (e) { data.paymentBreakdown = null; }
      scenarios.push(data);
    }
    if (btn) {
      btn.textContent = originalText || '2% Grant PDF';
      btn.style.background = '#006aff';
      btn.style.borderColor = '#006aff';
      btn.style.cursor = 'pointer';
      btn.disabled = false;
    }
    const lo = await readLoProfile();
    const borrowerName = readBorrowerNames();
    const html = renderComparisonHtml(scenarios, lo, borrowerName, { grant: true });
    openPrintWindow(html);
  }

  // ---- Scan loop ------------------------------------------------

  function scan() {
    if (!isOnScenariosPage()) {
      const btn = document.querySelector('[' + BRANDED_PDF_BUTTON_ATTR + ']');
      if (btn) btn.remove();
      return;
    }
    ensureLoanComparisonPdfButton();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[ZHL Loan Comparison PDF] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Update button state on every checkbox change (selection toggle).
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'checkbox') schedule();
  }, true);
  setInterval(schedule, 2000);
  schedule();

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
