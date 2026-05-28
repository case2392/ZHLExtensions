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
  "feature_autoCallDetailsTab",
  "feature_autoMessagingTab",
  "feature_scenarioSort",
  "feature_pricingResultsPrint",
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
const LO_FIELDS = ['lo_name', 'lo_nmls', 'lo_phone', 'lo_email'];
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
