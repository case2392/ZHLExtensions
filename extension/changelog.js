// Version highlights surfaced in the walkthrough page's "What's new"
// section and in the bottom-right update toast on LOP/Gmail/Salesforce
// tabs. Newest at the top. Each entry:
//
//   version:    semver string, must match manifest.json on the release
//                that introduced these changes.
//   headline:   one-line summary used in the toast.
//   highlights: short bullet strings rendered in the walkthrough
//                "What's new" section. Plain English, no jargon —
//                this is what users read, not what engineers debug.
//   sections:   optional array of walkthrough section ids to deep-link
//                from the toast's "View what's new" button.

window.ZHL_CHANGELOG = [
  {
    version: "1.47.1",
    headline: "Loan Comparison PDF: FHA scenarios now show Net closing cost net of the financed UFMIP — the $8k+ MIP no longer reads like cash the borrower brings to closing. Total closing costs unchanged for TRID compliance.",
    highlights: [
      "FHA Upfront Mortgage Insurance Premium (UFMIP) is always rolled into the FHA loan amount — the borrower never writes a check for it at closing; it gets paid back over the life of the loan as part of the financed principal. But the Detailed cost summary popup includes it in 'Fees you cannot shop for' under 'Mortgage insurance premium', which then rolls into Total closing costs and made the 'Net closing cost to borrower' line on the PDF read $8,444 too high. The Cash (to)/from at closing line already netted it out (matches LOP's own calc), so the two numbers didn't even reconcile.",
      "Now: when a scenario's title contains 'FHA', the PDF finds the 'Mortgage insurance premium' line item in the scraped closing detail (also accepts 'Upfront mortgage insurance' and 'UFMIP' synonyms) and subtracts that amount from the Net closing cost to borrower row. A small italic note appears under the row explaining the carve-out so the borrower understands the discrepancy if they cross-check the itemized table.",
      "Total closing costs in the itemized closing-costs table is UNCHANGED — line for line it still matches the LE / disclosure docs. Only the 'Net closing cost to borrower' figure in the Cash at closing block (and the fallback summary table when the popup wasn't scrapable) reflects the financed UFMIP.",
      "Conventional loans untouched: the carve-out is gated on the scenario title containing 'FHA', so conventional cards with PMI line items don't trigger the subtraction."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.47.0",
    headline: "Scenarios page: cards now top-align automatically — no more staircased rows when the ASSIGNED-TO-LOAN card lives in a different container than the others.",
    highlights: [
      "Previously, the scenario cards on the Pricing & Scenarios page rendered staircased: the assigned card with its ASSIGNED-TO-LOAN banner sat in its own sub-container, the unassigned cards sat in another, and LOP's default flex layout left them at different Y positions across the row. Within scenario-sort.js there was already an alignAssignedWrapper() helper, but it only ran AFTER you clicked one of the Sort buttons, and it bottom-aligned the card bodies (so the data rows lined up across the bottom) — which the user explicitly preferred-against in favor of plain top-alignment.",
      "Now: on every tick of the existing MutationObserver/setInterval loop, ensureTopAlignedRow() runs. (1) If the assigned wrapper's parent differs from the majority parent, it's moved into the majority parent (inserted at the start, preserving 'assigned first' order). (2) The alignment helper now sets the parent's align-items: flex-start AND each wrapper to flex-direction:column / justify-content:flex-start / align-self:flex-start / margin-top:0 — top-align across the board.",
      "Sig-based skip: ensureTopAlignedRow remembers the last applied layout signature and short-circuits when nothing changed, so the getComputedStyle calls in alignAssignedWrapper aren't repeated on every minor DOM mutation. Original styles are saved on each wrapper in data-zhl-wrapper-layout-saved so the existing Reset button still restores LOP's defaults.",
      "Works on Pricing & Scenarios for both the simple case (all cards in one parent — just align) and the staircased case shown in the screenshot (assigned card in a different parent — move + align)."
    ],
    sections: ["scenario-sort"]
  },
  {
    version: "1.46.2",
    headline: "SMS Quick-Add buttons now hide themselves once that participant is already in the To: row — works on both Lead and Opportunity pages.",
    highlights: [
      "Previously the Add Borrower / Add Co-Borrower / Add Buyer's Agent / Add Loan Officer buttons rendered permanently once injected. After you clicked one and the participant landed in the To: row, the corresponding pill button still showed — visual clutter and easy to misclick a second time.",
      "Now: on every scan, the module reads the current To: row pills (matches .slds-pill / lightning-pill and any element with 'pill' or 'participant' in its class name; dedupes nested wrappers) and computes which buttons should be visible. A pill is considered a match when EITHER (a) the pill text contains the candidate's name substring-wise (handles SF's name truncation and the role-suffix in our own button label), OR (b) the pill's digits-only form equals the candidate's known phone (handles the case where SF renders the pill as raw digits — '17048609132' — instead of resolving to a name).",
      "Belt + suspenders: we also remember every successful addParticipant() call in a per-session role:id Set. So during the brief window where Salesforce flips the pill from digits to a resolved name (or vice versa), the right button stays hidden through the transition. Click handler triggers an immediate re-scan after a successful add so the button disappears in <100ms instead of waiting for the next MutationObserver fire.",
      "Re-render guard: each wrapper carries a data-zhl-sig signature listing which roles are currently shown. Scans that produce the same signature leave the wrapper alone (no DOM churn), scans where pill state changed remove + rebuild. Avoids flicker on every Salesforce mutation."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.46.1",
    headline: "SMS Quick-Add buttons on Opportunity / Loan pages BUG FIX — Contact Roles links were missed by my v1.46.0 selector so no buttons rendered.",
    highlights: [
      "v1.46.0 shipped Quick-Add support for Opportunity / Loan pages but the buttons never actually appeared, because the Contact Roles related list renders links as /lightning/r/003a700000vrG10AAE/view (with the 003-prefixed Contact id directly in the path) instead of /lightning/r/Contact/<id>/view like every other Salesforce surface uses. My selector was a[href*=\"/lightning/r/Contact/\"], which matched zero anchors, which meant getOpportunityContactRoles() returned an empty {borrower, coBorrower, buyersAgent} and scan() bailed before injection.",
      "Fix: selector now matches on the data-recordid attribute (a[data-recordid^=\"003\"]) AND the bare-path form (a[href*=\"/lightning/r/003\"]) in addition to the legacy /Contact/ form. Id parsing also accepts the bare-path form. Applied to both the role extractor and the hover-fallback link resolver so the v1.45.1 hover preview keeps working on Opportunity too."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.46.0",
    headline: "SMS Quick-Add buttons now also appear on Opportunity / Loan pages — with a new Add Borrower button alongside Co-Borrower, Buyer's Agent, and Loan Owner.",
    highlights: [
      "Previously, the SMS Quick-Add buttons (Add Co-Borrower / Add Buyer's Agent / Add Loan Officer) only injected on Lead record pages. On Opportunity / Loan pages — where the SMS Messaging panel ALSO lives and where you spend most of your time once a loan converts — the buttons were missing entirely and you had to look up phones manually for every participant.",
      "Module now detects both /lightning/r/Lead/ and /lightning/r/Opportunity/ URLs. On Opportunity pages, role data comes from the Contact Roles related list (not record-layout-item fields, which is why Lead-side selectors didn't work). The extractor walks every leaf text span looking for 'Borrower' / 'Co-Borrower' / 'Buyer's Agent' role values, then climbs up to 12 levels to find the matching Contact link in the same row container.",
      "NEW Add Borrower button: only shown on Opportunity pages (Leads ARE the borrower — the SF SMS panel already finds them by phone from the Lead record). Uses the same fetchContactPhone -> hover-fallback flow introduced in v1.45.1, so if the API can't reach Salesforce or the phone is empty, you still get the hover preview on the Borrower's name link.",
      "Loan Owner detection: existing getLeadOwnerInfo() extended to also match the 'Loan Owner' label (Opportunity uses 'Loan Owner', Leads use 'Lead Owner' — both map to the User who owns the record). Self-check still applies — the LO opening their own file doesn't see an Add LO button.",
      "Hover fallback's role-to-link resolver now knows the Opportunity Contact Roles layout, so when the lookup fails for any of the three contact roles on Opportunity, the hover preview opens on the right link inside the Contact Roles related list (not the wrong record-layout-item).",
      "Telemetry: new sms_add_borrower event with ok flag, plus all existing sms_add_* events now fire on both Lead and Opportunity pages."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.45.1",
    headline: "SMS Add buttons now fall back to Salesforce's hover preview when the API phone lookup fails — phone shows up on-screen so you can still add the participant manually.",
    highlights: [
      "Previously, clicking Add Co-Borrower / Add Buyer's Agent / Add Loan Officer on a tab that had been open for a few days (long enough for ZHL Pack to auto-update underneath it) showed a misleading 'Co-borrower added and no reload detected' alert. The wording read as if the file had just had a co-borrower added by someone; really it meant the extension's chrome.runtime connection was dead and the SF API lookup couldn't fire.",
      "Now: when ANY of the three Add buttons can't fetch a phone — for any reason (stale tab, empty phone fields on the user record, lookup error) — the extension dispatches synthetic pointer + mouse events on the matching name link in the Lead's record layout (Co-Borrower, Buyer's Agent, or Lead Owner row). Salesforce's own hover preview pops open showing the contact's Mobile + Phone fields right where you were looking. The LO copies the number, types it into the SMS search, done.",
      "Belt + suspenders: shows a small toast in the top-right with the actual reason ('This tab is stale — reload to re-enable auto-fetch' vs 'No phone returned from Salesforce') AND an explicit 'Open contact page ↗' button that links to /lightning/r/Contact/<id>/view in a new tab in case synthetic hover events get rejected. Toast auto-dismisses in 14s.",
      "Lead Owner (User) lookup path handles the same fallback — falls back to /lightning/r/User/<id>/view if the hover doesn't take. Telemetry: sms_hover_fallback_shown with role."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.45.0",
    headline: "NEW first-run setup wizard + update toast now shows EVERY change since your last installed version.",
    highlights: [
      "First-run wizard: when lo_name is empty (either on a fresh install or an existing user who skipped setup), the extension now opens setup.html with a prominent blue banner: '👋 Welcome — let's get you set up in 30 seconds'. One click on '⚡ Auto-fill from Salesforce' runs the existing GET_SF_LO_PROFILE handler against the Salesforce session, pulls Name / Email / Phone / NMLS, writes them to chrome.storage.local, pulses a blue outline around the LO Profile card, and auto-dismisses the banner. Stored under _zhl_firstrun_dismissed so it only fires once per Chrome profile. Background's onInstalled now opens setup.html?firstrun=1 on install OR update when lo_name is missing (guarded by _zhl_firstrun_shown so it doesn't re-pop on every update).",
      "Why: the PE Workflow's '(your name)' placeholder bug was caused by users never setting lo_name. The setup page has had the LO Profile card forever, but nobody scrolls there. Putting it in their face the first time they install / update halves the problem; the second half is the inline 'Your name' field added on the email step in v1.44.2.",
      "Update toast diff view: the toast now reads the user's last-seen version and renders a 'See N earlier changes since vX.Y.Z' expander listing every intermediate version's headline (newest first, scrollable). If someone was on v1.41.0 and jumps to v1.45.0, they see four lines instead of one. Click 'View what's new' and the walkthrough page receives a ?since=v1.41.0 query param: instead of showing just the latest headline, it renders a big '🆙 You just updated from v1.41.0 → v1.45.0 · 5 releases' banner and pre-expands ALL diff entries with their full bullet highlights. Even-older pre-update releases collapse into a separate 'Even older' details block. Adds telemetry: update_toast_diff_expanded.",
      "Telemetry: firstrun_shown, firstrun_pull_clicked (source=auto|click), firstrun_pull_success (fields, missingNmls), firstrun_manual_clicked, firstrun_dismissed, update_toast_diff_expanded. Lets us measure setup-completion rate and how often users actually engage with the diff vs. just dismissing."
    ],
    sections: []
  },
  {
    version: "1.44.2",
    headline: "PE Workflow email polish: LO name editable inline, drop the redundant 'Loan: <uuid>' line, and Gmail auto-paste is now more reliable.",
    highlights: [
      "Removed the 'Loan: <uuid>' line from the PE email body (both plain text and HTML). The ZG# already lives in the subject and the LOP link still appears in the header — the raw UUID was redundant and made the email look engineered. Locked and unlocked paths both updated.",
      "Email step now has an inline 'Your name' field. If your name is blank (no setup-page LO Profile and no Salesforce identity captured), the field is highlighted red with '← fill in'. Typing rebuilds the subject/body live; blur (or clicking Open/Copy) auto-persists to chrome.storage.local under lo_name so you never have to type it again.",
      "Gmail auto-paste reliability: don't clear the pending-paste storage entry until we've verified the formatted comparison table is actually present in the compose body. Adds a 6-attempt verify-and-re-paste loop (over ~3s) for the case where Gmail's URL-driven &body= fill lands AFTER our paste and overwrites it. Poll window extended 10s → 20s, TTL 30s → 60s, in-tab dedupe so the URL-change watcher doesn't double-fire.",
      "Time-saved toast '0m' bug: when the background returns a suspiciously-zero userTotal after a positive record, the helper now falls back to reading chrome.storage directly (stored value + just-saved minutes) so the toast never lies."
    ],
    sections: ["pricing-exception-workflow", "time-saved-tracker"]
  },
  {
    version: "1.44.1",
    headline: "Time-saved toast now appears instantly instead of waiting up to 15s for the global total to fetch.",
    highlights: [
      "User reported the '🕒 You just saved Xm' box took ~15s to appear inside the FHA Manual UW analyzer. Cause: the background was awaiting a fresh fetch of the global total from Apps Script before responding to the tool's record() call — and Apps Script can take 10–20s on a cold start. So the toast Promise was held open for the full roundtrip even though the just-saved minutes + the user's local total were already known.",
      "Fix: background's global-total cache now returns IMMEDIATELY with whatever's already in chrome.storage (even if stale or null), and fires a refresh in the background for next time. Toast appears in ~100ms. The 'Across all users' line may briefly be missing on the very first click after a long idle, but the next click has the warm cache.",
      "Belt: service worker also warms the global-total cache 20s after start, so first-toast-of-the-session usually has the full three lines."
    ],
    sections: ["time-saved-tracker"]
  },
  {
    version: "1.44.0",
    headline: "Setup page: every module card now has an illustration — added 11 new SVGs for cards that were text-only before.",
    highlights: [
      "Setup page was shipping with ~10 module cards that had no screenshot/illustration above their feature list — they read as walls of bullet text and were easy to skim past. Filled the gaps with 11 new SVGs in extension/images/ matching the existing line-art style (off-white background, brand-color line art, viewBox 360×220): sms-mark-all-read, lop-file-copy, loan-comparison-pdf, dti-max-estimator, fha-flip-rule, fha-manual-eligible, address-copy, task-bulk-download, net-proceeds-calc, pricing-exception-workflow, telemetry.",
      "Going forward, every new card in setup.html and walkthrough.html ships with an image. Added to the project conventions in HANDOFF.md so future Claude sessions inherit the rule."
    ],
    sections: []
  },
  {
    version: "1.43.4",
    headline: "SMS Add Loan Officer button now detects Lead Owner across Salesforce's various Owner-field renderings (it was silently missing on Lead pages).",
    highlights: [
      "Lead Owner is a STANDARD Owner field, not a custom lookup — Salesforce renders it via force-owner-id-related-list-single instead of the records-record-layout-item used for Buyer's Agent and Co-Borrower. My old selector only matched the records-record-layout-item form, so the LO row was silently missed and no button rendered.",
      "Rewritten getLeadOwnerInfo() with four fallback strategies in priority order: (1) records-record-layout-item[field-label=Lead Owner], (2) any element with field-label=Lead Owner or Owner, (3) text-node walk looking for the literal 'Lead Owner' label + walk up to the row container, (4) last-resort scan for any anchor whose href contains a 005-prefix Salesforce User id.",
      "Href parsing widened to handle /lightning/r/User/<id>, /lightning/r/<005id>, and any anchor with 005-prefixed id in the path.",
      "Added one-shot diagnostic console.log('[SMS Add Participants] LO detect: …') so if it still misses on some loan, you can see exactly which strategy failed and share the message with me to refine."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.43.3",
    headline: "Time-saved totals were undercounting — expanded the back-credit registry by 12 more event types (caller_id_match, contact_sms_click, va_calc_apply, etc.) and forced cache refresh.",
    highlights: [
      "v1.43.1's registry only credited 6 event names. The real volume drivers were missing: caller_id_match (the highest-volume event — fires once per phone displayed in Salesforce/Genesys), contact_sms_click, va_calc_apply (separate from va_calc_open — applying the calc back into LOP), buydown_calc_open, scenario_sort_rate/select_all, exclude_telecom_selfreport, auto_call_details_switched, auto_messaging_switched. Apps Script's LEGACY_TIME_PER_EVENT_ now covers all 14.",
      "Cache invalidation: Apps Script's ScriptProperties cache keys bumped from _v2 → _v3 so the next call recomputes from scratch instead of serving the old undercount. Extension's chrome.storage cache key bumped from _v1 → _v2 — existing users will refetch global total on next service-worker tick, and re-seed their local user total against the (now-correct) server number.",
      "User action required (same as last time): redeploy your Apps Script (Manage deployments → ✏️ → Version: New version → Deploy). Until then, the new registry doesn't take effect — even though your extension is invalidating caches, the server is still computing with the old 6-event registry."
    ],
    sections: ["time-saved-tracker"]
  },
  {
    version: "1.43.2",
    headline: "Time-saved toast now shows up on VA Residual Income, Student Loans, FHA Flip Rule, and FHA Manual Eligible panels (was silently tracked but not displayed).",
    highlights: [
      "Four panels were using recordAndForget() — the time-saved was being credited to the user's running total and telemetry, but no '🕒 You just saved X' section rendered in the panel. Swapped each to record() + render the standard toast section inside the panel after its main content. Affected: VA Residual Income Calc (8 min), Calc Student Loans summary (4 min), FHA Flip Rule analyzer (4 min), FHA Manual Eligible analyzer (3 min)."
    ],
    sections: ["time-saved-tracker"]
  },
  {
    version: "1.43.1",
    headline: "Time-saved tracker now back-credits your historical usage — every va_calc, buydown PDF, bulk-delete, SMS quick-add etc. you've ever fired counts retroactively.",
    highlights: [
      "Apps Script now sums BOTH the explicit 'time_saved' events (v1.42.0+) AND a registry of legacy event names that predate the tracker: va_calc_open → 8 min, buydown_pdf_generate_branded → 5 min, sms_add_* (ok=true) → 0.5 min each, task_bulk_delete → 1 min per successfully deleted task. Powers both the global total and a new per-user endpoint.",
      "New ?action=userTimeSaved&email=X endpoint returns the user's lifetime total across all their historical events. Both endpoints are cached 15 min in ScriptProperties so re-deploys don't hammer the Sheet.",
      "Extension auto-seeds your local total from the server on first run after this update (gated by a one-shot flag in chrome.storage). Takes Math.max(local, server) so a partial-flush doesn't undercount. Subsequent runs early-exit on the seed flag and just accumulate normally.",
      "User action required to get historical credit: redeploy your Apps Script with the updated Code.gs from this commit (Manage deployments → ✏️ → Version: New version → Deploy). Until then the new endpoint 404s and the seeder no-ops — you'll just start counting from v1.42.0 forward, no harm done."
    ],
    sections: ["time-saved-tracker"]
  },
  {
    version: "1.43.0",
    headline: "SMS Add Loan Officer button now hides itself when YOU are the LO on the file. Plus time-saved tracker now covers all 13 tools.",
    highlights: [
      "Add Loan Officer button now disappears on files you own. The background worker now captures your Salesforce User id from chatter/users/me (alongside email + name), and the SMS module compares it to the Lead Owner — if they match (case-insensitive on the first 15 chars), the button is suppressed. Showing it would just add the LO to a thread they're already running, which would be confusing.",
      "Time-saved tracker wired into the remaining 7 tools — DTI Max Estimator (5 min, once per page load when pricing was run), FHA Flip Rule (4 min, on open), FHA Manual Eligible (3 min, on open), Loan Comparison PDF (5 min, on generate), Task Bulk Delete (1 min × successfully deleted), Loan Amount Calc (2 min, on apply), Calc Student Loans (4 min, when at least one row updates). All 13 tracked tools now feed your running total and the across-all-users total."
    ],
    sections: ["sms-add-participants", "time-saved-tracker"]
  },
  {
    version: "1.42.0",
    headline: "NEW Time-saved tracker — every completion popup now shows '🕒 You just saved X minutes' + your running total + the total across all users.",
    highlights: [
      "Shared helper modules/zhl-time-saved.js exposes window.__zhlTimeSaved.record(tool, minutes) — each tool calls it from its completion modal. Shows three numbers: minutes saved by this invocation, your running total (chrome.storage.local), and the global total across all users (fetched from the telemetry Apps Script, cached 1 hour).",
      "Wired into six tools in this release: Copy LOP file (15 min/use), Pricing Exception Workflow (12 min), Bulk-download docs (1 min × file count), 2-1 Buydown PDF (5 min), VA Residual Income Calc (8 min), Net Proceeds Calc (3 min). More tools coming in follow-up versions.",
      "Apps Script side: doGet now branches on ?action=totalTimeSaved and returns the global running total in JSON. The extension polls hourly and caches; ScriptProperties caches the sum for 15 minutes so the Sheet isn't re-scanned on every hit. To enable the 'across all users' line, paste the new Code.gs from this commit into your deployed Apps Script and re-deploy (Manage deployments → pencil → Version: New version)."
    ],
    sections: ["time-saved-tracker"]
  },
  {
    version: "1.41.0",
    headline: "NEW Add Loan Officer button in the SMS Quick-Add row on Salesforce Leads — one click texts the Lead Owner the same way as Add Buyer's Agent / Add Co-Borrower.",
    highlights: [
      "Adds a third button (next to Add Buyer's Agent / Add Co-Borrower) labeled Add Loan Officer (<name>) — reads the Lead Owner field on the Lead, looks up that Salesforce User's Phone / MobilePhone via the same REST plumbing Caller ID uses, and adds them to the SMS thread. Useful when an LOA/assistant is texting on behalf of the LO and needs them looped into the conversation.",
      "Lead Owner can also point to a Queue (id starting with 00G); in that case the SOQL returns no rows and the button shows a clear error explaining why. Same fallback messaging if the LO's User record has no Phone or MobilePhone populated."
    ],
    sections: ["sms-add-participants"]
  },
  {
    version: "1.40.4",
    headline: "Pricing Exception Workflow: ZHL and Competitor cards now line up row-for-row.",
    highlights: [
      "The Competitor card had an extra 'Competitor lender name' field at the top that shifted its Interest rate / Box A / Credits rows one row down vs the ZHL card, so the labels and inputs didn't sit on the same horizontal lines. Moved the Competitor lender name field OUT of the card and into its own row above both cards — now both cards start with 'Interest rate %' and align cleanly."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.40.3",
    headline: "Pricing Exception Workflow: 'Open in Gmail' auto-paste now actually fires — was being gated on a URL param Gmail strips.",
    highlights: [
      "v1.40.1's auto-paste content script only ran on URLs containing view=cm, but when the operator opens https://mail.google.com/mail/?view=cm&fs=1&… Gmail redirects to https://mail.google.com/mail/u/0/?fs=1&… and drops view=cm — so the gate failed and the script never ran. Result: LO saw the plain-text body filled from the URL's &body= param instead of the formatted version. Removed the URL gate entirely; 30 s TTL + single-use storage clear keep the paste safe.",
      "Broadened the compose-body selector with three fallback strategies: aria-label match → Gmail-specific [g_editable=true] / .editable[contenteditable] → largest contenteditable above an area threshold (filters out recipient/subject inputs). Last strategy survives future markup changes.",
      "Switched paste to document.execCommand('insertHTML') first (so Gmail's editor sanitizer runs), with innerHTML as fallback. Selection is set to span the existing content so the inserted HTML REPLACES what Gmail loaded from &body=, not appends to it.",
      "Added console logging at every step for debug visibility — open mail.google.com's devtools console and you'll see '[ZHL PE Auto-paste] pending paste found … pasted formatted body …'."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.40.2",
    headline: "PE Workflow: rate-lock status now in the subject ([LOCKED] / [NOT LOCKED]) and as a colored banner at the top of the email body.",
    highlights: [
      "Subject prefixed with [LOCKED] or [NOT LOCKED] — so the RM can sort/triage their inbox at a glance. Full subject example: '[NOT LOCKED] PE Request for Mark Malone (ZG001260248246) vs Rocket — >2.5 pts'.",
      "Plain-text body opens with 'Rate is currently LOCKED.' or 'Rate is NOT LOCKED.' as the first sentence after the greeting.",
      "HTML body shows a prominent colored banner at the top — green for locked, red for not locked — so it's impossible to miss when the RM reads the email in Gmail."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.40.1",
    headline: "Pricing Exception Workflow: Open in Gmail now AUTO-PASTES the formatted body — no Ctrl+V needed.",
    highlights: [
      "v1.40.0's flow needed the LO to manually Ctrl+V in Gmail's body field after the new tab opened. New companion content script (modules/gmail-pe-paste.js) runs on every Gmail tab, watches for the operator side to stash the formatted HTML in chrome.storage.local under zhlPePendingPaste, finds the compose body (div[contenteditable=true][aria-label*='message body']) and sets its innerHTML to the formatted version — automatically, the moment the compose dialog renders.",
      "Three-layer fallback so this always works: (1) chrome.storage stash + auto-paste (primary, fully automatic), (2) HTML on the clipboard via ClipboardItem (manual Ctrl+V still works if storage handoff fails), (3) plain text in the Gmail URL's &body= param (visible in the compose body even if both above fail).",
      "Single-use storage entry with a 30 s TTL — cleared before paste so a second Gmail tab can't accidentally pick up the same payload."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.40.0",
    headline: "Pricing Exception Workflow: new 'Reason / description' step on the unlocked path — included in every email so the RM can approve without coming back.",
    highlights: [
      "After the PE amount calc step, the unlocked path now drops into a new 'Reason / description for this PE' step before the < 2.5 pts question. Single textarea, free-form, required by the manager on every unlocked PE submission (not just > 2.5 pts requests).",
      "The text feeds into the email — under 2.5 pts shows a standalone 'Reason for PE request' section in both the plain-text body and the formatted HTML version. > 2.5 pts: the answer pre-fills the big-25 form's 'Main reason for PE' question (which already appears in the justification section of the email), so no double-entry.",
      "Locked path is unchanged — pre-submission checklist + size + (optional > 2.5) justifications, no separate reason step."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.39.5",
    headline: "Pricing Exception Workflow BUG FIX: the Closing Costs popup auto-fill now actually closes the popup again.",
    highlights: [
      "v1.39.3 introduced the auto-fill that opens LOP's 'Detailed cost summary' popup to scrape Box A + lender credits, but the close-button detector only matched aria-label='close' / 'dismiss' and literal × / X chars — none of which describe LOP's actual button, which is a visible text button labeled 'Close' at the bottom-right. So the popup opened, got scraped, and was left on screen for the user to dismiss.",
      "Fixed by widening the matcher to also accept (a) any aria-label containing 'close' / 'dismiss', (b) a <VisuallyHidden>Close</VisuallyHidden> child span (LOP's accessibility pattern for icon-only X buttons), and (c) a plain visible text button whose label is 'Close'.",
      "Also switched the click from bare .click() to the full mousedown→mouseup→click MouseEvent sequence, since some React handlers ignore programmatic .click(). Same pattern we use everywhere else for synthetic LOP clicks.",
      "Replaced the CSS-injection hide with an inline-style hide on the topmost fixed-positioned ancestor of the dialog. CSS injection was getting beaten by LOP's stacking; inline visibility:hidden + opacity:0 with !important is more reliable. Original style attribute is restored on cleanup."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.39.4",
    headline: "Net Proceeds calc: button now sits to the LEFT of LOP's 'Add asset or credit' button (was on the far right).",
    highlights: [
      "Swap the injection order in the Assets section header so the layout reads 'Assets ▸ 🏠 Net proceeds calc ▸ Add asset or credit' instead of pushing our button all the way to the right. Insert via insertBefore the data-cy='add-entity-button' element, with appendChild as the fallback."
    ],
    sections: ["net-proceeds-calc"]
  },
  {
    version: "1.39.3",
    headline: "Pricing Exception Workflow: Open in Gmail now produces the formatted email, RM email is sticky, and the comp pricing form auto-fills almost everything from LOP — including Box A from the Closing Costs popup.",
    highlights: [
      "Open in Gmail looked like ass compared to Copy body because Gmail's compose URL only accepts plain text in &body=. Fix: clicking Open in Gmail now ALSO copies the formatted HTML + plain text to the clipboard via the ClipboardItem API, then opens Gmail with To + Subject filled in and an empty body. One Ctrl+V in the Gmail body field drops in the same formatted table / headers / clickable LOP link as Copy body. Button relabeled 'Open in Gmail + copy body' so it's clear what's happening.",
      "RM email auto-saves now. As soon as you type your manager's email and leave the field (or click any of the action buttons), it's persisted in chrome.storage — no more 'Save RM email for next time' button. Future PE workflows on any loan default to the saved address until you change it.",
      "Comp pricing form now pre-fills Purchase price, Loan amount, ZHL Interest rate, Loan type, and FRM/ARM from LOP's Loan Details right-rail card. Loan type + ARM/FRM are derived from the Product name string (e.g. 'Conf Home Poss 30 Yr Fixed' → Conventional + FRM, 'FHA 30 Yr ARM 5/6' → FHA + ARM).",
      "ZHL Box A + Lender credits now auto-fill too. The form silently clicks the 'Total closing costs' link in the Loan Details card, scrapes the 'Lender costs Total' (Box A = discount points + origination fee) and 'Lender credit' from the Detailed cost summary popup, then closes it. The popup is hidden via injected CSS during the scrape so no visible flash. Inputs show 'Auto-filling from LOP…' as the placeholder while waiting.",
      "New 'Competitor lender name' field on the Competitor card (e.g. Rocket, Better.com, local CU). When set, it shows up in the email subject ('PE Request for X (ZG#) vs LenderXYZ') and as the column header in the formatted comparison table instead of the generic 'Competitor' label."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.39.2",
    headline: "Pricing Exception Workflow: friendlier header, formatted Copy body (HTML for Gmail), auto-fills the ZG# and Loan Officer name from the page.",
    highlights: [
      "Email header changed from 'PE request — <uuid>' to 'PE request for <Borrower> & <Co-borrower> by <Loan Officer>'. The loan id and LOP link drop below the heading as supporting info, not as the headline.",
      "ZG# is auto-detected from the LOP borrower header (matches the '#ZG…' span on the loan page). If found, it pre-fills the email's Loan: line and the editable ZG# field; if not, the LOP UUID is used until you type one in.",
      "Loan Officer name auto-loaded from chrome.storage — uses the Loan Officer Profile name from setup.html first, then falls back to the Salesforce-captured identity. Edit in the Email step if it's wrong.",
      "Copy body now puts BOTH a formatted HTML version (with a real pricing-comparison table, bold section headers, colored ZHL/Competitor columns, and the LOP link as a clickable hyperlink) AND a plain-text fallback on the clipboard via the ClipboardItem API. Paste into Gmail's body and it renders as a formatted email; paste into a plain-text editor (or Slack, etc.) and it falls back to plain text. The old monospace-alignment-in-Gmail-proportional-font ugliness is gone."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.39.1",
    headline: "Pricing Exception Workflow: 'Open in mail' is now 'Open in Gmail' — opens the email directly in Gmail instead of handing off to the OS default mail client (Outlook).",
    highlights: [
      "v1.39.0's mailto: link respected the OS default mail handler, which is Outlook for most ZHL users. Switched to Gmail's compose URL (https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...) so clicking the button opens a new Gmail tab with the email pre-filled. To/Subject/Body all carry over."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.39.0",
    headline: "NEW Pricing Exception Workflow — guided multi-step modal that walks the PE submission checklist and builds the RM email for you.",
    highlights: [
      "Adds a '⚖ Pricing Exception Workflow' button to the LOP loan toolbar (near Copy LOP file / Stage / Paste-from-staged). Click to start the guided flow.",
      "Branches on 'Is this loan locked?'. Locked path checks: pricing imported → Comp PE fields completed in ENC → no lock-difference alert → comp LE uploaded to eFolder. Unlocked path checks: updated scenario assigned → comp LE on tasks → enter ZHL + competitor pricing in a side-by-side form (rate, Box A, lender credits).",
      "Auto-computes PE $ and points on the unlocked path: PE $ = (ZHL Box A − ZHL credits) − (Comp Box A − Comp credits); PE points = PE $ / loan amount × 100.",
      "When the PE is ≥ 2.5 points, the modal surfaces the three justification questions your manager requires (main reason; expectations set with borrower re: further PEs / rate extensions being at their cost; relationship with agent/partner) and includes them in the email.",
      "Final step shows an editable Subject + Body with Open in mail (mailto:) and Copy buttons. RM email is remembered between sessions via Save RM email for next time. Attachments (Comp LE etc.) still attach manually after the email opens — mailto: can't carry files."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.38.1",
    headline: "Net Proceeds calc: auto-detects Mortgage / HELOC liens from LOP's Liabilities table and lists them as pre-filled checkboxes.",
    highlights: [
      "When you open the 🏠 Net proceeds calc, it now scans the Liabilities table for rows with account type Mortgage / Second Mortgage / HELOC and renders each one as a checkbox inside the Mortgage/Loans/HELOC Payoffs section — pre-filled with the payee, last 4 of the account, and the unpaid balance. All detected liens default to checked; uncheck any that shouldn't apply to the sale (e.g. a lien on a different property).",
      "Total payoffs = sum of checked balances + the new Additional input (for anything not in the table). Uncheck state persists in localStorage keyed by account number, so re-opening the modal restores what you had.",
      "Copy summary now itemizes each checked lien (Mortgage — JPMCB — …4586 — -$211,087.00) so the breakdown you paste matches what's on screen."
    ],
    sections: ["net-proceeds-calc"]
  },
  {
    version: "1.38.0",
    headline: "NEW Net Proceeds from Sale calculator — one click on the Assets section opens a modal that estimates seller proceeds after fees and payoffs.",
    highlights: [
      "Adds a '🏠 Net proceeds calc' button next to 'Add asset or credit' in the Assets section on LOP's Financial Information page. Opens a modal with six line items: Sale Price, Listing Agent Fee (default 3%), Buyer's Agent Fee (default 3%), Closing Costs (auto-fills at 1% of sale price but editable), Mortgage/Loans/HELOC Payoffs, and Other. Live-computes net proceeds as you type, with a per-line dollar breakdown.",
      "Closing costs auto-sync to 1% of sale price as long as you haven't typed a manual value. Once you edit it the auto-sync stops so you don't lose your override.",
      "Copy summary button writes a plain-text breakdown to clipboard so you can paste it into notes / Slack / borrower email. Last values persist in localStorage for this tab so you don't lose them if the modal closes."
    ],
    sections: ["net-proceeds-calc"]
  },
  {
    version: "1.37.10",
    headline: "Bulk-download: ~10x faster — skipped the 20s viewer-load wait per file, and now runs 4 downloads in parallel.",
    highlights: [
      "v1.37.9 worked but was painfully slow — ~3 minutes for 10 docs. Two reasons: (1) each doc waited 20s for the viewer to pre-fetch the PDF before giving up and clicking the Download button. The Zillow Docs editor never pre-fetches — it loads on demand — so that 20s was pure dead time. Now we go straight to the click. (2) Downloads were sequential.",
      "v1.37.10 runs the 'Save to folder' path with 4 concurrent workers. Each tab gets its own arm message via chrome.tabs.sendMessage addressed by tabId (replacing the single chrome.storage key that would race under parallelism). Expected: ~20 PDFs in ~30-60 seconds instead of 7+ minutes.",
      "'Save to Downloads' (chrome.downloads) path stays sequential since parallel chrome.downloads calls would just stack Save As dialogs."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.9",
    headline: "Bulk-download: NEW 'Save to folder' path that bypasses Chrome's Save As dialog entirely — works even with the PromptForDownloadLocation policy.",
    highlights: [
      "When you click ⬇ Download all docs, you now get TWO options: (a) 'Save to a folder' which uses the File System Access API — you pick a folder ONCE and every PDF saves silently into it, completely sidestepping Chrome's download manager (and therefore the PromptForDownloadLocation enterprise policy that was forcing Save As prompts); (b) 'Save to Downloads' which is the old chrome.downloads path for users without the policy.",
      "How it works under the hood: the zillowdocs background tab fetches each PDF in its own tab context (so cookies and signed-URL tokens just work), encodes the bytes as base64, and ships them back to the LOP tab. The LOP tab decodes and writes via FileSystemDirectoryHandle.getFileHandle(...).createWritable() — that's a regular web API, not Chrome's download manager, so PromptForDownloadLocation doesn't apply. Filename conflicts get a '(1)', '(2)' suffix automatically.",
      "Requires Chrome 86+ (File System Access API). If the API isn't available, the modal hides that option."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.8",
    headline: "Bulk-download: clearer warning about Chrome's 'Ask where to save' setting — the Save As dialog can't be bypassed by extensions when this is enabled.",
    highlights: [
      "v1.37.7 diagnostics proved that suggest({ conflictAction: 'uniquify' }) DOES apply our filename and uniquify behavior — but DOES NOT bypass the Save As dialog when the user's Chrome has 'Ask where to save each file before downloading' enabled. Worse: if it's enforced by enterprise policy (PromptForDownloadLocation), no extension can override it.",
      "The bulk-download confirmation prompt now includes a clear note explaining what to do: open chrome://settings/downloads and disable 'Ask where to save each file before downloading'. If the toggle is greyed out, contact IT — the policy is locked at the org level and no Chrome extension API can bypass it."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.7",
    headline: "Bulk-download Save As dialog — actually fixed this time via onDeterminingFilename + conflictAction override.",
    highlights: [
      "v1.37.6 diagnostics revealed the real problem: when Chrome's 'Ask where to save each file before downloading' preference is enabled, chrome.downloads.download({ saveAs: false }) DOES NOT bypass it — saveAs:false only respects the preference, doesn't override. And the DNR Content-Disposition strip rule we added in v1.37.5 doesn't apply to extension-initiated download requests (it only applies to page fetches), so Chrome's download manager still sees Content-Disposition: attachment on our request and triggers the dialog.",
      "The fix: track every bulk-download id we initiate, and in the downloads.onDeterminingFilename listener call suggest({ filename, conflictAction: 'uniquify' }) for those ids. Passing conflictAction explicitly there bypasses the user's prompt-each-time preference (this is documented Chrome behavior — conflictAction in suggest() takes precedence). Side benefit: our filename parameter is now respected even when the server returns a different Content-Disposition filename."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.6",
    headline: "Bulk-download diagnostics + DNR rule fixes — open the service worker console (chrome://extensions → Inspect views: service worker) and re-run to see what's happening.",
    highlights: [
      "Three changes that should help: (a) DNR rule now matches ALL URLs (not just zillowdocs.com) in case the PDF is served from a CDN like S3 / CloudFront. (b) The rule is now properly awaited before opening the background tab — fixes a possible timing race where the viewer's fetch completed before the rule was active. (c) Comprehensive diagnostic logging in the service worker console: every download Chrome detects (URL, MIME, referrer, filename), every onDeterminingFilename event, the active DNR rules at OPEN time, and per-tab content-script logs forwarded from the bulk-download tab.",
      "If Save As still appears: open chrome://extensions, find ZHL Productivity Pack, click 'Inspect views: service worker', re-run the bulk download, and copy/paste the full console output. The [ZHL Bulk DL][diag] lines will tell us exactly what URL the viewer is downloading from and whether the DNR rule matched."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.5",
    headline: "Bulk-download BUG FIX: Save As dialog truly gone — Content-Disposition header is stripped server-side during the run so Chrome never treats responses as attachments.",
    highlights: [
      "v1.37.4 was capturing the PDF URL successfully (logs showed 'fetch-url-after-click') but the Save As dialog still appeared. Root cause: the Zillow Docs viewer triggers its download via an iframe/location mechanism — NOT an anchor click — so all our prototype.click / dispatchEvent / document-click intercepts were bypassed. The response from that request carries Content-Disposition: attachment, which makes Chrome open Save As regardless of any in-page interception.",
      "New approach: use chrome.declarativeNetRequest to dynamically strip the Content-Disposition header from any zillowdocs.com response during an active bulk-download run. With no attachment header, Chrome treats the response as inline (no Save As). Meanwhile, our own chrome.downloads.download(saveAs:false) call downloads the same URL silently — the file still lands in the Downloads folder with the correct PDF name. Rule auto-disables 30 s after the last download to avoid affecting normal Zillow Docs use afterward."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.4",
    headline: "Bulk-download BUG FIX: Save As dialog is now actually eliminated — the Download button is never clicked.",
    highlights: [
      "Previous attempts to intercept the Download button click kept failing because the Zillow Docs viewer uses a download mechanism (iframe, navigation, or service worker) that bypasses anchor-click hooks. New strategy: don't click the Download button at all. The MAIN-world fetch/XHR interceptor captures the PDF's HTTPS URL the moment the viewer fetches it to display in its viewer pane. The content script sends that URL to background.js, which downloads it directly via chrome.downloads (saveAs: false, conflictAction: 'uniquify'). No button click, no native download, no Save As dialog.",
      "Fixed a timing race: the MAIN-world script runs at document_start and the PDF fetch can complete before the content script runs at document_idle. The interceptor now also stashes the URL on <html data-zhl-pdf-url=...> so the content script picks it up regardless of which started listening first.",
      "Falls back to clicking the Download button only if no PDF URL is captured within 20 s (rare — only for viewers with a different architecture)."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.3",
    headline: "Bulk-download BUG FIX: files now save with correct names — no more UUID.tmp; Save As dialog fully eliminated.",
    highlights: [
      "BUG 1 (UUID.tmp files): chrome.downloads with a data URL doesn't apply the specified filename on Windows — files land as random UUID.tmp. Fixed by adding a fetch interceptor in MAIN world that captures the original HTTPS PDF URL before the viewer creates a blob. chrome.downloads now downloads the HTTPS URL directly, which saves with the correct name on all platforms.",
      "BUG 2 (Save As dialog still appearing): the Zillow Docs viewer triggers the download via a.dispatchEvent(new MouseEvent('click')) on an off-DOM anchor, which doesn't bubble to document and doesn't go through HTMLAnchorElement.prototype.click — so neither of v1.37.2's intercepts caught it. Fixed by also overriding EventTarget.prototype.dispatchEvent to intercept MouseEvent click dispatches directly on anchor elements.",
      "Added conflictAction: 'uniquify' to all chrome.downloads calls so duplicate filenames get a counter suffix instead of any dialog."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.2",
    headline: "Bulk-download: files now save automatically — no 'Save As' dialog.",
    highlights: [
      "The browser's 'Ask where to save each file before downloading' dialog no longer appears during a bulk download. A MAIN-world interceptor hooks into the Zillow Docs viewer's programmatic anchor.click() download pattern, captures the PDF blob, and routes it through chrome.downloads (saveAs: false) so every file lands silently in your default Downloads folder. Manual opens of Zillow Docs documents are unaffected — the interceptor only fires when the bulk-download flow is active."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.1",
    headline: "Bulk-download BUG FIX: document links now collected correctly by expanding each task row before scanning.",
    highlights: [
      "BUG: 'Collected 0 unique documents' every time. LOP only renders the document anchor tags (<a href='zillowdocs.com/…'>) inside a task's detail row after that row has been expanded — if tasks are collapsed (the default on page load) there are zero anchors in the DOM to find. Fix: the collector now clicks each task's toggle chevron, waits up to 3 s for the detail row to appear, scrapes its links, then collapses the row again. Tasks that were already expanded are left as-is."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.37.0",
    headline: "NEW Bulk-download completed-task documents — one click downloads every borrower-uploaded file under Completed.",
    highlights: [
      "Adds a '⬇ Download all docs' button next to the Completed heading on LOP's Tasks tab. Walks every Zillow Docs link in the Completed table, opens each one in a background tab, auto-clicks the viewer's Download button, then closes the tab — repeats sequentially for every document.",
      "A small progress modal shows current document name + task + a progress bar so you can see what's happening. The browser's 'this site wants to download multiple files' prompt fires once at the start; click Allow and the rest land automatically.",
      "When done, a summary modal lists every downloaded file with its task name so you can rename or sort them after. Failed downloads show the specific reason (e.g. Download button never rendered) so you know which ones to grab manually.",
      "Files land in your browser's default Downloads folder with whatever filename Zillow Docs assigns them (V8663-Regular.pdf, etc.) — same as if you'd opened each doc manually and clicked Download.",
      "Safety: the zillowdocs-side content script is armed-flag gated. Opening a Zillow Docs document manually never triggers the auto-click; only this feature's bulk flow can arm it. Same pattern as the credit-report-reader v1.31.2 fix."
    ],
    sections: ["task-bulk-download"]
  },
  {
    version: "1.36.6",
    headline: "Copy LOP file: 'leave Justin karma' on the success modal is now an actual link to my Zall Wall.",
    highlights: [
      "v1.36.5 added the celebratory end-of-flow modal but the 'leave Justin karma' phrase was plain text. Now it's a real underlined link to zallwall.zillowgroup.com/justinca with the data-zhl-karma-link telemetry attribute so karma clicks from this surface are counted too."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.5",
    headline: "Copy LOP file: cheerier success modal at the end of the post-refresh flow.",
    highlights: [
      "Renamed the post-refresh success modal from 'Credit reissue triggered after refresh / Watch the right rail for the new pull to come back' to '🎉 Congrats on cloning your LOP file! Please make sure to leave Justin karma if you found this useful 💛' — by this point in the flow the credit pull AND liability edits AND pricing assign have all run, so 'triggered, watch the right rail' was outdated."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.4",
    headline: "Copy LOP file BUG FIX: liability edits now gated on every borrower having a credit score (not just the table-side stable-count exit).",
    highlights: [
      "BUG: liability edits were still firing before CoreLogic had finished streaming back, missing accounts that hadn't landed yet. The applyLiabilityEdits-side table wait could stable-exit too early (Borrower 1's liabilities arrive ~5s before Borrower 2's on multi-borrower files, so the row count plateaus briefly between them). Now we ALSO wait — between runCreditAction and applyLiabilityEdits — until every borrower's right-rail Credit card shows a 3-digit FICO (using the same waitForCreditToLand check that gates pricing). 120s cap. Applies to both the inline path AND the post-refresh resume path."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.3",
    headline: "Copy LOP file BUG FIX: liability edits now wait for every staged account to actually appear in the destination table.",
    highlights: [
      "BUG: liability edits (Payoff / Exclude+Reason / Property link) were missing rows after the credit reissue. CoreLogic streams the liabilities back over many seconds, but our old wait just polled for ANY row to appear — so the moment the first card landed, we'd try to find the rest and bail with 'No matching dest row' on accounts that hadn't streamed in yet. New logic polls until either (a) every staged accountIdentifier is present in the destination's liabilities table, or (b) the row count is stable for 4 poll cycles (meaning the pull is done and remaining staged accts won't appear), or (c) 90s hard cap. Per-row also has a 12s extra-wait fallback if the row still isn't there when we try to match it.",
      "Verbose console debug throughout — every poll cycle logs dest row count, wanted count, present count, and which accts are still missing, so you can see exactly when each one lands. Final dest-acct list is logged before edits start, and per-row apply results land under [Copy LOP][liability edits]."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.2",
    headline: "Copy LOP file BUG FIXES: per-borrower credit detect now reads LOP's data-cy grids + popper dismiss before Run pricing.",
    highlights: [
      "BUG: waitForCreditToLand was finding the borrower NAMES (entries with scores: []) but failing to read the actual scores because the text-slicing heuristic walked up too far in the DOM and the slice ran into other UI text. Rewrote to use LOP's stable data-cy attributes directly: each borrower's container is [data-cy=\"<Borrower Name>\"] with [data-cy=\"Hard\"] and [data-cy=\"Soft\"] sub-grids whose 3-digit score spans are direct children. Now returns separate hard / soft arrays per borrower so the polling log shows what was actually read.",
      "BUG: Run pricing was still bouncing with 'Failed to run pricing. Please check the form for errors and try again.' because the ZIP combobox's Google-Places autocomplete popper and the est-closing-date calendar popper were still open over the form when we clicked Run pricing. Added dismissPricingFormPoppers() that fires Escape + blur on each, then clicks a neutral area outside the form to close any remaining portaled poppers. Runs after fillPricingForm and before the Run pricing click."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.1",
    headline: "Copy LOP file BUG FIXES: pricing ZIP gets stripped to 5 digits + credit wait now requires a score for every borrower.",
    highlights: [
      "BUG: pricing form bounced with 'Failed to run pricing. Please check the form for errors and try again.' because the source's source ZIP was a ZIP+4 (e.g. 30504-5682) and LOP's Pricing form only accepts the 5-digit form. Now stripZipToFive() pulls the first 5 digits before writing to propertyZIP.",
      "BUG: waitForCreditToLand was firing as soon as any credit score appeared on the page (it found the combined 'Credit score: 751' in the eligibility panel and immediately proceeded). On multi-borrower files this meant pricing could run before Borrower 2's pull had landed. Now it reads each borrower's name from the personal-info-sections and waits until the right-rail Credit card shows at least one 3-digit FICO next to EVERY name. Logs the per-borrower scores it sees each poll cycle so you can watch progress in the console."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.36.0",
    headline: "Copy LOP file: NEW auto-run pricing + auto-assign same product & rate as the source loan — the whole pricing scenario carries over.",
    highlights: [
      "Stage now captures the source loan's full Pricing scenario: Subject Property section (occupancy, property type, attachment, address bits), Loan Information section (loan purpose, type, term, purchase price, down payment, MI type, appraised value, HOI, taxes, HOA, other monthly, seller credit, est closing date), Pricing Info section (documentation type, escrow type, FTHB, military / VA usage / VA exemption), and the right-rail Loan Details panel's currently-assigned scenario (product name, interest rate, points, lock period, FTHB, AMI LLPA waiver). All of this lives on the same Full Application page so no extra navigation is needed.",
      "Paste now drives the destination's Pricing & Scenarios → Pricing tab after credit lands: waits for the credit pull to populate (FICO / liability rows visible), navigates via the Pricing & Scenarios subnav, fills the pricing form from the staged values, clicks Run pricing, waits for results, finds the row matching the source's product + rate (expanding the collapsed product header if needed), checks the matching rate's checkbox, clicks Assign to loan, then navigates back to Full Application.",
      "Heavy console debug at every step under [Copy LOP][pricing] groups — what we're about to click, what was found, what got written, what got skipped and why. Failure modes (form not mounted, Run pricing disabled, no row matched the rate, Assign button stayed disabled, etc.) log loudly with the candidate-row snippets so you can spot the mismatch from the console alone.",
      "Summary modal now shows a green '✓ Pricing scenario assigned' banner with the picked product + rate, or a red banner with the specific reason it couldn't assign (so the LO can click Assign to loan manually with one less guess).",
      "Multi-borrower path: the post-refresh resume handler also runs the pricing flow after credit fires, so the same one-click flow works whether or not a co-borrower had to be auto-added."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.35.1",
    headline: "Walkthrough: added the Copy LOP file card so the feature actually shows up under New features + deep-links from the toast.",
    highlights: [
      "Bug carried since v1.29: the changelog has been pointing at sections: ['lop-file-copy'] but the walkthrough page never had a card with id='lop-file-copy'. The 'View what's new' button on the update toast was scrolling to nothing, and the feature didn't appear in the top 'New features' strip. Added a full card under the LOP section with an animated demo of the Stage → Paste flow (source card → traveling copy packet → destination filling in → + badge for auto-added co-borrower → ↻ for post-credit refresh) plus the bullet list covering multi-borrower auto-add, auto-save + auto-credit, the LOP credit-cache bypass, locked-field handling, and persistence."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.35.0",
    headline: "Copy LOP file: when a co-borrower is auto-added, paste now reloads the page before credit so LOP's eligibility cache picks up the new consent.",
    highlights: [
      "BUG: even with v1.34.6's double-save + 4.5s settle, LOP's credit-reissue endpoint was STILL bouncing with 'Missing credit consent — Sarah Malone' for some files. LOP's credit-eligibility cache lives on a different service than the consent dropdown commit and the cache lag varies; sometimes 5s isn't enough.",
      "Fix: when paste auto-added a co-borrower on this run, it now stashes a 'pending credit action' record in chrome.storage (loan ID, pull type, ref ID, liability edits) and triggers a page reload AFTER the save settles. The reload forces LOP to rebuild its credit-eligibility cache from scratch. As soon as the page comes back, an init-time handler reads the pending record, waits for the right-rail Choose-action button to mount, and fires the credit pull + liability edits automatically. A small toast modal confirms when it runs.",
      "Single-borrower files (no auto-add) keep the inline credit path — no reload needed when there's no consent-cache race condition to bypass."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.6",
    headline: "Copy LOP file BUG FIX: double-save + 4.5s settle so the credit endpoint sees the new co-borrower's consent.",
    highlights: [
      "BUG: even with consent dropdowns set to Verbal and a 'Granted on …' timestamp showing in the LOP UI, the credit-reissue pull was still bouncing with 'Missing credit consent — Sarah Malone'. LOP's credit-eligibility endpoint reads from a different cache layer than the consent dropdown auto-commit, and 1.5s wasn't long enough for that cache to refresh.",
      "Now: paste does a 3-second settle after the first save, then a SECOND Save Loan File click to force another backend round-trip, then waits 1.5s more before firing credit (4.5s total settle from initial save). The second save is cheap when nothing's dirty (LOP returns the disabled button to us so saveLoanFile no-ops) but it reliably nudges the credit-eligibility cache to re-read the consent state."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.5",
    headline: "Copy LOP file BUG FIX: credit pull no longer races the co-borrower's consent commit.",
    highlights: [
      "BUG: when a brand-new co-borrower was auto-added during paste, the credit pull was firing before LOP's backend had fully persisted the co-borrower's credit-consent records, even though the consent dropdowns were already set to Verbal in the UI. LOP rejected the pull with 'co-borrower didn't consent.' Now: paste waits 1.5s after Save Loan File before firing credit (so the consent records commit), and the pre-credit verifier ALSO checks that every borrower's softCreditConsent + hardCreditConsent dropdowns are set on the destination — if they're empty, we re-paste them from the staged values and re-verify before triggering credit.",
      "Pre-credit verifier now flags missing credit-consent-section render too (the new co-borrower's UI may take an extra render pass before the consent dropdowns mount), with a clear 'try re-paste in a moment' hint instead of failing opaquely downstream."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.4",
    headline: "Copy LOP file BUG FIX: Real Estate source-side scrape was being defeated by the nested liabilities table.",
    highlights: [
      "BUG: stage was failing to capture Property type / Current occupancy / Pending-sale date because expandRowAndReadForm couldn't recognize the open form row. The form's outer tr has a single colspan td, but Real Estate's edit form contains an INNER real-estate-liabilities-table whose own tds were being counted by our querySelectorAll('td') length check. That made tds.length be 9 (1 outer + 8 inner from a 2-row × 4-col liabilities table) instead of 1, so the predicate rejected the form-tr and we either toggled the row closed or timed out waiting. Fixed by counting only DIRECT children tds — nested tables no longer fool the detector. This unblocks the source-side scrape that v1.34.2 added.",
      "Same fix applies to Liabilities source-side scrape (which uses the same expandRowAndReadForm helper) — Property link / Payoff / Exclude+Reason capture now also survives forms with nested tables."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.3",
    headline: "Copy LOP file: Borrower multi-select now verifies the chip + tells you when to re-stage for Real Estate.",
    highlights: [
      "BUG: Real Estate Borrower(s) chip wasn't committing despite our helper claiming success. The multi-select listbox renders an option-row with a checkbox + label, and LOP's React handler is wired to different elements across forms. The picker now tries checkbox → label → option wrapper → type-and-Enter in sequence and VERIFIES each attempt by checking if the chip actually appeared in the combobox wrapper before moving on, so a false-positive log line can't sneak past again.",
      "Real Estate paste also blurs the streetAddress input and clicks the body after writing the address fields, so the Google-Places autocomplete popper that the address input opens doesn't overlap the form (could visually block Save).",
      "If the stage was captured with an older extension version (or before the source-side form scrape worked), the summary now shows a red banner explaining that Property type / Current occupancy / Pending-sale date came back empty because the source-form scrape didn't run — and tells the LO to re-stage from the source loan tab with this version loaded.",
      "Paste-from-stage now logs realEstateDetails / liabilityEdits counts up front so it's obvious whether the stage carries form-only data."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.2",
    headline: "Copy LOP file BUG FIX: Real Estate row now saves on the destination — borrower multi-select + source form scrape fixes.",
    highlights: [
      "BUG: Real Estate row was failing to save with Property type / Current occupancy / Pending sale date / Intended occupancy / Financial status all blank. Root cause was twofold. First, the source-side form scrape was bailing silently when the LO had a Real Estate row already expanded for inspection — our chevron click TOGGLED it closed and then waitForCondition couldn't find the form. Second, the destination's Borrower(s) multi-select combobox reported success (option was found) but never committed the chip because the option wrapper click didn't toggle the underlying checkbox.",
      "expandRowAndReadForm now detects a pre-expanded row and reads it in-place without re-clicking (and leaves it open if the LO had it open). Plus the chevron click uses the full mousedown→mouseup→click sequence so React's row-expand handler picks it up.",
      "New selectMultiBorrowerCombobox helper opens the listbox once, finds each wanted name's row, and clicks the embedded checkbox directly so the chip actually commits. Used by Real Estate Borrower(s).",
      "Real Estate paste now ALSO sets the Existing address dropdown when the borrower has a saved address that matches the property address — picking that option lets LOP auto-fill the address fields and clears the 'Address is required' validation.",
      "Source-side scrape lowered its gate from > 1 row to >= 1 actual-content row, added per-row capture logging, and added a fallback select-value reader for readonly source forms where React's value didn't reflect through select.value."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.1",
    headline: "Copy LOP file BUG FIX: Add-a-new-borrower dialog detector is now permissive — auto-add co-borrower no longer falsely aborts.",
    highlights: [
      "BUG: paste was aborting with 'Add a new borrower dialog did not open' even though the dialog clearly was open. The old matcher required section[role=\"dialog\"][aria-modal=\"true\"] with the title in an h2/h3/h4 child. LOP's actual dialog wrapper varies (some renders use a div with role=dialog, the title sits inside a header, the heading element is referenced via aria-labelledby) so the strict matcher missed it.",
      "Fix: matcher now accepts any [role=\"dialog\"] or [aria-modal=\"true\"] whose visible text (or aria-labelledby reference) contains 'Add a new borrower'. Final salvage: if that still fails but input[name=\"first\"] exists in the document (an input that ONLY renders on this dialog), use that input's nearest section/dialog/form ancestor as the dialog scope.",
      "Click on the + tab now uses the full mousedown→mouseup→click event sequence so React's tab handler picks it up reliably (the bare .click() can be swallowed by styled wrapper buttons — same trick the Save button needed)."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.34.0",
    headline: "Copy LOP file: auto-adds missing co-borrowers before pasting — multi-borrower files now copy cleanly in one click",
    highlights: [
      "BUG: when the source file had multiple borrowers but the destination only had the primary, paste was skipping the + tab and just writing everything into the one section it could find. The co-borrower's SSN ended up on the primary, the address got pasted twice, and the second borrower was never created. Fix: paste now checks the borrower-section count on the destination first and, if the source had more, drives the + tab → Add a new borrower dialog → fills First / Middle / Last / Suffix → leaves 'Coborrower with [primary]' selected → clicks Create borrower, then waits for the new personal-info-section to render before pasting any fields. Repeats for each missing co-borrower.",
      "Uses the dialog's stable input names (first / middle / last / suffix) and the + tab's stable id (add-primary-borrower) so the auto-add survives minor LOP DOM tweaks.",
      "If the auto-add fails (unexpected dialog state, button stayed disabled, etc.) paste aborts cleanly with a clear message telling the LO to add the borrower manually and re-paste — instead of silently writing co-borrower data onto the primary."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.33.2",
    headline: "Copy LOP file: soft credit pulls now save the file first + Save click uses full mouse-event sequence",
    highlights: [
      "BUG: soft credit pull was failing with '\"Pull credit report\" menu item not found.' because the file save step was being skipped. The save gate checked stage.creditReferenceId, which only gets set for HARD pulls — soft pulls have no reference so save never ran, Choose action stayed disabled, and the menu lookup failed. Gate is now stage.creditPullType so both Hard and Soft pulls trigger save before the credit action.",
      "Save click now fires a full mousedown/mouseup/click sequence so React's onClick handler actually picks it up (a bare .click() can get swallowed by styled wrapper buttons — same trick we needed on the loan-amount field). Also added explicit waits for the Choose action button to become enabled after save, with a clear log when it doesn't.",
      "Hard reissue and Soft pull both now bail with a specific 'Choose action still disabled' message if the save didn't take, instead of silently failing at the menu lookup further downstream."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.33.1",
    headline: "Copy LOP file: liability stage skips rows with no E/P tag and no mortgage type — much faster on big files",
    highlights: [
      "Stage now reads LOP's inline E (Exclude) and P (Payoff) tags from the Company/Payee column and only opens rows that actually need opening: Mortgages and HELOCs (likely tied to a Real Estate Property) plus anything with an E or P tag. A file with 10 plain credit cards no longer opens 10 forms on stage; it opens only what carries editable state.",
      "Added sanity-check logs that warn if the row's visible E/P tags disagree with what the form returned for payoff / exclude (could flag a future LOP DOM change before it breaks anything)."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.33.0",
    headline: "Copy LOP file: source-side form scrape for Real Estate + Liabilities, with auto-applied Property/Payoff/Exclude on the destination",
    highlights: [
      "Real Estate now copies form-only fields. Stage opens each source Real Estate row's edit form to capture Property type, Current occupancy, PendingSale / Sold date, and the Will-be-paid-prior-to-closing checkbox — fields LOP only shows in the form, not the table. Paste matches by address and writes them on the destination, so Real Estate rows save without manual cleanup.",
      "Liability metadata is now copied. Stage opens each source liability row's edit form to capture Payoff / Exclude+Reason / Property link (matched by the displayed property address since uuids differ across loans). After the destination's credit pull populates its own liabilities, the extension matches by account number, opens each dest row, applies the captured settings (checks Payoff, checks Exclude + selects the Reason after the Reason field renders, sets the Property dropdown by matching the option's address text), and clicks Save. Per-row report appears in the summary modal.",
      "Source stage now takes a little longer when Real Estate or Liabilities are present (one click per row to open and close each form), with a live progress overlay so you know what it's doing."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.32.1",
    headline: "Copy LOP file: Real estate financial-status defaults to With liabilities when source has a mortgage + clearer failure reason",
    highlights: [
      "Real-estate rows now infer Financial status correctly. Bug: the mapper was only setting WithLiabilities when the source column literally contained the word 'liabilities', but the column actually shows the lender name + account # (e.g. 'JPMCB - HOME LENDING - 4654031444586'). Fix: any non-empty Mortgage/HELOC content is treated as WithLiabilities; explicit 'Free and clear' text keeps FreeAndClear; truly empty leaves it blank.",
      "When a real-estate Save fails, the failure reason now lists the specific form-only fields that need manual entry (Property type, Current occupancy, plus Pending sale / Sold date when status is PendingSale or Sold). The source row scrape doesn't carry those — LOP only shows them in the form, not the table — so they're always the culprit when save bounces."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.32.0",
    headline: "Copy LOP file: one click handles EVERY borrower (per-borrower tables + soft credit pull + pre-credit verification)",
    highlights: [
      "Per-borrower tables now copy correctly. Bug: when a pair had a co-borrower, the scraper was only reading the Primary's Addresses/Employment/Other-income tables (the co-borrower's tables sit inside their own data-cy=\"address-section-1\" / employments-section-1 / other-incomes-section-1 containers). Each captured row is now tagged with its borrower index, and paste drives the matching borrower section's Add button. One Stage click captures every borrower, one Paste click writes every borrower.",
      "Soft credit gets a fresh pull instead of trying to reissue. Bug from v1.31.1's run: CoreLogic rejects reissue for soft credit (CR02 Reference Number Not Found). Fix: stage now branches on pull type — if source had a Hard pull we capture the reference ID and reissue on paste; if source had Soft we just remember the type and on paste drive Choose action → Pull credit report → click Pull credit (which defaults to Soft). No ref ID modal during stage for soft pulls — saves a click.",
      "Pre-credit verification check. Credit won't fire until every borrower in the source's personal-info-sections has matching first / last / DOB / SSN populated on the destination AND has at least one address row in their address-section. Specific issues are reported per borrower so you know exactly what's missing (e.g. \"Sarah Malone: ssn not populated on destination; no address added\"). The credit click is skipped (not failed) when borrowers aren't ready."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.31.2",
    headline: "Copy LOP file: stop auto-closing credit-report tabs the user opens manually + CR02 error context",
    highlights: [
      "BUG: v1.31.0/.1 was auto-closing EVERY credit-report tab you opened, including manual ones unrelated to the Stage flow. Fixed with an armed-flag gate: the Stage button sets chrome.storage.zhlCreditCaptureArmed right before clicking Hard/Soft, and the credit-report-reader content script only fires if it sees that flag set within the last 60 seconds. Tabs you open manually (typing the URL, clicking a link, anything outside the Stage flow) are now left alone. The flag is consumed on first read so a second tab opened within the same window isn't auto-closed.",
      "Added context for CoreLogic's CR02 'Reference Number Not Found' error in the summary modal. The reissue API call worked perfectly (right buttons clicked, right ID typed) — but CoreLogic rejects the ref if it expired (refs typically live a few days) or if the borrower's SSN/DOB on the destination doesn't exactly match what was on file for the original pull. The modal now explains that and points to <em>Choose action → Pull credit report</em> as the fallback."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.31.1",
    headline: "Copy LOP file: save before credit reissue + asset/real-estate borrower picker + employment income subtable wait",
    highlights: [
      "Credit reissue now works after the first paste. Issue: the Choose action button is disabled until the loan file is saved. Fix: after the field paste and table-row paste complete, the extension now clicks the file's Save button (data-cy=save-loan-file-button) and waits for the save cycle to finish before attempting the Choose action → Reissue credit flow.",
      "Asset (and Real Estate) Borrower(s) combobox is now driven programmatically. Issue: the borrower field is a role=combobox + portaled role=listbox — setting .value didn't work, save was blocked with 'at least one borrower must be attributed'. Fix: focus the input, open the listbox (click + ArrowDown), find the option whose text matches the staged borrower name, click it.",
      "Employment income subtable now fills on every row, not just the first. Issue: writeSelect was firing 80ms after employmentStatus was set, but LOP needed longer to render the employment-incomes-table on the 2nd and 3rd Add cycles. Fix: explicitly wait for the table to appear (up to 2.5s) before writing base.amount/base.frequency, with a clear warning logged if it never shows."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.31.0",
    headline: "Copy LOP file: auto-reads credit reference ID + auto-adds rows for every Full App table",
    highlights: [
      "Credit reference ID is now read AUTOMATICALLY from the credit report tab. When Stage clicks Hard or Soft, a new content script on zillowdocs.com finds the CoreLogic-XXX header, sends it to the background script, which stashes it for the source tab to pick up — then closes the report tab. The modal updates live (spinner → ✓ Captured) and saves the stage on its own. Manual paste still works as a fallback if the auto-read times out (30 seconds).",
      "Table rows are now auto-added on paste — Addresses, Employment, Other income, Assets, Gifts/Grants, and Real estate. The extension clicks each + Add button, fills the inline form field-by-field (using LOP's actual field names and value codes per type — addressType=Current/Previous/Mailing, housingType=Own/Rent/LivingRentFree, source=Social Security/Disability/etc., etc.), clicks Save, waits for the row to commit, and moves to the next. Per-row progress is shown in the overlay; per-table success/failure counts and specific failure reasons appear in the summary modal.",
      "Liabilities still skipped on purpose — they flow in from the reissued credit pull. Assets and Real Estate have a multi-select Borrower(s) combobox the auto-fill can't drive yet; those rows save what they can but the LO finishes the borrower-pick. Real Estate's PendingSale date input shows up on cascade and is left for manual entry since the source row doesn't carry the date."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.30.2",
    headline: "Copy LOP file: deep console logging so any field issue is debuggable in DevTools",
    highlights: [
      "Stage now logs (under a collapsible '[Copy LOP] Stage from current page' group): URL, loan ID, borrower names, total fields found, how many were excluded vs captured, full table data, credit button detection, credit capture result, and the final stage object.",
      "Each Paste pass logs (under '[Copy LOP] Paste pass N: wrote X, skippedLocked Y, …'): the exact list of fields that were written (with values), the list skipped because the dest was read-only/disabled, the list skipped because the source was empty or the option doesn't exist in the dest select, and the list of dest fields with no matching source value. So when something doesn't fill, you can see exactly which key was looked up and why it was dropped.",
      "Credit reissue logs each step individually: 'Step 1: looking for Choose action', 'Step 2: clicking Reissue credit report', etc. — if any step fails, the console shows exactly which selector missed."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.30.1",
    headline: "Copy LOP file: progress overlay during paste so you know it's working",
    highlights: [
      "Multi-pass paste + credit reissue takes several seconds. The button used to flip to disabled and then sit there with no feedback. Now a full-viewport overlay (matching the Mark-All-As-Read style) appears with a spinner and a status line that updates per phase: 'Pasting fields — pass 2…' with a running 'Written so far: 47' line, then 'Reissuing credit…' when it gets to that step. Disappears just before the summary modal opens."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.30.0",
    headline: "Copy LOP file: auto-reissue credit on paste + every table's rows captured as reference data",
    highlights: [
      "NEW: credit reissue. On Stage, if the source loan has a clickable Hard or Soft button on the right-rail Credit card, the extension clicks it (preferring Hard) to pop open the credit report in a new tab and prompts you to paste the reference ID (e.g. CoreLogic-117747122510000). The 'CoreLogic-' prefix and any trailing whitespace are stripped automatically. On Paste, after every basic-info field has been written (DOB, SSN, address, email, phone — which Reissue needs to match), the extension drives Choose action → Reissue credit report → fills the reference ID → clicks Reissue. New credit pull comes back on its own.",
      "Tables: stage now scrapes the FULL row content of every Full Application table (addresses, employment, other income, assets, gifts/grants, real estate). The stage and paste summary modals include a 'View staged row data' expander so you can see every captured row as a reference while you add them on the destination. Liabilities are skipped on purpose since the reissued credit pull will populate them.",
      "Note: actually driving LOP's '+ Add address' / '+ Add employment' / etc. inline forms still isn't automated — each form has its own field-by-field structure that I need the DOM for to wire per type. The summary calls this out explicitly and gives you the source row data inline. Send me the inline-form DOMs (one per table) and I'll add the auto-fill in the next iteration."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.29.2",
    headline: "Copy LOP file: bar now lives inline in the subnav (next to Premier Agent)",
    highlights: [
      "Stage / Paste bar is now injected as the last child of LOP's subnav row, sitting inline after the Premier Agent tab instead of floating over the page as a fixed overlay. Detection: walks up from any [data-cy^=\"subnav-\"] anchor to its parent container. Falls back to the previous fixed top-center overlay if the subnav isn't on the page (defensive against LOP layout changes)."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.29.1",
    headline: "Copy LOP file: bar moved to the top, Loan & Property excluded, cascading fields fixed, borrower picker actually shows names",
    highlights: [
      "Floating Stage / Paste bar moved from bottom-left to pinned at the top-center, in the same band as the page-level tab navigation. Same button, just easier to find.",
      "Loan & Property fields are now skipped entirely on BOTH stage and paste — Subject Property address, Purchase price, Rate, Lock period, Rental income, Title info, etc. shouldn't carry over from a previous loan and copying them would be actively wrong on a new file.",
      "Cascading questions now fill correctly. On Declarations, A1 only renders after A=Yes is set, and A2/A3 only render after A1=Yes. The paste now runs up to 4 passes with a 250ms settle between them so each round of newly-revealed fields gets filled. The summary modal reports the pass count.",
      "Borrower picker now shows the actual borrower name(s) (\"Sekou Swaray\" or \"Sekou Swaray & test test\") read directly from the captured first/last fields per personal-info-section, instead of the previous regex over page text that was picking up navigation labels like \"Pre-approval Letter\". The loan ID is still shown as a secondary line for disambiguation."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.29.0",
    headline: "New: Copy LOP file — stage a loan's borrower data and paste it into a new file",
    highlights: [
      "Adds a floating bar to the Full Application page with Stage / Paste buttons. On the source loan: click Stage from this file. The extension snapshots every editable Personal info, Contact, Marital, Military, Declarations, and Demographics field (plus a row count of every table section) and stores it under chrome.storage keyed by source loan ID. On the new loan: click Paste from staged, pick a stored loan from the dropdown, and the extension writes every matching field.",
      "Co-borrower aware: when a loan has a co-borrower on the same pair, both columns share field names like 'first' and 'dob'. The extension scopes each captured field by its enclosing personal-info-section index so primary→primary and co-borrower→co-borrower stay aligned. If the destination doesn't have the co-borrower yet, the summary tells you to add them first (+ tab → Coborrower with [name]) and re-paste.",
      "Multiple stages persist across browser restarts (up to 10). After pasting, a summary panel breaks down: wrote N, skipped M readonly/disabled, no matching source value for P, and lists table sections that still need manual entry (LOP's Add address / Add employment / Add asset flows can't be auto-driven in v1).",
      "Uses the same React-trusted write trick as the loan-amount fix from v1.25.1 — execCommand('insertText') + real .blur() for text inputs, native setter + change event for selects/checkboxes, and .click() for radios so LOP's onChange handlers fire as if a human typed every field."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.28.3",
    headline: "ZHL Comparison PDF: each scenario now fits on a single page",
    highlights: [
      "Split the itemized closing-costs table into a two-column layout: Loan costs on the left, Other costs on the right, with Credits and the grand totals running full-width below. That halves the vertical space the itemized table needs.",
      "Tightened the per-scenario masthead (eyebrow + product name + summary line) and reduced row padding / font sizes across the page to compact spacing. A typical scenario now lays out cleanly on one letter-sized page instead of spilling onto a continuation."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.28.2",
    headline: "ZHL Comparison PDF: no more blank pages + itemized costs match the rest of the design",
    highlights: [
      "Blank-page fix: dropped the standalone 'Detailed cost summary' intro page (which was rendering empty), and removed the page-break-inside: avoid rule that was pushing each scenario's card to a fresh page and leaving phantom blank pages between scenarios. Each scenario now starts on its own page (page-break-before: always) and is allowed to flow naturally onto a continuation page if the itemized table is long.",
      "Per-scenario masthead — each scenario page now has its own header: 'LOAN COMPARISON · DETAILED COST SUMMARY · Scenario X of N', then the product name in large dark text, then a summary line. Borrower flipping through always knows which scenario they're on.",
      "Itemized closing costs restyled with ZHL blue scheme to match page 1 — section headers (Loan costs, Other costs, Credits) are now ZHL blue on white instead of the black-block look that felt copy-pasted from LOP. Subsection underlines, section grand totals, and the final 'Total closing costs' all use the same blue/light-blue palette as page 1's PITI and Cash to/from rows."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.28.1",
    headline: "ZHL Comparison PDF: page 2 now has the full itemized closing-cost breakdown",
    highlights: [
      "Page 2 used to show only the closing-cost totals. Now it auto-opens LOP's \"Detailed cost summary\" popup for each selected scenario, scrapes the full itemized breakdown (Lender costs → Origination fee + total, Fees you cannot shop for → Appraisal/Credit report + total, Third-party costs → Settlement/Title + total, Taxes and other government fees, Prepaids, Initial escrow payment at closing, Other, Credits → Lender credit), and renders it on the PDF.",
      "Cash-at-closing math (down payment, net closing cost, Cash to/from) lives in its own block on the left of each Page 2 card so the borrower can still see the bottom-line cash figure at a glance.",
      "The button shows \"Reading 1 / N…\" progress while it scrapes each popup, and stays usable if a scenario's popup fails to open (it just falls back to the summary-only block for that one)."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.28.0",
    headline: "New: ZHL Loan Comparison PDF — better-looking borrower comparison handout",
    highlights: [
      "Adds a 'ZHL Comparison PDF' button next to LOP's 'Generate PDF' on the Scenarios review page. Generates a borrower-facing comparison handout for every selected scenario via the browser's native Save as PDF flow.",
      "Mirrors LOP's standard output with the requested tweaks: Seller credit is now its own row (not buried inside Cash to/from), Credit score and DTI are removed (the borrower doesn't need their qualifying numbers on a handout), and Estimated monthly cost (PITI) + Cash (to)/from are rendered bigger and bolder so they pop visually as the two anchors.",
      "Adds a Page 2 detailed cost summary — per scenario, breaks the monthly cost into Principal & interest vs Taxes/insurance/escrows, and the closing-cost stack into total closing costs, seller credit applied, net closing cost, down payment, and the final Cash (to)/from at closing.",
      "Uses chrome.storage's lo_name / lo_nmls / lo_phone / lo_email (same fields the 2-1 Buydown PDF uses) for the contact box."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.27.4",
    headline: "Max-PP estimator: holds down payment $ fixed + only updates after Run pricing",
    highlights: [
      "BIG MATH FIX: previous versions assumed the down payment PERCENTAGE stayed constant when extrapolating PP. But when an LO actually types a higher PP into LOP keeping the same dollar down payment, the loan amount grows MUCH faster (the borrower's $300k stays $300k, the loan goes from $300k to $621k, etc.) and PITI / DTI climb way past the linear projection. Now the estimator holds down-payment DOLLARS fixed, which matches what LOs actually do when shopping max price for a borrower with a fixed amount saved.",
      "Added PMI-crossover warning: if the current scenario is below 80% LTV (no PMI) but the estimated max PP would cross 80%, the pill turns amber and warns that PMI will kick in, real PITI will be higher, and the actual max will be lower.",
      "STALE-PRICING FIX: the pill no longer recomputes when you edit the scenario form. Previously, typing a new PP / DP / tax rate would re-derive the estimate before you clicked Run pricing — the number you were trying to test against shifted in real time. Now the pill latches to the last pricing-results rows and only updates after Run pricing returns new numbers (or your loan-level income / liabilities change)."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.27.3",
    headline: "Max-PP estimator: better math — taxes, HOI, HOA broken out separately + conforming-crossover warning",
    highlights: [
      "Previous versions treated PITI as a single ratio against PP, which scales taxes / HOI / HOA / Other all together — wrong for HOA and any fixed monthly costs. Now the estimator decomposes current PITI into P&I+MI (scales with loan amount), taxes (% of PP if entered as %, otherwise fixed), HOI (same), HOA (fixed), Other (fixed). Real PP estimate is more accurate, especially on loans with HOA or flat monthly costs.",
      "Added a conforming-limit crossover warning: if the estimated max loan amount climbs past the 2025 baseline ($806,500), the pill turns amber and the tooltip explains that rates and MI factor reprice into high-balance / jumbo, so real PITI at that PP will likely be higher and the actual max LOWER than shown. Treat the number as an upper bound and re-run pricing to confirm.",
      "Hover the pill to see the full breakdown: P&I+MI per month, taxes per month, insurance per month, plus the estimated loan amount at the suggested PP."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.27.2",
    headline: "Max-PP pill now reads \"Est.\" and shows a ⚠ — verify with AUS before quoting",
    highlights: [
      "Renamed to \"Est. max Conv / FHA / VA\" so it's obviously an estimate, not a quote.",
      "Added a ⚠ warning glyph after the dollar amount. Hovering surfaces the full message: this is an estimate only — confirm you have AUS approval (DU / LPA) at the new purchase price before quoting it to the borrower."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.27.1",
    headline: "Max-purchase-price pill: bumped up to a readable size",
    highlights: [
      "The Eligibility Details pill from v1.27.0 was rendering at 12px which made it hard to read at a glance. Bumped to 15px / heavier weight with more padding so it stands out next to the existing pills."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.27.0",
    headline: "New: max-purchase-price estimator on the Pricing & Scenarios page",
    highlights: [
      "Adds a pill in the Eligibility Details bar that shows the estimated maximum purchase price that would push back-end DTI to the program cap — Conv 49.99%, FHA 56.99%, VA 60%. One pill per loan type that's in the current scenario's results.",
      "Math: reads the best (lowest PITI) product row per loan type, computes how many PITI dollars per dollar of purchase price (taxes + HOI + MI all scale linearly with PP at a fixed down payment %), then back-solves the PP that hits the DTI cap. Accurate to within 1-2% of what re-running pricing would show.",
      "Hover any pill to see the breakdown: which product the estimate is based on, that product's current PITI, and the DTI target.",
      "Type the suggested number into the Purchase price field to verify — the loan-amount fix from v1.25.1 means LOP's pricing engine will pick it up on the next Run pricing."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.26.8",
    headline: "FHA Flip Rule: stop picking up the borrower's residence as the subject address",
    highlights: [
      "The previous auto-detection was reading the 'Use existing address' dropdown on the Subject Property section, but that dropdown holds the BORROWER's existing addresses (offered as one-click fill-ins) — not the property's. Loans where the borrower hadn't yet selected an option got their mailing address used by mistake (e.g. '509 Glenwood Dr' for a property that was actually '1920 Baker Ct').",
      "Also fixed: when the Subject Property section isn't on the current page (loan dashboard, pricing, etc.), the detector used to fall back to a document-wide scan and grab the FIRST 'addressStreet' input it found — which was always the borrower's residence. It now returns empty in that case so cached / manually-typed addresses survive.",
      "When a fresh Subject Property address is detected and it differs from what was cached, the cache is now updated and the Zillow seller-date lookup re-runs. Earlier 'unknown — click to set' pills should auto-fix themselves the next time you visit the Loan and Property page."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.7",
    headline: "FHA Flip Rule: Zillow-lookup diagnostics now visible in the page console",
    highlights: [
      "When the background Zillow lookup fails, the full diagnostic payload (final URL, HTML length, the captcha/blocked flag, and the snippet around 'Sold') now logs to the LOP page console — not just the service-worker console. Easier to debug 'still showing unknown' reports without digging through chrome://extensions → service worker logs."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.6",
    headline: "FHA Flip Rule: Subject Property address now auto-detected on Full Application page",
    highlights: [
      "The Full Application page has multiple address sections (each borrower's residence plus the Subject Property), and they all use the same input names like 'addressStreet' and 'addressCity'. The auto-detection was grabbing the FIRST match — usually the borrower's residence — so the pill stayed 'unknown' even when the Subject Property had a real address typed in.",
      "Now scoped to the #SubjectProperty container so it reads only the Subject Property inputs. The pill should auto-fill from Zillow as soon as the address is populated.",
      "Also retired the per-loan 'already attempted Zillow' flag in favor of one keyed on the address itself. If the Subject Property address is later added or corrected, the Zillow lookup runs again instead of staying stuck on an earlier 'unknown' result."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.5",
    headline: "FHA Flip Rule: Zillow auto-fill now actually works (parser fix)",
    highlights: [
      "Zillow's price-history field is named dateSoldString, not dateSold — my regex was looking for the wrong field name and missing every match. Added dateSoldString (plus escaped-JSON variants) so the seller's last sale date now auto-fills from Zillow on most properties.",
      "Cleaned up the diagnostic mouse-event logging from v1.26.4 now that the underlying click issue is resolved."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.3",
    headline: "FHA Flip Rule: pill click now works even when LOP re-renders the section",
    highlights: [
      "Switched the pill's click handler from per-element to document-level capture-phase delegation. Survives LOP's React reconciliation (which can strip event listeners off our injected button) and fires before any React synthetic-event delegate higher up the tree can stop propagation.",
      "Added an injection counter to the log so future 'click does nothing' reports show whether the pill is being re-injected repeatedly (a sign LOP is stripping our DOM)."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.2",
    headline: "FHA Flip Rule: clicking the pill now reliably opens the popup",
    highlights: [
      "Clicking the pill when there was no address was silently doing nothing — the window.prompt() flow it was running first sometimes fails inside Chrome content scripts and blocked the modal from ever appearing.",
      "Removed the prompt entirely. The popup now always opens directly on click and focuses the address input so you can type immediately if it's empty.",
      "Added diagnostic console.log so future 'click does nothing' reports are debuggable (the LOP tab's console will show '[FHA Flip Rule] pill clicked → opening panel')."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.1",
    headline: "FHA Flip Rule: now a compact pill (click to open) + more Zillow parsing fallbacks",
    highlights: [
      "Replaced the bulky card with a small pill under Loan Details, matching the FHA Manual Eligible pill style. The pill is color-coded: green clear, amber 91–180 days, red NOT eligible, gray unknown.",
      "Click the pill (any state) to open a popup with the address, dates, and rule-tier reference — same inputs the bulky card had, just on demand.",
      "Zillow parser now tries more patterns: escaped-JSON sale dates, 'Last sold for ...' text, dateSold / soldDate / lastSoldDate fields, and a few more shapes the previous code missed. Logs the response length and a snippet around 'Sold' to the SW console when nothing matched, so future misses are easier to debug.",
      "Background auto-lookup happens silently on first mount — the pill is already accurate by the time you click it."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.26.0",
    headline: "FHA Flip Rule card now auto-reads the address + auto-pulls last sold date from Zillow",
    highlights: [
      "Auto-detects the subject property address from LOP's Subject property section: reads the 'Use existing address' dropdown's options first, then falls back to the individual Street / City / State / Zip inputs.",
      "If neither is populated, the card prompts you for the address the first time it mounts on a loan.",
      "Once an address is loaded, the card automatically fetches Zillow's listing through the service worker, parses the seller's most recent sale date out of the price history, and fills the Seller's purchase date for you.",
      "A small status line shows ✓ when Zillow returned the date, ⚠ when it didn't (captcha, bot-block, or address not found on Zillow). A fallback 'or open Zillow manually' link is always available."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.25.1",
    headline: "Loan amount field: typing in it now actually updates LOP's pricing",
    highlights: [
      "When you typed in the Loan amount field (our injected one on the Pricing page), the down payment input visually updated but LOP's pricing engine kept using the old number — so the displayed scenarios showed a different loan amount and LTV than your inputs.",
      "Same fix that worked for the VA Calc reverting in v1.10.13 and the Copy Addresses module: route writes through document.execCommand('insertText') so the events are trusted by LOP's form library, and call the real .blur() method (not a dispatched event) to commit the value. Writes the dollar amount first with a 200ms settle, then the percent, so the two don't race."
    ],
    sections: ["loan-amount"]
  },
  {
    version: "1.25.0",
    headline: "New: FHA 90-Day Flip Rule checker on the right rail",
    highlights: [
      "On FHA loans only, a new card appears on the right rail under Loan Details with inputs for the property address, the seller's purchase date, and the contract date (defaults to today).",
      "Computes days between dates and color-codes the result: ✓ green when > 180 days (no restriction), ⚠ amber when 91–180 days (second appraisal may be required if resale ≥ 100% over seller's purchase), ✗ red when ≤ 90 days (NOT eligible for FHA).",
      "Has a 🔎 'Look up on Zillow' button that opens a new tab searched for the property so you can find the seller's acquisition date in the price-history table.",
      "Your inputs persist while you're on the loan, so navigating around the application doesn't lose them."
    ],
    sections: ["fha-flip-rule"]
  },
  {
    version: "1.24.0",
    headline: "Drag Gmail attachments straight into Slack",
    highlights: [
      "Previously the Gmail drag worked on LOP but Slack would silently drop the file (no error, just nothing happened). Slack web uses a custom React drop handler that doesn't expose an input[type=file] for us to inject into.",
      "Fix: receiver now ALSO runs on app.slack.com / *.slack.com, and when no file input is found, it synthesizes a real drop event on the target with a populated DataTransfer so Slack's own composer picks up the file like a native OS drop.",
      "Same fallback applies to any other site we add later — file-input injection first, drop-event synthesis as a fallback."
    ],
    sections: ["gmail-drag"]
  },
  {
    version: "1.23.4",
    headline: "Gmail compose: scrollbar no longer disappears when typing past the visible area",
    highlights: [
      "When you typed a long email in the popup compose, the cursor could scroll below the visible window and the scrollbar would seemingly disappear — actually the body's bottom was sitting behind the toolbar, hiding the scrollbar thumb.",
      "Fix: added 90px of clearance below the compose body so the toolbar doesn't overlap content or the scrollbar. Also tells the browser to keep the typing cursor 90px above the bottom edge when auto-scrolling, so your text stays visible above the toolbar."
    ],
    sections: ["gmail-tweaks"]
  },
  {
    version: "1.23.3",
    headline: "FHA Analyzer: cash reserves now subtract cash-to-close from total assets",
    highlights: [
      "The Cash reserves check was using gross Total Assets, ignoring the cash the borrower has to bring to closing. A file with $30k in assets but $28k cash-to-close only has $2k in actual reserves — but the analyzer was reporting 7.7 months of reserves instead of the real 0.5 months.",
      "Now reads 'Cash (to) / from' from the right rail and subtracts it from Total assets before dividing by PITI, so the reserve months reflect what's actually available AFTER closing. Cash-out refis (negative cash-to-close) are handled too.",
      "Detail line now shows the math: 'Assets $30,008 − cash to close $28,142.82 = $1,865.18 ÷ PITI $3,880.29 = 0.5 months'."
    ],
    sections: ["fha-manual"]
  },
  {
    version: "1.23.2",
    headline: "VA Calc fix: DU was reporting a wildly wrong residual income (huge bug)",
    highlights: [
      "Found it: the VA calc was filling LOP's 'VA total deductions' field with the FULL sum of every deduction (taxes + monthly debts + PITI + maintenance). DU and some other AUS readers expect that field to be the NON-housing, NON-debt portion only — they subtract PITI and monthly debts separately from the URLA. So DU was double-counting those, reporting a residual income about $3,400 lower than the real value and referring files unnecessarily.",
      "Example from a real submission: our calc showed +$893 residual, LPA showed +$813 (close, ~$80 tax-table difference, expected), DU showed −$2,499 (off by exactly the PITI + debts double-count).",
      "Fix: 'VA total deductions' now gets only taxes + maintenance + childcare. The on-screen residual and the panel breakdown still show the full picture. Re-run the VA Residual Income Calc on any open files to repopulate the field with the corrected value before re-submitting to DU."
    ],
    sections: ["va-calc"]
  },
  {
    version: "1.23.1",
    headline: "FHA Manual Analyzer: auto-evaluates VA residual + accurate tier indicators",
    highlights: [
      "Residual income (VA tables) is now auto-evaluated — pulls everything the VA Residual Income Calc reads (income, debts, family size, state, loan amount) and shows ✓ pass / ✗ fail with the actual numbers, instead of being a manual checkbox.",
      "Ratio tier indicators (37/47, 40/40, 40/50) now reflect BOTH conditions: DTI fits AND enough compensating factors verified. A tier with the DTI in range but factors still short shows '?' until the factor is checked.",
      "Toggling 'No discretionary debt' now flips the 40/40 indicator live as expected."
    ],
    sections: ["fha-manual"]
  },
  {
    version: "1.23.0",
    headline: "New: FHA Manual Underwrite Analyzer — one click, full ✓/✗ workup",
    highlights: [
      "New 'Analyze Manual UW' button next to the FHA Manual eligibility pill on the Credit section.",
      "One click opens a panel that runs every Manual UW check against your file: credit score floor, max DTI, the four ratio tiers (31/43, 37/47, 40/40, 40/50), and every compensating factor with ✓ green / ✗ red / ? gray for unknown.",
      "Auto-evaluates: minimum credit score, max DTI, ratio-tier eligibility from front/back DTI, cash reserves (Total assets ÷ PITI vs the 3-month / 6-month rule), minimal increase in housing payment ($100 or 5% rule from current rent → PITI).",
      "Manual checkboxes for the things the extension can't read: significant additional income, residual income via VA tables, no discretionary debt (for 40/40), Energy Efficient Home. Your checks persist as you navigate around the loan.",
      "Final recommendation box: green 'Qualifies under tier 31/43' when DTI fits with no comp factors needed, amber 'Likely does not qualify — needs X' with a specific list of what's missing, or red when score/DTI hard-fails."
    ],
    sections: ["fha-manual"]
  },
  {
    version: "1.22.1",
    headline: "VA Calc: enter square footage instead of doing the math yourself",
    highlights: [
      "VA Residual Income Calc: the Maintenance & Utilities row now takes square footage as input (defaulting to 2,500 sq ft). The calc multiplies by $0.14/sqft for you and shows the computed dollar amount below the input.",
      "FHA Manual UW guideline tooltip rewritten to match the published ZHL matrix verbatim.",
      "Update toast's 'View what's new' button now lands you at the top of the walkthrough (showing the karma banner + new features) instead of jumping straight to the changelog block."
    ],
    sections: ["va-calc", "fha-manual"]
  },
  {
    version: "1.22.0",
    headline: "Plain-English changelog + karma link to my Zall Wall",
    highlights: [
      "Rewrote every 'What's new' entry on the walkthrough page in plain English — no more PubNub / DOM / virtualization jargon.",
      "Added a karma callout at the top of the Setup page and the Walkthrough page with a link to my Zall Wall — if the pack saves you time, drop me karma!",
      "Update toast (the bottom-right notification when the extension updates) now also has the karma link at the bottom."
    ],
    sections: ["whats-new"]
  },
  {
    version: "1.21.4",
    headline: "Newest features now show first on the walkthrough page",
    highlights: [
      "The 'New features' section at the top of the walkthrough now lists the freshest stuff first instead of jumbling the order."
    ],
    sections: []
  },
  {
    version: "1.21.3",
    headline: "Mark All As Read now catches threads scrolled out of view",
    highlights: [
      "Before this fix, if your unread messages were scrolled below what you could see, the button would say 'No unread threads' even though the red dot in the tray was on.",
      "Now it flips Salesforce's own 'Unread' filter on first so the inbox shows only unread messages, marks them all, then flips the filter back so the panel looks the same as before."
    ],
    sections: ["sms-mark-read"]
  },
  {
    version: "1.21.2",
    headline: "Mark All As Read: cleaner look + accurate count",
    highlights: [
      "Fixed the dialog that wrongly said 'Marked 0 of 3' when threads were actually being marked correctly.",
      "Added a 'Marking 2 of 3 threads as read…' overlay so you don't see threads flickering open and closed during the run.",
      "The button is now hidden when you're inside a conversation — it only shows when you're looking at the inbox.",
      "Heads up: Salesforce only marks a thread read by opening it, so the button has to open each one briefly. There's no behind-the-scenes way to do it without that."
    ],
    sections: ["sms-mark-read"]
  },
  {
    version: "1.21.1",
    headline: "Several Salesforce features now work across multiple open tabs",
    highlights: [
      "Auto Call Details Tab and the Show Promotions auto-hide used to only work on the first Lead you opened. Now they work on every Lead workspace tab you have open.",
      "Mark All As Read clicks now reliably open the thread instead of doing nothing.",
      "Walkthrough page got a dedicated 'New features' section at the top so the latest stuff is always front and center."
    ],
    sections: ["new-features"]
  },
  {
    version: "1.21.0",
    headline: "Mark all SMS threads as read with one button",
    highlights: [
      "New Mark All As Read button in the Salesforce Messaging panel next to New thread.",
      "Clicks each unread thread once to mark it read, then returns to the inbox automatically."
    ],
    sections: ["sms-mark-read"]
  },
  {
    version: "1.20.3",
    headline: "Toast 'View' button now opens reliably + clearer Copy-addresses demo",
    highlights: [
      "Fixed the 'View what's new' button in the update toast — it wouldn't open the walkthrough for users with ad blockers installed.",
      "The Copy-addresses demo animation now actually shows the address landing on the co-borrower side instead of just sliding off."
    ],
    sections: ["whats-new", "address-copy"]
  },
  {
    version: "1.20.2",
    headline: "Update notification toast now actually appears after an update",
    highlights: [
      "The bottom-right 'new version' toast wasn't showing the first time anyone updated to a new version.",
      "Fixed so it appears on the first page load after every update."
    ],
    sections: ["whats-new"]
  },
  {
    version: "1.20.0",
    headline: "New: in-extension walkthrough page + update notifications",
    highlights: [
      "Walkthrough page collects every feature in one place with screenshots and 'where to find it' hints — open it from the setup page anytime.",
      "Bottom-right toast appears on LOP/Gmail/Salesforce after an update so you don't miss new features.",
      "Fresh installs auto-open the walkthrough so new users can see what they just installed."
    ],
    sections: ["whats-new"]
  },
  {
    version: "1.19.8",
    headline: "Drag Gmail attachments into your inline reply (not just popups)",
    highlights: [
      "When you reply to an email inline (without popping out a separate compose window), you can now drag attachments straight into the reply instead of having them paste as plain filename text.",
      "Copy addresses primary → co-borrower: no more confirm prompt when the co-borrower has no addresses yet — just runs.",
      "Copy addresses: about 700ms faster per address.",
      "FHA Manual Eligible pill: hover it to see the complete FHA Manual UW guideline matrix (score floor, max DTI, ratio tiers, compensating factors).",
      "FHA Disputed badge: now reads 'ACCT IN DISPUTE' out of the Remarks field, which is how most credit-report disputes actually show up."
    ],
    sections: ["gmail-drag", "address-copy", "fha-manual"]
  },
  {
    version: "1.19.0",
    headline: "FHA Manual Underwrite eligibility pill on every Lead",
    highlights: [
      "Green ✓ FHA Manual Eligible or red ✗ FHA Manual Ineligible pill appears under the Credit section based on each borrower's middle score.",
      "Uses the lower middle score when you have multiple borrowers, which is what underwriting actually qualifies off of.",
      "Hover the pill for the complete FHA Manual UW guideline matrix.",
      "New 'Copy addresses from primary' button on every empty co-borrower addresses section."
    ],
    sections: ["fha-manual", "address-copy"]
  },
  {
    version: "1.18.0",
    headline: "Branded 2-1 Buydown PDF + auto-fill your LO profile from Salesforce",
    highlights: [
      "One 2-1 Buydown PDF button that produces a borrower-facing comparison sheet with side-by-side scenarios and PITIA payment labels.",
      "Pull your Loan Officer profile (Name / Email / Phone) straight from Salesforce on the setup page instead of typing it.",
      "Hover any element added by this extension to see who built it."
    ],
    sections: ["buydown-pdf"]
  },
  {
    version: "1.15.0",
    headline: "FHA + Non-Permanent Resident Alien warning banner",
    highlights: [
      "Sticky red banner across the top of the Lead page when the loan is FHA and any borrower is marked as a Non-Permanent Resident Alien.",
      "HUD removed NPRAs from FHA eligibility on May 25, 2025 — this catches the combination before it ships."
    ],
    sections: ["fha-npr"]
  },
  {
    version: "1.12.0",
    headline: "FHA Collections + Disputed badges with $2k / $1k caps",
    highlights: [
      "Live badges on the Liabilities section showing total Collections (against the $2k FHA cap) and total Disputed Derogatory (against the $1k FHA cap).",
      "Bulk-delete unsent tasks: checkbox column + Delete Selected button on the Unsent and Awaiting borrower task tables."
    ],
    sections: ["fha-badges", "task-bulk"]
  }
];
