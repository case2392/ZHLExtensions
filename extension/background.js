// ZHL Productivity Pack — service worker.
//
// Two jobs:
//   1. Open the setup page the first time the extension installs so the user
//      knows where to go to enable / disable the modules.
//   2. Handle Salesforce REST lookups for the Caller ID module (kept here
//      because content scripts can't make cross-origin requests with cookies).
//
// SFGmail (VPA email sender) ships its own background script. ES-module
// service workers support `import` of sibling files; importing here causes
// SFGmail's listeners (chrome.runtime.onMessage / chrome.identity / Gmail +
// Drive API helpers) to register alongside ours. The listeners coexist
// because each one inspects msg.type and returns early for unrelated
// messages.
import './sfgmail-background.js';

const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?";
console.log(`[ZHL Pack v${VERSION}] service worker started`);

// ---- Defaults: every module on by default --------------------------------
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
  "feature_sfGmail",
  "feature_telemetry"
];

chrome.runtime.onInstalled.addListener(async (details) => {
  // Seed any unset feature flags to true so a fresh install ships with all
  // modules enabled. The setup page can flip them off after.
  const stored = await chrome.storage.local.get(FEATURE_KEYS);
  const updates = {};
  for (const k of FEATURE_KEYS) {
    if (stored[k] === undefined) updates[k] = true;
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);

  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// Clicking the toolbar icon opens the setup page too — gives users a second
// way to find it after install.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// -------------------------------------------------------------------------
// Caller ID lookup (was Genesys-CallerID/background.js)
// -------------------------------------------------------------------------

const CALLERID_DEFAULTS = {
  myDomainHost: "zillowhomeloans.my.salesforce.com",
  apiVersion: "v59.0",
  objects: [
    { sobject: "Lead",    nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Contact", nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Loan__c", nameField: "Name", phoneFields: ["Phone__c", "Mobile__c"] }
  ],
  cacheTtlMs: 5 * 60 * 1000
};

async function getCallerIdConfig() {
  const stored = await chrome.storage.sync.get(["myDomainHost", "apiVersion", "objects", "cacheTtlMs"]);
  return { ...CALLERID_DEFAULTS, ...stored };
}

async function getSessionId(host) {
  const cookie = await chrome.cookies.get({ url: `https://${host}`, name: "sid" });
  if (cookie && cookie.value) return cookie.value;
  const all = await chrome.cookies.getAll({ name: "sid" });
  for (const c of all) {
    if (c.domain && (host.endsWith(c.domain.replace(/^\./, "")) || c.domain.replace(/^\./, "") === host)) {
      return c.value;
    }
  }
  console.warn("[CallerID] No sid cookie for", host);
  return null;
}

const callerIdCache = new Map();

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function escapeSoql(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function phoneVariants(tenDigit) {
  const a = tenDigit.slice(0, 3);
  const b = tenDigit.slice(3, 6);
  const c = tenDigit.slice(6);
  return [
    tenDigit,
    `1${tenDigit}`,
    `+1${tenDigit}`,
    `+1 ${a} ${b} ${c}`,
    `+1 ${a}-${b}-${c}`,
    `${a}-${b}-${c}`,
    `(${a}) ${b}-${c}`,
    `${a}.${b}.${c}`,
    `${a} ${b} ${c}`
  ];
}

async function querySalesforce(host, apiVersion, sid, soql) {
  const url = `https://${host}/services/data/${apiVersion}/query/?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${sid}`, Accept: "application/json" }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SF ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function lookupPhone(tenDigit) {
  const cached = callerIdCache.get(tenDigit);
  if (cached && cached.expires > Date.now()) return cached.value;
  const cfg = await getCallerIdConfig();
  const sid = await getSessionId(cfg.myDomainHost);
  if (!sid) {
    return { error: "No Salesforce session. Log into Salesforce in this browser." };
  }

  const variants = phoneVariants(tenDigit).map(escapeSoql);
  const variantsList = variants.map(v => `'${v}'`).join(", ");

  let best = null;
  let queryAttempts = 0;
  let queryHits = 0;

  for (const obj of cfg.objects) {
    const phoneClauses = obj.phoneFields.map(f => `${f} IN (${variantsList})`).join(" OR ");
    const soql =
      `SELECT Id, ${obj.nameField}, ${obj.phoneFields.join(", ")}, LastModifiedDate ` +
      `FROM ${obj.sobject} WHERE ${phoneClauses} ORDER BY LastModifiedDate DESC LIMIT 1`;
    try {
      queryAttempts++;
      const data = await querySalesforce(cfg.myDomainHost, cfg.apiVersion, sid, soql);
      const rec = data.records && data.records[0];
      if (rec) {
        queryHits++;
        const candidate = {
          name: rec[obj.nameField],
          sobject: obj.sobject,
          id: rec.Id,
          lastModified: rec.LastModifiedDate
        };
        if (!best || (candidate.lastModified || "") > (best.lastModified || "")) {
          best = candidate;
        }
      }
    } catch (e) {
      if (!String(e.message).includes("400") && !String(e.message).includes("404")) {
        console.warn("[CallerID] SF query failed for", obj.sobject, e.message);
      }
    }
  }

  console.log("[CallerID] lookup", tenDigit, "→", best ? `${best.sobject} ${best.id} ${best.name}` : "no match",
    `(queries: ${queryAttempts}, hits: ${queryHits})`);

  const value = best || null;
  callerIdCache.set(tenDigit, { value, expires: Date.now() + cfg.cacheTtlMs });
  return value;
}

// Used by the SMS Quick-Add Participants module: given a Salesforce
// Contact id, return that contact's Phone / MobilePhone via the same
// REST plumbing the Caller ID lookup uses.
async function lookupContactPhone(contactId) {
  const safeId = String(contactId || "").replace(/[^a-zA-Z0-9]/g, "");
  if (safeId.length !== 15 && safeId.length !== 18) {
    return { error: "Invalid Salesforce Contact id" };
  }
  const cfg = await getCallerIdConfig();
  const sid = await getSessionId(cfg.myDomainHost);
  if (!sid) {
    return { error: "No Salesforce session. Log into Salesforce in this browser." };
  }
  const soql = `SELECT Id, Name, Phone, MobilePhone FROM Contact WHERE Id = '${safeId}' LIMIT 1`;
  try {
    const data = await querySalesforce(cfg.myDomainHost, cfg.apiVersion, sid, soql);
    const rec = data.records && data.records[0];
    if (!rec) return { error: "Contact not found" };
    return {
      id: rec.Id,
      name: rec.Name,
      phone: rec.Phone || null,
      mobilePhone: rec.MobilePhone || null
    };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

// -------------------------------------------------------------------------
// Telemetry — sends usage events to a Google Apps Script web app (admin
// dashboard). Configured ONCE: deploy apps-script/Code.gs as a web app,
// paste the deployment URL into TELEMETRY_ENDPOINT below, and bump the
// extension version.
//
// Identity = the Google account email captured from any open Gmail tab.
// Stored in chrome.storage.local; persists across reinstalls because the
// next time the user opens Gmail we re-detect the same email. Until an
// email is captured we use an anonymous UUID so we don't lose events.
// -------------------------------------------------------------------------

const TELEMETRY_ENDPOINT = "https://script.google.com/a/macros/zillowgroup.com/s/AKfycbzMWkGDZEDBBMBBD6mYMNEZJlwEUh3I41_iJgSaCz52abIBWNjf3YfbQ-fmA_1bLp75/exec";
const TELEMETRY_FLUSH_MS = 30 * 1000;
const TELEMETRY_QUEUE_KEY = "_zhl_tlm_queue";
const TELEMETRY_USER_KEY = "_zhl_tlm_user";
const TELEMETRY_ANON_KEY = "_zhl_tlm_anon_id";
const TELEMETRY_MAX_QUEUE = 500;

function _tlmUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function getOrCreateAnonId() {
  const data = await chrome.storage.local.get([TELEMETRY_ANON_KEY]);
  if (data[TELEMETRY_ANON_KEY]) return data[TELEMETRY_ANON_KEY];
  const id = "anon-" + _tlmUuid();
  await chrome.storage.local.set({ [TELEMETRY_ANON_KEY]: id });
  return id;
}

async function setTelemetryUser(user) {
  const data = await chrome.storage.local.get([TELEMETRY_USER_KEY]);
  const existing = data[TELEMETRY_USER_KEY] || {};
  const merged = Object.assign(
    { firstSeen: existing.firstSeen || Date.now() },
    existing,
    user || {},
    { lastSeen: Date.now() }
  );
  await chrome.storage.local.set({ [TELEMETRY_USER_KEY]: merged });
}

async function isTelemetryEnabled() {
  const data = await chrome.storage.local.get(["feature_telemetry"]);
  return data.feature_telemetry !== false; // default: on
}

async function enqueueEvent(event) {
  if (!(await isTelemetryEnabled())) return;
  const data = await chrome.storage.local.get([TELEMETRY_QUEUE_KEY]);
  const queue = data[TELEMETRY_QUEUE_KEY] || [];
  queue.push(event);
  if (queue.length > TELEMETRY_MAX_QUEUE) queue.splice(0, queue.length - TELEMETRY_MAX_QUEUE);
  await chrome.storage.local.set({ [TELEMETRY_QUEUE_KEY]: queue });
}

async function flushTelemetry() {
  if (!TELEMETRY_ENDPOINT) return;
  if (!(await isTelemetryEnabled())) return;
  const data = await chrome.storage.local.get([TELEMETRY_QUEUE_KEY, TELEMETRY_USER_KEY]);
  const queue = data[TELEMETRY_QUEUE_KEY] || [];
  if (queue.length === 0) return;
  const user = data[TELEMETRY_USER_KEY] || null;
  const anonId = await getOrCreateAnonId();
  const payload = {
    user: {
      email: (user && user.email) || null,
      name: (user && user.name) || null,
      id: anonId,
      firstSeen: (user && user.firstSeen) || null
    },
    extensionVersion: VERSION,
    sentAt: new Date().toISOString(),
    events: queue
  };
  try {
    const res = await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      // text/plain so the request is "simple" and avoids a CORS preflight
      // — Apps Script reads e.postData.contents either way.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      keepalive: true
    });
    if (res.ok) {
      // Drop the events we just sent. New events queued during the await
      // will already be in storage and will be picked up next flush.
      const after = await chrome.storage.local.get([TELEMETRY_QUEUE_KEY]);
      const cur = after[TELEMETRY_QUEUE_KEY] || [];
      const remaining = cur.slice(queue.length); // new events added during fetch
      await chrome.storage.local.set({ [TELEMETRY_QUEUE_KEY]: remaining });
    }
  } catch (_) {
    // Will retry on next interval. Events stay in the queue.
  }
}

setInterval(flushTelemetry, TELEMETRY_FLUSH_MS);
// Also flush soon after install/startup so events from the first session
// don't sit around for 30 seconds before being sent.
setTimeout(flushTelemetry, 5 * 1000);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "LOOKUP_PHONE") {
    const ten = normalizePhone(msg.phone);
    if (!ten || ten.length !== 10) {
      sendResponse({ ok: true, match: null });
      return false;
    }
    lookupPhone(ten).then(
      (match) => sendResponse({ ok: true, match }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }
  if (msg && msg.type === "GET_CONTACT_PHONE") {
    lookupContactPhone(msg.contactId).then(
      (result) => sendResponse(Object.assign({ ok: !result.error }, result)),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }
  if (msg && msg.type === "CLEAR_CACHE") {
    callerIdCache.clear();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "TRACK") {
    // Sanitize the source URL to hostname only — the full URL would leak
    // Salesforce record ids and other PII into the telemetry sheet.
    let url = null;
    if (sender && sender.url) {
      try { url = new URL(sender.url).hostname; } catch (_) { url = null; }
    }
    const event = {
      name: String(msg.event || "unknown"),
      props: msg.props && typeof msg.props === "object" ? msg.props : {},
      url: url,
      ts: Date.now()
    };
    enqueueEvent(event);
    return false;
  }
  if (msg && msg.type === "IDENTIFY") {
    setTelemetryUser({
      email: msg.email ? String(msg.email).trim() : null,
      name: msg.name ? String(msg.name).trim() : null
    });
    return false;
  }
  return false;
});
