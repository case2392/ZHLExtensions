// Setup page logic — feature toggles + Caller ID config.

const FEATURE_KEYS = [
  "feature_gmailTweaks",
  "feature_salesforcePromotions",
  "feature_contactSms",
  "feature_loanAmount",
  "feature_vaCalc",
  "feature_callerId"
];

const CID_DEFAULTS = {
  myDomainHost: "zillowhomeloans.my.salesforce.com",
  apiVersion: "v59.0",
  objects: [
    { sobject: "Lead",    nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Contact", nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Loan__c", nameField: "Name", phoneFields: ["Phone__c", "Mobile__c"] }
  ],
  cacheTtlMs: 300000
};

const $ = (id) => document.getElementById(id);

// Note: Gmail Tweaks covers both the Gmail mail.google.com fixes and the
// Salesforce "Show Promotions" auto-disable. They live in separate content
// scripts but share one toggle so the user sees one row per "thing" rather
// than one row per script file.
const GMAIL_TWEAKS_LINKED = ["feature_gmailTweaks", "feature_salesforcePromotions"];

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
    // Default to enabled if unset.
    const enabled = data[key] !== false;
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
      // Keep the linked Salesforce promotions sub-feature in sync.
      for (const linked of GMAIL_TWEAKS_LINKED) updates[linked] = value;
    }
    await chrome.storage.local.set(updates);
    syncCardState(input);
    showStatus(value ? "Enabled — reload affected tabs" : "Disabled — reload affected tabs");
  });
});

// ---- Caller ID config -------------------------------------------------

async function loadCallerIdConfig() {
  const cfg = { ...CID_DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(CID_DEFAULTS))) };
  $("cid-myDomainHost").value = cfg.myDomainHost;
  $("cid-apiVersion").value = cfg.apiVersion;
  $("cid-cacheTtlMs").value = cfg.cacheTtlMs;
  $("cid-objects").value = JSON.stringify(cfg.objects, null, 2);
}

function setCidStatus(msg, ok = true) {
  const el = $("cid-status");
  el.textContent = msg;
  el.classList.toggle("error", !ok);
  clearTimeout(setCidStatus._t);
  setCidStatus._t = setTimeout(() => { el.textContent = ""; }, 3000);
}

$("cid-save").addEventListener("click", async () => {
  let objects;
  try {
    objects = JSON.parse($("cid-objects").value);
    if (!Array.isArray(objects)) throw new Error("Objects must be an array");
  } catch (e) {
    setCidStatus("Invalid Objects JSON: " + e.message, false);
    return;
  }
  await chrome.storage.sync.set({
    myDomainHost: $("cid-myDomainHost").value.trim(),
    apiVersion: $("cid-apiVersion").value.trim() || "v59.0",
    objects,
    cacheTtlMs: parseInt($("cid-cacheTtlMs").value, 10) || 300000
  });
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, () => {});
  setCidStatus("Saved.");
});

$("cid-clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, () => setCidStatus("Cache cleared."));
});

loadFeatureStates();
loadCallerIdConfig();
