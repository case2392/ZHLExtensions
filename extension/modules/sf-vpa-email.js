// ZHL Productivity Pack module — feature key: feature_sfVpaEmail
// Adds a "Send VPA Email" button to Salesforce Lead/Contact action bars.
// Scrapes borrower / co-borrower / agent contact info from the page, then opens
// a pre-filled Gmail compose tab via the public compose URL (no OAuth, no API).
// LO attaches the Verified Pre-Approval PDF manually before sending.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_sfVpaEmail';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = '1.1';
  const BUTTON_ID = 'zhl-vpa-send-email-btn';
  const TOAST_ID = 'zhl-vpa-toast';
  const RECORD_URL_PATTERN = /\/lightning\/r\/(Lead|Contact)\/([a-zA-Z0-9]{15,18})\/view/;
  // Use the same compose URL pattern as the Pricing Exception Workflow.
  // Drop the u/0/ segment and tf=1 — those force a specific account and a
  // standalone popup window respectively. We want a normal tab in the LO's
  // current Gmail session.
  const GMAIL_COMPOSE_BASE = 'https://mail.google.com/mail/?view=cm&fs=1';

  function getRecordInfo() {
    const match = window.location.pathname.match(RECORD_URL_PATTERN);
    if (!match) return null;
    return { objectType: match[1], recordId: match[2] };
  }

  function formatCurrency(value) {
    if (!value) return null;
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  }

  function cleanScrapedValue(text) {
    if (!text) return text;
    return text
      .replace(/Open\s+.+?\s*Preview\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getLookupLinkText(container) {
    const link =
      container.querySelector('a[data-output-element-id="output-field"]') ||
      container.querySelector('a[href*="lightning/r/"]');
    if (!link) return null;
    const assistive = link.querySelector('.slds-assistive-text, span[class*="assistive"]');
    if (assistive) {
      const full = link.textContent.trim();
      const a = assistive.textContent.trim();
      const clean = full.replace(a, '').trim();
      if (clean) return clean;
    }
    for (const node of link.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) return t;
      }
    }
    return cleanScrapedValue(link.textContent.trim());
  }

  function scrapeFieldByLabel(label) {
    const labels = document.querySelectorAll('span.test-id__field-label, span[class*="field-label"]');
    for (const labelEl of labels) {
      if (labelEl.textContent.trim().toLowerCase() !== label.toLowerCase()) continue;
      if (!isElementVisible(labelEl)) continue;
      const container =
        labelEl.closest('records-record-layout-item') ||
        labelEl.closest('.slds-form-element');
      if (!container) continue;
      const lookupText = getLookupLinkText(container);
      if (lookupText) return lookupText;
      const valueEl =
        container.querySelector('lightning-formatted-text') ||
        container.querySelector('lightning-formatted-email') ||
        container.querySelector('lightning-formatted-name') ||
        container.querySelector('lightning-formatted-number') ||
        container.querySelector('lightning-formatted-phone') ||
        container.querySelector('a[data-output-element-id="output-field"]') ||
        container.querySelector('.slds-form-element__static');
      if (valueEl) return cleanScrapedValue(valueEl.textContent.trim());
    }
    return null;
  }

  function scrapeFieldByLabels(labels) {
    for (const l of labels) {
      const v = scrapeFieldByLabel(l);
      if (v) return v;
    }
    return null;
  }

  function getAllMailtoEmails() {
    const emails = new Set();
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const email = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email) emails.add(email);
    });
    return emails;
  }

  function findLookupLink(label) {
    const labels = document.querySelectorAll('span.test-id__field-label, span[class*="field-label"]');
    for (const labelEl of labels) {
      if (labelEl.textContent.trim().toLowerCase() !== label.toLowerCase()) continue;
      if (!isElementVisible(labelEl)) continue;
      const container =
        labelEl.closest('records-record-layout-item') ||
        labelEl.closest('.slds-form-element');
      if (!container) continue;
      return container.querySelector('a[data-output-element-id="output-field"]')
        || container.querySelector('a[href*="lightning/r/"]');
    }
    return null;
  }

  function dismissHover(link) {
    try {
      link.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    } catch (_) {}
    const header = document.querySelector('.slds-page-header') || document.body;
    try { header.click(); } catch (_) {}
  }

  // Hover the lookup link, watch for a new mailto / email pattern to appear
  // in any popover that opens, then dismiss. Returns null on timeout.
  function scrapeEmailFromHoverCard(label, baseline) {
    return new Promise((resolve) => {
      const link = findLookupLink(label);
      if (!link) return resolve(null);
      link.scrollIntoView({ behavior: 'instant', block: 'center' });
      const before = baseline || getAllMailtoEmails();
      let done = false;

      const check = () => {
        const after = getAllMailtoEmails();
        for (const e of after) if (!before.has(e)) return e;
        const pops = document.querySelectorAll(
          'section.slds-popover, div.slds-popover, [class*="slds-popover"], ' +
          'records-record-hover-preview, section[role="dialog"], div[role="tooltip"]'
        );
        for (const p of pops) {
          const txt = p.textContent || '';
          const m = txt.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          if (m && !before.has(m[0].toLowerCase())) return m[0].toLowerCase();
        }
        return null;
      };

      const finish = (val) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        observer.disconnect();
        dismissHover(link);
        resolve(val);
      };

      const observer = new MutationObserver(() => {
        const v = check();
        if (v) finish(v);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const rect = link.getBoundingClientRect();
      const opts = { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
      link.dispatchEvent(new MouseEvent('mouseenter', opts));
      link.dispatchEvent(new MouseEvent('mouseover', opts));
      link.dispatchEvent(new MouseEvent('mousemove', opts));

      const poll = setInterval(() => { const v = check(); if (v) finish(v); }, 200);
      setTimeout(() => finish(check()), 2000);
    });
  }

  function parseFullName(fullName) {
    if (!fullName) return { first: null, last: null };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  async function scrapeLeadData() {
    const fullName = scrapeFieldByLabels(['Name', 'Full Name']);
    const parsed = parseFullName(fullName);
    const firstName = parsed.first || scrapeFieldByLabels(['First Name', 'FirstName']);
    const lastName = parsed.last || scrapeFieldByLabels(['Last Name', 'LastName']);

    const coBorrower = scrapeFieldByLabels(['Co-Borrower', 'CoBorrower', 'Co Borrower']);
    const coParsed = parseFullName(coBorrower);

    const email = scrapeFieldByLabels(['Email', 'Email Address']);

    const purchasePrice = scrapeFieldByLabels(['Purchase Price']);
    const rawAmount = purchasePrice || scrapeFieldByLabels([
      'Max Affordability', 'Loan Amount', 'Pre-Approval Amount', 'Amount', 'Pre-Approval'
    ]);
    const amount = rawAmount ? formatCurrency(rawAmount) : null;

    const agentLabels = ["Buyer's Agent", 'Buyers Agent', 'Referring Agent', 'Agent', 'Real Estate Agent'];
    const agentName = scrapeFieldByLabels(agentLabels);

    // Best-effort: hover Co-Borrower and Agent lookups to surface their emails
    const baseline = getAllMailtoEmails();
    if (email) baseline.add(email.toLowerCase());
    let coBorrowerEmail = null;
    let agentEmail = null;

    if (coBorrower) {
      const lbl = ['Co-Borrower', 'CoBorrower', 'Co Borrower'].find((l) => scrapeFieldByLabel(l));
      if (lbl) {
        coBorrowerEmail = await scrapeEmailFromHoverCard(lbl, baseline);
        if (coBorrowerEmail) baseline.add(coBorrowerEmail.toLowerCase());
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (agentName) {
      const lbl = agentLabels.find((l) => scrapeFieldByLabel(l));
      if (lbl) agentEmail = await scrapeEmailFromHoverCard(lbl, baseline);
    }

    try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) {}

    return {
      firstName: firstName || null,
      lastName: lastName || null,
      coBorrowerFirstName: coParsed.first || null,
      coBorrowerLastName:  coParsed.last  || null,
      coBorrowerEmail: coBorrowerEmail || null,
      email: email || null,
      amount: amount || null,
      agentName: agentName || null,
      agentEmail: agentEmail || null
    };
  }

  // Greeting used inside the body: "FirstName" or "FirstName & CoFirstName"
  function buildGreeting(lead) {
    const first = lead.firstName || 'there';
    if (lead.coBorrowerFirstName) return `${first} & ${lead.coBorrowerFirstName}`;
    return first;
  }

  // Full names used in the subject line. Mirrors the original SFGmail
  // buildFullNames helper:
  //   Same last name:  "Tracey & Andrew Smith"
  //   Different last:  "Tracey Smith & Andrew Jones"
  //   Solo:            "Tracey Smith"
  function buildFullNames(lead) {
    const first = lead.firstName || '';
    const last  = lead.lastName  || '';
    if (lead.coBorrowerFirstName) {
      const coFirst = lead.coBorrowerFirstName;
      const coLast  = lead.coBorrowerLastName || '';
      const sameLast = last && coLast && last.toLowerCase() === coLast.toLowerCase();
      if (sameLast) return `${first} & ${coFirst} ${last}`;
      const coFull = coLast ? `${coFirst} ${coLast}` : coFirst;
      return `${first} ${last} & ${coFull}`;
    }
    return [first, last].filter(Boolean).join(' ');
  }

  // -----------------------------------------------------------------
  // Template defaults + placeholder substitution
  //
  // Subject and body are user-editable on the Setup page. The defaults
  // below are written with literal {Placeholder} markers; storage keys
  // vpa_subject_tmpl and vpa_body_html_tmpl override them per LO.
  // Substitution happens at send time inside substituteSubject() and
  // substituteBodyHtml().
  // -----------------------------------------------------------------

  const DEFAULT_SUBJECT_TMPL =
    'Verified Pre-Approval for {Full Names} - Up to {Amount}! - {LO Name} from Zillow Home Loans';

  function getSubjectTmpl() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['vpa_subject_tmpl'], function (data) {
          const v = data && data.vpa_subject_tmpl;
          resolve(v && v.trim() ? v : DEFAULT_SUBJECT_TMPL);
        });
      } catch (_) { resolve(DEFAULT_SUBJECT_TMPL); }
    });
  }

  // Subject substitution — all placeholders resolve to plain text. The
  // {Agent} and {LO Name} HTML wrappers used in the body don't make sense
  // in a subject line, so they fall back to plain names here.
  function substituteSubject(tmpl, lead, settings) {
    const greeting  = buildGreeting(lead);
    const fullNames = buildFullNames(lead) || lead.firstName || '';
    return String(tmpl || '')
      .replace(/\{Full Names\}/g, fullNames)
      .replace(/\{Greeting\}/g,   greeting)
      .replace(/\{Borrower\}/g,   lead.firstName || '')
      .replace(/\{Amount\}/g,     lead.amount    || '')
      .replace(/\{Agent Name\}/g, lead.agentName || '')
      .replace(/\{Agent\}/g,      lead.agentName || '')
      .replace(/\{LO Name\}/g,    settings.loName || 'Justin Case')
      .replace(/\{LO Email\}/g,   settings.loEmail || '')
      .replace(/\{Zillow URL\}/g, settings.zillowUrl || '');
  }

  function buildSubject(lead, loNameOrSettings) {
    // Synchronous default-template fallback for callers that don't await.
    // buildSubjectAsync below is the canonical entry point.
    const settings = typeof loNameOrSettings === 'string'
      ? { loName: loNameOrSettings, loEmail: '', zillowUrl: '' }
      : (loNameOrSettings || {});
    return substituteSubject(DEFAULT_SUBJECT_TMPL, lead, settings);
  }

  async function buildSubjectAsync(lead, settings) {
    const tmpl = await getSubjectTmpl();
    return substituteSubject(tmpl, lead, settings);
  }

  // Body — plain-text faithful port of templates/vpa-template.html from the
  // original SFGmail proof-of-concept. Gmail compose URLs only carry plain
  // text, so the HTML formatting is dropped but the wording and structure
  // is preserved exactly.
  function buildBody(lead, loName) {
    const greeting = buildGreeting(lead);
    const amount   = lead.amount    || '[AMOUNT]';
    const agent    = lead.agentName || '[AGENT NAME]';
    const lo       = loName         || 'Justin Case';
    return [
      `Congratulations ${greeting}!`,
      '',
      `I'm excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to ${amount} at Zillow Home Loans!  Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.`,
      '',
      `This is a significant milestone on your homebuying journey.  Now, armed with the Verified Pre-Approval, you're one step closer to finding your dream home!`,
      '',
      `Feel free to reach out to me if you have any questions or need assistance moving forward. I'm here to help make your homeownership dreams a reality.`,
      '',
      '',
      `What's Next?`,
      '',
      `  • Continue to stay in touch with your Loan Officer, ${lo} and your Real Estate Agent, ${agent}.`,
      `  • Continue to pay all bills on time.`,
      `  • Do Not open any new lines of credit nor acquire new debt.`,
      `  • Do Not increase balances on your current credit obligations.`,
      `  • Do Not make changes to your employment outside of promotions or simply moving physical locations.`,
      `  • Avoid any unnecessary movement of monies between accounts.`,
      `  • Do Not dimmish your savings or assets required for your home purchase.`,
      '',
      '',
      `Don't Forget`,
      '',
      `  • No Cost Appraisal – By financing with Zillow Home Loans and working with a Zillow Premier Agent partner, Zillow Home Loans will cover the cost of your appraisal*.`,
      `  • Very comfortable 21-Day closings`,
      '',
      '',
      `Congratulations again ${greeting}, and best of luck with your home search!`,
      '',
      '',
      `* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.`
    ].join('\n');
  }

  function buildComposeUrl(lead, loName) {
    return buildComposeUrlWithSubject(
      lead,
      buildSubject(lead, loName),
      buildBody(lead, loName)
    );
  }

  // Same as buildComposeUrl but accepts the resolved subject + plain body
  // up-front. The async send path uses this so the user-customizable
  // subject template makes it into the compose URL.
  function buildComposeUrlWithSubject(lead, subject, plainBody) {
    const params = new URLSearchParams();
    if (lead.email) params.set('to', lead.email);
    const cc = [lead.coBorrowerEmail, lead.agentEmail].filter(Boolean);
    if (cc.length) params.set('cc', cc.join(','));
    params.set('su', subject);
    // Plain-text body included as a belt-and-suspenders fallback. The
    // companion content script (gmail-vpa-paste.js) replaces it with the
    // formatted HTML once the compose tab loads. If both that and the
    // clipboard fallback fail, the LO at least has the plain wording in
    // the body to send.
    params.set('body', plainBody);
    return GMAIL_COMPOSE_BASE + '&' + params.toString();
  }

  // ----- HTML body --------------------------------------------------
  //
  // Faithful HTML port of the original SFGmail templates/vpa-template.html.
  // Same wording / structure / inline styles / image URLs — only the
  // placeholders get substituted in. Stashed in chrome.storage.local so
  // gmail-vpa-paste.js (the companion Gmail content script) can paste it
  // into the compose body once the new tab loads.
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildAgentHtml(lead) {
    const name = escHtml(lead.agentName || '[AGENT NAME]');
    if (lead.agentEmail) {
      return '<a href="mailto:' + escHtml(lead.agentEmail) + '" style="color: #cc0000; font-weight: bold; text-decoration: none;">' + name + '</a>';
    }
    return '<span style="color: #cc0000; font-weight: bold;">' + name + '</span>';
  }

  function buildLoHtml(loName, loEmail) {
    const name = escHtml(loName || 'Justin Case');
    if (loEmail) {
      return '<a href="mailto:' + escHtml(loEmail) + '" style="color: #0E35C4; font-weight: bold; text-decoration: none;">' + name + '</a>';
    }
    return '<span style="color: #0E35C4; font-weight: bold;">' + name + '</span>';
  }

  // Default HTML body template. Placeholders ({Greeting}, {Amount},
  // {Agent}, {LO Name}, {Zillow URL}) get substituted at send time.
  // Editable on the Setup page; the user's version is stored under
  // vpa_body_html_tmpl. ALSO exposed on window so setup.js can grab the
  // default for the editor's initial fill and Reset button.
  // Brand assets — hosted on the user's main branch so they're publicly
  // accessible from the recipient's Gmail client. The %20 in the URL is
  // an encoded space; the "ZIllow" filename has a capital I (matches the
  // file committed to main).
  const ZHL_LOGO_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/logo%20no%20border.png';
  const ZHL_TEXT_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/ZIllow%20Home%20Loans%20Text.png';

  // "Zillow Home Loans" inline brand styling — bold serif in the cobalt
  // blue sampled from the brand-text PNG (#0E35C4). Used wherever the
  // company name appears as styled text in the body (not in the small
  // gray footnote, where it stays default so the disclaimer reads as
  // disclosure copy instead of marketing).
  const ZHL_TEXT_SPAN_OPEN  = '<span style="font-family: Georgia, \'Times New Roman\', serif; color: #0E35C4; font-weight: bold;">';
  const ZHL_TEXT_SPAN_CLOSE = '</span>';
  const ZHL_BRAND = ZHL_TEXT_SPAN_OPEN + 'Zillow Home Loans' + ZHL_TEXT_SPAN_CLOSE;

  const DEFAULT_BODY_HTML_TMPL = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<img src="' + ZHL_TEXT_URL + '" alt="Zillow Home Loans" width="300" height="44" style="display: block; margin: 0 0 18px 0;"/>' +
      '<h1 style="color: #0E35C4; font-size: 26px; font-weight: bold; margin-bottom: 16px; font-family: Georgia, \'Times New Roman\', serif;">Congratulations {Greeting}!</h1>' +
      '<p>I\'m excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to <span style="color: #0E35C4; font-weight: bold; text-decoration: underline;">{Amount}</span> at ' + ZHL_BRAND + '!&nbsp; Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.&nbsp; You can also click here to view my <a href="{Zillow URL}" style="color: #0E35C4; text-decoration: underline;">Zillow Webpage</a>!</p>' +
      '<p><strong>This is a significant milestone on your homebuying journey.&nbsp; Now, armed with the Verified Pre-Approval, you\'re one step closer to finding your dream home!</strong></p>' +
      '<p><strong>Feel free to reach out to me if you have any questions or need assistance moving forward. I\'m here to help make your homeownership dreams a reality.</strong></p>' +
      '<br/>' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">' +
        '<tr>' +
          '<td style="vertical-align: middle; padding-right: 10px;">' +
            '<img src="' + ZHL_LOGO_URL + '" alt="Zillow" width="40" height="40" style="display: block;"/>' +
          '</td>' +
          '<td style="vertical-align: middle;">' +
            '<span style="color: #0E35C4; font-size: 22px; font-weight: bold; font-style: italic; font-family: Georgia, \'Times New Roman\', serif;">What\'s Next?</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<ul style="margin: 8px 0 16px 0; padding-left: 24px;">' +
        '<li style="margin-bottom: 6px;">Continue to stay in touch with your Loan Officer, {LO Name} and your Real Estate Agent, {Agent}.</li>' +
        '<li style="margin-bottom: 6px;">Continue to pay all bills on time.</li>' +
        '<li style="margin-bottom: 6px;">Do Not open any new lines of credit nor acquire new debt.</li>' +
        '<li style="margin-bottom: 6px;">Do Not increase balances on your current credit obligations.</li>' +
        '<li style="margin-bottom: 6px;">Do Not make changes to your employment outside of promotions or simply moving physical locations.</li>' +
        '<li style="margin-bottom: 6px;">Avoid any unnecessary movement of monies between accounts.</li>' +
        '<li style="margin-bottom: 6px;">Do Not dimmish your savings or assets required for your home purchase.</li>' +
      '</ul>' +
      '<br/>' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">' +
        '<tr>' +
          '<td style="vertical-align: middle; padding-right: 8px;">' +
            '<img src="https://drive.google.com/uc?export=view&id=1XWel1Mh3_SbuGxz4tb0jF_4iQqMP2TdV" alt="Bonus" width="40" height="50" style="display: block;"/>' +
          '</td>' +
          '<td style="vertical-align: middle;">' +
            '<span style="color: #0E35C4; font-size: 22px; font-weight: bold; font-style: italic; font-family: Georgia, \'Times New Roman\', serif;">Don\'t Forget</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<ul style="margin: 8px 0 16px 0; padding-left: 24px;">' +
        '<li style="margin-bottom: 6px;">No Cost Appraisal &ndash; By financing with ' + ZHL_BRAND + ' and working with a Zillow Premier Agent partner, ' + ZHL_BRAND + ' will cover the cost of your appraisal*.</li>' +
        '<li style="margin-bottom: 6px;">Very comfortable 21-Day closings</li>' +
      '</ul>' +
      '<p style="font-size: 20px; font-weight: bold; font-style: italic; margin: 20px 0; color: #0E35C4; font-family: Georgia, \'Times New Roman\', serif;">Congratulations again {Greeting}, and best of luck with your home search!</p>' +
      '<p style="font-size: 10px; color: #666666; font-style: italic; line-height: 1.4;">* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.</p>' +
    '</div>'
  );

  // Expose the default template on window so setup.js (which loads in a
  // separate document but shares the same extension origin) can read it
  // for initial fill / Reset to Default. setup.js falls back to its own
  // copy if this global isn't reachable.
  try { window.__ZHL_VPA_DEFAULT_BODY_HTML = DEFAULT_BODY_HTML_TMPL; } catch (_) {}
  try { window.__ZHL_VPA_DEFAULT_SUBJECT  = DEFAULT_SUBJECT_TMPL; }   catch (_) {}

  function getBodyHtmlTmpl() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['vpa_body_html_tmpl'], function (data) {
          const v = data && data.vpa_body_html_tmpl;
          resolve(v && v.trim() ? v : DEFAULT_BODY_HTML_TMPL);
        });
      } catch (_) { resolve(DEFAULT_BODY_HTML_TMPL); }
    });
  }

  // HTML body substitution. {Greeting} / {Borrower} / {Amount} / {Full
  // Names} / {Agent Name} / {LO Email} / {Zillow URL} resolve to escaped
  // plain text; {Agent} and {LO Name} resolve to fully-styled HTML chunks
  // (mailto link in red bold / blue bold when an email is available,
  // plain styled span when not).
  function substituteBodyHtml(tmpl, lead, settings) {
    const greeting  = escHtml(buildGreeting(lead));
    const fullNames = escHtml(buildFullNames(lead) || '');
    const amount    = escHtml(lead.amount    || '');
    const agentName = escHtml(lead.agentName || '');
    const loEmail   = escHtml(settings.loEmail || '');
    const zillowUrl = escHtml(settings.zillowUrl || '');
    const agentHtml = buildAgentHtml(lead);
    const loHtml    = buildLoHtml(settings.loName, settings.loEmail);
    return String(tmpl || '')
      .replace(/\{Greeting\}/g,   greeting)
      .replace(/\{Borrower\}/g,   escHtml(lead.firstName || ''))
      .replace(/\{Full Names\}/g, fullNames)
      .replace(/\{Amount\}/g,     amount)
      .replace(/\{Agent\}/g,      agentHtml)
      .replace(/\{Agent Name\}/g, agentName)
      .replace(/\{LO Name\}/g,    loHtml)
      .replace(/\{LO Email\}/g,   loEmail)
      .replace(/\{Zillow URL\}/g, zillowUrl);
  }

  async function buildBodyHtmlAsync(lead, settings) {
    const tmpl = await getBodyHtmlTmpl();
    return substituteBodyHtml(tmpl, lead, settings);
  }

  // Synchronous default-template fallback for the few legacy call sites
  // that don't await. Real send path uses buildBodyHtmlAsync.
  function buildBodyHtml(lead, loName, loEmail, zillowUrl) {
    return substituteBodyHtml(DEFAULT_BODY_HTML_TMPL, lead, {
      loName: loName, loEmail: loEmail, zillowUrl: zillowUrl
    });
  }

  // Pull the configured LO name / email / Zillow URL from chrome.storage.
  // Same key the Pricing Exception Workflow and other branded-output
  // modules read from.
  function getLoSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['lo_name', 'lo_email', 'lo_zillow_url'], function (data) {
          resolve({
            loName:    (data && data.lo_name)        || '',
            loEmail:   (data && data.lo_email)       || '',
            zillowUrl: (data && data.lo_zillow_url)  || ''
          });
        });
      } catch (_) { resolve({ loName: '', loEmail: '', zillowUrl: '' }); }
    });
  }
  function getLoName() { return getLoSettings().then(function (s) { return s.loName; }); }

  // Stash the HTML body in chrome.storage.local so the Gmail companion
  // content script (gmail-vpa-paste.js) can pick it up after the compose
  // tab loads, and copy HTML + plain to the clipboard as a Ctrl+V fallback.
  function stashAndClip(html, plain) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set({
          zhlVpaPendingPaste: { html: html, plain: plain, ts: Date.now() }
        }, function () {
          // Also write to clipboard as a manual paste fallback. Some
          // browsers require this to happen inside a user gesture, which
          // the click handler is.
          try {
            const data = [new ClipboardItem({
              'text/html':  new Blob([html],  { type: 'text/html'  }),
              'text/plain': new Blob([plain], { type: 'text/plain' })
            })];
            navigator.clipboard.write(data).then(resolve, function () {
              navigator.clipboard.writeText(plain).then(resolve, resolve);
            });
          } catch (_) {
            try { navigator.clipboard.writeText(plain).then(resolve, resolve); }
            catch (__) { resolve(); }
          }
        });
      } catch (_) { resolve(); }
    });
  }

  function showToast(message, variant) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.className = 'zhl-vpa-toast';
      document.body.appendChild(toast);
    }
    toast.classList.remove('zhl-vpa-toast--success', 'zhl-vpa-toast--error');
    if (variant) toast.classList.add('zhl-vpa-toast--' + variant);
    toast.textContent = message;
    toast.classList.add('zhl-vpa-toast--show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('zhl-vpa-toast--show'), 4500);
  }

  function setButtonState(button, state, message) {
    button.disabled = state === 'loading' || state === 'disabled';
    button.classList.remove('zhl-vpa-btn--loading', 'zhl-vpa-btn--success', 'zhl-vpa-btn--error', 'zhl-vpa-btn--disabled');
    switch (state) {
      case 'disabled':
        button.classList.add('zhl-vpa-btn--disabled');
        button.textContent = '✉ Send VPA Email';
        button.title = 'Available on Pre-Approval leads';
        break;
      case 'loading':
        button.classList.add('zhl-vpa-btn--loading');
        button.textContent = 'Preparing…';
        break;
      case 'success':
        button.classList.add('zhl-vpa-btn--success');
        button.textContent = 'Draft opened';
        setTimeout(() => setButtonState(button, 'default'), 3000);
        break;
      case 'error':
        button.classList.add('zhl-vpa-btn--error');
        button.textContent = message || 'Error';
        setTimeout(() => setButtonState(button, 'default'), 4000);
        break;
      default:
        button.textContent = '✉ Send VPA Email';
        button.title = '';
    }
  }

  async function handleSendClick(event) {
    const button = event.currentTarget;
    try {
      setButtonState(button, 'loading');
      const [lead, settings] = await Promise.all([scrapeLeadData(), getLoSettings()]);
      if (!lead.email) {
        setButtonState(button, 'error', 'No email found');
        showToast('No email address visible on this lead. Make sure the Email field is showing on the page.', 'error');
        return;
      }
      // Build HTML + plain bodies (HTML uses the user-customizable
      // template from Setup → VPA Email template; subject likewise).
      // The Gmail companion content script (gmail-vpa-paste.js) reads
      // chrome.storage.local once the compose tab loads and replaces the
      // plain body with the formatted HTML. The clipboard fallback
      // covers cases where the auto-paste fails (Ctrl+V).
      const [html, subject] = await Promise.all([
        buildBodyHtmlAsync(lead, settings),
        buildSubjectAsync(lead, settings)
      ]);
      const plain = buildBody(lead, settings.loName);
      await stashAndClip(html, plain);

      const url = buildComposeUrlWithSubject(lead, subject, plain);
      // Plain window.open with just _blank — no windowFeatures string — so
      // browsers open it as a normal tab in the LO's current Gmail session
      // (matches the Pricing Exception Workflow's behavior). Passing a
      // features string causes a standalone popup window in many browsers.
      try { window.open(url, '_blank'); }
      catch (_) { window.location.href = url; }
      setButtonState(button, 'success');
      showToast('VPA draft opened in Gmail with formatting. Attach the pre-approval PDF before sending.', 'success');
    } catch (e) {
      console.error('[ZHL VPA] click error', e);
      setButtonState(button, 'error', 'Error');
      showToast('Could not build the VPA draft. Check the console for details.', 'error');
    }
  }

  function isPreApprovalStatus() {
    const sel =
      '.slds-path__item.slds-is-current span, ' +
      '.slds-path__item.slds-is-active span, ' +
      'lightning-path-step.slds-is-current span';
    for (const step of document.querySelectorAll(sel)) {
      if (!isElementVisible(step)) continue;
      if (step.textContent.trim().toLowerCase().includes('pre-approval')) return true;
    }
    return false;
  }

  function findActionBar() {
    const knownLabels = ['Follow', 'Edit', 'Clone', 'New Note'];
    for (const label of knownLabels) {
      for (const btn of document.querySelectorAll('button, a.slds-button')) {
        const t = btn.textContent.trim();
        if (t !== label && t !== '+ ' + label) continue;
        if (!isElementVisible(btn)) continue;
        const list = btn.closest('ul');
        if (list) return list;
      }
    }
    const selectors = [
      'runtime_platform_actions-actions-ribbon ul.slds-button-group-list',
      'lightning-actions-ribbon ul.slds-button-group-list',
      '.slds-page-header__col-actions ul.slds-button-group-list'
    ];
    for (const s of selectors) {
      for (const el of document.querySelectorAll(s)) {
        if (isElementVisible(el)) return el;
      }
    }
    return null;
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!getRecordInfo()) return;
    const bar = findActionBar();
    if (!bar) return;

    const li = document.createElement('li');
    li.className = 'slds-button-group-item';
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'slds-button slds-button_brand zhl-vpa-btn';
    button.addEventListener('click', handleSendClick);
    setButtonState(button, 'disabled');
    li.appendChild(button);

    try {
      if (bar.firstChild) bar.insertBefore(li, bar.firstChild);
      else bar.appendChild(li);
    } catch (_) { return; }

    setTimeout(() => {
      if (isPreApprovalStatus()) setButtonState(button, 'default');
    }, 1500);
  }

  function init() {
    let lastUrl = location.href;
    function tick() {
      try {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          document.querySelectorAll('#' + BUTTON_ID).forEach((el) => {
            const li = el.closest('li.slds-button-group-item');
            if (li) li.remove(); else el.remove();
          });
        }
        if (!getRecordInfo()) return;
        const existing = document.getElementById(BUTTON_ID);
        if (existing && isElementVisible(existing)) {
          // Re-evaluate pre-approval status on every tick so the button
          // becomes enabled the moment the LO advances the path on this
          // same record. Without this, the one-shot setTimeout in
          // injectButton only ran 1.5s after first inject — if the
          // status was still "Qualification" / "Active Outreach" at
          // that moment and the LO later moved it to Pre-Approval, the
          // button stayed disabled until a tab switch re-injected it
          // (the bug the user hit).
          // Only flip between 'disabled' and 'default' — leave loading/
          // success/error states alone so we don't trample mid-click.
          const cur = existing.classList.contains('zhl-vpa-btn--loading') ? 'loading'
            : existing.classList.contains('zhl-vpa-btn--success') ? 'success'
            : existing.classList.contains('zhl-vpa-btn--error') ? 'error'
            : existing.classList.contains('zhl-vpa-btn--disabled') ? 'disabled'
            : 'default';
          if (cur === 'disabled' && isPreApprovalStatus()) {
            setButtonState(existing, 'default');
          } else if (cur === 'default' && !isPreApprovalStatus()) {
            setButtonState(existing, 'disabled');
          }
          return;
        }
        if (existing) {
          const li = existing.closest('li.slds-button-group-item');
          if (li) li.remove(); else existing.remove();
        }
        injectButton();
      } catch (e) { console.error('[ZHL VPA] tick error', e); }
    }
    tick();
    setInterval(tick, 1000);
  }

  init();
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
