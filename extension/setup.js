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
  "feature_gmailDragAttachments",
  "feature_telemetry"
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
