# Privacy Policy — ZHL Productivity Pack

Effective date: November 2025
Last updated: November 2025

This Privacy Policy describes the data the **ZHL Productivity Pack** Chrome extension ("the extension") collects, how it uses that data, and how you can control it.

The extension is a private, internal tool for staff at Zillow Home Loans (a Zillow Group business). It is distributed via a private (domain-restricted) Chrome Web Store listing and is not available to the general public.

The extension is maintained by Justin Case (the "developer"). All data described below is sent only to the developer; no third-party recipients.

## What the extension does on your device, locally

- Reads the contents of the Salesforce, Loan Officer Portal, Genesys Cloud, and Gmail pages you load in order to inject small UI elements (buttons, calculators, sort toolbars, name badges, draggable compose windows) and to read on-page values like loan amounts and phone numbers.
- Reads your Salesforce session cookie ("sid") on your own Salesforce my-domain so it can call the Salesforce REST API on your behalf — for example, to look up a Lead/Contact/Loan name when an incoming call number matches one of yours, or to fetch a Co-Borrower's phone when adding them to an SMS thread. The cookie value is sent only to your own Salesforce instance, not to the developer or any third party.
- Stores your per-feature on/off preferences in your browser's local storage.

None of the above leaves your device.

## What the extension transmits to the developer

The extension sends a small "telemetry" event to the developer's Google Apps Script web app (which writes to a private Google Sheet owned by the developer) when you take certain actions inside the extension. These events are used to understand which tools are getting used so the developer can decide what to invest in.

Each event contains:

- **Your Google Account email and display name** — read once from the Google Account button on Gmail when you have a Gmail tab open. Used to attribute usage to a specific person within the organization. Persists across reinstalls of the extension because the next Gmail visit re-captures the same email.
- **The name of the feature/action** you used (e.g. `va_calc_open`, `scenario_sort_rate`, `caller_id_match`).
- **A timestamp** for when the action occurred.
- **The extension version** in use.
- **The hostname of the page** where the action happened (e.g. `mail.google.com`, not the full URL with record IDs).
- **Small numeric or category props** describing the action (e.g. how many cards were sorted, ascending/descending). Never any free-text content from emails, SMS messages, or Salesforce records.

The extension does **not** transmit:

- Email contents, drafts, attachments, recipients, or subject lines.
- SMS message bodies.
- Salesforce record contents (loan amounts, names of leads/contacts, notes, etc.).
- Phone numbers, even though the Caller ID feature looks them up.
- Browsing history outside of the extension's modules.
- Form input you type, including the calculator inputs.
- Authentication tokens, passwords, or session cookies.

## How telemetry data is stored

- Events are queued briefly in the extension's local storage and POSTed in batches to a Google Apps Script web app every 30 seconds.
- The web app appends each event as a row in a Google Sheet owned by the developer.
- Access to the Sheet is restricted to the developer's Google Workspace account.
- The data is not shared with any third party, sold, used for advertising, or used for credit/lending decisions.
- Retention: indefinite at the developer's discretion. The developer may purge old data periodically.

## How to opt out

Open the extension's setup page (Chrome toolbar → puzzle-piece icon → ZHL Productivity Pack). Scroll to **"Anonymous usage telemetry"** and toggle it off. When disabled, the extension queues no events and sends nothing.

You can also uninstall the extension at any time from `chrome://extensions`.

## Permissions explained

| Permission | Why it's needed |
|---|---|
| `storage` | Saves your per-feature on/off toggles and queues telemetry events for batched send. |
| `cookies` | Reads your already-authenticated Salesforce session cookie so the extension can call Salesforce's REST API on your behalf. The cookie value is never sent off-device. |
| `scripting` | Lets the extension inject small UI elements into Salesforce, the Loan Officer Portal, Genesys, and Gmail. |
| Host permissions for `mail.google.com`, `*.salesforce.com`, `*.force.com`, `apps.mypurecloud.com`, `operator.zillowhomeloans.com`, `script.google.com` | Each module runs on the corresponding site. The `script.google.com` permission is for sending telemetry events to the developer's Google Apps Script web app. |

## Children

The extension is intended for use by employees of Zillow Group / Zillow Home Loans only. It is not directed to children under 13.

## Changes

The developer may update this policy. Material changes will be reflected by an updated "Last updated" date. Continued use after a change constitutes acceptance.

## Contact

Questions or requests (including data deletion requests): contact Justin Case.

---

*This policy is published as a Google Doc at: [paste your Google Doc URL here once you've published it].*
