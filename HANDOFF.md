# ZHL Productivity Pack — Handoff

You're inheriting a mature Chrome extension I've been building with another Claude. Long context, lots of moving parts. Below is the full picture: what exists, why each piece exists, where the code lives, what's broken/half-built, what's next, and the meta-goal (getting paid by Zillow Home Loans for this work).

---

## Identity & meta-goal

I'm **Justin Case**, a Loan Officer at Zillow Home Loans. I've built and now maintain a private Chrome extension called **ZHL Productivity Pack** that bundles ~20 workflow tools across the LO daily-grind surfaces (Loan Officer Portal, Salesforce, Genesys, Gmail, Zillow Docs). It's live, distributed to **150+ LOs at ZHL**, and reviewed/published on the Chrome Web Store as an unlisted extension.

**The endgame I'm aiming at:** make a data-backed case to Zillow leadership (eventually the CEO) that this pack saves enough collective LO time to justify Zillow either (a) buying it / hiring me to maintain it as a real product, (b) paying me a recurring stipend, or (c) at minimum giving me formal recognition + comp. We have telemetry plumbed end-to-end and a "time saved" tracker that backs this up with real numbers. Everything we build going forward should sharpen that pitch.

**Repo:** `case2392/zhlextensions` on GitHub. Working branch: `claude/combine-extensions-setup-CQK1L`. Hundreds of commits.

---

## Architecture in 30 seconds

- **Chrome MV3 extension** — service worker `background.js` + ~25 content scripts in `extension/modules/`.
- **Manifest** declares per-tool content_scripts with `matches` + `js` arrays scoped to operator.zillowhomeloans.com (LOP), \*.lightning.force.com / \*.salesforce.com (Salesforce), mail.google.com (Gmail), zillowdocs.com (document viewer), \*.mypurecloud.com (Genesys).
- **Setup page** (`setup.html`) — feature toggles per tool, Loan Officer Profile fields (name/NMLS/phone/email) used to stamp PDFs.
- **Walkthrough page** (`walkthrough.html`) — illustrated "what's new" cards. Auto-opens on install.
- **Update toast** (`modules/update-toast.js`) — one-time bottom-right toast on LOP/Gmail/Salesforce per release. Reads headlines from `modules/update-toast.js`'s `CHANGELOG_HEADLINES`. Full per-version highlights live in `changelog.js`. **Bump both on every release.**
- **Telemetry backend** is a Google Apps Script web app deployed against a Google Sheet (`apps-script/Code.gs`). Extension POSTs event batches; Apps Script appends rows to an `Events` sheet + maintains `Users` and `Daily` rollup sheets. `doGet` serves an admin dashboard at the same `/exec` URL.

---

## What ships in the pack today

**LOP tools** (the meat):
- `lop-file-copy.js` — Stage-and-paste the whole Full Application across loans. Includes auto-run pricing, credit reissue, liability edits, co-borrower consent handling. ~3000 lines. Saves 15 min/use.
- `pricing-exception-workflow.js` — Multi-step modal that walks the PE submission checklist (locked vs unlocked branches, > 2.5 pt justification questions) and builds an HTML email to the RM. Auto-pastes into Gmail via a companion content script. Pulls borrower names, ZG#, LO name, comp pricing including Box A from LOP's Closing Costs popup.
- `task-bulk-download.js` + `zillowdocs-bulk-download.js` + `zillowdocs-download-interceptor.js` — Bulk-download every borrower doc from the Completed tasks tab. Uses File System Access API to save silently to a picked folder (bypasses Chrome's PromptForDownloadLocation enterprise policy).
- `va-calc.js` — VA residual income calculator + Calc Student Loans helper.
- `buydown-calc.js` — 2-1 buydown payment breakdown + branded PDF.
- `loan-comparison-pdf.js` — Side-by-side scenario comparison PDF.
- `net-proceeds-calc.js` — Net-proceeds-from-sale calc; auto-detects Mortgage/HELOC liens from Liabilities table as pre-filled checkboxes.
- `dti-max-estimator.js` — Inline pills next to ratios showing max purchase price at 43/50% DTI.
- `fha-flip-rule.js`, `fha-manual-eligible.js`, `fha-npr-warning.js` — FHA compliance analyzers.
- `task-bulk-delete.js`, `loan-amount.js`, `scenario-sort.js`, `address-copy.js` — Small quality-of-life tools.

**Salesforce tools:**
- `caller-id.js` + `gmail-caller-id.js` — Matches incoming phone numbers to Lead/Contact/Loan records via REST.
- `sms-add-participants.js` — Adds Buyer's Agent / Co-Borrower / Loan Officer buttons to the SMS Quick-Add panel on Lead pages.
- `contact-sms.js` — One-click SMS button on Contact pages.
- `auto-call-details-tab.js`, `auto-messaging-tab.js` — Auto-switch to the relevant tab on call/text.
- `sms-mark-all-read.js`, `salesforce-promotions.js` — Various tweaks.

**Gmail tools:**
- `gmail-tweaks.js` — Reply-all by default, Delete-key deletes open thread, inline reply pinned to top.
- `gmail-drag-attachments.js` — Cross-tab attachment drag (Gmail → LOP) using base64 handoff through the SW.
- `gmail-pe-paste.js` — Companion to the PE Workflow; auto-pastes the formatted HTML email into Gmail's compose body when it opens.

---

## The "time saved" tracker (most important piece for the pitch)

Built across v1.42.0 → v1.43.4. Architecture:

**Shared helper:** `extension/modules/zhl-time-saved.js` — exposes `window.__zhlTimeSaved.record(tool, minutes)` and `.recordAndForget(...)` and `.renderHtml(just, user, global)`. Loaded as the FIRST `js` entry in every relevant content_script's manifest array so it lands in the same isolated world as the tool.

**Background handler** (background.js): `ZHL_TIME_SAVED_RECORD` message bumps `chrome.storage.local._zhl_time_saved_user_total_min`, fires a `time_saved` telemetry event, returns `{ userTotal, globalTotal }` for the popup to render.

**Apps Script side** (`apps-script/Code.gs`):
- `doGet` branches on `?action=totalTimeSaved` (global) and `?action=userTimeSaved&email=X` (per-user)
- `LEGACY_TIME_PER_EVENT_` registry back-credits pre-tracker events: `caller_id_match`, `va_calc_open`, `va_calc_apply`, `buydown_calc_open`, `buydown_pdf_generate_branded`, `sms_add_*`, `task_bulk_delete`, `contact_sms_click`, `scenario_sort_*`, `auto_*_switched`, `exclude_telecom_selfreport`. 14 entries total. Values vary 0.25–8 min per event.
- Caches in ScriptProperties for 15 min (`timeSavedTotal_v3`, `userTimeSaved_v3_<email>`).

**Seeding:** First time the extension runs after v1.42.0+, `maybeSeedUserTimeSavedFromHistory()` fetches the user's historical total from the Apps Script and sets local total to `Math.max(existing, server)`. Gated by `_zhl_time_saved_seeded_v2` flag — one-shot.

**Render points:** Toast yellow-cream card appears in completion modals: Copy LOP file (15 min), PE Workflow (12 min), Bulk download docs (1 × file count), Net Proceeds (3 min), VA residual (8 min), Calc Student Loans (4 min), FHA Flip Rule (4 min), FHA Manual Eligible (3 min). Other tools use `recordAndForget` (no popup but still credit the totals): 2-1 Buydown, Loan Comparison PDF, Task Bulk Delete, Loan Amount, DTI Max Estimator.

**Important cache invalidation pattern:** If the legacy registry minute values change, bump the Apps Script ScriptProperties key suffix AND the extension's `TIME_SAVED_GLOBAL_KEY` / `TIME_SAVED_SEED_KEY` suffixes in lockstep. Otherwise existing users see stale undercounted values for up to an hour.

**Current state:** Apps Script is deployed. Users see personal total + global total in popups. Numbers will rise as more telemetry rolls in over the next week.

---

## Pitch-ready things still TO BUILD

Discussed but not built. Pick highest-leverage:

1. **In-extension Stats dashboard** — a real page (could extend `setup.html`) showing big headline minutes saved, $ equivalent at $75/hr, top 5 tools used, this-week-vs-last-week trend, and a "Generate exec memo" button that outputs a markdown one-pager with adoption + ROI + risk-mitigation counts. **~3 hour build, highest pitch leverage.**
2. **Public-facing leadership dashboard** — extend the existing Apps Script `doGet` dashboard with a `?view=executive` mode: org-wide adoption, total $ saved, top tools, risk-mitigation event counts (`fha_*`, `pe_workflow_*`), engagement (active days per user). Shareable URL.
3. **Testimonial / NPS widget** — small 👍/👎 + comment on completion modals, written to telemetry sheet. Builds a quote bank for the pitch deck.
4. **Lock-expiration / TRID radar** — sidebar showing every loan with days until rate lock expires, days until disclosure window closes, last-borrower-contact aging. Doubles as a compliance risk-mitigation story for the pitch.
5. **Self-employed / K-1 / rental income calculator** — same shape as VA residual calc but pulls from tax returns in the eFolder. High single-task time save → adoption driver.
6. **Pitch packet generator** — markdown/PDF exporter that pulls live numbers + top testimonials. Run it the day before the exec meeting.

I drafted a longer feature backlog in a previous turn (lock radar / pipeline next-action queue / email template library / Salesforce activity auto-logger / AUS findings diff / document checklist / MI quote comparator / quick scratchpad calc / "Open in Encompass" deep link). Smaller wins, lower priority than the pitch-related work above.

---

## Conventions you'll inherit

- **Every release: bump `manifest.json` version, add an entry to the top of `changelog.js`'s `window.ZHL_CHANGELOG` array, add a one-line headline to the `CHANGELOG_HEADLINES` object in `update-toast.js`, then commit and push.** Skip a step and users either don't see the toast or see a wrong version.
- **Every new card in `setup.html` and `walkthrough.html` MUST include an image** — either a `<div class="module-screenshot"><img src="images/<tool>.svg" alt="…"></div>` block for setup, or a `<div class="shot"><img …>` / inline animated `<svg class="demo-svg">` for walkthrough. Style match: `viewBox="0 0 360 220"`, off-white `#f4f6f9` background, line-art with brand colors (`#0b5cab` blue, `#15803d` green, `#b91c1c` red, `#b45309` accent gold). Existing files in `extension/images/` are the template. Do not ship a card without art — Justin caught ~10 missing in one sweep.
- **Commit messages are detailed.** Read recent ones in the branch to match the style. They double as docs.
- **Push immediately** after each commit. Co-workers pull and run.
- **`apps-script/Code.gs` is hand-deployed** by me — when I change it, I have to remind the user to redeploy via Manage deployments → ✏️ → Version: New version → Deploy. Apps Script URL is hardcoded in `extension/background.js` as `TELEMETRY_ENDPOINT`. Cache keys are bumped when registry values change so users invalidate stale caches.
- **`extension/modules/zhl-time-saved.js` must stay first in every content_script `js` array** that uses it — otherwise `window.__zhlTimeSaved` isn't defined when the tool tries to use it. Isolated worlds.
- **Salesforce DOM is treacherous.** Use the existing `deepQuerySelector` / `deepQuerySelectorAll` / `deepWalkText` helpers in `sms-add-participants.js` — they pierce shadow DOM. Standard `document.querySelector` misses everything inside LWCs.
- **LOP DOM also re-renders constantly** (React). Use MutationObserver-driven scan loops with idempotent injectors. See `task-bulk-download.js` for the canonical pattern: `function ensureButton()` that early-exits if its button is already in the DOM.
- **All chrome.runtime.sendMessage call sites** check for `chrome.runtime.lastError` and the "Extension context invalidated" string, since reloading the extension while a tab is open kills the messaging channel. See `fetchContactPhone` in `sms-add-participants.js`.
- **Enterprise environment** — users are on managed Chrome with `PromptForDownloadLocation` enforced, which is why `chrome.downloads.download({ saveAs: false })` doesn't actually skip the Save As dialog on its own. We worked around this with the File System Access API in `task-bulk-download.js` and `onDeterminingFilename` + `conflictAction: 'uniquify'` in `background.js` for legacy paths.

---

## Stuff that's flaky or you should know about

- **Caller ID is the highest-volume telemetry event by 10×+.** It fires once per phone number displayed across Salesforce + Genesys + Gmail. If you change the `caller_id_match` minutes value in the registry, expect global totals to shift wildly.
- **The Add Loan Officer button** auto-hides when the LO opens their own file (matches `currentSfUserId` from chatter/users/me against the Lead Owner's User id, case-insensitive 15-char compare). v1.43.4 has the robust Lead-Owner detector with 4 fallback strategies — earlier versions silently missed Lead Owner because it renders via `force-owner-id-related-list-single`, not `records-record-layout-item` like custom lookups.
- **Net Proceeds Calc** auto-detects Mortgage/HELOC liens from the Liabilities table as pre-filled checkboxes. Strips the `<button>E</button>` / `<button>P</button>` badges via DOM cloning before reading textContent. Unchecked lien IDs persist in localStorage so re-opens preserve.
- **PE Workflow auto-paste into Gmail** went through three iterations before working: (1) clipboard + Ctrl+V (users didn't realize they had to paste), (2) auto-paste gated on `view=cm` URL (Gmail redirects strip that param), (3) v1.40.3 finally drops the URL gate and uses 4-strategy compose-body detection. See `modules/gmail-pe-paste.js`.
- **Chrome Web Store submission** required justifications for `downloads` and `declarativeNetRequestWithHostAccess` permissions. Wording is in the chat history from a recent turn — paste from there if resubmitting.

---

## When you talk to me

- **Don't be a yes-man.** When I propose something dumb or there's a cleaner path, say so.
- **No fluff in commit messages or code comments.** Tell me WHY, not WHAT. Future-me reading the comment needs to know the hidden gotcha or the bug that drove the workaround, not what the code obviously does.
- **Ship small.** I'd rather have 5 small commits that each work than one big commit that needs to be re-rolled.
- **When DOM is uncertain, ask for it.** I'll paste from DevTools. Don't guess at Salesforce/LOP/Gmail markup — guesses break silently.
- **When the user-visible behavior changes, the changelog headline should be in plain LO English** ("Net Proceeds calc now auto-fills Box A from the Closing Costs popup") not engineer-speak ("Wired chrome.downloads.onDeterminingFilename"). Engineer-speak goes in the commit body where it belongs.
- **The pitch is the north star.** Every feature should either save measurable time (→ telemetry → pitch number) or mitigate a measurable risk (→ event count → pitch story). Bias toward those.

Welcome aboard. Open the repo, skim recent commits, and let me know what to work on next.
