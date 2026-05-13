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

loadFeatureStates();
