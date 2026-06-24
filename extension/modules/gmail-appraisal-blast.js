// ZHL Productivity Pack module — feature key: feature_appraisalBlast
//
// When the LO opens a Reggora appraisal notification email in Gmail
// (either "Appraisal Submission Summary" or "Low appraisal valuation"),
// this module injects a floating "Send to all parties" button.
// On click it:
//   1. Parses the email for loan number, last name, property address,
//      appraised value, purchase price, condition, and low-value flag.
//      Two body formats are supported — the standard submission email
//      with structured "Appraised value / Estimated value / Reconciliation
//      / Report Condition / Low Value" lines, and the low-valuation
//      email with prose "The appraisal valued the property at $X.
//      The Purchase Price is $Y." (no condition info).
//   2. Asks the background service worker to look up the loan in
//      Salesforce and return every Contact Role's email.
//   3. Buckets contacts into TO (Borrower, Co-Borrower, Buyer's Agent,
//      Transaction Coordinator) and CC (Processor).
//   4. Builds BOTH a plain-text body (for Gmail's compose-URL `body=`
//      param) AND a styled HTML body that matches the VPA email
//      aesthetic (ZHL logo, Calibri body, Georgia ZHL-blue headings,
//      framed highlight box with appraised / purchase / equity numbers).
//   5. Stashes the HTML in chrome.storage.local, writes HTML+plain to
//      the clipboard as a Ctrl+V fallback, and opens a Gmail compose
//      tab with TO / CC / Subject pre-filled.
//   6. On the new compose tab, the same script (loaded automatically
//      because the content_script matches mail.google.com/*) sees
//      the pending paste, locates the contenteditable compose body,
//      and replaces the plain text with the formatted HTML — mirroring
//      the VPA paste pattern.
// Nothing sends automatically; the LO reviews and hits Send.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_appraisalBlast';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Appraisal Blast v' + VERSION + '] loaded on', location.href);

  // Subjects we accept. The standard submission email begins with
  // "Appraisal Submission Summary:"; Reggora's low-value flag email
  // begins with "Low appraisal valuation:". Both share the same
  // "#ZG... - LastName, Address (County County)" tail in the subject
  // so name/address parsing is unified.
  const SUBJECT_PATTERNS = [
    /^Appraisal Submission Summary[:\s]/i,
    /^Low appraisal valuation[:\s]/i
  ];

  const NAVY = '#1F3864', GOLD = '#BF8F00';
  const ZHL_BLUE = '#0E35C4';
  const ZHL_TEXT_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/ZIllow%20Home%20Loans%20Text.png';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  // Paste handoff: identical pattern to gmail-vpa-paste.js — stash
  // formatted HTML under a per-feature key with a TTL, then on the
  // new compose tab the same content script finds the pending entry
  // and paints it into the contenteditable body.
  const PASTE_STORAGE_KEY = 'zhlAppraisalBlastPendingPaste';
  const PASTE_TTL_MS = 10 * 60 * 1000;

  let panelInjected = false;
  let creditedTimeSaved = false;

  // -------- helpers ----------------------------------------------
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function money(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // -------- detect the open email --------
  function openEmailSubject() {
    const h =
      document.querySelector('h2[data-thread-perm-id]') ||
      document.querySelector('h2.hP') ||
      document.querySelector('div.ha h2');
    return h ? (h.textContent || '').trim() : '';
  }

  function openEmailBodyText() {
    const bodyEl =
      document.querySelector('div.a3s.aiL') ||
      document.querySelector('div[role="listitem"] div.a3s') ||
      document.querySelector('div.adn div.a3s');
    return bodyEl ? bodyEl.innerText : '';
  }

  function subjectMatches(subj) {
    for (const re of SUBJECT_PATTERNS) if (re.test(subj)) return true;
    return false;
  }

  function tick() {
    const subj = openEmailSubject();
    const matches = subjectMatches(subj);
    if (matches && !panelInjected) injectPanel();
    else if (!matches && panelInjected) removePanel();
  }

  // -------- floating panel --------
  function injectPanel() {
    if (document.getElementById('zhl-ab-panel')) return;
    const p = document.createElement('div');
    p.id = 'zhl-ab-panel';
    p.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:' + NAVY + ';' +
      'color:#fff;font:13px/1.4 system-ui,Arial,sans-serif;padding:14px 16px;border-radius:10px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:340px';
    p.title = ZHL_TIP;
    const h = document.createElement('div');
    h.textContent = 'Appraisal Blast';
    h.style.cssText = 'font-weight:700;margin-bottom:8px;font-size:14px';
    p.appendChild(h);
    const btn = document.createElement('button');
    btn.id = 'zhl-ab-btn';
    btn.textContent = '📧  Send to all parties';
    btn.style.cssText =
      'background:' + GOLD + ';color:#fff;border:0;padding:9px 12px;border-radius:6px;' +
      'cursor:pointer;font-weight:700;width:100%;font-size:13px';
    btn.addEventListener('click', onClick);
    p.appendChild(btn);
    const status = document.createElement('div');
    status.id = 'zhl-ab-status';
    status.style.cssText = 'margin-top:8px;font-size:12px;color:#D6E4F0;white-space:pre-wrap';
    p.appendChild(status);
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = 'hide';
    close.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;opacity:.7;font-size:16px';
    close.addEventListener('click', function () { p.remove(); panelInjected = false; });
    p.appendChild(close);
    document.body.appendChild(p);
    panelInjected = true;
  }

  function removePanel() {
    const p = document.getElementById('zhl-ab-panel');
    if (p) p.remove();
    panelInjected = false;
  }

  function setStatus(text) {
    const s = document.getElementById('zhl-ab-status');
    if (s) s.textContent = text;
  }

  // -------- parse the appraisal email --------
  // Subject pattern (shared by both email variants):
  //   "<prefix>: #ZG001234567 - LastName, 1302 W A St, Kannapolis NC 28081 (Rowan County)"
  // Body shape varies — see comments inside.
  function parseEmail() {
    const subject = openEmailSubject();
    const body = openEmailBodyText();

    // Loan number. Subject is the primary source; body provides a
    // backup ("loan ZG..." in the submission email, "Loan Number:
    // #ZG..." or "Loan Number: ZG..." in the low-value email).
    const loan =
      (subject.match(/#\s*(ZG\d+)/) || [])[1] ||
      (body.match(/Loan Number:\s*#?\s*(ZG\d+)/i) || [])[1] ||
      (body.match(/loan\s+(ZG\d+)/i) || [])[1] || '';

    // Last name from the subject's "#ZG... - <Last>, ..." segment.
    const ln = subject.match(/#\s*ZG\d+\s*-\s*([^,]+?),/i);
    const lastName = ln ? ln[1].trim() : '';

    // Property address. Subject's tail is the primary source; both
    // body formats can serve as a backup ("at <addr> (..." in the
    // submission email, "Order Address: <addr> (..." in the
    // low-value email).
    const addrMatch =
      subject.match(/#\s*ZG\d+\s*-\s*[^,]+,\s*(.+?)\s*\(/i) ||
      body.match(/Order Address:\s*(.+?)\s*\(/i) ||
      body.match(/at\s+(.+?)\s*\(/i);
    const address = addrMatch ? addrMatch[1].trim() : '';

    // Branch on email variant. The low-value email is unambiguously
    // marked by its subject prefix; the submission email carries its
    // own "Low Value: YES/NO" line that may also indicate a low
    // value even when the subject is the standard prefix.
    const isLowValueEmail = /^Low appraisal valuation/i.test(subject);

    let appraised = 0, purchase = 0, condition = '', lowValue = 'NO', pdr = false;

    if (isLowValueEmail) {
      // "The appraisal valued the property at $175000.00.
      //  The Purchase Price is $178000.00."
      const aMatch = body.match(/valued the property at\s*\$?([\d,]+(?:\.\d{2})?)/i);
      appraised = aMatch ? parseFloat(aMatch[1].replace(/,/g, '')) : 0;
      const pMatch = body.match(/Purchase\s*Price\s*is\s*\$?([\d,]+(?:\.\d{2})?)/i);
      purchase = pMatch ? parseFloat(pMatch[1].replace(/,/g, '')) : 0;
      condition = ''; // not present in the low-value email
      lowValue = 'YES'; // implied by the subject prefix
    } else {
      // Standard submission email — structured field lines.
      const num = function (re) {
        const m = body.match(re);
        return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
      };
      appraised = num(/Appraised value:\s*\$?([\d,]+(?:\.\d{2})?)/i);
      purchase  = num(/Estimated value:\s*\$?([\d,]+(?:\.\d{2})?)/i);

      // "Appraised value: N/A" means Reggora did a Property Data
      // Report (PDR) — a condition check rather than a numeric
      // appraisal. The home was verified in good shape; there is no
      // appraised dollar amount to compare against the purchase price.
      // We surface this so buildMessage / buildHtmlBody can render an
      // "at value, came back good via PDR" message instead of treating
      // the missing number as a $0 appraised value and therefore a
      // huge shortfall.
      pdr = /Appraised value:\s*N\/A/i.test(body);
      if (pdr) {
        // Equity math should land on $0 (not negative purchase price),
        // and the low-value path must not fire.
        appraised = purchase;
        lowValue = 'NO';
      }

      // Reggora writes "Reconciliation/Report Condition: <value>"
      // (no spaces around the slash in the screenshots). The regex
      // is permissive about whitespace either way. Condition can be
      // a single token like "AsIs" or a semicolon-joined list like
      // "SubjectToRepairs;SubjectToInspections".
      const condMatch = body.match(/Reconciliation\s*\/\s*Report\s*Condition:\s*([^\r\n]+)/i);
      condition = condMatch ? condMatch[1].trim() : '';
      // PDR emails carry "Condition: N/A" — don't pass that through to
      // the rendered email body; it isn't informative.
      if (pdr && /^n\/a$/i.test(condition)) condition = '';

      const lowMatch = body.match(/Low\s*Value:\s*(YES|NO)/i);
      if (!pdr) {
        lowValue = lowMatch ? lowMatch[1].toUpperCase() : 'NO';
      }
    }

    return { loan: loan, lastName: lastName, address: address,
             appraised: appraised, purchase: purchase,
             condition: condition, lowValue: lowValue,
             pdr: pdr };
  }

  // -------- build the email --------
  // TO: Borrower, Co-Borrower, Buyer's Agent, Transaction Coordinator
  // CC: Processor
  const TO_ROLES = ['borrower', 'coborrower', 'buyersagent', 'transactioncoordinator'];
  const CC_ROLES = ['processor'];
  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, ''); }

  function bucketContacts(contacts) {
    const to = [], cc = [];
    contacts.forEach(function (c) {
      if (!c.email) return;
      const r = norm(c.role);
      if (TO_ROLES.indexOf(r) !== -1) to.push(c.email);
      else if (CC_ROLES.indexOf(r) !== -1) cc.push(c.email);
    });
    return { to: to, cc: cc };
  }

  // Map Reggora's condition codes to borrower-readable phrasing.
  // Handles single values ("AsIs"), semicolon-joined lists
  // ("SubjectToRepairs;SubjectToInspections"), and "Subject to ..."
  // variants by token: repairs, inspections, completion. Falls
  // back to the raw text if nothing matches.
  function conditionPhrase(condition) {
    if (!condition) return '';
    const parts = condition.split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    const flat = parts.map(function (s) { return s.toLowerCase().replace(/[\s\-]+/g, ''); });

    const isAsIs = flat.some(function (n) { return n === 'asis'; });
    const hasRepairs     = flat.some(function (n) { return n.indexOf('subjecttorepair')     >= 0; });
    const hasInspections = flat.some(function (n) { return n.indexOf('subjecttoinspection') >= 0; });
    const hasCompletion  = flat.some(function (n) { return n.indexOf('subjecttocompletion') >= 0; });
    const anySubjectTo = hasRepairs || hasInspections || hasCompletion;

    if (isAsIs && !anySubjectTo) {
      return 'as-is, so no repairs are required';
    }

    if (anySubjectTo) {
      const items = [];
      if (hasRepairs) items.push('repairs');
      if (hasInspections) items.push('inspections');
      if (hasCompletion) items.push('completion');
      let joined;
      if (items.length === 1) joined = items[0];
      else if (items.length === 2) joined = items.join(' and ');
      else joined = items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
      return 'subject to ' + joined + ' — see the report for the required items';
    }

    // Unrecognized — keep the raw condition text.
    return condition;
  }

  function buildMessage(data, contacts) {
    const buckets = bucketContacts(contacts);
    const equity = data.appraised - data.purchase;
    const pdr = !!data.pdr;
    const lowValue = !pdr && (data.lowValue === 'YES' || equity < 0);

    const subject = 'Appraisal Received - ' + data.lastName + ' - ' + data.address;

    // Plain-text body — Gmail's compose-URL `body=` param renders this
    // verbatim, and it's also the Ctrl+V fallback if the HTML paste
    // never lands. Gmail appends the LO's signature automatically.
    let body;
    if (pdr) {
      // Property Data Report: no numeric appraised value, but the home
      // was verified in good condition. Reads "good and at value" so
      // the buyer / agent don't see a misleading $0 / shortfall.
      body =
'Hey all,\n\n' +
'Great news — the appraisal on ' + data.address + ' came back good and at value via Property Data Report. 🎉\n\n' +
'Reach out with any questions.';
    } else if (lowValue) {
      body =
'Hey all,\n\n' +
'The appraisal on ' + data.address + ' came back at ' + money(data.appraised) +
' against a purchase price of ' + money(data.purchase) + '. Let\'s connect on next steps.';
      if (data.condition) {
        body += '\n\nThe home came back ' + conditionPhrase(data.condition) + '.';
      }
    } else {
      // Celebration variant. Only mention immediate equity when the
      // appraisal beat the purchase price (equity > 0); at a flat
      // appraisal there's no equity to celebrate.
      body =
'Hey all,\n\n' +
'Congratulations! The appraisal on ' + data.address + ' came back at ' +
money(data.appraised) + '. We\'re purchasing for ' + money(data.purchase) +
(equity > 0 ? ', which means ' + money(equity) + ' in immediate equity 🎉' : '. 🎉');
      if (data.condition) {
        body += '\n\nThe home came back ' + conditionPhrase(data.condition) + '.';
      }
      body += '\n\nReach out with any questions.';
    }
    return { to: buckets.to, cc: buckets.cc, subject: subject, body: body };
  }

  // Pretty HTML body — mirrors the VPA email's visual language:
  // ZHL logo at top, Calibri body, Georgia ZHL-blue headlines, a
  // bordered highlight box for the dollar figures. Colors switch
  // between celebration green (#16a34a) and amber/red warning
  // (#D97706 / #b91c1c) for the low-value variant.
  function buildHtmlBody(data) {
    const equity = data.appraised - data.purchase;
    const pdr = !!data.pdr;
    const lowValue = !pdr && (data.lowValue === 'YES' || equity < 0);
    const condPhrase = conditionPhrase(data.condition);

    const wrapStyle =
      'font-family: Calibri, Arial, sans-serif; font-size: 14.5px; ' +
      'color: #000000; line-height: 1.5;';
    const h1Style =
      'color: ' + ZHL_BLUE + '; font-size: 26px; font-weight: bold; ' +
      'margin: 0 0 14px 0; font-family: Georgia, \'Times New Roman\', serif;';
    const labelStyle =
      'font-size: 11px; color: #6b7280; letter-spacing: 0.6px; ' +
      'text-transform: uppercase; margin-bottom: 2px;';

    const logoTag =
      '<img src="' + ZHL_TEXT_URL + '" alt="Zillow Home Loans" width="300" height="44" ' +
      'style="display: block; margin: 0 0 18px 0;"/>';

    const addressH = escHtml(data.address);
    const appraisedH = escHtml(money(data.appraised));
    const purchaseH = escHtml(money(data.purchase));

    let headline, intro, highlightBox, closing;

    if (pdr) {
      // Property Data Report variant. Same green / celebratory palette
      // as the normal "came back at value" path, but the highlight box
      // omits the dollar-amount equity row and instead labels the
      // result as "Came back at value" so the borrower / agents don't
      // see a $0 figure that reads as a misfire.
      headline = '<h1 style="' + h1Style + '">🎉 Appraisal Results</h1>';
      intro = '<p>Great news &mdash; the appraisal on <strong>' + addressH +
              '</strong> came back <strong>good and at value</strong> via Property Data Report.</p>';
      highlightBox =
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" ' +
          'style="margin: 18px 0; border-collapse: collapse;">' +
          '<tr><td style="background: #F5F9FF; border-left: 4px solid ' + ZHL_BLUE + '; padding: 16px 20px;">' +
            '<div style="' + labelStyle + '">Purchase price</div>' +
            '<div style="font-size: 22px; color: ' + ZHL_BLUE + '; font-weight: bold; ' +
              'font-family: Georgia, \'Times New Roman\', serif; margin-bottom: 12px;">' +
              purchaseH + '</div>' +
            '<div style="' + labelStyle + '">Appraisal result</div>' +
            '<div style="font-size: 18px; color: #16a34a; font-weight: bold;">' +
              'Came back at value &mdash; verified in good condition ✓</div>' +
          '</td></tr>' +
        '</table>';
      closing = '<p style="margin-top: 18px;">Reach out with any questions!</p>';
    } else if (lowValue) {
      const shortfall = Math.max(0, data.purchase - data.appraised);
      headline = '<h1 style="' + h1Style + '">Appraisal Results</h1>';
      intro = '<p>The appraisal on <strong>' + addressH + '</strong> has come back.' +
              ' Let&rsquo;s connect on next steps.</p>';
      highlightBox =
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" ' +
          'style="margin: 18px 0; border-collapse: collapse;">' +
          '<tr><td style="background: #FEF7E0; border-left: 4px solid #D97706; padding: 16px 20px;">' +
            '<div style="' + labelStyle + '">Appraised value</div>' +
            '<div style="font-size: 22px; color: #D97706; font-weight: bold; ' +
              'font-family: Georgia, \'Times New Roman\', serif; margin-bottom: 12px;">' +
              appraisedH + '</div>' +
            '<div style="' + labelStyle + '">Purchase price</div>' +
            '<div style="font-size: 18px; color: #111827; font-weight: bold; margin-bottom: 12px;">' +
              purchaseH + '</div>' +
            (shortfall > 0 ? (
              '<div style="' + labelStyle + '">Shortfall</div>' +
              '<div style="font-size: 18px; color: #b91c1c; font-weight: bold;">' +
                escHtml(money(shortfall)) + '</div>'
            ) : '') +
          '</td></tr>' +
        '</table>';
      closing = '<p style="margin-top: 18px;">I&rsquo;ll follow up shortly with options.</p>';
    } else {
      headline = '<h1 style="' + h1Style + '">🎉 Congratulations!</h1>';
      intro = '<p>Great news &mdash; the appraisal on <strong>' + addressH +
              '</strong> just came back.</p>';
      highlightBox =
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" ' +
          'style="margin: 18px 0; border-collapse: collapse;">' +
          '<tr><td style="background: #F5F9FF; border-left: 4px solid ' + ZHL_BLUE + '; padding: 16px 20px;">' +
            '<div style="' + labelStyle + '">Appraised value</div>' +
            '<div style="font-size: 22px; color: ' + ZHL_BLUE + '; font-weight: bold; ' +
              'font-family: Georgia, \'Times New Roman\', serif; margin-bottom: 12px;">' +
              appraisedH + '</div>' +
            '<div style="' + labelStyle + '">Purchase price</div>' +
            '<div style="font-size: 18px; color: #111827; font-weight: bold;' +
              (equity > 0 ? ' margin-bottom: 12px;' : '') + '">' +
              purchaseH + '</div>' +
            // Only show the equity row when the appraisal came in ABOVE
            // purchase price. At a flat appraisal (equity $0) the line
            // would read "$0 🎉" which is silly, so omit it entirely.
            (equity > 0 ? (
              '<div style="' + labelStyle + '">Immediate equity</div>' +
              '<div style="font-size: 22px; color: #16a34a; font-weight: bold; ' +
                'font-family: Georgia, \'Times New Roman\', serif;">' +
                escHtml(money(equity)) + ' 🎉</div>'
            ) : '') +
          '</td></tr>' +
        '</table>';
      closing = '<p style="margin-top: 18px;">Reach out with any questions!</p>';
    }

    const conditionPara = condPhrase
      ? '<p>The home came back <strong>' + escHtml(condPhrase) + '</strong>.</p>'
      : '';

    return (
      '<div data-zhl-ab-html="1" style="' + wrapStyle + '">' +
        logoTag +
        headline +
        intro +
        highlightBox +
        conditionPara +
        closing +
      '</div>'
    );
  }

  function openCompose(msg) {
    const params = new URLSearchParams();
    params.set('view', 'cm');
    params.set('fs', '1');
    if (msg.to.length) params.set('to', msg.to.join(','));
    if (msg.cc.length) params.set('cc', msg.cc.join(','));
    params.set('su', msg.subject);
    params.set('body', msg.body);
    window.open('https://mail.google.com/mail/?' + params.toString(), '_blank');
  }

  // ---- Source-side: gather Reggora attachments to auto-attach ----
  //
  // Cross-window Gmail-to-Gmail drag-and-drop of attachment chips
  // doesn't work today (the gmail-drag-attachments module's
  // activeDragFile is module-scoped per content-script instance, and
  // Chrome strips JS-constructed Files from dataTransfer.files at
  // cross-window drop time). So instead of asking the LO to drag the
  // PDF over from the source Reggora email, we fetch the
  // attachment(s) on the source tab at click time, base64-encode
  // them, stash them alongside the formatted HTML body, and
  // re-inject as File objects on the new compose tab. End result:
  // when the compose draft opens, the appraisal PDF is already in
  // the attachments — no drag needed.
  //
  // Per-attachment cap: chrome.storage.local has a 10 MB total
  // quota by default. We cap each file at 4 MB so the HTML body
  // + a few attachments comfortably fit. Anything larger is logged
  // and skipped; the LO can attach it manually.

  // Raised from 4 MB to 20 MB in v1.64.21 — Reggora Property Data
  // Reports (PDRs) contain inline photos of the property and routinely
  // run 6–12 MB, well above the old cap. Standard appraisal PDFs are
  // text-heavy and stay under 4 MB, which is why the bug only showed
  // up on a PDR. 20 MB encodes to ~27 MB of base64 in storage; the
  // manifest now requests "unlimitedStorage" so we comfortably fit
  // past chrome.storage.local's default 10 MB cap.
  const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () {
        const s = String(r.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(r.error || new Error('read error')); };
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  async function gatherAttachments() {
    // Gmail's attachment chips carry a [download_url] attribute
    // formatted as "<mime>:<filename>:<url>". Same parsing pattern as
    // gmail-drag-attachments.js so we stay consistent with that
    // module's prefetched cache.
    const seen = new Set();
    const infos = [];
    document.querySelectorAll('[download_url]').forEach(function (el) {
      const dl = el.getAttribute('download_url') || '';
      const idx1 = dl.indexOf(':');
      const idx2 = dl.indexOf(':', idx1 + 1);
      if (idx1 < 1 || idx2 < idx1 + 1) return;
      let filename = dl.slice(idx1 + 1, idx2);
      try { filename = decodeURIComponent(filename); } catch (_) {}
      const info = {
        mime: dl.slice(0, idx1),
        filename: filename,
        url: dl.slice(idx2 + 1)
      };
      if (seen.has(info.url)) return;
      seen.add(info.url);
      infos.push(info);
    });
    if (!infos.length) return { files: [], skipped: [] };

    const out = [];
    const skipped = []; // {name, reason} for status reporting
    for (const info of infos) {
      try {
        // credentials: 'include' so Gmail's auth cookies tag along.
        const resp = await fetch(info.url, { credentials: 'include' });
        if (!resp.ok) {
          console.warn('[ZHL Appraisal Blast] attachment fetch HTTP ' + resp.status + ' for', info.filename);
          skipped.push({ name: info.filename, reason: 'fetch HTTP ' + resp.status });
          continue;
        }
        const blob = await resp.blob();
        if (blob.size > ATTACH_MAX_BYTES) {
          const mb = (blob.size / 1024 / 1024).toFixed(1);
          const capMb = (ATTACH_MAX_BYTES / 1024 / 1024).toFixed(0);
          console.warn('[ZHL Appraisal Blast] attachment too large to auto-attach (' +
            blob.size + ' bytes, cap ' + ATTACH_MAX_BYTES + '), skipping:', info.filename);
          skipped.push({ name: info.filename, reason: mb + ' MB > ' + capMb + ' MB cap' });
          continue;
        }
        const b64 = await blobToBase64(blob);
        out.push({
          name: info.filename || 'attachment',
          mime: info.mime || blob.type || 'application/octet-stream',
          b64: b64,
          size: blob.size
        });
        console.log('[ZHL Appraisal Blast] gathered attachment', info.filename, '(' + blob.size + ' bytes)');
      } catch (e) {
        console.warn('[ZHL Appraisal Blast] attachment fetch failed for', info.filename, e);
        skipped.push({ name: info.filename, reason: 'fetch error' });
      }
    }
    return { files: out, skipped: skipped };
  }

  // Stash + clipboard mirror of sf-vpa-email.js's stashAndClip:
  // chrome.storage.local holds the HTML so the new compose tab can
  // see it; the clipboard write is a Ctrl+V fallback for the rare
  // case where the auto-paste misses (Gmail compose body never
  // appears, extension context invalidated mid-flight, etc.). The
  // `files` array carries base64-encoded attachments for re-injection
  // into the compose's file input on the destination tab.
  function stashAndClip(html, plain, files) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set({
          [PASTE_STORAGE_KEY]: { html: html, plain: plain, files: files || [], ts: Date.now() }
        }, function () {
          try {
            const data = [new ClipboardItem({
              'text/html':  new Blob([html],  { type: 'text/html'  }),
              'text/plain': new Blob([plain], { type: 'text/plain' })
            })];
            navigator.clipboard.write(data).then(resolve, function () {
              try { navigator.clipboard.writeText(plain).then(resolve, resolve); }
              catch (_) { resolve(); }
            });
          } catch (_) {
            try { navigator.clipboard.writeText(plain).then(resolve, resolve); }
            catch (__) { resolve(); }
          }
        });
      } catch (_) { resolve(); }
    });
  }

  // -------- click handler --------
  async function onClick() {
    const btn = document.getElementById('zhl-ab-btn');
    btn.disabled = true;
    try {
      setStatus('Parsing email…');
      const data = parseEmail();
      if (!data.loan) throw new Error('Could not find loan number in this email.');
      if (!data.address) throw new Error('Could not find the property address.');

      setStatus('Looking up loan ' + data.loan + ' in Salesforce…');
      const resp = await chrome.runtime.sendMessage({
        action: 'zhlAppraisalBlast.lookupContacts',
        loanNumber: data.loan
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Salesforce lookup failed');

      const contacts = resp.contacts || [];
      const msg = buildMessage(data, contacts);
      const html = buildHtmlBody(data);

      setStatus('Gathering attachments from this email…');
      let files = [];
      let skipped = [];
      try {
        const g = await gatherAttachments();
        files = g.files || [];
        skipped = g.skipped || [];
      } catch (e) { console.warn('[ZHL Appraisal Blast] gatherAttachments failed:', e); }

      let attachSummary;
      if (files.length && skipped.length) {
        attachSummary = files.length + ' attachment' + (files.length === 1 ? '' : 's') +
          ' (skipped ' + skipped.length + ': ' + skipped.map(function (s) { return s.reason; }).join(', ') + ')';
      } else if (files.length) {
        attachSummary = files.length + ' attachment' + (files.length === 1 ? '' : 's');
      } else if (skipped.length) {
        attachSummary = 'no attachments auto-attached (skipped ' +
          skipped.map(function (s) { return s.name + ': ' + s.reason; }).join(', ') +
          ' — drag manually from the source email)';
      } else {
        attachSummary = 'no attachments';
      }
      setStatus('Found ' + contacts.length + ' contacts; ' + msg.to.length + ' on TO, ' +
        msg.cc.length + ' on CC; ' + attachSummary + '. Stashing formatted body…');
      await stashAndClip(html, msg.body, files);

      setStatus('Opening draft…');
      openCompose(msg);

      // Time saved: ~6 min vs manually pulling contacts from Salesforce,
      // typing the email, and looking up each role's address. Credit
      // once per content-script load so re-clicks don't double-count.
      if (!creditedTimeSaved && window.__zhlTimeSaved) {
        window.__zhlTimeSaved.recordAndForget('appraisal-blast', 6);
        creditedTimeSaved = true;
      }

      setTimeout(function () {
        setStatus('Draft opened. Formatted body will paste in automatically. (Ctrl+V fallback if needed.)');
      }, 600);
    } catch (e) {
      setStatus('Error: ' + (e.message || String(e)));
    } finally {
      btn.disabled = false;
    }
  }

  // -------- progress messages from background --------
  chrome.runtime.onMessage.addListener(function (m) {
    if (m && m.action === 'zhlAppraisalBlast.status') setStatus(m.text);
  });

  // -------- watch DOM --------
  const obs = new MutationObserver(function () { tick(); });
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(tick, 1500);
  tick();

  // ============================================================
  // Auto-paste of the formatted HTML into the Gmail compose body.
  // This block mirrors gmail-vpa-paste.js exactly — kept inline so
  // we don't need a separate companion content script in the
  // manifest. The same module loads on every Gmail tab; the source
  // tab does the stash + openCompose, and the new compose tab does
  // the paste (it has no Reggora email so tick() never injects the
  // panel, but the paste loop runs regardless).
  // ============================================================
  const POLL_MS = 100;
  const POLL_LIMIT = 300; // ~30 s
  let pasteRanInThisTab = false;

  function findComposeBody() {
    const all = document.querySelectorAll('div[contenteditable="true"]');
    for (const el of all) {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (aria.indexOf('message body') >= 0 ||
          aria === 'body' ||
          aria.indexOf('email body') >= 0 ||
          aria.indexOf('compose body') >= 0) {
        return el;
      }
    }
    const gmailSpecific = document.querySelector(
      'div[g_editable="true"], div.editable[contenteditable="true"]'
    );
    if (gmailSpecific) return gmailSpecific;
    let largest = null;
    let largestArea = 0;
    for (const el of all) {
      try {
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > 8000 && area > largestArea) {
          largestArea = area;
          largest = el;
        }
      } catch (_) {}
    }
    return largest;
  }

  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function doPasteInto(target, html) {
    try {
      target.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      let ok = false;
      try { ok = document.execCommand('insertHTML', false, html); } catch (_) {}
      if (!ok) {
        try { target.innerHTML = html; ok = true; } catch (_) {}
      }
      try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      placeCaretAtEnd(target);
      return ok;
    } catch (_) { return false; }
  }

  // ---- Destination-side: inject the gathered attachments ----
  //
  // After the HTML paste verifies as successful, find the compose
  // form's file input and inject base64-decoded Files via a
  // DataTransfer object. Same pattern as gmail-drag-attachments.js's
  // injectFilesIntoCompose — Gmail listens to the change event on
  // input[type="file"] and treats injected DataTransfer.files as if
  // the user had picked them via the paperclip dialog. Returns the
  // count actually attached (zero on any failure).
  function findComposeFileInput(composeBody) {
    if (!composeBody) return null;
    // Popup compose wraps everything in role="dialog".
    let scope = composeBody.closest && composeBody.closest('div[role="dialog"]');
    if (!scope) {
      // Full-screen compose (the one Appraisal Blast opens via
      // ?fs=1) has no dialog wrapper. Walk up to the nearest
      // ancestor that owns an <input type="file"> — that's the
      // compose form regardless of mode.
      let p = composeBody.parentElement;
      while (p && p !== document.body) {
        if (p.querySelector('input[type="file"]')) { scope = p; break; }
        p = p.parentElement;
      }
    }
    if (!scope) return null;
    return scope.querySelector('input[type="file"][name="Filedata"]') ||
           scope.querySelector('input[type="file"]');
  }
  function injectFilesIntoCompose(composeBody, files) {
    if (!files || !files.length) return 0;
    const input = findComposeFileInput(composeBody);
    if (!input) {
      console.warn('[ZHL Appraisal Blast paste] no <input type="file"> on compose; cannot auto-attach');
      return 0;
    }
    try {
      const dt = new DataTransfer();
      let count = 0;
      for (const f of files) {
        try {
          const blob = base64ToBlob(f.b64, f.mime);
          const fileObj = new File([blob], f.name, { type: f.mime });
          dt.items.add(fileObj);
          count++;
        } catch (e) {
          console.warn('[ZHL Appraisal Blast paste] decode failed for', f.name, e);
        }
      }
      if (!count) return 0;
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[ZHL Appraisal Blast paste] attached ' + count + ' file(s) to compose');
      return count;
    } catch (e) {
      console.warn('[ZHL Appraisal Blast paste] inject failed:', e);
      return 0;
    }
  }

  // Fingerprint: the data-zhl-ab-html marker attribute we always
  // emit on the outer wrapper. Survives Gmail's sanitizer in
  // testing; if Gmail ever strips it the secondary check on the
  // Calibri font-family inside style attributes catches the paste.
  function looksLikeFormattedPaste(target) {
    try {
      if (!target) return false;
      const html = target.innerHTML || '';
      if (html.indexOf('data-zhl-ab-html') >= 0) return true;
      if (html.indexOf('font-family: Calibri') >= 0 ||
          html.indexOf('font-family:Calibri') >= 0) return true;
      return false;
    } catch (_) { return false; }
  }

  function pasteIntoCompose(html, files, onSuccess, onFail) {
    let attempts = 0;
    let pasted = false;
    let filesInjected = false;
    const interval = setInterval(function () {
      attempts++;
      const target = findComposeBody();
      if (target && !pasted) {
        clearInterval(interval);
        pasted = true;
        const ok = doPasteInto(target, html);
        console.log('[ZHL Appraisal Blast paste] pasted formatted body (attempt ' + attempts + ', ok=' + ok + ')');
        // Verify a moment later in case Gmail's URL-driven plain
        // body fill landed after our paste and overwrote it.
        let verifyTries = 0;
        const verifyInterval = setInterval(function () {
          verifyTries++;
          const stillTarget = findComposeBody();
          if (!stillTarget) return;
          if (looksLikeFormattedPaste(stillTarget)) {
            clearInterval(verifyInterval);
            // Body verified — now attach the gathered files. Do this
            // ONLY after the HTML is settled so the attach toolbar
            // animation in Gmail doesn't fight the paste insert.
            if (!filesInjected && files && files.length) {
              filesInjected = true;
              injectFilesIntoCompose(stillTarget, files);
            }
            if (typeof onSuccess === 'function') onSuccess();
            return;
          }
          if (verifyTries <= 6) {
            console.log('[ZHL Appraisal Blast paste] verify ' + verifyTries + ': formatted content missing — re-pasting');
            doPasteInto(stillTarget, html);
          } else {
            clearInterval(verifyInterval);
            console.warn('[ZHL Appraisal Blast paste] gave up after re-paste retries; clipboard fallback (Ctrl+V) still works');
            // Still attempt the file inject even if the HTML never
            // verified — the LO at least gets the PDF attached
            // (they'd Ctrl+V the body manually).
            if (!filesInjected && files && files.length) {
              filesInjected = true;
              injectFilesIntoCompose(stillTarget, files);
            }
            if (typeof onFail === 'function') onFail();
          }
        }, 500);
        return;
      }
      if (attempts > POLL_LIMIT) {
        clearInterval(interval);
        console.warn('[ZHL Appraisal Blast paste] gave up — compose body not found within ' + (POLL_LIMIT * POLL_MS / 1000) + ' s. Clipboard fallback still works (Ctrl+V).');
        if (typeof onFail === 'function') onFail();
      }
    }, POLL_MS);
  }

  function extensionContextValid() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (_) { return false; }
  }

  function checkAndPaste() {
    if (pasteRanInThisTab) return;
    if (!extensionContextValid()) return;
    try {
      chrome.storage.local.get([PASTE_STORAGE_KEY], function (data) {
        const pending = data && data[PASTE_STORAGE_KEY];
        if (!pending || !pending.html) return;
        const age = Date.now() - (pending.ts || 0);
        if (age > PASTE_TTL_MS) {
          try { chrome.storage.local.remove([PASTE_STORAGE_KEY]); } catch (_) {}
          return;
        }
        pasteRanInThisTab = true;
        const files = Array.isArray(pending.files) ? pending.files : [];
        console.log('[ZHL Appraisal Blast paste] pending paste found (age=' + age + ' ms, HTML length=' + (pending.html || '').length + ' bytes, files=' + files.length + '), running…');
        pasteIntoCompose(
          pending.html,
          files,
          function onOk() {
            try { chrome.storage.local.remove([PASTE_STORAGE_KEY]); } catch (_) {}
            console.log('[ZHL Appraisal Blast paste] verified formatted body in compose — storage cleared');
          },
          function onFail() {
            pasteRanInThisTab = false;
          }
        );
      });
    } catch (e) {
      console.warn('[ZHL Appraisal Blast paste] storage read failed:', e);
    }
  }

  setTimeout(checkAndPaste, 300);
  let lastUrl = location.href;
  setInterval(function () {
    if (!extensionContextValid()) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      pasteRanInThisTab = false;
      setTimeout(checkAndPaste, 300);
    }
  }, 500);
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
