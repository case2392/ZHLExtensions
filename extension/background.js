// ZHL Productivity Pack — service worker.
//
// Two jobs:
//   1. Open the setup page the first time the extension installs so the user
//      knows where to go to enable / disable the modules.
//   2. Handle Salesforce REST lookups for the Caller ID module (kept here
//      because content scripts can't make cross-origin requests with cookies).

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
  "feature_gmailDragAttachments",
  "feature_gmailCallerId",
  "feature_taskBulkDelete",
  "feature_taskBulkDownload",
  "feature_fhaBadges",
  "feature_fhaNprWarning",
  "feature_fhaFlipRule",
  "feature_fhaManualEligible",
  "feature_copyAddresses",
  "feature_updateToast",
  "feature_smsMarkAllRead",
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
    // Fresh install — open the walkthrough page so new users get the
    // tour. Stamp the toast's "last seen" key to the current version
    // so the content script's update-toast doesn't ALSO fire on the
    // user's first LOP/Gmail/Salesforce tab load.
    await chrome.storage.local.set({ "_zhl_last_seen_version": VERSION });
    chrome.tabs.create({ url: chrome.runtime.getURL("walkthrough.html?src=install") });
  }
  // For "update" we intentionally do NOT stamp the version — that's
  // how the content script's update-toast knows to fire on the next
  // LOP/Gmail/Salesforce tab load.
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

async function lookupPhone(tenDigit, senderInfo) {
  const cached = callerIdCache.get(tenDigit);
  // Cache hit: return immediately AND don't fire telemetry. The
  // telemetry only fires when we actually query Salesforce, which
  // gives us 5-minute deduplication (the cache TTL) per phone number
  // — way better than the per-60s content-script dedup we had before.
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

  // Telemetry: only fires on a real Salesforce query, not on cache
  // hits. Includes the page hostname so we can see WHERE misses are
  // coming from (e.g. is it always voicemail rows? call history? a
  // particular Salesforce page?).
  const hostname = (senderInfo && senderInfo.hostname) || null;
  enqueueEvent({
    name: best ? "caller_id_match" : "caller_id_no_match",
    props: best
      ? { sobject: best.sobject, hostname: hostname }
      : { hostname: hostname },
    url: hostname,
    ts: Date.now()
  });

  const value = best || null;
  callerIdCache.set(tenDigit, { value, expires: Date.now() + cfg.cacheTtlMs });
  return value;
}

// -------------------------------------------------------------------------
// Identity capture from Salesforce (no Gmail tab required)
//
// Calls /services/data/vXX.0/chatter/users/me with the user's existing
// Salesforce session cookie. That endpoint returns the current user's
// email and display name — same data we'd otherwise scrape from
// Gmail's account button. Lets us identify users who don't have Gmail
// open in this browser at all.
// -------------------------------------------------------------------------

let sfIdentityLastChecked = 0;
const SF_IDENTITY_TTL_MS = 60 * 60 * 1000; // re-check once an hour

async function tryCaptureSalesforceIdentity() {
  const now = Date.now();
  if (now - sfIdentityLastChecked < SF_IDENTITY_TTL_MS) return;
  sfIdentityLastChecked = now;
  try {
    const cfg = await getCallerIdConfig();
    const sid = await getSessionId(cfg.myDomainHost);
    if (!sid) return;
    const url = `https://${cfg.myDomainHost}/services/data/${cfg.apiVersion}/chatter/users/me`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${sid}`, Accept: "application/json" }
    });
    if (!res.ok) return;
    const data = await res.json();
    const email = data && data.email ? String(data.email).trim() : null;
    if (!email) return;
    const name = data.displayName || data.name || null;
    await setTelemetryUser({ email, name });
    enqueueEvent({
      name: "identity_captured",
      props: { source: "salesforce_chatter_me" },
      url: cfg.myDomainHost,
      ts: Date.now()
    });
    console.log("[ZHL Pack] identity captured from Salesforce:", email);
  } catch (e) {
    // best effort — Gmail capture will still try too
  }
}
// First check after startup, then once an hour. The TTL guard inside
// the function prevents redundant calls even if these schedules drift.
setTimeout(tryCaptureSalesforceIdentity, 10 * 1000);
setInterval(tryCaptureSalesforceIdentity, 30 * 60 * 1000);

// Used by the SMS Quick-Add Participants module: given a Salesforce
// Contact id, return that contact's Phone / MobilePhone via the same
// REST plumbing the Caller ID lookup uses. Falls back to Lead because
// in ZHL's schema the Lead's Co-Borrower lookup field can point to
// either a Contact or a Lead — the link in the UI looks the same and
// our regex on /lightning/r/Contact/<id>/ already filters to Contact-
// shaped URLs, but if the SOQL Contact query comes back empty (which
// happens when the id is actually a Lead id with the same prefix
// pattern, or when a Contact exists but its Phone+Mobile are both
// empty) we try Lead before giving up.
async function lookupContactPhone(contactId) {
  const safeId = String(contactId || "").replace(/[^a-zA-Z0-9]/g, "");
  if (safeId.length !== 15 && safeId.length !== 18) {
    return { error: "Invalid Salesforce id (expected 15 or 18 chars)" };
  }
  const cfg = await getCallerIdConfig();
  const sid = await getSessionId(cfg.myDomainHost);
  if (!sid) {
    return { error: "No Salesforce session. Log into Salesforce in this browser." };
  }

  async function tryObject(sobject) {
    const soql = `SELECT Id, Name, Phone, MobilePhone FROM ${sobject} WHERE Id = '${safeId}' LIMIT 1`;
    try {
      const data = await querySalesforce(cfg.myDomainHost, cfg.apiVersion, sid, soql);
      const rec = data.records && data.records[0];
      if (!rec) return null;
      return {
        sobject,
        id: rec.Id,
        name: rec.Name,
        phone: rec.Phone || null,
        mobilePhone: rec.MobilePhone || null
      };
    } catch (e) {
      return { __error: String(e.message || e) };
    }
  }

  // Try Contact first (most common), then Lead.
  let result = await tryObject("Contact");
  if (result && result.__error && !/INVALID_TYPE|MALFORMED_ID|NOT_FOUND/i.test(result.__error)) {
    return { error: result.__error };
  }
  if (!result || result.__error) {
    result = await tryObject("Lead");
  }
  if (!result || result.__error) {
    return { error: "Record not found in Contact or Lead" };
  }
  if (!result.phone && !result.mobilePhone) {
    return {
      error: `Found ${result.sobject} "${result.name}" but it has no Phone or MobilePhone`,
      id: result.id, name: result.name, phone: null, mobilePhone: null, sobject: result.sobject
    };
  }
  return {
    id: result.id,
    name: result.name,
    phone: result.phone,
    mobilePhone: result.mobilePhone,
    sobject: result.sobject
  };
}

// -------------------------------------------------------------------------
// Loan Officer Profile pulled from Salesforce.
//
// The setup page has Name / NMLS / Phone / Email inputs that get stamped
// onto borrower-facing PDFs. Rather than make users type them, we can pull
// most of it straight from Salesforce using the same session cookie the
// Caller ID plumbing already uses.
//
//   - Name / Email / Phone: /chatter/users/me
//   - NMLS: User object, custom field. The API name varies across orgs
//     (NMLS_ID__c, NMLSId__c, NMLS_Number__c, etc.) so we describe the
//     User object once, find any custom field whose label/name contains
//     "NMLS", then SOQL the current user's record for it.
// -------------------------------------------------------------------------

let cachedNmlsFieldName = null;

async function discoverNmlsField(host, apiVersion, sid) {
  if (cachedNmlsFieldName) return cachedNmlsFieldName;
  const url = `https://${host}/services/data/${apiVersion}/sobjects/User/describe`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${sid}`, Accept: "application/json" }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const fields = (data && data.fields) || [];
  const match = fields.find((f) => {
    const n = String(f.name || "").toLowerCase();
    const l = String(f.label || "").toLowerCase();
    return /nmls/.test(n) || /nmls/.test(l);
  });
  cachedNmlsFieldName = match ? match.name : null;
  return cachedNmlsFieldName;
}

async function fetchSalesforceLoProfile() {
  const cfg = await getCallerIdConfig();
  const sid = await getSessionId(cfg.myDomainHost);
  if (!sid) {
    return { error: "No Salesforce session. Log into Salesforce in this browser." };
  }
  const meUrl = `https://${cfg.myDomainHost}/services/data/${cfg.apiVersion}/chatter/users/me`;
  const meRes = await fetch(meUrl, {
    headers: { Authorization: `Bearer ${sid}`, Accept: "application/json" }
  });
  if (!meRes.ok) {
    return { error: `Salesforce returned ${meRes.status} for chatter/users/me` };
  }
  const me = await meRes.json();
  const userId = me && me.id;
  const name = (me && (me.displayName || me.name)) || null;
  const email = (me && me.email) ? String(me.email).trim() : null;
  const phone = (me && (me.phoneNumber || me.mobilePhone)) || null;

  let nmls = null;
  let nmlsFieldName = null;
  try {
    nmlsFieldName = await discoverNmlsField(cfg.myDomainHost, cfg.apiVersion, sid);
    if (nmlsFieldName && userId) {
      const safeId = String(userId).replace(/[^a-zA-Z0-9]/g, "");
      const soql = `SELECT ${nmlsFieldName} FROM User WHERE Id = '${safeId}' LIMIT 1`;
      const data = await querySalesforce(cfg.myDomainHost, cfg.apiVersion, sid, soql);
      const rec = data.records && data.records[0];
      const raw = rec ? rec[nmlsFieldName] : null;
      if (raw != null && String(raw).trim() !== "") nmls = String(raw).trim();
    }
  } catch (e) {
    // Best-effort: if NMLS lookup fails we still return name/email/phone.
    console.warn("[ZHL Pack] NMLS lookup failed", e && e.message || e);
  }

  return { name, email, phone, nmls, nmlsFieldName };
}

// -------------------------------------------------------------------------
// Zillow last-sold lookup for the FHA 90-Day Flip Rule analyzer.
// Fetches Zillow's search page for the given address and tries
// multiple parsing strategies to extract the seller's most recent
// sale date. Falls back gracefully when Zillow returns a captcha /
// login wall (which they do on aggressive bot detection).
// -------------------------------------------------------------------------

async function fetchZillowLastSold(addressRaw) {
  const address = String(addressRaw || "").trim();
  if (!address) return { ok: false, error: "no address provided" };

  // Zillow's search-by-address URL. The _rb suffix tells Zillow this
  // is an address lookup vs. a city/region search. Encoding the
  // whole address as a single path segment matches what their own
  // search box produces.
  const url = "https://www.zillow.com/homes/" + encodeURIComponent(address) + "_rb/";

  let html;
  let finalUrl = url;
  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      // Don't send our extension's identity to Zillow; their bot
      // heuristics are friendlier to anonymous-looking requests.
      credentials: "omit",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9"
      },
      redirect: "follow"
    });
    httpStatus = res.status;
    finalUrl = res.url || url;
    if (!res.ok) {
      return { ok: false, error: "Zillow returned HTTP " + res.status, url, finalUrl };
    }
    html = await res.text();
  } catch (e) {
    return { ok: false, error: "fetch failed: " + (e && e.message || e), url };
  }

  console.log("[Zillow lookup] addr=" + address +
    " status=" + httpStatus +
    " finalUrl=" + finalUrl +
    " htmlLen=" + html.length);

  // Detect captcha / login wall — Zillow shows a "Press & hold" or
  // "Please verify you are a human" page when bot-blocking. Bail
  // early so the user knows to enter the date manually.
  if (/Press &amp; Hold to confirm|press and hold|please verify|are you a human/i.test(html)) {
    return { ok: false, error: "Zillow showed a captcha / verification page — try again later or enter the date manually", url, finalUrl, blocked: true, htmlLen: html.length };
  }

  // Strategy 1: __NEXT_DATA__ JSON. Newer Zillow pages embed the
  // full property data here.
  const nextMatch = html.match(/<script[^>]+id=\"__NEXT_DATA__\"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const found = findSoldDateInObject(data);
      if (found) return { ok: true, date: found, source: "zillow:__NEXT_DATA__", url };
    } catch (_) { /* fall through */ }
  }

  // Strategy 2: gdpClientCache JSON blob (older Zillow listing
  // pages).
  const cacheMatch = html.match(/"gdpClientCache"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (cacheMatch) {
    try {
      // The JSON inside gdpClientCache is double-escaped — decode
      // the string first, then JSON.parse the result.
      const inner = JSON.parse('"' + cacheMatch[1] + '"');
      const data = JSON.parse(inner);
      const found = findSoldDateInObject(data);
      if (found) return { ok: true, date: found, source: "zillow:gdpClientCache", url };
    } catch (_) { /* fall through */ }
  }

  // Strategy 3: regex over the raw HTML for any "Sold on" / "Last
  // sold" / "Sold date" pattern. Less precise but works on simpler
  // listing-card markup.
  const regexes = [
    // JSON in script blobs
    /"event"\s*:\s*"Sold"[^}]*?"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
    /"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"[^}]*?"event"\s*:\s*"Sold"/,
    /"event"\s*:\s*"Sold"[^}]*?"time"\s*:\s*"(\d{4}-\d{2}-\d{2})/,
    // Escaped JSON inside double-encoded payloads
    /\\"event\\"\s*:\s*\\"Sold\\"[^}]*?\\"date\\"\s*:\s*\\"(\d{4}-\d{2}-\d{2})\\"/,
    /\\"date\\"\s*:\s*\\"(\d{4}-\d{2}-\d{2})\\"[^}]*?\\"event\\"\s*:\s*\\"Sold\\"/,
    // Visible markup
    /Sold\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})[^<]*?<[^>]*>[^<]*Sold/i,
    /Last\s+sold(?:\s+for[^.]*?)?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Last\s+sold[^<]*?(\d{4}-\d{2}-\d{2})/i,
    /datePublished[^>]*?>(\d{4}-\d{2}-\d{2})</i,
    // dateSold / soldDate / dateSoldString fields anywhere in the
    // page (Zillow's actual current field is dateSoldString — the
    // others are kept for older / cached page variants).
    /"(?:dateSoldString|dateSold|soldDate|lastSoldDate)"\s*:\s*"?(\d{4}-\d{2}-\d{2})/i,
    /"(?:dateSoldString|dateSold|soldDate|lastSoldDate)"\s*:\s*"?(\d{1,2}\/\d{1,2}\/\d{4})/i,
    // Escaped-JSON variants (nested-JSON-as-string blobs)
    /\\"(?:dateSoldString|dateSold|soldDate|lastSoldDate)\\"\s*:\s*\\?"?(\d{4}-\d{2}-\d{2})/i,
    /\\"(?:dateSoldString|dateSold|soldDate|lastSoldDate)\\"\s*:\s*\\?"?(\d{1,2}\/\d{1,2}\/\d{4})/i
  ];
  for (const re of regexes) {
    const m = html.match(re);
    if (m && m[1]) {
      console.log("[Zillow lookup] matched regex " + re + " → " + m[1]);
      return { ok: true, date: m[1], source: "zillow:regex", url, finalUrl };
    }
  }

  // Diagnostic snippet — if Zillow returned a search results page or
  // a listing without price history we want to know what we got
  // back. Search for the word "Sold" so we can see what context it
  // appears in (or whether it's missing entirely).
  const soldIdx = html.indexOf("Sold");
  const snippet = soldIdx >= 0
    ? html.slice(Math.max(0, soldIdx - 80), Math.min(html.length, soldIdx + 160))
    : html.slice(0, 240);
  console.log("[Zillow lookup] no parse hit. snippet around 'Sold':", snippet);

  return {
    ok: false,
    error: "no sale date found in Zillow response",
    url,
    finalUrl,
    htmlLen: html.length,
    snippet: snippet
  };
}

// Walk an arbitrary object tree looking for a Sold event with a date.
// Zillow's JSON nests priceHistory at varying paths between major
// page rewrites; a recursive walk is more robust than hard-coded
// dotted paths.
function findSoldDateInObject(root) {
  const seen = new WeakSet();
  let best = null;
  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (Array.isArray(obj)) {
      for (const v of obj) walk(v);
      return;
    }
    // Direct hit: { event: "Sold", date: "2025-08-15" }
    if (obj.event && /sold/i.test(String(obj.event)) && obj.date) {
      const d = String(obj.date);
      if (!best || d > best) best = d; // pick most-recent sale
    }
    // priceHistory: [{ event, date, price }]
    if (Array.isArray(obj.priceHistory)) {
      for (const ev of obj.priceHistory) {
        if (ev && /sold/i.test(String(ev.event || "")) && ev.date) {
          const d = String(ev.date);
          if (!best || d > best) best = d;
        }
      }
    }
    for (const k of Object.keys(obj)) walk(obj[k]);
  }
  walk(root);
  return best;
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

// -------------------------------------------------------------------------
// Cross-tab Gmail attachment drag (feature_gmailDragAttachments — Phase 1)
// -------------------------------------------------------------------------
//
// Dragging from a Gmail tab to a different tab (e.g. LOP) loses the JS-
// constructed File: Chrome strips it from dataTransfer.files at drop, and
// the destination tab's drag events have no shared dataTransfer with the
// source. Workaround: cache the file's bytes here in the SW for the brief
// window between dragstart and dragend, and let the destination tab pull
// them on drop.
//
// Encoded as base64 because chrome.runtime.sendMessage JSON-serializes
// — Blob/ArrayBuffer don't survive structured clone over the message
// channel in MV3. Capped at 25MB on the source side; base64 inflates to
// ~33MB which fits comfortably within Chrome's IPC message size limit.
let activeGmailDrag = null;
const GMAIL_DRAG_TTL_MS = 60 * 1000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ZHL Credit Reader: a content script on zillowdocs.com found the
  // CoreLogic-XXX reference ID. Stash it in storage (so the Copy
  // LOP file feature can pick it up from any tab) and close the
  // sender's tab so the LO isn't left staring at the credit report.
  if (msg && msg.type === "ZHL_CREDIT_REF_FOUND") {
    const refId = String(msg.refId || "");
    if (!refId) { sendResponse({ ok: false, reason: "empty refId" }); return false; }
    try {
      chrome.storage.local.set({
        zhlPendingCreditRef: {
          refId: refId,
          rawText: "CoreLogic-" + refId,
          capturedAt: Date.now(),
          fromTabId: sender.tab ? sender.tab.id : null,
          fromUrl: msg.url || (sender.tab ? sender.tab.url : "")
        }
      }, () => {
        console.log("[ZHL Pack] Credit ref stashed:", refId);
      });
    } catch (e) {
      console.warn("[ZHL Pack] failed to stash credit ref:", e);
    }
    // Close the credit-report tab after a short delay so the
    // storage write completes first.
    setTimeout(() => {
      try {
        if (sender.tab && sender.tab.id) chrome.tabs.remove(sender.tab.id);
      } catch (e) {
        console.warn("[ZHL Pack] failed to close credit-report tab:", e);
      }
    }, 400);
    sendResponse({ ok: true, refId: refId });
    return false;
  }
  // ZHL Task Bulk Download: open a Zillow Docs viewer URL in a
  // background tab, arm the zillowdocs-side content script via
  // chrome.storage, and resolve the operator-side promise once
  // that content script reports back (or times out / errors).
  // Sequential — the operator-side awaits one OPEN at a time.
  if (msg && msg.type === "ZHL_BULK_DOWNLOAD_OPEN") {
    const url = String(msg.url || "");
    if (!url || !/^https:\/\/(?:www\.)?zillowdocs\.com\/embed\/editor/.test(url)) {
      sendResponse({ ok: false, reason: "bad or non-zillowdocs URL" });
      return false;
    }
    // Stash armed flag BEFORE creating the tab so the content
    // script sees it on its very first read.
    chrome.storage.local.set({
      zhlBulkDownloadArmed: {
        url: url,
        docName: String(msg.docName || ""),
        taskName: String(msg.taskName || ""),
        armedAt: Date.now()
      }
    }, () => {
      chrome.tabs.create({ url: url, active: false }, (tab) => {
        if (chrome.runtime.lastError || !tab || tab.id == null) {
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message || "tabs.create failed";
          console.warn("[ZHL Bulk DL] tabs.create failed:", err);
          sendResponse({ ok: false, reason: err });
          return;
        }
        const tabId = tab.id;
        let settled = false;
        const TIMEOUT_MS = 45 * 1000;
        const onMsg = (innerMsg, innerSender) => {
          if (settled) return;
          if (!innerMsg || innerMsg.type !== "ZHL_BULK_DOWNLOAD_TAB_DONE") return;
          if (!innerSender || !innerSender.tab || innerSender.tab.id !== tabId) return;
          settled = true;
          chrome.runtime.onMessage.removeListener(onMsg);
          // Brief delay so the download actually starts before we
          // close the tab.
          setTimeout(() => {
            try { chrome.tabs.remove(tabId); } catch (e) {
              console.warn("[ZHL Bulk DL] tabs.remove failed:", e);
            }
            sendResponse(Object.assign({ ok: true }, innerMsg.result || {}));
          }, 600);
        };
        chrome.runtime.onMessage.addListener(onMsg);
        // Timeout fallback — close the tab and resolve with an
        // error so the operator-side's await unblocks.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          chrome.runtime.onMessage.removeListener(onMsg);
          try { chrome.tabs.remove(tabId); } catch (_) {}
          // Also clear the armed flag so a future manual open
          // doesn't trigger the auto-download.
          try { chrome.storage.local.remove(["zhlBulkDownloadArmed"]); } catch (_) {}
          sendResponse({ ok: false, reason: "timed out waiting for Download click" });
        }, TIMEOUT_MS);
      });
    });
    return true; // async
  }
  if (msg && msg.type === "ZHL_BULK_DOWNLOAD_TAB_DONE") {
    // Just an ack — the OPEN handler above already wired its own
    // onMessage listener for the actual completion bookkeeping.
    sendResponse({ ok: true });
    return false;
  }
  // ZHL Task Bulk Download — silent save path.
  // The zillowdocs-bulk-download.js content script intercepted the
  // viewer's blob download, base64-encoded it, and sent it here.
  // We call chrome.downloads.download({ saveAs: false }) so the file
  // lands in the default Downloads folder without the "where do you
  // want to save?" dialog.
  if (msg && msg.type === "ZHL_BULK_DOWNLOAD_DATA") {
    const base64 = String(msg.base64 || "");
    const mimeType = String(msg.mimeType || "application/pdf");
    const filename = String(msg.filename || "document.pdf");
    if (!base64) { sendResponse({ ok: false, reason: "empty base64" }); return false; }
    const dataUrl = "data:" + mimeType + ";base64," + base64;
    chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, function (downloadId) {
      if (chrome.runtime.lastError) {
        console.warn("[ZHL Bulk DL] chrome.downloads.download failed:", chrome.runtime.lastError.message);
        sendResponse({ ok: false, reason: chrome.runtime.lastError.message });
      } else {
        console.log("[ZHL Bulk DL] silent download started, id:", downloadId, "file:", filename);
        sendResponse({ ok: true, downloadId: downloadId });
      }
    });
    return true; // async
  }
  if (msg && msg.type === "GMAIL_DRAG_START") {
    activeGmailDrag = {
      name: String(msg.name || "attachment"),
      mime: String(msg.mime || "application/octet-stream"),
      size: Number(msg.size || 0),
      b64: String(msg.b64 || ""),
      expires: Date.now() + GMAIL_DRAG_TTL_MS
    };
    console.log("[ZHL Pack] cached cross-tab drag:", activeGmailDrag.name, activeGmailDrag.size, "bytes");
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "GMAIL_DRAG_END") {
    // Small grace period so a drop that fires fractionally after dragend
    // still finds the file. The TTL also serves as a backstop.
    setTimeout(() => { activeGmailDrag = null; }, 500);
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "GET_GMAIL_DRAG_FILE") {
    if (!activeGmailDrag || activeGmailDrag.expires < Date.now()) {
      sendResponse({ ok: true, file: null });
      return false;
    }
    sendResponse({ ok: true, file: activeGmailDrag });
    return false;
  }
  return undefined;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "LOOKUP_PHONE") {
    const ten = normalizePhone(msg.phone);
    if (!ten || ten.length !== 10) {
      sendResponse({ ok: true, match: null });
      return false;
    }
    let hostname = null;
    if (sender && sender.url) {
      try { hostname = new URL(sender.url).hostname; } catch (_) {}
    }
    // Opportunistic: as soon as we see traffic from a Salesforce tab,
    // try to identify the user via Salesforce's chatter/users/me API.
    // The TTL inside the function makes this cheap.
    if (hostname && /salesforce|force\.com/.test(hostname)) {
      tryCaptureSalesforceIdentity();
    }
    lookupPhone(ten, { hostname }).then(
      (match) => sendResponse({ ok: true, match }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }
  if (msg && msg.type === "FETCH_ZILLOW_LAST_SOLD") {
    // FHA 90-Day Flip Rule helper. Takes an address, fetches the
    // Zillow listing search URL, and parses the seller's most recent
    // sale date out of the response so the analyzer card can auto-
    // fill its "Seller's purchase date" input. Best effort — Zillow
    // sometimes returns a captcha / login wall instead of the actual
    // page, in which case we return ok:false and the user falls
    // back to typing the date in manually.
    fetchZillowLastSold(String(msg.address || "")).then(
      (result) => sendResponse(result),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true; // async
  }
  if (msg && msg.type === "OPEN_TAB") {
    // Content scripts on some pages have window.open() blocked by
    // uBlock / privacy extensions when the target URL is a
    // chrome-extension:// page. The toast's "View what's new" button
    // routes through here so the tab opens via the SW's
    // chrome.tabs.create, which adblockers can't intercept.
    const url = String(msg.url || "");
    if (url) chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "GET_CONTACT_PHONE") {
    lookupContactPhone(msg.contactId).then(
      (result) => sendResponse(Object.assign({ ok: !result.error }, result)),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true;
  }
  if (msg && msg.type === "GET_SF_LO_PROFILE") {
    fetchSalesforceLoProfile().then(
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
