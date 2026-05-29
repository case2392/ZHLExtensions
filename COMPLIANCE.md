# ZHL Productivity Pack — Compliance & Data-Flow Overview

**Prepared for:** ZG Data & IT Compliance
**Extension:** ZHL Productivity Pack (Chrome extension, Manifest V3)
**Version covered:** 1.50.9
**Owner / author:** Justin Case
**Repository:** https://github.com/case2392/zhlextensions
**Last updated:** 2026-05-29

---

## 1. Purpose

The ZHL Productivity Pack is an internal Chrome extension that adds workflow
helpers for Zillow Home Loans loan officers. It runs only on a fixed set of
work sites the LO is already logged into (the LO Portal, Salesforce, Gmail,
ZillowDocs, and the Genesys dialer) and automates repetitive steps such as
calculators, copying borrower data between screens, bulk document handling,
caller ID, and SMS shortcuts.

It is a **client-side productivity tool**. It does not create a new system of
record, and (with the single exception of usage telemetry described in §5) it
does not send data to any server outside the sites the LO already uses.

---

## 2. Distribution & install model

- Manifest V3 Chrome extension.
- Intended distribution: Chrome Web Store with restricted visibility (private /
  trusted-tester) or ZG Admin-console managed force-install. (Final
  distribution path is being decided with IT — see §10.)
- No auto-update server of its own; updates flow through the Chrome Web Store.

---

## 3. Architecture

| Component | Role |
|---|---|
| `background.js` (service worker) | Central logic: telemetry queue/flush, caller-ID lookups, cross-tab relays, download-header rule toggling. No UI. |
| Content scripts (`modules/*.js`) | Injected into specific work sites to add buttons/calculators and read/write the page the LO is viewing. |
| `setup.html` / `setup.js` | Options page: per-feature on/off toggles, stored locally. |
| `inject-open-shadow.js` | Forces Salesforce's shadow DOM open so our scripts can read the page the LO sees. Runs only on Salesforce. |

Each feature module is individually toggleable from the Setup page (stored in
`chrome.storage.local`), **except** usage telemetry, which is always on (§5).

---

## 4. Permissions requested (and why)

### Chrome API permissions
| Permission | Why it's needed |
|---|---|
| `storage` | Save feature settings and short-lived staged data locally on the LO's machine. |
| `cookies` | Read the existing Salesforce session cookie (`sid`) **only**, to call Salesforce's own API as the logged-in LO (caller ID, LO identity/NMLS). No cookies are written or exported. |
| `scripting` | Inject feature scripts on supported sites. |
| `downloads` | Save documents the LO chooses to download (bulk task/loan-doc downloads). |
| `declarativeNetRequestWithHostAccess` | Temporarily strip the `Content-Disposition` response header **during a user-initiated bulk download** so files save instead of opening in a tab. (See note in §8.) |

### Host permissions (sites the extension runs on)
Salesforce (`*.lightning.force.com`, `*.salesforce.com`, related domains),
Gmail (`mail.google.com`), the LO Portal
(`operator.zillowhomeloans.com`), ZillowDocs (`*.zillowdocs.com`), the Genesys
dialer (`*.mypurecloud.*`, `*.pure.cloud`), Slack (`*.slack.com`), Google Apps
Script (`script.google.com` — telemetry endpoint), and Zillow.com (public
property lookups).

> **Note:** the manifest currently also requests `<all_urls>`. This is broader
> than the functional list above and is flagged for tightening before
> submission (see §10).

---

## 5. Usage telemetry — the only outbound data to a non-work server

**What is sent, where:**

- **Endpoint:** a Google Apps Script Web App bound to the **zillowgroup.com**
  Google Workspace
  (`https://script.google.com/a/macros/zillowgroup.com/s/…/exec`). The backing
  Google Sheet is ZG-owned.
- **Transport:** HTTPS POST, JSON body.
- **Fields sent:**
  - LO **work email** and display name (to attribute usage per LO).
  - A random anonymous install id (UUID).
  - Extension version.
  - A list of **events**: the tool/feature name used, a "minutes saved"
    estimate, a timestamp, and the **hostname only** of the page (e.g.
    `operator.zillowhomeloans.com`).

**What is explicitly NOT sent:**

- No borrower PII of any kind (no names, SSN, DOB, phone, email, address,
  loan numbers).
- **Full URLs are stripped to hostname** before queuing, specifically so
  Salesforce record IDs and query strings never leave the browser
  (`background.js`, `TRACK` handler).

**Purpose:** lets the admin see which features are used / time saved, to decide
what to maintain. Telemetry is currently **always-on and not user-disableable**
— called out in §10 as something Compliance may want a notice/consent for.

---

## 6. Borrower PII handling (local only)

The most sensitive data the extension touches is borrower information on the
"Stage from this file / Paste from staged" feature (`modules/lop-file-copy.js`),
which copies a borrower/co-borrower record between LO Portal screens so the LO
doesn't re-key it.

- **Fields touched:** first/last name, DOB, SSN, phone, email, addresses, and
  related application fields — read from the page the LO is already viewing.
- **Where it's stored:** `chrome.storage.local` **on the LO's own machine
  only**. It is never transmitted anywhere — not to telemetry, not to any
  server.
- **Retention:** auto-expires after **24 hours** (`STAGE_TTL_MS`); expired
  entries are purged on the next read.
- **Scope:** local to that browser profile; not synced across devices
  (`storage.local`, not `storage.sync`).

This is functionally equivalent to a clipboard with a 24-hour timer, scoped to
one machine.

---

## 7. Salesforce / property data reads (stay within work systems)

These calls use the LO's **existing** Salesforce session and never send data to
a third party:

| Call | Reads | Used for |
|---|---|---|
| Chatter `users/me` | Logged-in LO's email, name, phone, user id | Identify the LO, populate caller-ID / SMS author |
| User object `describe` + SOQL | LO's NMLS number | Stamp NMLS on LO-generated docs |
| SOQL contact/lead query by phone | Caller name match | Inbound caller ID |
| Zillow.com home search (public, **credentials omitted**) | Public property page | Net-proceeds / property lookups |

All of the above flow **from the work system to the LO's browser** for display;
none are forwarded onward.

---

## 8. Network-request modification

The extension uses a `declarativeNetRequest` dynamic rule **only** to remove the
`Content-Disposition` response header, and **only while a user-initiated bulk
download is running**; the rule is removed when the run finishes. It does not
block, redirect, or inspect traffic. The rule's URL filter is currently `*`
(broad) because download files can be served from arbitrary CDNs — flagged in
§10 for review.

---

## 9. Data inventory summary

| Data | Stored where | Transmitted? | Retention |
|---|---|---|---|
| Feature on/off settings | `chrome.storage.local` | No | Until changed |
| Staged borrower record (incl. SSN/DOB) | `chrome.storage.local` | **No** | 24 hours |
| LO work email + name | `chrome.storage.local` + telemetry | Yes → ZG Apps Script | Telemetry queue cleared on send |
| Tool usage / minutes / hostname | telemetry | Yes → ZG Apps Script | — |
| Salesforce session cookie (`sid`) | Read in-memory only | No (used to auth SF API as the LO) | Not persisted by us |
| Borrower PII | — | **Never to any server** | — |

**Third parties:** none. The only external endpoint is the ZG-owned Apps
Script. (Google, as the browser/Workspace vendor, and Salesforce are existing
ZG-approved systems.)

---

## 10. Items to button up before final review

These are the things I'd recommend tightening so Compliance has nothing
outstanding to flag:

1. **Scope `<all_urls>` down.** The manifest requests `<all_urls>` host
   permission; the extension only functionally needs the specific domains in
   §4. Recommend removing `<all_urls>` and relying on the explicit list. (Also
   review the `*` URL filter on the bulk-download header rule.)
2. **Document/justify SSN & DOB staging.** It's local-only and 24h-TTL'd, but
   Compliance will want this explicitly acknowledged. Options if they object:
   exclude SSN/DOB from staging, or encrypt the staged blob at rest.
3. **Telemetry notice/consent.** Telemetry is always-on. It carries no borrower
   PII, but it does carry the LO's work email + usage. Recommend a short
   in-extension notice (and confirming who can access the backing Google Sheet).
4. **Privacy / data-use disclosure.** No formal privacy statement exists yet;
   Compliance will likely want one (this document can be the basis).
5. **Confirm the Apps Script / Sheet ownership & access list** is a ZG-managed
   account with restricted access.
6. **Distribution boundary.** Decide between Chrome Web Store private/
   trusted-tester vs. ZG Admin-console managed install; the latter gives IT a
   real enforcement boundary (only ZG-managed profiles get the extension).

---

## 11. Feature list (for context)

Calculators & analyzers: VA residual income + entitlement calculator, 2-1
buydown, DTI max estimator, net proceeds, FHA flip-rule check, FHA/VA manual
underwrite analyzer, FHA NPR / VA non-spouse co-borrower warnings, pricing
exception workflow.

Document & data helpers: stage/paste borrower file, copy co-borrower to
Salesforce, bulk task download, ZillowDocs bulk download, loan comparison &
2%-grant & buyer-worksheet PDFs, credit-report reader, address copy.

Communication & UI: caller ID (LO Portal + Gmail + Salesforce + dialer), SMS
quick-add participants / mark-all-read, contact SMS, scenario sort, Gmail
tweaks, auto tab switching, update toast.

Each is individually toggleable on the Setup page.
