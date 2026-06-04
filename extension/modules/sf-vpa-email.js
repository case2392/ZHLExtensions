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

  // Subject line — matches the original SFGmail default exactly:
  //   "Verified Pre-Approval for {fullNames} - Up to {amount}! - {LOName} from Zillow Home Loans"
  function buildSubject(lead, loName) {
    const fullNames = buildFullNames(lead) || lead.firstName || '';
    const amount    = lead.amount || '';
    const lo        = loName || 'Justin Case';
    return `Verified Pre-Approval for ${fullNames} - Up to ${amount}! - ${lo} from Zillow Home Loans`;
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
    const params = new URLSearchParams();
    if (lead.email) params.set('to', lead.email);
    const cc = [lead.coBorrowerEmail, lead.agentEmail].filter(Boolean);
    if (cc.length) params.set('cc', cc.join(','));
    params.set('su', buildSubject(lead, loName));
    params.set('body', buildBody(lead, loName));
    return GMAIL_COMPOSE_BASE + '&' + params.toString();
  }

  // Pull the configured LO name from chrome.storage.local. Same key used by
  // the Pricing Exception Workflow and other branded-output modules.
  function getLoName() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['lo_name'], function (data) {
          resolve((data && data.lo_name) || '');
        });
      } catch (_) { resolve(''); }
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
      const [lead, loName] = await Promise.all([scrapeLeadData(), getLoName()]);
      if (!lead.email) {
        setButtonState(button, 'error', 'No email found');
        showToast('No email address visible on this lead. Make sure the Email field is showing on the page.', 'error');
        return;
      }
      const url = buildComposeUrl(lead, loName);
      // Plain window.open with just _blank — no windowFeatures string — so
      // browsers open it as a normal tab in the LO's current Gmail session
      // (matches the Pricing Exception Workflow's behavior). Passing a
      // features string causes a standalone popup window in many browsers.
      try { window.open(url, '_blank'); }
      catch (_) { window.location.href = url; }
      setButtonState(button, 'success');
      showToast('VPA draft opened in Gmail. Attach the pre-approval PDF before sending.', 'success');
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
        if (existing && isElementVisible(existing)) return;
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
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
