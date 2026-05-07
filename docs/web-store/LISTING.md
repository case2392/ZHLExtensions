# Chrome Web Store listing — copy/paste fields

All fields ready to paste into the Web Store Developer Dashboard form. Each section's heading matches the form field name.

---

## Short description (132 chars max)

> Productivity helpers for Zillow Home Loans staff: VA Calc, 2-1 Buydown, Caller ID, SMS shortcuts, and Gmail tweaks.

(116 chars)

---

## Detailed description

Paste this into the "Detailed description" textarea. Reads top-down so your team can scan it before installing.

```
ZHL Productivity Pack is a private internal tool for Zillow Home Loans loan officers. It bundles eleven small workflow tweaks across Salesforce, the Loan Officer Portal, Genesys, and Gmail — each one toggleable from a single setup page.

WHAT'S INSIDE

• VA Calculator — VA residual income + total deductions calculator, pre-populated from the Salesforce loan record. One click writes results back to the loan and saves.

• 2-1 Buydown Calculator — Year 1 / Year 2 / Year 3+ payment breakdown with seller credit factored in, on every scenario card in Pricing & Scenarios. Skips FHA / VA programs automatically.

• Caller ID — In Genesys (active call card, voicemail rows, call history), shows a blue "Match" badge with the Salesforce Lead/Contact/Loan name when a phone number matches one of yours.

• SMS Quick-Add Participants — In a Salesforce SMS thread, one-click "Add Buyer's Agent" or "Add Co-Borrower" that pulls the right phone number from Salesforce and adds them to the thread.

• Open SMS button — On Contact pages, an "Open SMS" link next to phone fields jumps straight to a new SMS thread with that number.

• Auto-switch to Call Details — Lead pages auto-switch to the Call Details tab so you don't have to click out of Active Listening every time.

• Auto-switch to Messaging — Contact pages auto-switch to the Messaging tab so you land on the SMS thread instead of Activity.

• Scenario Sort & drag — Sort scenarios by rate ascending or descending, drag-and-drop to reorder, Reset to original, Select all checkboxes — all from a small toolbar above the cards.

• Loan Amount editor — Inline editable Loan amount field that recalculates Down Payment / DP% live as you type.

• Gmail tweaks — Reply All button on every message header, Delete-key deletes the open thread, inline reply moves to the top of the thread, Salesforce "Show Promotions" auto-disables, draggable compose window.

• Show Promotions disable — Auto-flips the Salesforce account "Show Promotions" toggle off when you visit Lead pages.

EVERY TOOL IS OPTIONAL — turn any one off from the setup page (Chrome toolbar icon → click the puzzle piece, pin, click ZHL Pack icon).

PRIVACY

Anonymous usage telemetry is enabled by default to help the developer (Justin Case) decide what to invest in. Identification is the user's signed-in Google account email; events are tool/action names plus a timestamp. No email contents, SMS contents, Salesforce record contents, or phone numbers are transmitted. Toggle off any time on the setup page. Full privacy policy: see homepage URL.

For Zillow Group / Zillow Home Loans staff only. Restricted to the zillowgroup.com Workspace domain.
```

---

## Single-purpose statement

(Required by Chrome Web Store. Goes in the "Single purpose" field.)

```
Workflow productivity helpers for Zillow Home Loans loan officers using Salesforce, the Loan Officer Portal, Genesys, and Gmail.
```

---

## Permission justifications

The Web Store form lists each permission/host_permission and asks why. Paste these into the corresponding fields:

### `storage`

```
Stores per-feature toggle state (which of the eleven modules are enabled) and a small queue of usage telemetry events waiting to be sent. No browsing data; no third-party data.
```

### `cookies`

```
Reads the Salesforce session cookie ("sid") on the user's already-authenticated Salesforce my-domain (e.g. zillowhomeloans.my.salesforce.com) so the extension can call the Salesforce REST API on the user's behalf — to look up a Lead/Contact/Loan name from an incoming caller's phone number, or to fetch a Co-Borrower / Buyer's Agent phone number when adding them to an SMS thread. The cookie is never transmitted off-device.
```

### `scripting`

```
Used by content scripts to inject small UI elements (calculator buttons, "Open SMS" links, the scenario sort toolbar) into Salesforce Lightning, the Loan Officer Portal, Genesys Cloud, and Gmail.
```

### Host permissions: Gmail (`https://mail.google.com/*`)

```
The Gmail Tweaks module adds a Reply-All button to message headers, makes the Delete key delete the open thread, moves the inline reply to the top of the thread for visibility, and makes the floating compose window draggable. Identity capture also reads the signed-in account email from the Google account button to attribute usage telemetry to the correct user.
```

### Host permissions: Salesforce (`*.lightning.force.com/*`, `*.salesforce.com/*`, `*.force.com/*`, `*.salesforce-setup.com/*`, `*.salesforce-experience.com/*`, `*.visualforce.com/*`, `*.vf.force.com/*`, `*.visual.force.com/*`, `*.cloudforce.com/*`)

```
Required by the Salesforce-side modules: Open SMS button on Contact pages, SMS Quick-Add Participants in SMS threads, Auto-switch Lead pages to Call Details, Auto-switch Contact pages to Messaging, Caller ID name badges, and the Salesforce "Show Promotions" auto-disable. Salesforce hosts vary across orgs and Lightning versions, hence the multiple domains.
```

### Host permissions: Genesys (`apps.mypurecloud.com/*`, `*.mypurecloud.{com,ie,de,com.au,jp}/*`, `*.pure.cloud/*`)

```
Caller ID module annotates phone numbers shown in the Genesys Cloud softphone (active call card, voicemail rows, call history) with the matched Salesforce record's name. Genesys regional domains differ by data center.
```

### Host permissions: Loan Officer Portal (`https://operator.zillowhomeloans.com/*`)

```
The Loan Amount, VA Calculator, 2-1 Buydown Calculator, and Scenario Sort modules all run on the loan-officer-portal pages. They read on-page numbers, render small calculator panels in the page, and write results back to the loan record.
```

### Host permissions: Apps Script (`https://script.google.com/*`, `https://script.googleusercontent.com/*`)

```
Endpoint for anonymous usage telemetry. The extension POSTs feature/action events (no content, no PII beyond the user's signed-in Google email) to a Google Apps Script web app owned by the developer. Telemetry can be disabled by the user from the setup page.
```

---

## Privacy practices disclosures

The form has a checklist. Tick:

- ✅ Personally identifiable information — *user's name and email, captured from the Google Account button when the user has Gmail open. Used to attribute anonymous usage telemetry to a specific person within the developer's organization.*
- ❌ Health information
- ❌ Financial and payment information — *the calculators read on-page loan amounts, but those values stay on-device; nothing is transmitted.*
- ❌ Authentication information
- ❌ Personal communications — *the extension reads Salesforce session cookies but never reads the contents of any email, SMS, or Salesforce record.*
- ❌ Location
- ❌ Web history
- ✅ User activity — *names of features used and timestamps, sent to the developer's Google Sheet for usage analysis. Disclosed in privacy policy.*
- ❌ Website content

For each ✅, the form asks a short justification — paste the italicized text above.

Then certify:
- ✅ I do not sell or transfer user data to third parties for purposes unrelated to the item's single purpose.
- ✅ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Category

`Productivity`

## Language

`English (United States)`

## Privacy policy URL

The URL of your hosted privacy policy. See `docs/web-store/PRIVACY_POLICY.md` for the doc to host. Easiest path: paste it into a public Google Doc, copy the share link, and use that.
