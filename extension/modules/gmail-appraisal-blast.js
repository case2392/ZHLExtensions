// ZHL Productivity Pack module — feature key: feature_appraisalBlast
//
// When the LO opens a Reggora "Appraisal Submission Summary" email in
// Gmail, this module injects a floating "Send to all parties" button.
// On click it:
//   1. Parses the email for loan number, last name, property address,
//      appraised value, purchase price, condition, and low-value flag.
//   2. Asks the background service worker to look up the loan in
//      Salesforce and return every Contact Role's email.
//   3. Buckets contacts into TO (Borrower, Co-Borrower, Buyer's Agent,
//      Transaction Coordinator) and CC (Processor).
//   4. Opens a Gmail compose tab pre-filled with TO / CC / Subject /
//      Body — congratulatory wording for normal appraisals, a
//      different message when the appraisal came in low.
// Nothing sends automatically; the LO reviews and hits Send.

(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_appraisalBlast';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL Appraisal Blast v' + VERSION + '] loaded');

  const SUBJECT_PREFIX = 'Appraisal Submission Summary';
  const NAVY = '#1F3864', GOLD = '#BF8F00';
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';

  let panelInjected = false;
  let creditedTimeSaved = false;

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

  function tick() {
    const subj = openEmailSubject();
    const matches = subj.startsWith(SUBJECT_PREFIX);
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
  function parseEmail() {
    const subject = openEmailSubject();
    const body = openEmailBodyText();

    const loan =
      (subject.match(/#\s*(ZG\d+)/) || [])[1] ||
      (body.match(/loan\s+(ZG\d+)/i) || [])[1] || '';

    const ln = subject.match(/#\s*ZG\d+\s*-\s*([^,]+?),/i);
    const lastName = ln ? ln[1].trim() : '';

    const addrMatch =
      subject.match(/#\s*ZG\d+\s*-\s*[^,]+,\s*(.+?)\s*\(/i) ||
      body.match(/at\s+(.+?)\s*\(/i);
    const address = addrMatch ? addrMatch[1].trim() : '';

    const num = function (re) {
      const m = body.match(re);
      return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
    };
    const appraised = num(/Appraised value:\s*\$?([\d,]+(?:\.\d{2})?)/i);
    const purchase  = num(/Estimated value:\s*\$?([\d,]+(?:\.\d{2})?)/i);

    const condMatch = body.match(/Reconciliation\s*\/\s*Report\s*Condition:\s*([^\r\n]+)/i);
    const condition = condMatch ? condMatch[1].trim() : '';

    const lowMatch = body.match(/Low\s*Value:\s*(YES|NO)/i);
    const lowValue = lowMatch ? lowMatch[1].toUpperCase() : 'NO';

    return { loan: loan, lastName: lastName, address: address,
             appraised: appraised, purchase: purchase,
             condition: condition, lowValue: lowValue };
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

  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  function conditionPhrase(condition) {
    const c = (condition || '').toLowerCase().replace(/\s+/g, '');
    if (c === 'asis' || c === 'as-is') return 'as-is, so no repairs are required';
    if (c.indexOf('subjectto') === 0) return 'subject to repairs/completion — see the report for the required items';
    return condition || 'see the report for details';
  }

  function buildMessage(data, contacts) {
    const buckets = bucketContacts(contacts);
    const equity = data.appraised - data.purchase;
    const lowValue = data.lowValue === 'YES' || equity < 0;

    const subject = 'Appraisal Received - ' + data.lastName + ' - ' + data.address;

    // No hand-typed signature — Gmail appends the LO's signature
    // automatically when the compose window opens.
    let body;
    if (lowValue) {
      body =
'Hey all,\n\n' +
'The appraisal on ' + data.address + ' came back at ' + money(data.appraised) +
' against a purchase price of ' + money(data.purchase) + '. Let\'s connect on next steps.\n\n' +
'The home came back ' + conditionPhrase(data.condition) + '.';
    } else {
      body =
'Hey all,\n\n' +
'Congratulations! The appraisal on ' + data.address + ' came back at ' +
money(data.appraised) + '. We\'re purchasing for ' + money(data.purchase) +
', which means ' + money(equity) + ' in immediate equity 🎉\n\n' +
'The home came back ' + conditionPhrase(data.condition) + '.\n\n' +
'Reach out with any questions.';
    }
    return { to: buckets.to, cc: buckets.cc, subject: subject, body: body };
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
      setStatus('Found ' + contacts.length + ' contacts; ' + msg.to.length + ' on TO, ' +
        msg.cc.length + ' on CC. Opening draft…');
      openCompose(msg);

      // Time saved: ~6 min vs manually pulling contacts from Salesforce,
      // typing the email, and looking up each role's address. Credit
      // once per content-script load so re-clicks don't double-count.
      if (!creditedTimeSaved && window.__zhlTimeSaved) {
        window.__zhlTimeSaved.recordAndForget('appraisal-blast', 6);
        creditedTimeSaved = true;
      }

      setTimeout(function () { setStatus('Draft opened. Review and send.'); }, 600);
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
