// ZHL Productivity Pack module — feature key: feature_sfIntroEmail
//
// Adds a "Send Intro Email" button to the Salesforce Opportunity record
// action ribbon (same slot as the Send VPA Email button on Lead pages).
// On click: scrapes borrower / co-borrower from the Contact Roles list,
// reads Close Date + Loan Number from the Opportunity highlights, builds
// the disclosures-signed-here's-what-happens-next email body from the
// customizable template, stashes the HTML in chrome.storage.local so the
// Gmail companion content script (gmail-intro-paste.js) can auto-paste
// it after the compose tab loads, and opens the Gmail compose URL.
//
// No OAuth / no Connected App — uses the public Gmail compose URL,
// matching the same pattern as the VPA Email and Pricing Exception
// Workflow flows.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_sfIntroEmail';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = '1.0';
  const BUTTON_ID = 'zhl-intro-send-email-btn';
  const TOAST_ID = 'zhl-intro-toast';
  const RECORD_URL_PATTERN = /\/lightning\/r\/Opportunity\/([a-zA-Z0-9]{15,18})/;
  const GMAIL_COMPOSE_BASE = 'https://mail.google.com/mail/?view=cm&fs=1';

  console.log('[ZHL Intro Email v' + VERSION + '] loaded');

  function getRecordInfo() {
    const m = location.pathname.match(RECORD_URL_PATTERN);
    return m ? { recordId: m[1] } : null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ----- Contact roles scraping ------------------------------------
  //
  // Contact Roles is rendered as a <ul class="uiAbstractList"> with
  // one <li class="forceRecordLayout"> per contact. Each item has:
  //   - <a class="outputLookupLink"> with the contact name as text
  //   - <div title="Role:"> → sibling .recordCellDetail contains the
  //     role text ("Borrower" / "Co-Borrower" / "Buyer's Agent" / ...)
  //   - <span class="uiOutputPhone"> for phone
  //   - <a href="mailto:..." class="emailuiFormattedEmail"> for email
  function scrapeContactRoles() {
    const out = [];
    document.querySelectorAll('li.forceRecordLayout').forEach(function (li) {
      if (!isElementVisible(li)) return;
      // Role
      const roleLabel = li.querySelector('[title="Role:"]');
      if (!roleLabel) return;
      const roleValue = roleLabel.parentElement && roleLabel.parentElement.querySelector('.recordCellDetail');
      const role = cleanText(roleValue && roleValue.textContent);
      if (!role) return;
      // Name
      const nameLink = li.querySelector('a.outputLookupLink');
      const name = cleanText(nameLink && nameLink.textContent);
      if (!name) return;
      // Email (mailto link)
      const emailLink = li.querySelector('a[href^="mailto:"]');
      const email = emailLink
        ? cleanText(emailLink.getAttribute('href').replace(/^mailto:/i, '').split('?')[0])
        : '';
      // Phone (first uiOutputPhone span — both enabled + disabled states
      // mirror the same number, so grabbing the first is fine)
      const phoneEl = li.querySelector('.uiOutputPhone');
      const phone = cleanText(phoneEl && phoneEl.textContent);
      out.push({ role: role, name: name, email: email, phone: phone });
    });
    return out;
  }

  function parseFullName(fullName) {
    if (!fullName) return { first: '', last: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  function selectBorrowers(contacts) {
    // "Borrower" exact match for primary; "Co-Borrower" / "Co Borrower"
    // for the secondary. Skip Buyer's Agent / Listing Agent / etc.
    const primary = contacts.find(function (c) { return /^borrower$/i.test(c.role); });
    const co = contacts.find(function (c) { return /co[\s-]?borrower/i.test(c.role); });
    return { primary: primary || null, coBorrower: co || null };
  }

  // ----- Field scraping (Close Date, Loan Number, etc.) -----------
  //
  // Salesforce Lightning renders read-only fields with a label span
  // (.test-id__field-label) and a value via lightning-formatted-text
  // (data-output-element-id="output-field"). Find by label text.
  function scrapeFieldByLabel(label) {
    const labels = document.querySelectorAll('span.test-id__field-label');
    for (const labelEl of labels) {
      if (cleanText(labelEl.textContent).toLowerCase() !== label.toLowerCase()) continue;
      if (!isElementVisible(labelEl)) continue;
      const container = labelEl.closest('.slds-form-element');
      if (!container) continue;
      const valEl = container.querySelector('lightning-formatted-text')
                 || container.querySelector('[data-output-element-id="output-field"]')
                 || container.querySelector('.slds-form-element__static');
      if (valEl) return cleanText(valEl.textContent);
    }
    return '';
  }

  function scrapeFieldByLabels(labels) {
    for (const l of labels) {
      const v = scrapeFieldByLabel(l);
      if (v) return v;
    }
    return '';
  }

  // ----- Template defaults + substitution -------------------------

  const DEFAULT_SUBJECT_TMPL =
    'Disclosures signed — here\'s what happens next';

  // Default body — faithful HTML port of the LO's plain-text template.
  // Brand-styled "Zillow Home Loans" mention matches the VPA email's
  // Georgia serif + cobalt (#0E35C4) treatment for consistency.
  const DEFAULT_BODY_HTML_TMPL = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<p>Hi {First Name},</p>' +
      '<p>Great news &mdash; your initial disclosures are signed and your file is officially moving. Here\'s what to expect over the next several days so nothing catches you off guard.</p>' +
      '<p><strong>1. Initial underwriting review.</strong> Your file goes into an early underwriter review so we can get ahead of any conditions before they become time crunches later. The goal is to surface anything we need from you now, while we have runway, rather than at the closing table.</p>' +
      '<p><strong>2. Loan processor introduction.</strong> One of our processors will reach out shortly to introduce themselves and become your day-to-day point of contact for documentation. They\'ll let you know if anything additional is needed beyond what you\'ve already provided. I\'m still quarterbacking the whole file, so don\'t worry &mdash; you\'re not getting handed off, just adding a teammate.</p>' +
      '<p><strong>3. Homeowners insurance.</strong> This is the one item I\'d ask you to start on this week. You\'ll need a homeowners insurance policy in place before we can close, and quotes can take a few days to come back. I\'ve cc\'d <strong>Karson Carter</strong> with Goosehead Insurance on this email &mdash; she\'s excellent and can shop multiple carriers for you to find the best coverage and rate. Feel free to reply all or reach her directly:</p>' +
      '<p style="margin-left: 24px;">' +
        '<strong>Karson Carter</strong><br>' +
        'Goosehead Insurance<br>' +
        '(336) 596-3603<br>' +
        '<a href="mailto:Karson.carter@goosehead.com" style="color: #0E35C4;">Karson.carter@goosehead.com</a>' +
      '</p>' +
      '<p>Once you have a policy selected, just let me know so we can coordinate the rest.</p>' +
      '<p>If any questions come up between now and closing, text or call me anytime &mdash; that\'s what I\'m here for. We\'ll keep this moving.</p>' +
      '<p>Best,<br>' +
        '{LO Name}<br>' +
        'Mortgage Loan Officer | <span style="font-family: Georgia, \'Times New Roman\', serif; color: #0E35C4; font-weight: bold;">Zillow Home Loans</span><br>' +
        'NMLS #{NMLS}</p>' +
      '<hr style="border: none; border-top: 1px solid #d1d5db; margin: 16px 0;">' +
      '<p style="font-size: 12px; color: #4b5563;">' +
        '<strong>Borrower Information</strong><br>' +
        'Borrower: {Borrower Name}<br>' +
        'Co-Borrower: {Co-Borrower Name}<br>' +
        'Property Address: {Property Address}<br>' +
        'Loan Number: {Loan Number}<br>' +
        'Estimated Closing Date: {Closing Date}' +
      '</p>' +
    '</div>'
  );

  try { window.__ZHL_INTRO_DEFAULT_BODY_HTML = DEFAULT_BODY_HTML_TMPL; } catch (_) {}
  try { window.__ZHL_INTRO_DEFAULT_SUBJECT  = DEFAULT_SUBJECT_TMPL;   } catch (_) {}

  function getSubjectTmpl() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['intro_subject_tmpl'], function (data) {
          const v = data && data.intro_subject_tmpl;
          resolve(v && v.trim() ? v : DEFAULT_SUBJECT_TMPL);
        });
      } catch (_) { resolve(DEFAULT_SUBJECT_TMPL); }
    });
  }
  function getBodyHtmlTmpl() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['intro_body_html_tmpl'], function (data) {
          const v = data && data.intro_body_html_tmpl;
          resolve(v && v.trim() ? v : DEFAULT_BODY_HTML_TMPL);
        });
      } catch (_) { resolve(DEFAULT_BODY_HTML_TMPL); }
    });
  }

  function substituteAll(tmpl, ctx, htmlSafe) {
    const enc = htmlSafe ? escHtml : function (s) { return s == null ? '' : String(s); };
    return String(tmpl || '')
      .replace(/\{First Name\}/g,        enc(ctx.firstName))
      .replace(/\{Borrower Name\}/g,     enc(ctx.borrowerName))
      .replace(/\{Co-Borrower Name\}/g,  enc(ctx.coBorrowerName))
      .replace(/\{Property Address\}/g,  enc(ctx.propertyAddress))
      .replace(/\{Loan Number\}/g,       enc(ctx.loanNumber))
      .replace(/\{Closing Date\}/g,      enc(ctx.closingDate))
      .replace(/\{LO Name\}/g,           enc(ctx.loName))
      .replace(/\{LO Email\}/g,          enc(ctx.loEmail))
      .replace(/\{NMLS\}/g,              enc(ctx.loNmls));
  }

  function buildContext(borrowers, settings, fields) {
    const primaryFull = borrowers.primary ? borrowers.primary.name : '';
    const primaryParsed = parseFullName(primaryFull);
    const coFull = borrowers.coBorrower ? borrowers.coBorrower.name : '';
    return {
      firstName:       primaryParsed.first || '[First Name]',
      borrowerName:    primaryFull || '[Borrower Name]',
      coBorrowerName:  coFull || 'n/a',
      propertyAddress: fields.propertyAddress || '[Property Address]',
      loanNumber:      fields.loanNumber || '[Loan Number]',
      closingDate:     fields.closingDate || '[Closing Date]',
      loName:          settings.loName || 'Justin Case',
      loEmail:         settings.loEmail || '',
      loNmls:          settings.loNmls || ''
    };
  }

  // ----- Plain-text body (compose URL fallback) -------------------
  //
  // The Gmail companion auto-pastes the HTML once compose loads. The
  // plain version is included in the compose URL's &body= parameter
  // as a final fallback if the auto-paste fails AND the clipboard
  // copy is unavailable.
  function buildPlainBody(ctx) {
    return [
      'Hi ' + ctx.firstName + ',',
      '',
      'Great news — your initial disclosures are signed and your file is officially moving. Here\'s what to expect over the next several days so nothing catches you off guard.',
      '',
      '1. Initial underwriting review. Your file goes into an early underwriter review so we can get ahead of any conditions before they become time crunches later.',
      '',
      '2. Loan processor introduction. One of our processors will reach out shortly to introduce themselves and become your day-to-day point of contact for documentation. I\'m still quarterbacking the whole file — just adding a teammate.',
      '',
      '3. Homeowners insurance. You\'ll need a homeowners insurance policy in place before we can close. I\'ve cc\'d Karson Carter with Goosehead Insurance — she can shop multiple carriers for you.',
      '',
      '   Karson Carter',
      '   Goosehead Insurance',
      '   (336) 596-3603',
      '   Karson.carter@goosehead.com',
      '',
      'If any questions come up between now and closing, text or call me anytime.',
      '',
      'Best,',
      ctx.loName,
      'Mortgage Loan Officer | Zillow Home Loans',
      'NMLS #' + ctx.loNmls,
      '',
      '———————————————',
      'Borrower Information',
      'Borrower: '         + ctx.borrowerName,
      'Co-Borrower: '      + ctx.coBorrowerName,
      'Property Address: ' + ctx.propertyAddress,
      'Loan Number: '      + ctx.loanNumber,
      'Estimated Closing Date: ' + ctx.closingDate
    ].join('\n');
  }

  // ----- Settings + stash ------------------------------------------

  function getLoSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['lo_name', 'lo_email', 'lo_nmls'], function (data) {
          resolve({
            loName:  (data && data.lo_name)  || '',
            loEmail: (data && data.lo_email) || '',
            loNmls:  (data && data.lo_nmls)  || ''
          });
        });
      } catch (_) { resolve({ loName: '', loEmail: '', loNmls: '' }); }
    });
  }

  function stashAndClip(html, plain) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set({
          zhlIntroPendingPaste: { html: html, plain: plain, ts: Date.now() }
        }, function () {
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

  function buildComposeUrl(toEmail, ccList, subject, plainBody) {
    const params = new URLSearchParams();
    if (toEmail) params.set('to', toEmail);
    if (ccList && ccList.length) params.set('cc', ccList.join(','));
    params.set('su', subject);
    params.set('body', plainBody);
    return GMAIL_COMPOSE_BASE + '&' + params.toString();
  }

  // ----- Toast + button state --------------------------------------

  function showToast(message, variant) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.className = 'zhl-intro-toast';
      document.body.appendChild(toast);
    }
    toast.classList.remove('zhl-intro-toast--success', 'zhl-intro-toast--error');
    if (variant) toast.classList.add('zhl-intro-toast--' + variant);
    toast.textContent = message;
    toast.classList.add('zhl-intro-toast--show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('zhl-intro-toast--show'); }, 4500);
  }

  function setButtonState(button, state, message) {
    button.disabled = state === 'loading';
    button.classList.remove('zhl-intro-btn--loading', 'zhl-intro-btn--success', 'zhl-intro-btn--error');
    switch (state) {
      case 'loading':
        button.classList.add('zhl-intro-btn--loading');
        button.textContent = 'Preparing…';
        break;
      case 'success':
        button.classList.add('zhl-intro-btn--success');
        button.textContent = 'Draft opened';
        setTimeout(function () { setButtonState(button, 'default'); }, 3000);
        break;
      case 'error':
        button.classList.add('zhl-intro-btn--error');
        button.textContent = message || 'Error';
        setTimeout(function () { setButtonState(button, 'default'); }, 4000);
        break;
      default:
        button.textContent = '✉ Send Intro Email';
        button.title = '';
    }
  }

  // ----- Click handler ---------------------------------------------

  async function handleSendClick(event) {
    const button = event.currentTarget;
    try {
      setButtonState(button, 'loading');

      const contacts = scrapeContactRoles();
      const borrowers = selectBorrowers(contacts);
      if (!borrowers.primary || !borrowers.primary.email) {
        setButtonState(button, 'error', 'No borrower email');
        showToast('Could not find a borrower with a visible email in the Contact Roles list. Make sure the borrower has a contact role of "Borrower" with an email on file.', 'error');
        return;
      }

      const [settings, subjectTmpl, bodyTmpl] = await Promise.all([
        getLoSettings(),
        getSubjectTmpl(),
        getBodyHtmlTmpl()
      ]);

      const fields = {
        propertyAddress: scrapeFieldByLabels(['Property Address', 'Subject Property Address', 'Property Street Address']),
        loanNumber:      scrapeFieldByLabels(['Loan Number', 'ZG Number', 'Encompass Loan Number']),
        closingDate:     scrapeFieldByLabels(['Close Date', 'Closing Date', 'Estimated Close Date'])
      };

      const ctx     = buildContext(borrowers, settings, fields);
      const subject = substituteAll(subjectTmpl, ctx, false);
      const html    = substituteAll(bodyTmpl,    ctx, true);
      const plain   = buildPlainBody(ctx);

      await stashAndClip(html, plain);

      const cc = [];
      if (borrowers.coBorrower && borrowers.coBorrower.email) cc.push(borrowers.coBorrower.email);
      const url = buildComposeUrl(borrowers.primary.email, cc, subject, plain);

      try { window.open(url, '_blank'); }
      catch (_) { window.location.href = url; }

      setButtonState(button, 'success');
      const coNote = borrowers.coBorrower ? ' (CC: co-borrower)' : '';
      showToast('Intro draft opened in Gmail with formatting' + coNote + '. Add Karson Carter to CC before sending if you want her on the email.', 'success');
    } catch (e) {
      console.error('[ZHL Intro] click error', e);
      setButtonState(button, 'error', 'Error');
      showToast('Could not build the intro email draft. Check the console for details.', 'error');
    }
  }

  // ----- Action ribbon discovery + injection ----------------------

  function findActionBar() {
    const knownLabels = ['Follow', 'Edit', 'Clone', 'New Note', 'New Contact', 'Send Activation Link via SMS'];
    for (const label of knownLabels) {
      for (const btn of document.querySelectorAll('button, a.slds-button')) {
        if (cleanText(btn.textContent) !== label) continue;
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
    button.className = 'slds-button slds-button_brand zhl-intro-btn';
    button.addEventListener('click', handleSendClick);
    setButtonState(button, 'default');
    li.appendChild(button);

    try {
      if (bar.firstChild) bar.insertBefore(li, bar.firstChild);
      else bar.appendChild(li);
    } catch (_) {}
  }

  function init() {
    let lastUrl = location.href;
    function tick() {
      try {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          document.querySelectorAll('#' + BUTTON_ID).forEach(function (el) {
            const li = el.closest('li.slds-button-group-item');
            if (li) li.remove(); else el.remove();
          });
        }
        // Strictly Opportunity pages only
        if (!getRecordInfo()) {
          const existing = document.getElementById(BUTTON_ID);
          if (existing) {
            const li = existing.closest('li.slds-button-group-item');
            if (li) li.remove(); else existing.remove();
          }
          return;
        }
        const existing = document.getElementById(BUTTON_ID);
        if (existing && isElementVisible(existing)) return;
        if (existing) {
          const li = existing.closest('li.slds-button-group-item');
          if (li) li.remove(); else existing.remove();
        }
        injectButton();
      } catch (e) { console.error('[ZHL Intro] tick error', e); }
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
