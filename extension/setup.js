// Setup page logic — feature toggles only.
// Caller ID still works using its built-in defaults from background.js;
// the config UI was removed per user request.

const FEATURE_KEYS = [
  "feature_gmailTweaks",
  "feature_salesforcePromotions",
  "feature_contactSms",
  "feature_loanAmount",
  "feature_vaCalc",
  "feature_buydownCalc",
  "feature_callerId",
  "feature_smsAddParticipants",
  "feature_sfVpaEmail",
  "feature_sfIntroEmail",
  "feature_loanStoryGenerator",
  "feature_autoCallDetailsTab",
  "feature_autoMessagingTab",
  "feature_scenarioSort",
  "feature_pricingResultsPrint",
  "feature_coborrowerToSf",
  "feature_gmailDragAttachments"
  // feature_telemetry intentionally omitted — telemetry is always on
  // (no toggle in the UI; isTelemetryEnabled() in background.js always
  // returns true).
];

// Gmail Tweaks covers both the Gmail mail.google.com fixes and the
// Salesforce "Show Promotions" auto-disable. They live in separate content
// scripts but share one toggle so the user sees one row per "thing" rather
// than one row per script file.
const GMAIL_TWEAKS_LINKED = ["feature_gmailTweaks", "feature_salesforcePromotions"];

const $ = (id) => document.getElementById(id);

function showStatus(msg) {
  const el = $("save-status");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => el.classList.remove("show"), 1400);
}

async function loadFeatureStates() {
  const data = await chrome.storage.local.get(FEATURE_KEYS);
  document.querySelectorAll('input[data-feature]').forEach((input) => {
    const key = input.dataset.feature;
    const enabled = data[key] !== false; // default to enabled if unset
    input.checked = enabled;
    syncCardState(input);
  });
}

function syncCardState(input) {
  const card = input.closest('[data-module]');
  if (!card) return;
  card.classList.toggle('disabled', !input.checked);
}

document.querySelectorAll('input[data-feature]').forEach((input) => {
  input.addEventListener('change', async () => {
    const key = input.dataset.feature;
    const value = input.checked;
    const updates = { [key]: value };
    if (key === "feature_gmailTweaks") {
      for (const linked of GMAIL_TWEAKS_LINKED) updates[linked] = value;
    }
    await chrome.storage.local.set(updates);
    syncCardState(input);
    showStatus(value ? "Enabled — reload affected tabs" : "Disabled — reload affected tabs");
  });
});

// Loan Officer Profile — name / NMLS / phone / email used by
// borrower-facing PDFs. Stored in chrome.storage.local under the
// lo_* keys. Saves on input (debounced) so the user doesn't have
// to click a Save button.
const LO_FIELDS = ['lo_name', 'lo_nmls', 'lo_phone', 'lo_email', 'lo_zillow_url'];
async function loadLoProfile() {
  const data = await chrome.storage.local.get(LO_FIELDS);
  document.querySelectorAll('input[data-lo-field]').forEach((input) => {
    const key = input.dataset.loField;
    if (data[key] != null) input.value = data[key];
  });
}
const loSaveTimers = {};
document.querySelectorAll('input[data-lo-field]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.loField;
    clearTimeout(loSaveTimers[key]);
    loSaveTimers[key] = setTimeout(async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() });
      showStatus('Profile saved');
    }, 400);
  });
});
loadLoProfile();

// Insurance Agent defaults — used by the Intro Email module and auto-CC'd
// on every Intro Email draft. Same auto-save-on-input pattern as the LO
// Profile fields.
const IA_FIELDS = ['insurance_agent_name', 'insurance_agent_company', 'insurance_agent_phone', 'insurance_agent_email'];
async function loadInsuranceAgent() {
  const data = await chrome.storage.local.get(IA_FIELDS);
  document.querySelectorAll('input[data-ia-field]').forEach((input) => {
    const key = input.dataset.iaField;
    if (data[key] != null) input.value = data[key];
  });
}
const iaSaveTimers = {};
document.querySelectorAll('input[data-ia-field]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.iaField;
    clearTimeout(iaSaveTimers[key]);
    iaSaveTimers[key] = setTimeout(async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() });
      showStatus('Insurance agent saved');
    }, 400);
  });
});
loadInsuranceAgent();

// "Pull from Salesforce" button — asks the SW to fetch the current user's
// Name / Email / Phone from chatter/users/me and (best effort) NMLS from
// a User custom field discovered via describe. Only fills inputs that
// come back populated; never blanks out a value the user already typed.
const loPullBtn = $('lo-pull-from-sf');
const loPullStatus = $('lo-pull-status');
function setLoPullStatus(text, color) {
  if (!loPullStatus) return;
  loPullStatus.textContent = text || '';
  loPullStatus.style.color = color || '#6b7280';
}
function setInputValue(field, value) {
  const input = document.querySelector(`input[data-lo-field="${field}"]`);
  if (!input || value == null || String(value).trim() === '') return false;
  input.value = String(value).trim();
  return true;
}
if (loPullBtn) {
  loPullBtn.addEventListener('click', async () => {
    loPullBtn.disabled = true;
    setLoPullStatus('Looking up…', '#6b7280');
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SF_LO_PROFILE' });
      if (!resp || !resp.ok) {
        setLoPullStatus(resp && resp.error ? resp.error : 'Lookup failed', '#b91c1c');
        return;
      }
      const filled = [];
      const updates = {};
      if (setInputValue('lo_name', resp.name))  { filled.push('Name');  updates.lo_name  = resp.name.trim(); }
      if (setInputValue('lo_email', resp.email)) { filled.push('Email'); updates.lo_email = resp.email.trim(); }
      if (setInputValue('lo_phone', resp.phone)) { filled.push('Phone'); updates.lo_phone = resp.phone.trim(); }
      if (setInputValue('lo_nmls', resp.nmls))   { filled.push('NMLS');  updates.lo_nmls  = resp.nmls.trim(); }
      if (Object.keys(updates).length) await chrome.storage.local.set(updates);
      if (filled.length === 0) {
        setLoPullStatus('Connected to Salesforce but nothing to fill.', '#b91c1c');
      } else {
        const missingNmls = !resp.nmls;
        const note = missingNmls
          ? ` (NMLS not found${resp.nmlsFieldName ? ` in field ${resp.nmlsFieldName}` : ''} — enter manually)`
          : '';
        setLoPullStatus(`Filled: ${filled.join(', ')}${note}`, '#15803d');
      }
    } catch (e) {
      setLoPullStatus(String(e && e.message || e), '#b91c1c');
    } finally {
      loPullBtn.disabled = false;
    }
  });
}

loadFeatureStates();

// Karma-link telemetry — fires when anyone clicks the "drop me karma"
// link in the banner. Lets us see whether the banner actually drives
// traffic to the Zall Wall.
document.querySelectorAll('a[data-zhl-karma-link]').forEach((a) => {
  a.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'karma_link_clicked',
        props: { source: a.getAttribute('data-zhl-karma-link') || 'setup' }
      });
    } catch (_) {}
  });
});

// ---------------------------------------------------------------------------
// First-run wizard
//
// Triggered by background's onInstalled when lo_name is empty (opens this
// page with ?firstrun=1). Also self-triggers if the user lands here through
// any other path and lo_name is blank — covers the case where someone opens
// setup themselves without ever filling in their profile.
//
// One-click flow: show banner → user clicks "Auto-fill from Salesforce" →
// reuse the existing Pull-from-Salesforce button's handler → highlight the
// LO Profile card with a brief pulse → dismiss banner on success.
// ---------------------------------------------------------------------------
(function initFirstRunWizard() {
  const banner   = document.getElementById('firstrun-banner');
  const pullBtn  = document.getElementById('firstrun-pull-btn');
  const manual   = document.getElementById('firstrun-manual-btn');
  const dismiss  = document.getElementById('firstrun-dismiss-btn');
  const status   = document.getElementById('firstrun-status');
  if (!banner) return;

  const params      = new URLSearchParams(location.search);
  const explicitRun = params.get('firstrun') === '1';

  function setStatus(text, color) {
    if (!status) return;
    status.textContent = text || '';
    status.style.color = color || '#1e40af';
  }
  function scrollToProfile() {
    const card = document.querySelector('[data-profile]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.style.transition = 'box-shadow .3s, outline .3s';
    card.style.outline = '3px solid #2563eb';
    card.style.boxShadow = '0 0 0 6px rgba(37,99,235,0.18)';
    setTimeout(function () {
      card.style.outline = '';
      card.style.boxShadow = '';
    }, 2400);
  }
  function hideBanner() { banner.style.display = 'none'; }

  // Decide whether to show. Either firstrun=1 OR lo_name is blank AND the
  // user hasn't already dismissed this banner in this Chrome profile.
  chrome.storage.local.get(['lo_name', '_zhl_firstrun_dismissed'], function (data) {
    const nameMissing = !data.lo_name || !String(data.lo_name).trim();
    const dismissed   = !!data._zhl_firstrun_dismissed;
    if (!explicitRun && (!nameMissing || dismissed)) return;
    banner.style.display = 'block';
    try {
      chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_shown', props: { explicit: explicitRun, nameMissing: nameMissing } });
    } catch (_) {}
    // If we came here via ?firstrun=1, auto-trigger the SF pull after a
    // beat so the user sees the banner first and the action feels caused
    // by their visit rather than mysteriously instant.
    if (explicitRun) setTimeout(function () { runPull('auto'); }, 600);
  });

  function runPull(source) {
    if (!pullBtn) return;
    pullBtn.disabled = true;
    setStatus('Looking up your Salesforce profile…', '#1e40af');
    try {
      chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_pull_clicked', props: { source: source } });
    } catch (_) {}
    chrome.runtime.sendMessage({ type: 'GET_SF_LO_PROFILE' }, function (resp) {
      pullBtn.disabled = false;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        const err = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Lookup failed — make sure you\'re signed into Salesforce.';
        setStatus('⚠ ' + err + ' You can still fill in below.', '#b91c1c');
        scrollToProfile();
        return;
      }
      const filled = [];
      const updates = {};
      if (setInputValue('lo_name',  resp.name))  { filled.push('Name');  updates.lo_name  = resp.name.trim(); }
      if (setInputValue('lo_email', resp.email)) { filled.push('Email'); updates.lo_email = resp.email.trim(); }
      if (setInputValue('lo_phone', resp.phone)) { filled.push('Phone'); updates.lo_phone = resp.phone.trim(); }
      if (setInputValue('lo_nmls',  resp.nmls))  { filled.push('NMLS');  updates.lo_nmls  = resp.nmls.trim(); }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
      if (filled.length === 0) {
        setStatus('Connected to Salesforce but nothing to fill — please type it in below.', '#b91c1c');
        scrollToProfile();
        return;
      }
      const missingNmls = !resp.nmls;
      setStatus('✓ Filled: ' + filled.join(', ') + (missingNmls ? ' (NMLS not found — enter manually)' : '') + '. You\'re all set!', '#15803d');
      try {
        chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_pull_success', props: { fields: filled.length, missingNmls: missingNmls } });
      } catch (_) {}
      // Persist dismissal so we don't pop again next time the user opens setup.
      chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
      scrollToProfile();
      // Auto-hide banner after a beat so the user sees the success message.
      setTimeout(function () {
        if (missingNmls) return; // leave open if NMLS needs manual entry
        hideBanner();
      }, missingNmls ? 0 : 2200);
    });
  }
  if (pullBtn)  pullBtn.addEventListener('click', function () { runPull('click'); });
  if (manual) manual.addEventListener('click', function () {
    chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_manual_clicked' }); } catch (_) {}
    hideBanner();
    scrollToProfile();
  });
  if (dismiss) dismiss.addEventListener('click', function () {
    chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_dismissed' }); } catch (_) {}
    hideBanner();
  });
})();

// ---------------------------------------------------------------------------
// VPA Email template editor
//
// Lets the LO customize the subject line and HTML body of the Send VPA
// Email module. Storage keys: vpa_subject_tmpl, vpa_body_html_tmpl.
// Defaults are read from window.__ZHL_VPA_DEFAULT_SUBJECT and
// window.__ZHL_VPA_DEFAULT_BODY_HTML (set by sf-vpa-email.js when it
// loads), with a local copy below as a fallback for the case where
// setup.html is opened in a context that doesn't have the module
// loaded in the same window.
// ---------------------------------------------------------------------------
(function initVpaTemplateEditor() {
  const subjectInput = document.getElementById('vpa-subject-tmpl');
  const bodyEditor   = document.getElementById('vpa-body-tmpl');
  const resetBtn     = document.getElementById('vpa-reset-btn');
  const statusEl     = document.getElementById('vpa-status');
  const toolbar      = document.querySelector('.vpa-body-toolbar');
  const tags         = document.querySelectorAll('.vpa-placeholders .placeholder-tag');
  if (!subjectInput || !bodyEditor) return;

  // Local fallback default (kept in sync with sf-vpa-email.js's
  // DEFAULT_BODY_HTML_TMPL). The module exposes the live default on
  // window when it runs in the same document; setup.html doesn't load
  // sf-vpa-email.js though, so we always end up using these locals.
  const LOCAL_DEFAULT_SUBJECT =
    'Verified Pre-Approval for {Full Names} - Up to {Amount}! - {LO Name} from Zillow Home Loans';

  // Brand asset URLs + styled "Zillow Home Loans" span (kept in sync with
  // sf-vpa-email.js DEFAULT_BODY_HTML_TMPL).
  const __ZHL_LOGO_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/logo%20no%20border.png';
  const __ZHL_TEXT_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/ZIllow%20Home%20Loans%20Text.png';
  const __ZHL_BRAND = '<span style="font-family: Georgia, \'Times New Roman\', serif; color: #0E35C4; font-weight: bold;">Zillow Home Loans</span>';

  const LOCAL_DEFAULT_BODY_HTML = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<img src="' + __ZHL_TEXT_URL + '" alt="Zillow Home Loans" width="300" height="44" style="display: block; margin: 0 0 18px 0;"/>' +
      '<h1 style="color: #0E35C4; font-size: 26px; font-weight: bold; margin-bottom: 16px; font-family: Georgia, \'Times New Roman\', serif;">Congratulations {Greeting}!</h1>' +
      '<p>I\'m excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to <span style="color: #0E35C4; font-weight: bold; text-decoration: underline;">{Amount}</span> at ' + __ZHL_BRAND + '!&nbsp; Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.&nbsp; You can also click here to view my <a href="{Zillow URL}" style="color: #0E35C4; text-decoration: underline;">Zillow Webpage</a>!</p>' +
      '<p><strong>This is a significant milestone on your homebuying journey.&nbsp; Now, armed with the Verified Pre-Approval, you\'re one step closer to finding your dream home!</strong></p>' +
      '<p><strong>Feel free to reach out to me if you have any questions or need assistance moving forward. I\'m here to help make your homeownership dreams a reality.</strong></p>' +
      '<br/>' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">' +
        '<tr>' +
          '<td style="vertical-align: middle; padding-right: 10px;">' +
            '<img src="' + __ZHL_LOGO_URL + '" alt="Zillow" width="40" height="40" style="display: block;"/>' +
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
        '<li style="margin-bottom: 6px;">No Cost Appraisal &ndash; By financing with ' + __ZHL_BRAND + ' and working with a Zillow Premier Agent partner, ' + __ZHL_BRAND + ' will cover the cost of your appraisal*.</li>' +
        '<li style="margin-bottom: 6px;">Very comfortable 21-Day closings</li>' +
      '</ul>' +
      '<p style="font-size: 20px; font-weight: bold; font-style: italic; margin: 20px 0; color: #0E35C4; font-family: Georgia, \'Times New Roman\', serif;">Congratulations again {Greeting}, and best of luck with your home search!</p>' +
      '<p style="font-size: 10px; color: #666666; font-style: italic; line-height: 1.4;">* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.</p>' +
    '</div>'
  );

  function getDefaultSubject() {
    try { return window.__ZHL_VPA_DEFAULT_SUBJECT || LOCAL_DEFAULT_SUBJECT; }
    catch (_) { return LOCAL_DEFAULT_SUBJECT; }
  }
  function getDefaultBodyHtml() {
    try { return window.__ZHL_VPA_DEFAULT_BODY_HTML || LOCAL_DEFAULT_BODY_HTML; }
    catch (_) { return LOCAL_DEFAULT_BODY_HTML; }
  }

  // Load saved values (or defaults)
  chrome.storage.local.get(['vpa_subject_tmpl', 'vpa_body_html_tmpl'], function (data) {
    subjectInput.value = (data && data.vpa_subject_tmpl) || getDefaultSubject();
    bodyEditor.innerHTML = (data && data.vpa_body_html_tmpl) || getDefaultBodyHtml();
  });

  // Status helper
  let statusTimer = null;
  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 1800);
  }

  // Debounced save on subject change
  let subjectTimer = null;
  subjectInput.addEventListener('input', function () {
    clearTimeout(subjectTimer);
    subjectTimer = setTimeout(function () {
      chrome.storage.local.set({ vpa_subject_tmpl: subjectInput.value.trim() }, function () {
        setStatus('Subject saved');
      });
    }, 400);
  });

  // Debounced save on body edit
  let bodyTimer = null;
  bodyEditor.addEventListener('input', function () {
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(function () {
      chrome.storage.local.set({ vpa_body_html_tmpl: bodyEditor.innerHTML }, function () {
        setStatus('Body saved');
      });
    }, 600);
  });

  // Toolbar buttons → document.execCommand on the editor
  if (toolbar) {
    toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('.vpa-tb');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      bodyEditor.focus();
      if (cmd === 'createLink') {
        const url = window.prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      // Save the edit
      chrome.storage.local.set({ vpa_body_html_tmpl: bodyEditor.innerHTML });
    });
  }

  // Placeholder chip click → insert at caret
  tags.forEach(function (tag) {
    tag.addEventListener('click', function () {
      const code = tag.getAttribute('data-insert') || tag.textContent.trim();
      // Decide which input has focus. If neither does, default to the body.
      const active = document.activeElement;
      if (active === subjectInput) {
        const start = subjectInput.selectionStart || subjectInput.value.length;
        const end   = subjectInput.selectionEnd   || start;
        const before = subjectInput.value.slice(0, start);
        const after  = subjectInput.value.slice(end);
        subjectInput.value = before + code + after;
        const pos = before.length + code.length;
        subjectInput.setSelectionRange(pos, pos);
        subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
        subjectInput.focus();
      } else {
        bodyEditor.focus();
        document.execCommand('insertText', false, code);
        bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  // Reset to defaults
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('Reset the VPA Email subject and body to the default template? Your customizations will be replaced.')) return;
      subjectInput.value    = getDefaultSubject();
      bodyEditor.innerHTML  = getDefaultBodyHtml();
      chrome.storage.local.set({
        vpa_subject_tmpl:    subjectInput.value,
        vpa_body_html_tmpl:  bodyEditor.innerHTML
      }, function () { setStatus('Reset to default'); });
    });
  }
})();

// ---------------------------------------------------------------------------
// Intro Email template editor — mirrors the VPA editor, different storage
// keys (intro_subject_tmpl, intro_body_html_tmpl) and a different default
// body. Defaults come from window.__ZHL_INTRO_DEFAULT_* (set by
// sf-intro-email.js); a local fallback below keeps the Setup page
// self-contained.
// ---------------------------------------------------------------------------
(function initIntroTemplateEditor() {
  const subjectInput = document.getElementById('intro-subject-tmpl');
  const bodyEditor   = document.getElementById('intro-body-tmpl');
  const resetBtn     = document.getElementById('intro-reset-btn');
  const statusEl     = document.getElementById('intro-status');
  const toolbar      = bodyEditor && bodyEditor.previousElementSibling;
  const tags         = subjectInput && subjectInput.closest('.vpa-email-config').querySelectorAll('.vpa-placeholders .placeholder-tag');
  if (!subjectInput || !bodyEditor) return;

  const LOCAL_DEFAULT_SUBJECT = 'Disclosures signed — here\'s what happens next';

  const LOCAL_DEFAULT_BODY_HTML = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<p>Hi {Greeting},</p>' +
      '<p>Great news &mdash; your initial disclosures are signed and your file is officially moving. Here\'s what to expect over the next several days so nothing catches you off guard.</p>' +
      '<p><strong>1. Initial underwriting review.</strong> Your file goes into an early underwriter review so we can get ahead of any conditions before they become time crunches later. The goal is to surface anything we need from you now, while we have runway, rather than at the closing table.</p>' +
      '<p><strong>2. Loan processor introduction.</strong> One of our processors will reach out shortly to introduce themselves and become your day-to-day point of contact for documentation. They\'ll let you know if anything additional is needed beyond what you\'ve already provided. I\'m still quarterbacking the whole file, so don\'t worry &mdash; you\'re not getting handed off, just adding a teammate.</p>' +
      '<p><strong>3. Homeowners insurance.</strong> This is the one item I\'d ask you to start on this week. You\'ll need a homeowners insurance policy in place before we can close, and quotes can take a few days to come back. I\'ve cc\'d <strong>{Insurance Agent Name}</strong> with {Insurance Agent Company} on this email &mdash; she/he can shop multiple carriers for you to find the best coverage and rate. Feel free to reply all or reach her/him directly:</p>' +
      '<p style="margin-left: 24px;">' +
        '<strong>{Insurance Agent Name}</strong><br>' +
        '{Insurance Agent Company}<br>' +
        '{Insurance Agent Phone}<br>' +
        '<a href="mailto:{Insurance Agent Email}" style="color: #0E35C4;">{Insurance Agent Email}</a>' +
      '</p>' +
      '<p>Once you have a policy selected, just let me know so we can coordinate the rest.</p>' +
      '<p>If any questions come up between now and closing, text or call me anytime &mdash; that\'s what I\'m here for. We\'ll keep this moving.</p>' +
      '<hr style="border: none; border-top: 1px solid #d1d5db; margin: 16px 0;">' +
      '<p style="font-size: 12px; color: #4b5563;">' +
        '<strong>Borrower Information</strong><br>' +
        'Borrower: {Borrower Name}<br>' +
        'Phone: {Borrower Phone}<br>' +
        'Email: {Borrower Email}<br>' +
        'Co-Borrower: {Co-Borrower Name}<br>' +
        'Phone: {Co-Borrower Phone}<br>' +
        'Email: {Co-Borrower Email}<br>' +
        'Property Address: {Property Address}<br>' +
        'Loan Number: {Loan Number}<br>' +
        'Estimated Closing Date: {Closing Date}' +
      '</p>' +
    '</div>'
  );

  function getDefaultSubject() {
    try { return window.__ZHL_INTRO_DEFAULT_SUBJECT || LOCAL_DEFAULT_SUBJECT; }
    catch (_) { return LOCAL_DEFAULT_SUBJECT; }
  }
  function getDefaultBodyHtml() {
    try { return window.__ZHL_INTRO_DEFAULT_BODY_HTML || LOCAL_DEFAULT_BODY_HTML; }
    catch (_) { return LOCAL_DEFAULT_BODY_HTML; }
  }

  chrome.storage.local.get(['intro_subject_tmpl', 'intro_body_html_tmpl'], function (data) {
    subjectInput.value   = (data && data.intro_subject_tmpl)   || getDefaultSubject();
    bodyEditor.innerHTML = (data && data.intro_body_html_tmpl) || getDefaultBodyHtml();
  });

  let statusTimer = null;
  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 1800);
  }

  let subjectTimer = null;
  subjectInput.addEventListener('input', function () {
    clearTimeout(subjectTimer);
    subjectTimer = setTimeout(function () {
      chrome.storage.local.set({ intro_subject_tmpl: subjectInput.value.trim() }, function () {
        setStatus('Subject saved');
      });
    }, 400);
  });

  let bodyTimer = null;
  bodyEditor.addEventListener('input', function () {
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(function () {
      chrome.storage.local.set({ intro_body_html_tmpl: bodyEditor.innerHTML }, function () {
        setStatus('Body saved');
      });
    }, 600);
  });

  if (toolbar && toolbar.classList && toolbar.classList.contains('vpa-body-toolbar')) {
    toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('.vpa-tb');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      bodyEditor.focus();
      if (cmd === 'createLink') {
        const url = window.prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      chrome.storage.local.set({ intro_body_html_tmpl: bodyEditor.innerHTML });
    });
  }

  if (tags && tags.length) {
    tags.forEach(function (tag) {
      tag.addEventListener('click', function () {
        const code = tag.getAttribute('data-insert') || tag.textContent.trim();
        const active = document.activeElement;
        if (active === subjectInput) {
          const start = subjectInput.selectionStart || subjectInput.value.length;
          const end   = subjectInput.selectionEnd   || start;
          const before = subjectInput.value.slice(0, start);
          const after  = subjectInput.value.slice(end);
          subjectInput.value = before + code + after;
          const pos = before.length + code.length;
          subjectInput.setSelectionRange(pos, pos);
          subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
          subjectInput.focus();
        } else {
          bodyEditor.focus();
          document.execCommand('insertText', false, code);
          bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('Reset the Intro Email subject and body to the default template? Your customizations will be replaced.')) return;
      subjectInput.value   = getDefaultSubject();
      bodyEditor.innerHTML = getDefaultBodyHtml();
      chrome.storage.local.set({
        intro_subject_tmpl:   subjectInput.value,
        intro_body_html_tmpl: bodyEditor.innerHTML
      }, function () { setStatus('Reset to default'); });
    });
  }
})();
