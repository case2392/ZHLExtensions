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
    version: "1.64.10",
    category: "improvement",
    headline: "Meeting Reminders — removed the 'Snooze all' button; 'Dismiss all' now sits in its place (right side of the footer). Snoozing is handled by each reminder's own Snooze button plus the shared 'Snooze until:' dropdown.",
    highlights: [
      "Footer is now: 'Snooze until:' dropdown on the left, 'Dismiss all' on the right. The per-row Snooze button still uses the dropdown selection to snooze that one meeting.",
      "Removed the now-unused snoozeAll() function."
    ],
    sections: ["calendar-reminders", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.9",
    category: "improvement",
    headline: "Meeting Reminders — fixed the same meeting showing up multiple times, and changed the Snooze options to be relative to the meeting ('5 min before event', 'at start time', '5 min after event', …) instead of plain durations.",
    highlights: [
      "Duplicate fix: a single meeting was appearing up to 4 times because it gets scraped from several DOM representations (week grid + agenda + the side-panel iframe) — some without a stable event id, and one was a stale entry from before the title fix (hence the leftover word-salad title on one copy). De-dup now keys on start-time + the first 16 alphanumerics of the title, which collapses the clean title and the comma-salad variant into one, and always keeps the cleaner title. Applied both in the scraper's merge and as a final guard on the Gmail render side.",
      "Stale cleanup: events contributed by a frame/tab are now stamped with a 'last seen' time and dropped if they haven't been re-scraped in 90 seconds (so a closed Calendar surface stops leaving ghost reminders), and any stale copy that collides with a freshly-scraped event is replaced by the fresh one.",
      "Snooze options are now event-relative: 15/5/1 min before event, at start time, and 1/5/15 min after event. Snoozing hides the reminder until that point relative to the meeting and then pops it again — far more useful than 'snooze 10 minutes'. The footer label is now 'Snooze until:'. Snooze is keyed to the event occurrence so it suppresses every lead-time reminder for that meeting until the chosen moment.",
      "If you pick a relative time that's already passed (e.g. '5 min before' when it's already 2 min before), the reminder still hides for ~1 minute rather than re-appearing instantly."
    ],
    sections: ["calendar-reminders", "calendar-events-scraper", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.8",
    category: "improvement",
    headline: "Meeting Reminders — now reads the Google Calendar side-panel inside Gmail (and the Schedule/agenda view), so events show up and fire reminders even when you're using the little calendar panel rather than a full Calendar tab. Events already inside your reminder window when the calendar loads now pop right away.",
    highlights: [
      "Side-panel / iframe support: the Gmail Calendar side panel loads calendar.google.com in an IFRAME, and the scraper content script only ran in top-level Calendar tabs — so it never saw those events. The scraper now runs in all frames (manifest all_frames: true), and the background's inject-into-open-tabs step now injects into all frames too. That covers the embedded side-panel calendar as well as standalone Calendar tabs.",
      "Agenda / Schedule view date fallback: in the agenda layout the event chip has no data-datekey — the date lives in a day-header row ('Mon, Jun 22'). Date resolution now has three tiers: (1) a date in the chip's own aria-label/text, (2) the data-datekey on a column ancestor (week/day view), (3) the nearest preceding day-header date (agenda view + side panel). So chips that only show a time still get placed on the right day.",
      "De-dup across frames: because the scraper can now run in both a full Calendar tab and the side-panel iframe at once, the merged event store is de-duplicated by uid+start time so the same meeting can't produce two reminder cards.",
      "Net effect for your screenshot: with the side panel open showing meetings 10 and 20 minutes out and a 30-minute lead time, both now scrape and pop immediately. (Reminders still display in Gmail — keep a Gmail tab open. If it still shows nothing, open the Calendar surface's console, set window.__zhlCalDebug = true, and share the '[ZHL Calendar Scraper]' line.)"
    ],
    sections: ["calendar-reminders", "calendar-events-scraper"]
  },
  {
    version: "1.64.7",
    category: "bugfix",
    headline: "Meeting Reminders — dismissing one of the test-preview reminders no longer closes the whole pop-up. It now removes only the reminder you clicked, leaving the others showing.",
    highlights: [
      "Bug: the test-event cleanup (removeTestEvents) stripped EVERY event whose uid started with 'zhl-test' on any dismiss, so dismissing one of the three previews wiped all three and the panel collapsed.",
      "Fix: cleanup is now scoped to the specific dismissed event's uid (parsed from the instance key 'uid|startMs|lead'). Dismiss-one removes just that uid; Dismiss-all removes only the test uids that were actually in the due list. Real (non-test) reminders were never affected — this only touched the synthetic preview events.",
      "Note: this was a test-preview-only quirk; live calendar reminders dismiss individually as expected."
    ],
    sections: ["calendar-reminders", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.6",
    category: "improvement",
    headline: "Meeting Reminders — the pop-up now brings your Gmail window to the front when a new reminder fires (so you can't miss it even if you're in another tab/app), and the meeting title is cleaned up — no more 'Melynda Florea and 15-minute meeting, Justin Case, Accepted, No location, …' word salad.",
    highlights: [
      "Auto-focus on new reminder: when a reminder newly becomes due, the Gmail content script asks the background to activate its tab and focus its window (with the taskbar attention flag). It only fires on a NEW reminder key — not on every 15-second re-render — so it won't repeatedly steal focus while a reminder is just sitting there. A reminder that's snoozed and later wakes up counts as new again and re-focuses.",
      "Title cleanup: Google's week/day-view aria-labels are comma-segmented as '<title>, <organizer>, <RSVP status>, <location>, <title again>, <time>'. The old parser stripped only the time/date and kept all the rest, producing word salad. The title is now the first comma-segment that isn't a time, date, RSVP status (Accepted/Declined/Maybe/etc.), or location marker ('No location'). Handles time-first formats too, and no longer mangles titles like '15-minute meeting' (the time-strip now requires a colon or am/pm, so it won't eat the bare '15').",
      "Verified against the reported salad string plus time-first, Zoom-link, and all-day variants — all resolve to just the clean event name."
    ],
    sections: ["calendar-reminders", "gmail-calendar-reminders", "calendar-events-scraper"]
  },
  {
    version: "1.64.5",
    category: "improvement",
    headline: "Meeting Reminders — fixed the core bug where week/day-view events weren't being detected (so a meeting added within the reminder window never popped). Also: all-day events now show an ALL DAY badge (anchored to 8am) instead of being ignored, the Join button now recognizes Zoom links too, and the Setup 'Show test reminder' button now fires THREE preview reminders at different intervals so you can see the full layout.",
    highlights: [
      "Root-cause fix for 'added a meeting within 30 min but it never popped up': in week/day view a Google Calendar event chip's aria-label carries only the time + title — NOT the date (the date is in the day-column header). The old parser REQUIRED a date in the aria-label, so every week-view event was rejected and nothing was scraped (hence the earlier '0 upcoming events loaded'). The scraper now resolves the date from the chip's nearest data-datekey ancestor (Google encodes the column date there as (year<<9)|(month<<5)|day) and searches both the aria-label AND the chip's visible text for the time. Falls back to text date parsing when there's no datekey.",
      "All-day events (previously skipped): now produce a reminder anchored at 8:00am local on their date and render with a purple ALL DAY badge instead of an 'in X minutes' countdown. The reminder fires at your normal lead times before 8am (e.g. 7:30/7:55am with the 30,5 default).",
      "Join button now matches Zoom as well as Google Meet — meet.google.com, *.zoom.us, and *.zoomgov.com links (corporate subdomains included, e.g. zillowgroup.zoom.us). The link is found in the chip's text, aria-label, or any <a href> inside it.",
      "Show test reminder (Setup) now fires THREE previews at once so you can see the stacked layout: a Borrower call ~3 min out (red 'soon' styling + Google Meet Join), a Team standup ~25 min out (blue + Zoom Join), and an all-day Quarterly planning (ALL DAY badge). Dismiss all clears them.",
      "Selector broadened to any [data-eventid] / [data-eventchip] / event-tagged role=button, and a one-line diagnostic still logs to the Calendar tab console (with samples) whenever a scrape parses zero events — set window.__zhlCalDebug = true to always log."
    ],
    sections: ["calendar-reminders", "calendar-events-scraper", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.4",
    category: "bugfix",
    headline: "Appraisal Blast — the 'Immediate equity' line now only appears when there's actually positive equity. At a flat appraisal (appraised = purchase price) the email used to show 'Immediate equity $0 🎉', which read as silly. Now the equity row is omitted entirely unless the appraisal came in above the purchase price.",
    highlights: [
      "Celebration variant fires whenever the appraisal isn't low (equity >= 0), but the equity figure is only meaningful when it's strictly positive. Both the HTML highlight box and the plain-text body now gate the equity line on equity > 0.",
      "HTML: at $0 equity the highlight box shows just Appraised value + Purchase price (the bottom margin on Purchase price is also dropped so the box doesn't have dead space where the equity row was).",
      "Plain text: at $0 equity the sentence ends '...We're purchasing for $385,000. 🎉' instead of '...which means $0 in immediate equity 🎉'.",
      "Low-value variant (appraisal below purchase) is unchanged — it still shows the Shortfall row."
    ],
    sections: ["gmail-appraisal-blast", "appraisal-blast"]
  },
  {
    version: "1.64.3",
    category: "improvement",
    headline: "Meeting Reminders — pop-up now appears smack in the middle of the screen on first show, is draggable by its header, and has an × close button in the corner that hides it until the next reminder fires. Position is remembered across renders, so once you drag it where you want, it stays there.",
    highlights: [
      "Initial position: the reminder panel now opens centered (translate -50%/-50%) instead of top-right. Drag it by the blue header — clamped inside the viewport so it can't get lost off-screen — and its pixel coordinates persist to chrome.storage.local under zhlCalPanelPos. Every subsequent open uses that saved position.",
      "Close X (top-right of the blue header, next to the title): closes the panel without dismissing or snoozing anything. The panel reappears the moment a NEW reminder enters the due list (e.g. the 5-minute follow-up after you closed the 30-minute heads-up, or a different meeting's reminder). Implemented via an in-memory closedKeysSnapshot: render() suppresses the panel while every due key is in the snapshot; the first new key clears it. Matches Outlook's close-X-on-the-popup semantics.",
      "Drag implementation: mousemove/mouseup listeners are attached ONCE at module init (not in render), so they don't accumulate across the 15-second re-renders. The mousedown handler on the header skips drag-start when the click target is inside a button, so the X / Snooze / Dismiss buttons still work normally. First drag switches the panel from the centered transform to pixel positioning so subsequent moves track 1:1 with mouse delta.",
      "Saved position is per-Chrome-profile (storage.local). To 're-center', click the X to close, then trigger a new reminder (e.g. the Setup test button) — actually, no, the saved position sticks. If you want a quick reset, deleting the zhlCalPanelPos key in chrome.storage will do it; happy to add a Setup button for this if you want one."
    ],
    sections: ["calendar-reminders", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.2",
    category: "improvement",
    headline: "Meeting Reminders — added a 'Show test reminder' button in Setup (see the pop-up instantly without waiting for a real meeting), made already-open Calendar tabs get scraped automatically, and broadened the event parser to handle single-time chips plus diagnostic logging when nothing parses.",
    highlights: [
      "Show test reminder button (Setup → Meeting Reminders): writes a synthetic 'Test meeting (ZHL preview)' event ~2 minutes out straight into the event store (bypassing the scraper), brings your first open Gmail tab to the front, and the reminder card pops immediately. Dismissing the test card removes it cleanly (synthetic uid 'zhl-test*' is stripped from the store on dismiss). Lets you see exactly what the card looks like on demand.",
      "Already-open Calendar tabs now scraped: manifest content scripts only auto-inject on page load, so a Calendar tab you had open BEFORE reloading the extension was never scraped (you had to open a fresh window — exactly the reported bug). The background now injects the scraper into existing calendar.google.com tabs on install/startup via chrome.scripting.executeScript, guarded by a window.__zhlCalScraperLoaded flag so there's no double-injection / duplicate events.",
      "Parser robustness: the scraper previously only accepted event chips whose aria-label had a full time RANGE ('10:15 – 11:15am'). Many Calendar chips expose only a single start time ('10:15am'), so those produced zero events. The parser now accepts a single start time (assuming a 30-minute duration) in addition to ranges, and the chip pre-filter was loosened to any aria-label containing a clock time. Date is still REQUIRED from the aria-label (we never guess a day, to avoid firing reminders for the wrong date).",
      "Diagnostics: when a scrape parses zero events (or when you set window.__zhlCalDebug = true in the Calendar tab console), the scraper logs how many chips matched, how many had a time, how many parsed, and up to six sample aria-labels — so if a Calendar layout still isn't recognized, the exact format is one console line away.",
      "Note on the '0 upcoming events loaded' status: that means the scraper connected to the tab but didn't recognize any event chips. With the single-time support added here it should now populate; if it still shows 0, open the Calendar tab's DevTools console and share a '[ZHL Calendar Scraper] sample aria-labels' line so the parser can be tuned to your exact layout."
    ],
    sections: ["calendar-reminders", "calendar-events-scraper", "gmail-calendar-reminders"]
  },
  {
    version: "1.64.1",
    category: "improvement",
    headline: "Meeting Reminders — pivoted from ICS-feed polling to Calendar-tab scraping. Zillow Workspace has the per-user 'Secret address in iCal format' disabled, so the v1.64.0 setup flow had no usable URL to paste. The reminder card, snooze/dismiss UI, lead-time logic, and storage schema are all unchanged; only the data source changed. Keep a calendar.google.com tab open and reminders fire as before.",
    highlights: [
      "Root cause: corporate Google Workspace policy hides the per-user secret iCal URL (only the Public iCal URL is exposed, and using that would require making the entire calendar public — exposing borrower info). The ICS approach is dead for the LO's account. User chose 'scrape an open Calendar tab' as the alternative.",
      "New content script modules/calendar-events-scraper.js runs on calendar.google.com pages. It walks the rendered event chips (role=button + data-eventid for week/day views, role=gridcell for month view), parses each aria-label for a time range, a date, and a title via permissive regex, and writes the parsed events to chrome.storage.local under zhlCalEvents — exactly the shape the Gmail-side renderer already consumes.",
      "Multi-tab safe: each Calendar tab tags its scraped events with a per-tab id and only overwrites its own contributions on each pass. So having Calendar open in two browser tabs (e.g. different accounts) doesn't make the tabs fight each other — events from all open Calendar tabs merge into the same list. On beforeunload, the tab clears its own contributions so closing a Calendar tab doesn't leave stale events lingering.",
      "MutationObserver + 8-second backstop catches Calendar's frequent React re-renders; cross-midnight times wrap correctly; events more than 1 hour past their start time are pruned to keep the list lean.",
      "Setup card: the ICS URL field is replaced with a blue banner explaining the open-tab requirement, the rationale, and a 'Open Google Calendar in a new tab →' link. New live status line shows 'Calendar tab active · N upcoming events loaded' (green), 'no Calendar tab detected yet' (red), or 'last scrape N min ago — Calendar tab may be closed' (amber), updating every 5 seconds.",
      "background.js: the alarms-driven ICS poller is now a no-op. The ZHL_CAL_REFRESH_NOW message handler still answers (so Gmail-side refresh pings don't error), it just returns { skipped: true } now. The ICS parser code is kept in place as dead code for potential reuse if a personal-Google-account path is ever wired up.",
      "manifest content_scripts: added calendar.google.com/* registration for the new scraper module. No new permissions — calendar.google.com is covered by the existing <all_urls> host permission. Bumped 1.64.0 → 1.64.1.",
      "Setup-page ordering: moved the Meeting Reminders module card to position #2 (immediately after Loan Officer Profile, before VA Calc). It's the feature most likely to need ongoing tweaking (lead times, checking 'is my Calendar tab still open?'), so making it visible without scrolling matches how it gets used."
    ],
    sections: ["calendar-reminders", "gmail-calendar-reminders", "calendar-events-scraper"]
  },
  {
    version: "1.64.0",
    category: "new",
    headline: "New module: Meeting Reminders — the Outlook reminder window, recreated inside Gmail. A pop-up card slides into the corner before each meeting with Snooze and Dismiss buttons, read from your Google Calendar. Set it up once by pasting your calendar's private ICS address in the extension Setup page (no Google sign-in pop-up). Default reminders fire at 30 minutes AND again at 5 minutes before start, fully configurable.",
    highlights: [
      "One-time setup in Setup → Meeting Reminders: paste your Google Calendar 'Secret address in iCal format' (Calendar settings → your calendar → Integrate calendar) and optionally edit the lead times (default '30, 5' minutes). Both save automatically and stay on this Chrome profile only.",
      "Background poll: a chrome.alarms job fetches the private ICS feed every 5 minutes (and immediately when you save/change the URL). No OAuth — the secret token in the URL is the auth, and the extension's existing <all_urls> host access covers the fetch. Parsed upcoming events are cached in chrome.storage.local for the Gmail side to read.",
      "ICS parser handles real calendars: timezones via the browser's IANA database (DST-correct), recurring meetings (DAILY / WEEKLY+BYDAY / MONTHLY / YEARLY with INTERVAL, UNTIL, EXDATE) expanded across a ~26-hour look-ahead window, Google Meet link extraction for a Join button, and skips all-day and cancelled events. Recurrence is resolved by scanning only the ~2-3 candidate days inside the look-ahead window, so it stays fast regardless of how old the series is.",
      "Reminder card (Gmail content script): Outlook-style panel top-right listing every due meeting with its time, a live 'in X minutes' / 'X minutes ago' / 'In progress' label, a 📹 Join button when a Meet link exists, and per-meeting Snooze / Dismiss plus a footer Snooze-duration dropdown, Snooze all, and Dismiss all.",
      "Two-nudge lead-time model: the configured lead times are sorted descending and the 'active' reminder is the smallest one already reached. So a 30-minute reminder fires first; dismiss it and a fresh 5-minute reminder still fires at T-5 (separate instance). Reminders auto-expire 60 minutes after a meeting starts so nothing lingers.",
      "Snooze/dismiss state lives in chrome.storage.local, so it's consistent across every open Gmail tab and survives reloads; old entries are pruned 2 hours after the meeting passes. The card re-renders instantly on storage changes (e.g. dismissing in one tab clears it in the others).",
      "Caveat surfaced in Setup + walkthrough: Google can cache the private ICS feed for a few minutes, so a meeting created moments ago may lag; meetings scheduled in advance (the overwhelming majority) are unaffected.",
      "Feature key feature_calendarReminders (default on). Toggle in Setup. New content script modules/gmail-calendar-reminders.js + background poll block; no manifest permission additions were needed (alarms + <all_urls> already present)."
    ],
    sections: ["gmail-calendar-reminders", "calendar-reminders"]
  },
  {
    version: "1.63.36",
    category: "improvement",
    headline: "Zoho Booking watcher — removed the 5-second auto-fire countdown. The 'Booking detected' panel now waits for you to explicitly click 'Open Salesforce & paste' (or Cancel / ×) before anything happens, matching the button-only UX of the Appraisal Blast 'Send to all parties' panel.",
    highlights: [
      "Before: the booking-detected toast showed 'Open Salesforce & paste (5)' with a 1-second-per-tick countdown that auto-confirmed at 0. If the LO walked away or didn't notice the toast in time, the disposition note got logged automatically — fine when accurate, awkward when the LO actually wanted to ignore that detection.",
      "After: same panel, same blue 'Open Salesforce & paste' button — but no countdown, no auto-fire. The panel persists until the LO clicks the button (confirm) or Cancel / × (dismiss). Identical behavior to the Appraisal Blast bottom-right panel where clicking 'Send to all parties' is the only way to trigger work.",
      "Code changes: removed the COUNTDOWN_MS constant, the remaining/tick/setInterval block, and the (5) counter <span> inside the button label. Wrapped confirm + cancel in a single resolved=true latch so both paths idempotently remove the panel and fire their callback exactly once. Updated the file header comment to describe the button-only flow.",
      "Per-message dedup, daily-limit (10/day/LO), and the firingInThisTab guard are unchanged — all the safety rails that prevented misfire loops still apply, they just no longer have a 5-second timer pulling the trigger automatically."
    ],
    sections: ["gmail-zoho-booking-watcher"]
  },
  {
    version: "1.63.35",
    category: "bugfix",
    headline: "Walkthrough — Appraisal Blast now sorts to the TOP of the '✨ New features' section instead of the bottom. The section auto-sorts cards by the newest changelog version whose `sections` array references the card's HTML id, but the Appraisal Blast changelog entries used module filenames (gmail-appraisal-blast / sf-appraisal-blast / appraisal-blast-background) as section ids, none of which matched the card's id (appraisal-blast). With no matching changelog entry the card was treated as having no recency and fell to the bottom in DOM order.",
    highlights: [
      "walkthrough.js's populateNewFeatures() computes each card's recency via newestVersionFor(cardId), which scans changelog.js newest-first for the first entry whose `sections` array contains the card id. The convention is that the section id equals the card's HTML id (e.g. card id='pricing-exception-workflow' ↔ sections:['pricing-exception-workflow']).",
      "The Appraisal Blast card has id='appraisal-blast', but its changelog entries listed sections like ['gmail-appraisal-blast','sf-appraisal-blast'] — the underlying module filenames, not the card id. So newestVersionFor('appraisal-blast') returned null and the card sorted to the bottom.",
      "Fix: added 'appraisal-blast' to the sections arrays of the Appraisal Blast changelog entries (v1.63.27, .30, .33, .34). The newest of those (v1.63.34) is now the highest changelog version referencing the card, so it sorts above every other is-new card. Left the original module-filename section ids in place too — they're still accurate references to the underlying files.",
      "No walkthrough.html or walkthrough.js change needed — the sort logic was already correct, it just had nothing to match against."
    ],
    sections: ["walkthrough", "appraisal-blast"]
  },
  {
    version: "1.63.34",
    category: "bugfix",
    headline: "Walkthrough — Appraisal Blast now appears in the '✨ New features' section at the top of the walkthrough page. Was missing the `is-new` class on the feature div, so walkthrough.js's auto-clone (which copies every .feature.is-new card into the top section) skipped it.",
    highlights: [
      "extension/walkthrough.html: added the `is-new` class to the Appraisal Blast feature div (line 1148: `<div class=\"feature\" id=\"appraisal-blast\">` → `<div class=\"feature is-new\" id=\"appraisal-blast\">`).",
      "walkthrough.js scans the document on load for every .feature.is-new card and clones it into #new-features-host in document order. Adding the class is the only step needed — the clone is automatic, so the same Gmail-section card now also renders at the top of the page next to the other recent features (Pricing Exception Workflow, Print Buyer Worksheet, etc.)."
    ],
    sections: ["walkthrough", "appraisal-blast"]
  },
  {
    version: "1.63.33",
    category: "bugfix",
    headline: "Appraisal Blast — reverted the hidden minimized Salesforce window. It was causing 'Timeout waiting for element' failures because Lightning doesn't reliably render its global-search header in a minimized window, so the search button/input never appeared for the script to drive. Back to a normal visible Salesforce tab the LO can watch.",
    highlights: [
      "Root cause of the timeout: v1.63.31's chrome.windows.create({ state: 'minimized' }) successfully hid the window, but a minimized Chromium window doesn't lay out its DOM the way a visible one does — the global-search button and input in the Salesforce header weren't present/visible, so searchLoan()'s waitFor() for those elements ran out its 15s budget and threw 'Timeout waiting for element'. The earlier assumption that 'Chrome only throttles JS in unused tabs, not minimized windows' was wrong about layout — JS runs, but offscreen/minimized layout is deprioritized enough that the header controls never materialized.",
      "Fix: chrome.tabs.create({ url, active: true }) — a normal foreground tab in the LO's current window. The LO watches the search + Contact Roles scrape happen, then the tab auto-closes when the lookup finishes (success or error). Watching it is acceptable and actually reassures the LO that work is happening.",
      "Removed the now-unused popup-window plumbing (the win variable, the state-reassert setTimeout calls, the windows.remove teardown branch). Teardown is back to a simple chrome.tabs.remove(tab.id) in the finally block.",
      "If hiding the tab becomes a priority again later, the right approach is a visible-but-background tab (active: false in the SAME window) rather than a minimized window — that keeps layout intact while staying off the LO's active view. We had that in v1.63.29 and earlier; it worked but still showed in the tab strip, which is why this revert uses active: true for clarity that the operation is running."
    ],
    sections: ["appraisal-blast-background", "appraisal-blast"]
  },
  {
    version: "1.63.32",
    category: "improvement",
    headline: "Appraisal Blast — the appraisal PDF from the Reggora email is now auto-attached to the new draft. No drag-and-drop required: when you click 'Send to all parties', the script fetches every attachment from the source email, stashes it alongside the formatted body, and re-injects it as a real file on the new compose tab so the PDF is already attached when the draft opens.",
    highlights: [
      "Why not just fix drag-and-drop: cross-window Gmail-to-Gmail drag doesn't work in the existing gmail-drag-attachments module — its activeDragFile is module-scoped per content-script instance, so a drag from window A to window B never sees the file in window B's drop handler. Chrome also strips JS-constructed Files from dataTransfer.files at cross-window drop time, so the fallback path is empty too. Result: the destination compose body sees only the attachment filename as plain text and pastes that into the body. Auto-attach sidesteps the whole problem.",
      "How it works: gatherAttachments() on the source tab walks all [download_url] elements in the open Reggora email, parses Gmail's 'mime:filename:url' format (same parser as gmail-drag-attachments), fetches each blob with credentials:include (so Gmail's auth cookies tag along), base64-encodes, and returns { name, mime, b64, size } entries. The list is added to the existing chrome.storage.local stash key zhlAppraisalBlastPendingPaste alongside the HTML body.",
      "On the destination compose tab, the existing paste pipeline now also calls injectFilesIntoCompose() AFTER the HTML body verifies as pasted. The compose form's input[type=\"file\"] gets a fresh DataTransfer.files assignment + a synthesized 'change' event — Gmail treats this exactly like a paperclip-dialog file pick, so the attachment chip animates in normally.",
      "Compose-form lookup handles both popup compose (closest div[role=\"dialog\"] wrapper) AND fullscreen compose (which Appraisal Blast opens via ?fs=1 — no dialog wrapper, so we walk up to the nearest ancestor that owns an input[type=\"file\"]). Mirrors the gmail-drag-attachments helper.",
      "Per-attachment cap: 4 MB. chrome.storage.local has a 10 MB default quota; capping at 4 MB leaves headroom for the HTML body plus a few attachments. Reggora appraisal PDFs are typically 1–3 MB so this is comfortable in practice. Anything larger is logged with a console.warn and skipped — the LO would need to drag-and-drop manually for those (and we should look at that as a follow-up; an unlimitedStorage permission bump would lift the cap if it becomes a problem).",
      "Status bar copy updated: shows 'N attachments' or 'no attachments' as it gathers, so the LO can tell at a glance whether the PDF was picked up before the draft opens.",
      "Failure modes degrade gracefully: gather failure logs a warn and continues with zero files; per-file fetch/encode errors skip that file; the file inject runs even if the HTML verify never succeeded (so the LO at least gets the PDF attached and can Ctrl+V the body)."
    ],
    sections: ["gmail-appraisal-blast"]
  },
  {
    version: "1.63.31",
    category: "bugfix",
    headline: "Appraisal Blast — the Salesforce lookup popup was opening visibly in v1.63.30 despite the 'state: minimized' hint, because Chrome silently rejects state=minimized when width/height/left/top are also passed (per chrome.windows.create docs: 'cannot be combined with bounds'). Dropped the width/height params so the minimized state actually applies; window now stays collapsed in the taskbar throughout the lookup.",
    highlights: [
      "Bug: v1.63.30's chrome.windows.create call passed state: 'minimized' AND width: 480 / height: 360. Chrome's docs explicitly say minimized/maximized/fullscreen states cannot be combined with bounds — so Chrome either threw (sending us into the tabs.create fallback, which puts the SF tab in the LO's main window's tab strip) or silently ignored the state hint and opened a normal 480×360 popup. Either way, the LO saw the work happen live.",
      "Fix: removed width and height from the create options. Now passes only { url, focused: false, type: 'popup', state: 'minimized' } so Chrome can honor the state and pick its own default geometry. The popup never un-minimizes during the flow (no need to size it — Lightning renders into the off-screen DOM regardless).",
      "Added a console.log right after chrome.windows.create returns so the LO (or me, in future debugging) can confirm whether the minimized state landed. Also added an explicit console.warn on the tabs.create fallback path so it's clear which branch ran if the minimized window ever fails to open.",
      "Wrapped the post-create chrome.windows.update({ state: 'minimized' }) re-assert in a setTimeout(0) so it runs on the next tick — gives Chrome's window-state machine a beat to finish applying the create options before we stamp it again, instead of racing with the same call."
    ],
    sections: ["appraisal-blast-background"]
  },
  {
    version: "1.63.30",
    category: "improvement",
    headline: "Appraisal Blast — four upgrades in one push: (1) contacts are now correctly bucketed to TO/CC (role column was being misread as the contact name, so every recipient was getting dropped), (2) the second Reggora email variant 'Low appraisal valuation' is now recognized and parsed too, (3) the email body now renders as VPA-style HTML (Calibri body, ZHL-blue Georgia headings, framed highlight box with the dollar figures) instead of plain text, and (4) the Salesforce lookup runs in a minimized popup window so you don't watch it happen live in your tab strip.",
    highlights: [
      "Contact-role bug (TO/CC empty): the Contact Roles related-list grid has six columns (Item Number | Contact Name | Role | Phone | Email | Action). The previous positional fallback in sf-appraisal-blast.js scanned cells[1..3] looking for text without digits/@ — but cells[1] IS the contact name (e.g. 'James Hanny'), which has no digit prefix and no '@', so the fallback incorrectly returned 'James Hanny' as the role on every row. Bucketing then matched no rows to TO/CC and the compose opened with empty recipients. Fix: read column indices directly from the header row's aria-label='Role'/'Email' attributes, then index into each body row by that fixed position. Header-anchored is robust to row layout drift.",
      "Low-value email variant: SUBJECT_PATTERNS now accepts both 'Appraisal Submission Summary:' and 'Low appraisal valuation:' prefixes. parseEmail() branches on subject: standard email uses the structured 'Appraised value / Estimated value / Reconciliation/Report Condition / Low Value' lines; low-value email uses prose regexes for 'valued the property at $X' and 'Purchase Price is $Y' and sets lowValue='YES' from the subject (no Condition field in this variant). Address backup parse now also accepts 'Order Address: <addr> (...)' (the low-value email's address line).",
      "Condition phrasing: the SubjectToRepairs;SubjectToInspections case (semicolon-joined codes) now produces 'subject to repairs and inspections — see the report for the required items' instead of a single generic 'subject to repairs/completion' line. Splits on semicolons / commas, detects repairs / inspections / completion as separate tokens, joins them naturally ('repairs and inspections', 'repairs, inspections, and completion'). AsIs unchanged → 'as-is, so no repairs are required'. Unknown codes pass through verbatim.",
      "Pretty HTML body: new buildHtmlBody() emits the same visual language as the VPA email — ZHL logo at top, Calibri 14.5px body, Georgia bold ZHL-blue (#0E35C4) H1, a bordered highlight box with three labeled rows (Appraised / Purchase / Equity for celebration; Appraised / Purchase / Shortfall for low value). Celebration variant uses green (#16a34a) for the equity figure and 🎉 emoji on the headline; low-value variant uses amber (#D97706) on the appraised value and red (#b91c1c) on the shortfall. The condition line is shown only when condition data is present.",
      "HTML paste mechanism: mirrors gmail-vpa-paste.js exactly, but folded into gmail-appraisal-blast.js so no new manifest content_script entry is needed. After the click handler builds the HTML, it stashes the HTML+plain text under chrome.storage.local key 'zhlAppraisalBlastPendingPaste' (10-minute TTL), writes both to the clipboard (Ctrl+V fallback), then opens the Gmail compose URL with the plain body. The same module loads on the new compose tab, sees the pending paste, polls for the contenteditable compose body (up to 30s), and replaces the plain text with the HTML via document.execCommand('insertHTML'). Re-pastes up to 6 times across 3 seconds if Gmail's URL-driven plain fill overwrites our paste.",
      "Background tab visibility: chrome.tabs.create({ active: false }) was opening the SF tab inactive but still in the LO's main window's tab strip — they watched the whole search and Contact Roles scrape happen in a sibling tab. Switched to chrome.windows.create({ type: 'popup', state: 'minimized', focused: false, width: 480, height: 360 }) which opens an entirely separate window that starts minimized in the taskbar. Re-asserts state: 'minimized' twice (once right after open, once after the URL change to the Opportunity record) so it stays collapsed across the navigation. Falls back to the inactive-tab approach if windows.create fails (policy block on managed devices). Tear-down now closes the whole window rather than just the tab.",
      "Fingerprint for the auto-paste detector is a custom 'data-zhl-ab-html' attribute on the outer wrapper plus the Calibri font-family marker — distinct from the VPA email's '<h1>Congratulations' marker, so the two paste loops don't collide when the LO has both modules enabled and a pending paste from each.",
      "Time saved unchanged at ~6 min/appraisal, credited once per content-script load."
    ],
    sections: ["gmail-appraisal-blast", "sf-appraisal-blast", "appraisal-blast"]
  },
  {
    version: "1.63.29",
    category: "bugfix",
    headline: "Appraisal Blast — loan number was getting typed correctly but Salesforce never actually submitted the search. Synthetic KeyboardEvent('Enter') is not isTrusted, so Lightning's submit handler ignores it — the dropdown opens but never navigates to the results page, and the script timed out waiting for an Opportunity link that never appeared. Now drives the dropdown manually: either grabs a direct Opportunity match if LOP inlined it, or clicks the 'Show more results for <loan#>' link (always present when anything matches) to reach the full search results page.",
    highlights: [
      "Bug: after the native value setter + 'input' event populates the dropdown, the script dispatched a synthetic KeyboardEvent for Enter on the search input. Chrome marks programmatically-dispatched events as isTrusted=false, and Salesforce's search submit handler (a delegated Lightning listener) only fires on isTrusted=true. Result: the loan number sat in the input box, the dropdown showed 'Show more results for ZG...', and our 25s wait-for-Opportunity-link timed out.",
      "Fix: replace the synthetic Enter dispatch with manual dropdown navigation. After typing + 600ms wait for the dropdown to populate, race two paths: (a) any visible Opportunity-href anchor (LOP sometimes inlines the top hit as a direct dropdown option — grab it without clicking, saves a navigation) OR (b) any clickable element whose text starts with 'Show more results for' and contains the loan number — click it, which is what an LO would do manually, and which Lightning DOES respond to because the click event is on a real anchor/button with a real onClick handler (no isTrusted gate).",
      "Fallback: if neither a direct match nor the Show-more-results link appears within 8s, fall back to the original synthetic Enter dispatch + 25s wait. So a future LOP redesign that hides the dropdown link won't immediately break the feature.",
      "Both branches funnel into the same final step (waitFor an Opportunity-href anchor anywhere on screen) so the downstream URL-normalization and navigation logic in background.js stays unchanged.",
      "Source comment expanded to document the isTrusted constraint so a future maintainer doesn't reintroduce the synthetic Enter approach."
    ],
    sections: ["sf-appraisal-blast"]
  },
  {
    version: "1.63.28",
    category: "bugfix",
    headline: "Appraisal Blast — loan number was being typed into the WRONG Salesforce input. The header has two inputs next to each other (a left 'Search: All' object-type combobox + the right global search input), and the v1.63.27 selector was grabbing the LEFT combobox because it appeared first in DOM order and matched the broad 'input.slds-input, input[type=\"search\"], input[role=\"combobox\"]' selector. Now requires type=\"search\" AND skips role=\"combobox\" so we always land on the right input.",
    highlights: [
      "Bug: v1.63.27's selector was 'input.slds-input, input[type=\"search\"], input[role=\"combobox\"]' picking the first visible match. The left object-type combobox (id=combobox-input-NNN, type='text', role='combobox', aria-label='Search by object type') appears first in DOM and matches both .slds-input and role='combobox', so it always won. The loan number landed in the object dropdown ('Search: All') instead of the global search input, so Enter just filtered the object list and no result link ever appeared — the orchestrator timed out reading 'No loan record found'.",
      "Fix: prefer type=\"search\" without role=\"combobox\". The actual search input is type='search', placeholder='Search...', no role attribute. The left object combobox is type='text' AND role='combobox'. Two cheap discriminators that pick the right input deterministically.",
      "Fallback: if no type='search' input is found (layout drift), fall back to any visible input.slds-input WITHOUT role='combobox' — still excludes the object switcher.",
      "Source comment expanded to document both inputs and which selector targets which, so a future maintainer doesn't reintroduce the broad match."
    ],
    sections: ["sf-appraisal-blast"]
  },
  {
    version: "1.63.27",
    category: "new",
    headline: "New module: Appraisal Blast — when you open a Reggora 'Appraisal Submission Summary' email, a gold 'Send to all parties' button appears bottom-right. One click parses the email, looks up the loan's Contact Roles in Salesforce via a hidden background tab, and opens a Gmail compose draft pre-filled with TO/CC/Subject/Body. Nothing sends automatically — review and hit Send.",
    highlights: [
      "Detection: Gmail content script tabs the open thread's subject line and shows the panel only when the subject starts with 'Appraisal Submission Summary'. MutationObserver + 1.5s polling keeps the panel correctly attached / removed as the LO navigates between emails.",
      "Email parser pulls loan number (from subject '#ZG...' or body 'loan ZG...'), last name (from subject), property address (from subject before the first '('), appraised value, estimated/purchase value, reconciliation condition, and the explicit Low Value YES/NO flag.",
      "Background orchestrator opens a hidden Salesforce tab in the LO's session, drives the global search header (clicks the search button, types the loan number, presses Enter), captures the resulting Opportunity URL, navigates the hidden tab to it, asks the SF content script to scrape the Contact Roles 'View All' list, then closes the hidden tab. Progress updates relay back to Gmail so the LO sees what step we're on.",
      "Contact bucketing: TO = Borrower, Co-Borrower, Buyer's Agent, Transaction Coordinator. CC = Processor. Role matching is whitespace/punctuation tolerant ('Buyer's Agent', 'buyersagent', 'Buyer Agent' all match). Contacts with no email are skipped silently.",
      "Two body variants: congratulatory (with the immediate-equity figure if appraised > purchase) for normal appraisals; a low-value variant if Reggora flagged Low Value: YES or if appraised < purchase. Condition phrasing is mapped — 'As-is' → 'as-is, so no repairs are required'; 'Subject to ...' → 'subject to repairs/completion — see the report for the required items'.",
      "Signature: body ends with no hand-typed name. Gmail's own signature appends automatically when the compose window opens, so the feature works for any LO without per-user code changes.",
      "Files: extension/modules/gmail-appraisal-blast.js (Gmail panel + parser + orchestrator caller), extension/modules/sf-appraisal-blast.js (SF tab driver — search + Contact Roles scrape), background.js orchestration block (lookupContacts handler + sfProgress relay), extension/images/appraisal-blast.svg, setup.html + setup.js + walkthrough.html feature entries, FEATURE_KEYS arrays. Both Gmail and SF host_permissions already existed, no manifest permission expansion needed.",
      "Time saved: ~6 minutes per appraisal vs manually opening Salesforce, pulling each role's email, composing the message, and looking up the equity math. Credited once per content-script load so re-clicks don't double-count.",
      "Feature key: feature_appraisalBlast (default on for new installs, like every other ZHL module). Disable via Setup if not needed. The Salesforce content script gates on the same key so the SF tab driver never runs on installs that have the feature off."
    ],
    sections: ["gmail-appraisal-blast", "sf-appraisal-blast", "appraisal-blast"]
  },
  {
    version: "1.63.26",
    category: "improvement",
    headline: "Loan Comparison PDF page 2 — monthly cost breakdown now shows every PITIA component on its own line (P&I, MI, taxes, insurance, HOA, other) by scraping the 'Payment breakdown' popup that opens when you click the Monthly P&I / PITI value on each scenario card. The prior catchall 'MI, taxes, insurance & HOA' row is kept only as a fallback for when the popup scrape can't read the components.",
    highlights: [
      "New scrape pipeline mirrors the existing closing-costs popup pattern: per selected scenario, click the StyledTextButton next to 'Monthly P&I / PITI' → wait for the dialog whose <h4> reads 'Payment breakdown' → pair each leaf <span> label with the next leaf <span> value (label-keyed lookup so the APR / Interest-rate header row at the top of the dialog is naturally skipped) → close the dialog → next scenario. Scraping is positional rather than class-based so LOP's styled-component class-suffix churn won't break it.",
      "Scraped fields: firstMortgagePi, homeownersInsurance, propertyTaxes, mortgageInsurance, hoa, other, totalMonthlyPayment. Each is parsed via the same parseMoney helper used for the rest of the scrape.",
      "Page 2 rendering: when the scrape produced ANY of P&I / taxes / insurance / MI, the breakdown table shows one row per component. P&I, property taxes, and homeowner's insurance always render (core PITIA). Mortgage insurance, HOA, and Other are hidden when 0 to avoid empty noise — so a 20%+ down conventional borrower with no HOA sees just P&I + taxes + insurance + PITIA total. The fallback two-row layout (P&I + 'MI, taxes, insurance & HOA' catchall + PITIA total) ships only when the popup scrape returned nothing.",
      "Both PDF flows updated: onComparisonPdfClick (standard Loan Comparison) and onGrantPdfClick (2% Grant variant) now run scrapePaymentBreakdown after scrapeClosingDetail for each card. Both wrap the call in a try/catch so a single-card scrape failure degrades gracefully to the fallback row rather than aborting the whole PDF.",
      "Defensive: scrapePaymentBreakdown closes any stale Payment-breakdown dialog before opening a new one (mirrors scrapeClosingDetail), waits up to 5s for the dialog to appear, and up to 2s for it to close — so back-to-back scenarios don't trip over a dialog that didn't dismiss in time.",
      "Source-comment housekeeping in the page-2 derivation comment so future maintainers understand the new data flow (popup scrape, not just piti − pi math)."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.63.25",
    category: "improvement",
    headline: "Loan Comparison PDF — relabeled 'PITI' → 'PITIA' on both pages, because LOP's monthly figure already bundles HOA dues into the value. The previous 'PITI' label was technically wrong whenever the borrower had any HOA in the scenario; PITIA (Principal + Interest + Taxes + Insurance + Association dues) is the truthful name for what LOP is actually showing.",
    highlights: [
      "Page 1 big-row label: 'Estimated monthly cost (PITI)' → 'Estimated monthly cost (PITIA)'.",
      "Page 2 breakdown total row: same relabel.",
      "Page 2 catchall sub-line: was 'Taxes, insurance & escrows' (vague). Now reads 'MI, taxes, insurance & HOA' — spells out exactly what's inside the derived value (PITIA − P&I) so the borrower can match the number to the components their LO discussed.",
      "Source-comment housekeeping: the module header, page-2 derivation comment, and styling comment all updated from PITI to PITIA. Remaining 'PITI' mentions are intentional and reference LOP's own row label 'Monthly P&I / PITI' (the scrape selector and an explanatory note about why we pull the right-hand value).",
      "Not done in this pass: line-by-line breakdown of MI / taxes / insurance / HOA as separate sub-rows. The saved-scenario card only exposes the combined PITIA — separating the four would require scraping an additional LOP panel or popup. Ping me if you want that as a follow-up and I'll dig into the right-rail loan-details panel for the components."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.63.24",
    category: "improvement",
    headline: "Lead-clone PA Contact ID auto-paste now also fires when you clone an Opportunity (loan) — Salesforce recently started exposing the PA Contact ID field on the Opportunity layout, AND the Opp clone action on ZHL's layout creates a NEW LEAD (not a new Opp). The extension now bridges those two facts so the PA Contact ID carries from the source loan into the new lead automatically, no manual paste required.",
    highlights: [
      "Source-side capture: the Clone-button watcher now fires from BOTH /lightning/r/Lead/ AND /lightning/r/Opportunity/ pages. Detection broadened to match (a) any button whose name ends in '.Clone' (covers Lead.Clone, Opportunity.Clone, and any future *.Clone quick actions) and (b) any 'Clone'-text button inside a target-selection-name attribute containing 'Clone' (covers ZHL's custom Opp-to-Lead clone flow). Page-context check scopes the broad match so we never fire on unrelated record pages.",
      "Storage shape: stash now records { sourceRecordId, sourceType: 'Lead' | 'Opportunity', paContactId, stashedAt } instead of the old sourceLeadId. The auto-paste handler reads either field (sourceRecordId OR legacy sourceLeadId) so an in-flight clone stashed by the previous version still de-dupes correctly during the rollout window.",
      "Destination side unchanged: the auto-paste still triggers on the next Lead page navigation only. When source was an Opportunity, the source-record de-dup check is naturally harmless because Lead IDs start with 00Q and Opp IDs with 006, so they never collide.",
      "Confirmation-modal banner unchanged — same c-clone-request injection, same 'PA Contact ID (in case the paste did not work)' fallback line, same full-width banner with the collapsed empty 3-of-12 column and inner-container auto height. Works the same on both Lead and Opportunity confirm modals because the c-clone-request component is shared."
    ],
    sections: ["sf-clone-pa-contact-id"]
  },
  {
    version: "1.63.23",
    category: "bugfix",
    headline: "Max Affordability pill, fix #3 — three concrete bugs surfaced from a DOM dump of the manually-expanded Eligibility details row. The redesigned LOP page uses TITLE CASE labels ('Monthly Income' vs the old 'Monthly income') AND <p> tags instead of <span> tags for both labels and values, AND v1.63.22's 'click 6 ancestors at once' approach was cancelling itself out. All three fixed.",
    highlights: [
      "Bug 1 (case-sensitive walk-up): findEligibilityRow's text matcher used /Monthly income/.test(t) && /Credit score/.test(t) — case-sensitive. The redesigned eligibility row uses 'Monthly Income' / 'Credit Score' (capital I/S), so the matcher never recognised the expanded row even when the LO manually expanded it. Added /i flag.",
      "Bug 2 (wrong cell tag): readEligibilityRow queried row.querySelectorAll('span, button'), but the new DOM uses <p> tags for both labels AND values. Even if the walk-up matched, the cell iteration would find zero label/value pairs and income/liabilities would stay NaN. Selector now accepts 'p, span, button' to support both the new in-page row (all <p>) and the older side-panel layout (<span> labels + <p> values).",
      "Bug 3 (multi-ancestor click cancels itself): v1.63.22 fired the full pointer-event sequence on SIX label-ancestors in a tight loop. If two ancestors both respond to the click (inner toggle + an outer delegated handler), the section toggles open→closed→open→closed and lands back where it started. Now tries ONE label-ancestor per scan tick (depth 0→5). A successful expand on any tick stops further attempts because the walk-up finds the pill row and returns before we re-enter the expand block.",
      "End result: when the LO loads the redesigned Pricing & Scenarios page with Eligibility details collapsed, the extension tries depth-0 click first tick, depth-1 next tick (~2s later via the 2-second scan timer), etc., until the right ancestor's React onClick fires. Once expanded, the existing pipeline reads income/liabilities/etc, computes Max Affordability, and renders the pill row as before."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.63.22",
    category: "bugfix",
    headline: "Max Affordability pill, take two: v1.63.21's auto-expand click missed the React handler. Now walks up multiple ancestors of the 'Eligibility details' label and fires the full pointer/mouse event sequence (pointerover→mouseover→pointerdown→mousedown→pointerup→mouseup→click) on each — same pattern that fixed the kx framework buttons in the Zoho booking paster.",
    highlights: [
      "Symptom on v1.63.21: section stayed collapsed and the pill never appeared. The single .click() on the inner flex was firing but React's onClick handler (which lives on a different ancestor in LOP's styled-component-nested DOM) wasn't being triggered. Plain .click() doesn't always cross the pointer-event-gated handlers some styled-component libraries install.",
      "Fix: replaced the single .click() with a fullClickSequence() that dispatches pointerover, pointerenter, mouseover, mouseenter, pointerdown, mousedown, pointerup, mouseup, then .click() on each of the inner-most → outer-most ancestors (6 levels deep). Whichever ancestor actually owns the React onClick handler will fire correctly. Once expanded, the existing scan loop picks up the now-visible Monthly income / Credit score data on the next ~500ms tick and renders the Max Affordability pill as before."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.63.21",
    category: "bugfix",
    headline: "Max Affordability pill is back on the redesigned LOP Scenarios page. LOP changed the Eligibility header text case ('Eligibility Details' → 'Eligibility details') AND collapsed the section by default — the pill row our estimator reads from wasn't in the DOM until expanded.",
    highlights: [
      "Symptom: after LOP's Scenarios page redesign, the Max Affordability pill (the small green pill that shows the max purchase price that pushes back-end DTI to the cap for each loan program) silently stopped appearing. The Recommended Scenarios AI section and the Budget Preference panel are the new prominent surface; the Eligibility details section is collapsed by default and the Monthly income / Credit score / Liabilities pills only render when expanded.",
      "Fix #1: case-insensitive label match. findEligibilityLabel() now matches /^eligibility details$/i so both the old 'Eligibility Details' and new 'Eligibility details' spellings work.",
      "Fix #2: auto-expand the collapsed section once per page load. If the pill row can't be located after the label is found, the estimator clicks the chevron/header container exactly once to expand the section, then lets the next scan find the data normally. A flag prevents repeated clicking — if the LO deliberately re-collapses the section, the module respects that and won't fight them.",
      "Diagnostic log in DevTools console when auto-expand fires, so future regressions are easier to spot."
    ],
    sections: ["dti-max-estimator"]
  },
  {
    version: "1.63.20",
    category: "bugfix",
    headline: "Zoho Booking auto-log: stops getting stuck at 'Waiting for the disposition modal to finish loading…' when the lead is already open in Salesforce. Removed the circular Save-button-must-be-enabled check, broadened the Save selector, added diagnostic logging when the wait times out.",
    highlights: [
      "Symptom: when the auto-log focused an existing Salesforce tab that was already on the right lead, the overlay sat for 30 seconds at 'Waiting for the disposition modal to finish loading…' and then warned 'Communication Type / PA Notes / Save not all present and visible'. Same lead worked fine on a fresh navigation.",
      "Cause #1 (circular check): waitForDispositionReady required Save to be NOT aria-disabled before proceeding. But Salesforce disables the Save button until the form has been touched — and the only way to touch it is to do our paste. On a fresh navigation Save was apparently enabled long enough for the check to pass; on an already-loaded lead it stayed disabled and the wait spun forever. Removed the disabled check.",
      "Cause #2 (brittle selector): the Save button selector required the c-dispositionmodal_dispositionmodal LWC scoping attribute. That prefix is generated by the LWC compiler and can shift across recompiles. Switched to scoping the Save lookup via findDispositionContainer() and matching any visible button.slds-button_brand with text/title 'Save'.",
      "Diagnostic upgrade: the wait now tracks which specific element it's still missing (Email button / PA Notes / Save / zero-width) and surfaces it both in the DevTools console warning AND in the LO-facing toast — so a future timeout tells us exactly what didn't show up. Timeout reduced from 30s to 15s; if the modal isn't ready by then, waiting longer doesn't help and the LO shouldn't sit through it.",
      "Toast also now suggests refreshing the lead and re-running the booking from Gmail when the disposition modal doesn't finish loading."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.19",
    category: "bugfix",
    headline: "Task Bulk Delete: new 'Initial disclosures' task rows were rendering misaligned in the Awaiting Borrower table because they don't carry a delete button, so the module was inserting the bulk-select column header but not a corresponding cell on those rows. Now adds an empty placeholder cell so every row has the same column count as the header.",
    highlights: [
      "Symptom: with the extension enabled, the 'Initial disclosures' task rows in the Awaiting Borrower section appear shifted one column to the left of all the other rows — Task name lines up under Toggle, Assigned-to lines up under Task name, etc. Without the extension, all rows align correctly.",
      "Root cause: when the bulk-select column is added, the module gives every deletable row a checkbox <td>, but skipped non-deletable rows entirely. The header gained an extra <th> for the column, so deletable rows had N+1 cells and non-deletable rows had N cells — visual shift on the non-deletable ones.",
      "The 'Initial disclosures' task type is one LOP recently added to the Awaiting Borrower table. Unlike Proof-of-X tasks, it isn't manually deletable, so it has no data-cy=\"delete-task-btn\" button. The module's old skip-rows-without-a-delete-button check was correct for the checkbox itself (we still don't add a real checkbox to a row that can't be bulk-deleted) but missed the column-count consequence.",
      "Fix: non-deletable rows now get an empty placeholder <td> with a data-zhl-*-checkbox-placeholder attribute, so column counts match the header. The select-all toggle still only fans out to real checkbox <input>s, so non-deletable rows don't get accidentally selected."
    ],
    sections: ["task-bulk-delete"]
  },
  {
    version: "1.63.18",
    category: "improvement",
    headline: "Removed the 2% Grant PDF button (the underlying ZHL 2% Grant program has been sunset). Intro Email now substitutes the configured insurance-agent pronouns into legacy customized templates that still contain literal 'he/she' / 'her/him' hedges — no more manual Reset required.",
    highlights: [
      "2% Grant PDF retired: the button next to ZHL Comparison PDF no longer injects. Eligibility logic and rendering branch can come back as a one-commit revert if the program ever returns — kept in source for now. Setup card and walkthrough copy updated to drop the Grant mention. Stale Grant buttons from older install versions are cleaned up on next render.",
      "Pronoun fallback for legacy templates: customized intro_body_html_tmpl values saved before v1.61.3 still contain literal 'she/he' and 'her/him' hedge text — the v1.61.3 pronoun placeholders ({IA Pronoun Subject} / {IA Pronoun Object}) only get substituted if the template uses them. substituteAll now runs a second pass that maps the literal pronoun pairs onto the configured pronouns: 'she/he' or 'he/she' → subject pronoun, 'her/him' or 'him/her' → object pronoun. Capitalized variants ('She/He' at the start of a sentence) preserve the capital. Word boundaries protect the substitution from clobbering unrelated text."
    ],
    sections: ["loan-comparison-pdf", "sf-intro-email"]
  },
  {
    version: "1.63.17",
    category: "bugfix",
    headline: "Send VPA Email + Send Intro Email: fix the auto-paste fingerprint that was bailing on the plain-text URL fallback. The HTML body now actually lands every time.",
    highlights: [
      "Symptom: clicking Send VPA Email (and sometimes Send Intro Email) opened Gmail with the plain-text body in the URL — and the formatted HTML never replaced it. The compose body stayed plain text, no Zillow Home Loans header, no <h1> Congratulations, no bullet styling, no Borrower Information table.",
      "Root cause: gmail-vpa-paste.js's looksLikeFormattedPaste fingerprint was checking for the strings 'Congratulations' and \"What's Next\" anywhere in the compose body's innerHTML. Those words ALSO appear in the plain-text URL fallback body Gmail fills from &body=. So when the paster ran its verify check after Gmail's URL-driven body fill landed, it saw the plain text, said 'looks like our paste worked!', and bailed without ever inserting the HTML. Same bug existed in gmail-intro-paste.js.",
      "Fix: switched both fingerprints to check for HTML STRUCTURAL markers that can only exist in the formatted body — never in plain text. VPA: <h1>Congratulations OR 'font-family: Calibri'. Intro: <table> wrapping 'Borrower Information' OR 'font-family: Calibri'. The PE Workflow paster already used this structural pattern (<table> + 'Pricing comparison') and was unaffected — that's why PE Email never regressed.",
      "First-time vs returning behavior: this also explains the 'works sometimes' reports. On a fast Gmail load, our HTML paste landed before Gmail's URL-body fill, the verify saw the HTML, all good. On a slow Gmail load, Gmail's URL-body fill landed first, our paste fired, then a re-render reverted to URL body, the verify saw the URL body's text, decided everything looked fine, exited. With the structural check the paster will keep retrying for up to 3 seconds until real HTML is in the body."
    ],
    sections: ["sf-vpa-email", "sf-intro-email"]
  },
  {
    version: "1.63.16",
    category: "milestone",
    headline: "🎉 Product has shipped the 2-1 Buydown calculator NATIVELY in LOP — second feature to make the full LO-builder → Product validation → native shipment round trip. The extension's buydown-calc module is retired in celebration.",
    highlights: [
      "Year 1 / Year 2 / Year 3+ payment calc, buydown cost, and closing-cost impact are now built into the Loan Officer Portal natively. Every LO at ZHL gets the feature with no install required. This module was the prototype that validated the design; with native parity in production, the extension stays out of LOP's way.",
      "buydown-calc.js is permanently disabled in this release — the module short-circuits at load time with an early return and never injects its scenario-card buttons. The full source is preserved in the repo so the implementation history remains visible. Setup card and walkthrough both surface a celebratory '✓ Shipped natively · Product' badge in place of the old toggle / feature card.",
      "Second feature to make the round trip — Scenario Sort (v1.62.0) was the first. Direct proof that the LO-builder pattern is becoming a repeatable flywheel at ZHL: LOs build, Product validates, Product ships natively, the extension retires and celebrates."
    ],
    sections: ["buydown-calc"]
  },
  {
    version: "1.63.15",
    category: "improvement",
    headline: "Zoho Booking auto-log: re-enabled the per-messageId dedup and 10/day per-LO daily limit that were temporarily disabled for testing in v1.63.5. The flow is verified working end-to-end now, so the safety rails are back on.",
    highlights: [
      "Per-messageId dedup: chrome.storage.local key zhlZohoBookingSeenIds tracks the last 200 Gmail messageIds we've processed. The same Zoho booking confirmation email cannot trigger an auto-log twice — opening or refreshing the same email re-detects the booking but the dedup check short-circuits before the confirmation toast appears.",
      "Daily limit: chrome.storage.local key zhlZohoBookingDailyCount tracks how many auto-logs fired per LO per day (10/day cap). Catches runaway loops if detection ever misfires on a non-Zoho email — the watcher quietly stops after 10 fires and resumes the next day.",
      "Both keys are now written to on every successful auto-log, same as v1.63.0 originally specified."
    ],
    sections: ["gmail-zoho-booking-watcher"]
  },
  {
    version: "1.63.14",
    category: "bugfix",
    headline: "Zoho Booking auto-log: stop opening a brand-new Salesforce tab when one is already open. The service worker is now the sole authority for tab handling, with a broad fallback query so an existing tab is always reused.",
    highlights: [
      "Root cause: the Gmail watcher had a window.open() fallback that fired whenever the sendMessage callback got a falsy response. In MV3 that callback frequently fires with chrome.runtime.lastError set even when the service worker DID successfully focus the existing Salesforce tab — so both happened: the SW focused the existing tab AND the watcher popped a redundant blank tab that stole focus, landing the LO on a new tab instead of their open Salesforce tab.",
      "Fix #1: removed the in-callback window.open fallback. The watcher now only opens a tab directly in the synchronous catch block (extension context genuinely invalidated, where the SW could not have run at all). The SW handles focus-existing-vs-create-new for every other case.",
      "Fix #2: hardened the SW handler. If the URL-filtered chrome.tabs.query returns nothing (it can miss on discarded/unloaded tabs), it now does a broad query of all tabs and filters by Salesforce host client-side. It also prefers an already-active SF tab, then the most recently accessed one. Added the 'tabs' permission so the broad query reliably populates each tab's url.",
      "Net effect: if any Salesforce tab is open anywhere, the auto-log reuses it. A new tab is created only when no Salesforce tab exists at all."
    ],
    sections: ["gmail-zoho-booking-watcher", "sf-zoho-booking-paster"]
  },
  {
    version: "1.63.13",
    category: "bugfix",
    headline: "Zoho Booking auto-log: fix duplicate save (save was firing twice from one click sequence) and switch save verification from Note History row count (wrong panel — never updates here) to PA Notes textarea clearing + success toast.",
    highlights: [
      "Duplicate save fix: fullClickSequence() was dispatching a 'click' MouseEvent in its mouse-event loop AND calling .click() separately — two click events fired, two saves committed, two identical disposition entries appeared. Removed 'click' from the buildup loop; .click() is the only thing that triggers the actual click handler now. The buildup events (pointerover, pointerenter, mouseover, mouseenter, pointerdown, mousedown, pointerup, mouseup) prime the kx ripple framework, then .click() does the work exactly once.",
      "Save verification fix: the disposition modal's own <c-disposition-note-history> section doesn't reflect newly-saved notes — those go to a different activity panel on the lead. So v1.63.10–v1.63.12's row-count check was guaranteed to time out, and v1.63.12's 20-second wait made the overlay sit there forever. New approach: snapshot the PA Notes textarea value before clicking Save (must be non-empty), then wait for it to clear OR for a Salesforce success toast. Salesforce resets the form on a successful save, which empties the textarea — that's a reliable in-page signal that the save round-tripped through the backend. Timeout reduced to 10 seconds.",
      "False-positive guard: the textarea-cleared signal only counts if the textarea actually HAD content at save-click time. An already-empty textarea (which would happen if our PA Notes write failed earlier) doesn't false-positive as success."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.12",
    category: "bugfix",
    headline: "Zoho Booking auto-log: stop showing the success toast when the disposition didn't actually persist. Wait for the disposition modal to be FULLY hydrated by LWC before interacting, make Communication Type Email a hard requirement (no proceeding if the click doesn't take), and only trust the Note History row count growing as the save-succeeded signal.",
    highlights: [
      "Root cause of intermittent failures: the LO's observation that it 'worked once and that one time it visibly scrolled / pasted / saved' pointed at a hydration race. The disposition modal's DOM is present quickly, but LWC takes another beat to wire up its reactive system. v1.63.10 was finding elements early and firing clicks/value sets before the component was actually listening — so the events looked successful from our side but never reached LWC's internal state. Form was empty when Save fired, save was rejected, but my fallback signals false-positived.",
      "Hydration wait: new waitForDispositionReady() that requires all THREE critical elements (lightning-button.button-email, PA Notes textarea, disposition Save button) to be present, visible, and not aria-disabled together — up to 30s. Then a 1500ms settle buffer to let LWC finish wiring listeners. Only then do we start interacting.",
      "Email selection is now mandatory: if the lightning-button's variant attribute doesn't flip from 'neutral' to 'brand' after the click sequence, the paster halts the flow instead of proceeding into a save attempt that would fail validation. Halt surfaces a clear reason in the warning toast.",
      "PA Notes commit retry: after the initial write, if ta.value doesn't match the wanted text, retry the full write (host property + execCommand + composed events) up to 3 times with progressively longer waits (400ms, 600ms, 800ms). Logs each attempt's state to the console.",
      "Save verification narrowed to Note History row count ONLY: removed v1.63.10's PA-Notes-cleared and SF-toast fallback signals — both were false-positive prone. Now only a new row in <c-disposition-note-history> counts as success. Wait extended to 20 seconds for the backend save round-trip.",
      "Failure messaging is more specific too: 'no new row appeared in Note History within 20 seconds — the disposition was NOT persisted' plus the likely cause (Communication Type or LWC state), so the LO knows the auto-log truly failed instead of seeing a phantom success."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.11",
    category: "improvement",
    headline: "MOSS Request from Salesforce moved to Coming Soon while the Work Discovery intake endpoint is being scoped. The button no longer injects on Salesforce action ribbons; the Setup card and walkthrough both surface a 'Coming Soon' banner instead.",
    highlights: [
      "Module behavior: sf-moss-request.js now short-circuits at load time — no button is added to Salesforce Lead / Contact / Opportunity action ribbons, no chrome.storage.local reads or writes. The full v1 implementation is preserved below the early return for the v2 build (single-commit re-enable).",
      "Setup card: previous toggle card replaced with an amber 'Coming Soon' card explaining what the feature will do and what it's blocked on (the Work Discovery LO-side task-intake endpoint). When the endpoint is live, flipping it back here re-enables for every install with no extension reinstall needed.",
      "Walkthrough: new 'Coming Soon' feature card (#sf-moss-request) added to the Salesforce section with an amber 'COMING SOON' badge, an SVG mockup of the request modal, and a description of the seven request types being scoped. New CSS class .feature.is-coming-soon styles it differently from .feature.is-new — and importantly, the 'What's new' section's auto-clone logic only picks up .is-new, so this Coming Soon card doesn't appear in the top-of-page new-features carousel."
    ],
    sections: ["sf-moss-request"]
  },
  {
    version: "1.63.10",
    category: "bugfix",
    headline: "Zoho Booking auto-log: Communication Type Email click wasn't actually selecting Email (the disposition was saving with default Call or empty Type), and the v1.63.9 save verification was reading false positives. Fixed both with the full pointer event sequence and verifying the new disposition lands in Note History.",
    highlights: [
      "Root cause #1 (Communication Type): the Email button is a <lightning-button> with class=\"button-email\" — the inner <button> uses Salesforce's 'kx' interaction framework (kx-scope, kx-type=\"ripple\"). A plain .click() looks fired but the LWC component doesn't register it as a real selection — the variant stays \"neutral\" instead of flipping to \"brand\". Same problem as the Enter key issue we hit on search.",
      "Fix #1 (full click sequence): new fullClickSequence() helper that dispatches pointerover→pointerenter→pointerdown→pointerup→mouseover→mouseenter→mousedown→mouseup→click at the element's center coordinates, then calls .click() as a backup. This is what the kx framework expects from a real user. After clicking, the paster reads the lightning-button host's variant attribute back — if it's still 'neutral' after two attempts (inner + host click), we know the click didn't take and the paster proceeds with Call selected instead of falsely claiming Email is set.",
      "Root cause #2 (save verification): v1.63.9 checked for an SF 'saved' toast or the PA Notes textarea clearing. Both were false-positive prone — other toasts can match /saved/, and textarea clearing can happen for reasons other than save success.",
      "Fix #2 (Note History row count): on the disposition page the LO pasted, saved dispositions land in <c-disposition-note-history> as new <tr> rows. The paster now snapshots the row count before clicking Save and waits for it to grow after — that's the strongest possible signal that the disposition actually persisted. Falls back to PA Notes clearing and the SF toast check only if the Note History row count check is inconclusive.",
      "Save click also uses fullClickSequence() now, in case Salesforce's Save handler is also gated on the kx interaction framework rather than just a plain click."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.9",
    category: "bugfix",
    headline: "Zoho Booking auto-log: 'Save' toast was firing even when nothing actually persisted to the Activity tracker. Now scopes the Save button + Communication Type click to the disposition modal subtree, then verifies the save with a positive signal (SF success toast OR the form clearing).",
    highlights: [
      "Symptom: paster reported 'PA Note saved' but the Activity tracker showed no new disposition entry. The success toast was firing on a click that didn't actually persist anything.",
      "Root cause: my Save selector was button.slds-button_brand[title=\"Save\"] anywhere in the document, plus the Communication Type 'Email' click matched the first element with text 'email' — both could land on the wrong target (record-edit Save, the Email field label in Borrower Information, etc.), and a click on the wrong button silently does nothing.",
      "Fix #1 — disposition container scope: new findDispositionContainer() that looks for elements carrying the LWC scoping attribute c-dispositionmodal_dispositionmodal (or the logoutcome variant) and walks up to the lowest ancestor wrapping both the PA Notes textarea and the Save button. Save button + Communication Type Email click now scope to this container's subtree first.",
      "Fix #2 — save verification: after clicking Save, wait up to 5 seconds for a positive signal: (a) a Salesforce success toast that says 'saved' / 'success' / 'created' / 'logged' (and isn't an error/required-field toast); OR (b) the PA Notes textarea cleared (the disposition modal usually resets on a successful save). If neither shows up, return ok:false with a 'no success indication appeared, check Activity timeline' reason so the LO knows to verify manually.",
      "Diagnostic logging: paster now logs the actual Save button element it's about to click so the next console capture will tell us exactly what was clicked if something still misses."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.8",
    category: "improvement",
    headline: "Zoho Booking auto-log: added a greyed-out progress overlay on the Salesforce tab during the auto-log run, matching the LOP File Copy / SMS Mark All Read pattern.",
    highlights: [
      "Same translucent-white veil + blue spinner + status message UX as the LOP File Copy and SMS Mark All Read overlays. Greys out the page so it's obvious automation is running and prevents the LO from accidentally clicking into Salesforce while the script is still driving things.",
      "Status line updates per phase: 'Searching Salesforce by contact phone…' → 'Opening lead record…' → 'Opening Call Details tab…' → 'Setting Communication Type to Email…' → 'Filling PA Notes and saving…'. Hidden on success, error, or any early return.",
      "Overlay only paints on the Salesforce tab — Gmail stays clickable since the watcher's role is finished as soon as it stashes the payload and pings the service worker."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.7",
    category: "bugfix",
    headline: "Zoho Booking auto-log: PA Notes textarea was being written to but LWC's reactive state never saw the change — disposition got saved with an empty note. Fixed by setting the <lightning-textarea> host's value property, dispatching composed events, and scrolling so the LO can see it.",
    highlights: [
      "Symptom: lead opened, disposition saved (the save toast appeared), but the PA Notes field was empty in the record. The synthetic input/change events on the inner <textarea> never reached LWC's reactive state, so when the save handler read the component's `value` property it got the empty initial value.",
      "Fix #1 — host property write: the inner <textarea> lives in the shadow root of a <lightning-textarea> custom element. The component stores the reactive value on the host element, not the inner textarea. The paster now walks up across shadow-root boundaries to find the host and sets `host.value = noteText` directly. LWC propagates that into the inner textarea on its own re-render.",
      "Fix #2 — execCommand + composed events: still drive the inner textarea too (focus, select all, document.execCommand('insertText'), then dispatch InputEvent('input', {composed: true, inputType: 'insertText'}) + change with composed:true so the events cross shadow boundaries and reach any listeners on parent components). Belt and suspenders.",
      "Fix #3 — verification log: after the writes, the paster reads back ta.value and logs a warning to the console if it doesn't match the wanted text, including the host's value and whether a host was found. So if it still misses on the next test we can see exactly which path failed.",
      "Fix #4 — scrollIntoView({block:'center'}) on the textarea before writing so the LO can watch it fill in. Useful during the rest of the testing pass."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.6",
    category: "bugfix",
    headline: "Zoho Booking auto-log: lead-link selector was looking for /lightning/r/Lead/ in the href, but Salesforce uses generic record IDs (e.g., /lightning/r/00Qa.../view) — selector never matched. Also the link has target=\"_blank\" so .click() was opening a new tab. Fixed both.",
    highlights: [
      "Symptom: search executed, results page loaded (recommended result Quentin Goodwin visible), but the paster reported 'No matching Lead link found in search results' and copied the note to clipboard for manual pasting.",
      "Root cause #1: my selector required a[href*=\"/lightning/r/Lead/\"]. Salesforce's actual record-link href is /lightning/r/<recordId>/view — no /Lead/ segment. The Aura class name forceOutputLookup and data-refid=\"recordId\" attribute are what identify these links across all object types.",
      "Fix #1: new three-strategy lookup. (a) exact title-attribute match on a.forceOutputLookup[title] / a[data-refid=\"recordId\"][title] — most reliable since SF sets title to the record's display name. (b) textContent exact/substring match on the same anchors. (c) first-name fallback. All run with the shadow-DOM-piercing helper.",
      "Root cause #2: the link carries target=\"_blank\". .click() respects that — it would open the lead in a brand-new tab, not navigate the current one.",
      "Fix #2: link.removeAttribute('target') before clicking. Plus a 3.5-second nav check after the click — if the URL didn't change, fall back to location.href = link.href to force the navigation. Salesforce's router intercepts the assignment and SPA-routes correctly either way."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.5",
    category: "improvement",
    headline: "Zoho Booking auto-log: temporarily disabled per-messageId dedup + 10/day daily limit so the same test booking can be re-fired repeatedly during testing. Re-enable before broad rollout.",
    highlights: [
      "Both safety rails are bypassed via commented-out blocks in gmail-zoho-booking-watcher.js consumeBooking() with TESTING MODE markers. The structure is preserved so re-enabling is a copy-paste un-comment.",
      "While disabled: the same Gmail message can detect-and-fire over and over, and the daily counter doesn't increment. Storage writes to zhlZohoBookingSeenIds and zhlZohoBookingDailyCount are also skipped to keep chrome.storage.local clean across repeated test runs.",
      "The confirmation toast (5-second countdown with explicit Cancel) is still in place. Detection still requires the email to be a real Zoho booking confirmation (sender + subject + body fields)."
    ],
    sections: ["gmail-zoho-booking-watcher"]
  },
  {
    version: "1.63.4",
    category: "bugfix",
    headline: "Zoho Booking auto-log: after typing the phone, the synthetic Enter keydown was being ignored by Salesforce (events created via dispatchEvent have isTrusted=false). Now clicks the 'Show more results for...' link instead — same path the LO takes manually.",
    highlights: [
      "Symptom: phone digits typed correctly into the search overlay, the suggestions dropdown showed 'Show more results for \"<phone>\"', but the search results page never loaded — so the paster timed out at 'Search results page never loaded' and fell back to the clipboard-copy toast.",
      "Cause: Salesforce's search submission handler is gated on real user events (KeyboardEvent.isTrusted === true). Synthetic events created via dispatchEvent are isTrusted=false and silently ignored. The 'Press Enter to search' path was never going to work for Salesforce specifically.",
      "Fix: after pressEnter(), wait briefly to check if results loaded (in case some SF instance handles it). If not, find the 'Show more results for...' anchor in the suggestions dropdown via piercing query (matches by text, supports light/shadow DOM) and click it. Falls back to document.body Enter as a last-ditch belt-and-suspenders."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.3",
    category: "bugfix",
    headline: "Zoho Booking auto-log: Salesforce's global search is a BUTTON that opens an overlay — not an input you can type into directly. Click the button first, THEN find the input.",
    highlights: [
      "Root cause discovered from the global-header DOM the LO pasted: the visible 'Search...' bar is actually <button class=\"search-button\" aria-label=\"Search\">Search...</button> inside .forceSearchAssistant. Clicking it opens the Search Assistant overlay where the real input lives. v1.63.0–v1.63.2 were all looking for an <input> at the top of the page that doesn't exist until the button is clicked.",
      "Also confirmed the global header is Aura (data-aura-rendered-by attributes everywhere) — light DOM — so the trigger button is accessible via plain document.querySelector. No shadow DOM piercing needed for that step. The sf-shadow-shim still helps for the overlay's input (likely in shadow DOM) and for the PA Notes / Save button later in the flow.",
      "New runSearch() flow: (1) document.querySelector for the search-button trigger (forceSearchAssistant button), click it, wait 450ms; (2) findActiveSearchInput() — checks document.activeElement first (since Salesforce auto-focuses the overlay input), then falls back to a shadow-pierced search-input lookup; (3) if neither lands, dispatch Ctrl+/ and Cmd+/ as a backup; (4) one more 4-second wait+poll; (5) only then give up. Once the input is in hand, type and press Enter as before."
    ],
    sections: ["sf-zoho-booking-paster"]
  },
  {
    version: "1.63.2",
    category: "bugfix",
    headline: "Zoho Booking auto-log: Salesforce's Lightning Web Component shadow DOM is in CLOSED mode, which my v1.63.1 piercing helper couldn't see into. Added a document_start main-world shim that forces every attachShadow call to open mode, plus a keyboard-shortcut fallback for the global search.",
    highlights: [
      "Symptom: v1.63.1 still showed 'Could not auto-log — Global search input not found'. The global-search input lives in a Lightning Web Component shadow root that Salesforce creates in mode:\"closed\" — element.shadowRoot returns null for closed roots regardless of how the walker traverses.",
      "Primary fix: new sf-shadow-shim.js content script, registered at run_at:\"document_start\" with world:\"MAIN\" and all_frames:true. It monkey-patches Element.prototype.attachShadow to force {mode:\"open\"} on every shadow root LWC creates afterwards. Components still work normally (their own this.shadowRoot is unaffected by the mode flag) and our paster's existing queryAllPiercing() helper now sees through them.",
      "Belt-and-suspenders: paster now tries the Salesforce documented global-search keyboard shortcut (Ctrl+/ on Windows, Cmd+/ on Mac) FIRST. It dispatches the key combo, waits 200ms, and grabs document.activeElement — which Salesforce focuses to the search input. This path doesn't depend on shadow DOM access at all. Falls through to the shadow-pierced selector, then to a plain querySelector, only if the shortcut doesn't land."
    ],
    sections: ["sf-zoho-booking-paster", "sf-shadow-shim"]
  },
  {
    version: "1.63.1",
    category: "bugfix",
    headline: "Zoho Booking auto-log: pierce shadow DOM to find the Salesforce global search input, and reuse an existing Salesforce tab instead of opening a brand-new one.",
    highlights: [
      "Symptom: v1.63.0 toast said 'Could not auto-log — Global search input not found'. Salesforce Lightning's global search input lives inside a Lightning Web Component shadow root (the input carries part=\"input\" and lwc-* attributes), and document.querySelectorAll doesn't see inside shadow DOM, so the selector never matched.",
      "Fix: added a queryAllPiercing() helper that walks the document and every nested shadowRoot recursively. Switched the global-search input, Save button, PA Notes textarea, Communication Type buttons, Call Details tab, and Lead-link finders to use it.",
      "Tab reuse: the watcher no longer calls window.open() directly. It now sends a ZHL_OPEN_OR_FOCUS_SF message to the service worker, which queries chrome.tabs.query for existing lightning.force.com / salesforce.com tabs and focuses the most recently used one. If no SF tab is open, it falls back to opening a new tab. On reuse the SW also sends a ZHL_BOOKING_CHECK_PENDING message to that tab so the paster wakes up immediately without waiting for a URL change."
    ],
    sections: ["gmail-zoho-booking-watcher", "sf-zoho-booking-paster"]
  },
  {
    version: "1.63.0",
    category: "feature",
    headline: "New: auto-log Zoho booking confirmation emails as a PA Note in Salesforce, so the premier agent sees the scheduled appointment without you remembering to log it manually.",
    highlights: [
      "Watches your ZHL Gmail inbox for booking confirmation emails from scheduling@booking.zillowgroup.com (subject 'New Appointment with <Name>'). When one is detected, parses the borrower name, date, time, and contact phone from the body and shows a 5-second confirmation toast top-right in Gmail with an explicit Cancel button.",
      "If you let the countdown finish (or click 'Open Salesforce & paste'), a Salesforce tab opens, types the contact phone into the global search bar, clicks the matched Lead from the search results, selects Communication Type = Email, fills the PA Notes textarea with '<First Name> scheduled an appointment with me for <time> on <day, date>.', and clicks Save. Agent sees the PA note immediately.",
      "Safety rails: per-message dedup keyed on Gmail messageId so the same booking can't double-fire; daily limit of 10 auto-logs per LO so a misdetection can't loop; if any Salesforce step fails the note is copied to your clipboard with a toast telling you exactly which step broke. Feature toggle in Setup if you want to disable entirely."
    ],
    sections: ["gmail-zoho-booking-watcher", "sf-zoho-booking-paster"]
  },
  {
    version: "1.62.4",
    category: "bugfix",
    headline: "Send VPA Email: subject line now includes the co-borrower's last name. Previously every VPA subject showed only the co-borrower's first name (e.g., 'Connie Oldham & Glen' instead of 'Connie Oldham & Glen Smith', or 'Ashley Burkholder & Timothy' instead of 'Ashley & Timothy Burkholder').",
    highlights: [
      "Root cause: the scraper at sf-vpa-email.js captured the co-borrower's full name into coParsed via parseFullName(), but the returned lead object only carried coParsed.first through to the rest of the module. coBorrowerLastName was never populated. buildFullNames() then read lead.coBorrowerLastName, got undefined, treated coLast as empty, and the same-last-name collapse never fired.",
      "Fix: add coBorrowerLastName: coParsed.last to the lead object. Two-line change. buildFullNames()'s existing logic now correctly produces 'Connie Oldham & Glen Smith' for different last names and the cleaner 'Ashley & Timothy Burkholder' when both borrowers share a last name.",
      "Affects subject line only — body greeting ('Hi Connie & Glen') was already correct because it only uses first names. Default Intro Email is unaffected (it pulls from Salesforce Contact Roles which carries full names directly)."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.62.3",
    category: "bugfix",
    headline: "Copy LOP file: the Hard Pull Guardrail no longer interrupts the paste flow's credit-reissue step. The paste now bypasses the guardrail because the LO has already explicitly chosen to copy a known-good loan onto the destination.",
    highlights: [
      "Symptom: in the middle of a Copy LOP paste, after the addresses / employment / income / assets / pricing all landed and the script moved on to the credit-reissue step, the Hard Pull Guardrail's confirmation dialog popped up ('Hard pull may be outside ZHL guidance — no soft on file'). This is technically correct guidance — but in a paste flow the destination loan having no soft on file is expected (it's a brand-new file being populated from the source), and the LO has already opted into the operation. The dialog was friction, not a safety net.",
      "Fix: runHardReissue() in lop-file-copy.js now sets window.__zhl_skip_hard_pull_warning = true (the Hard Pull Guardrail's published SKIP_FLAG) immediately before clicking [data-cy=\"run-credit\"], so the Guardrail's click interceptor lets the click through silently. The flag is cleared 2 seconds later, and in a finally so an exception can't permanently disable the Guardrail.",
      "Soft-pull path (runSoftPull) does not need this — the Pull-type select defaults to Soft on that branch and the Guardrail only fires on pullType=Hard."
    ],
    sections: ["lop-file-copy", "hard-pull-guardrail"]
  },
  {
    version: "1.62.2",
    category: "bugfix",
    headline: "Copy LOP file: asset rows weren't picking up the right Asset type when the source row had LOP's 'D' badge next to the type name. mapAssetType() now falls back to prefix-match, and the failure dialog tells you which specific field stayed empty instead of guessing Borrower(s).",
    highlights: [
      "Root cause: LOP renders some asset rows with a one-letter badge appended to the type cell (the small 'D' pill next to 'Checking account' marking it as a depository account). cell.textContent picks up both, producing strings like 'checking account d' or 'checking accountd' that miss the exact-match table → mapAssetType returns empty → Asset type dropdown stays at 'Select' → required-field validation blocks save → form stays open → next asset hits 'Add button not available' too.",
      "Fix in mapAssetType(): if the lowercase trimmed source text doesn't match a known type exactly, fall back to picking the longest known type whose name appears at the START of the cell text. 'checking account d' now matches 'checking account' → 'CheckingAccount'.",
      "Diagnostic upgrade in pasteAssetRow(): when Save doesn't close the Add form, the modal now inspects the still-open form and reports which specific required field is empty (Asset type, Borrower(s), Financial institution, Amount). If Asset type is the culprit, the message includes the source text so the LO knows exactly what to pick manually."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.62.1",
    category: "bugfix",
    headline: "Intro / VPA Email auto-paste: extend the storage TTL from 60s to 10 min so a slow-loading Gmail tab no longer leaves you with the plain-text URL fallback instead of the formatted HTML draft.",
    highlights: [
      "Symptom: clicking Send Intro Email or Send VPA Email opens Gmail with the plain-text body in the URL (correct), then a content script on the Gmail tab is supposed to paste the formatted HTML on top. If Gmail took longer than 60 seconds to load — slow corporate network, idle ZG VPN, sleeping tab — the storage stash expired before the paste fired. Result: the LO saw an unformatted draft.",
      "Fix: TTL extended from 60s to 10 min in both gmail-intro-paste.js and gmail-vpa-paste.js. Polling window also extended from ~20s to ~30s. Added explicit console warnings when the stash expires or is missing, so future failures can be diagnosed from the browser DevTools console.",
      "Also cleaned up a no-op duplicate check in the Intro auto-paste's looksLikeFormattedPaste fingerprint (was checking the same string twice). No behavioral impact."
    ],
    sections: ["sf-intro-email", "sf-vpa-email"]
  },
  {
    version: "1.62.0",
    category: "milestone",
    headline: "🎉 Product has shipped Sort & reorder scenarios NATIVELY in LOP. The full feature set (Sort by rate, Reset, Select all, drag-and-drop) is now in core LOP for every LO — no extension needed. The extension's scenario-sort module is retired in celebration.",
    highlights: [
      "Sort & reorder scenario cards is now built into the Loan Officer Portal natively. Every LO at ZHL gets Sort by rate (ascending / descending), Reset, Select all / Deselect all, and drag-and-drop reordering of scenario cards — without installing anything. This module was the prototype that validated the design; with native parity now in production, the extension stays out of LOP's way.",
      "scenario-sort.js is permanently disabled in this release — the module short-circuits at load time and never injects its toolbar, drag handles, or click handlers. The full source is preserved in the repo so the implementation history remains visible. The Setup page replaces the old toggle with a celebratory '✓ Shipped natively · Product' card explaining the handoff.",
      "First feature to make the full LO-builder → Product-validation → native-shipment round trip. Direct proof that the extension's pattern (LOs build small, Product ships big) is the flywheel ZHL was hoping it would be. Impact Report's Product Validation page updated to call out the handoff."
    ],
    sections: ["scenario-sort"]
  },
  {
    version: "1.61.3",
    category: "improvement",
    headline: "Intro Email: insurance-agent pronouns are now configurable (defaults to she/her for Karson Carter), and the Borrower Information block hides the Co-Borrower rows entirely when there's no co-borrower on the file.",
    highlights: [
      "Pronouns dropdown added to Setup → Send Intro Email → Default homeowners insurance agent — she/her, he/him, or they/them. Karson Carter defaults to she/her. The body template now reads e.g. '...she can shop multiple carriers for you... reach her directly:' instead of 'she/he ... her/him'.",
      "Two new placeholder chips in the Intro Email template editor: {IA Pronoun Subject} (she / he / they) and {IA Pronoun Object} (her / him / them). The default body template uses them; existing customized templates keep the literal 'she/he' until you click Reset to default — or you can swap the literal text for the chips manually.",
      "Borrower Information block now hides the three Co-Borrower rows (Co-Borrower / Phone / Email) when the loan has no co-borrower, instead of showing them with 'n/a'. Implemented via a new {#if Co-Borrower}…{/if} conditional block in the template — wrapping any content in that pair makes it appear only when a co-borrower is present. Plain-text fallback honors the same conditional."
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.61.2",
    category: "improvement",
    headline: "Pricing Exception Workflow: threshold for the 'big PE' justification branch lowered from 2.5 points to 2 points to match the updated ZHL guidance.",
    highlights: [
      "The 'Is your PE request under X points?' step now asks 'under 2 points' instead of 'under 2.5'. The auto-route logic (when PE points were captured from the LE Section A inputs) compares pePoints >= 2 instead of >= 2.5.",
      "Email subject tags (' — >2 pts') and the 'Justification (PE > 2 pts)' section heading updated to match. Modal copy ('PE > 2 points — additional justification required'), the sizeLabel helper, and all related comments rewritten.",
      "Internal renames: isOver25 → isOver2, big25SectionHtml/Plain → big2SectionHtml/Plain. No functional change beyond the threshold."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.61.1",
    category: "bugfix",
    headline: "Copy LOP file: asset rows weren't being saved on paste — the Borrower(s) chip wasn't committing because the asset form was using the broken single-select helper. Fixed.",
    highlights: [
      "Symptom: pasting into the new loan would land 'addresses' and 'employment' rows cleanly, but 'assets' would show '0 of N rows added' and report 'Save did not close — likely Borrower(s) field is required'. The first asset's Add form would stay open, blocking subsequent assets ('Add button not available').",
      "Cause: pasteAssetRow() in lop-file-copy.js was driving the asset's Borrower(s) multi-select with selectComboboxOption() (the single-select helper). That helper clicks the option div, which returns success but doesn't always commit the underlying checkbox — so LOP's required-field validation blocked save.",
      "Fix: switched to selectMultiBorrowerCombobox(), the same dedicated multi-picker pasteRealEstateRow() already uses. It opens the listbox once and toggles each borrower's checkbox by label match, which is what LOP's React form actually requires."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.61.0",
    category: "feature",
    headline: "New MOSS Request button on Salesforce Lead / Contact / Opportunity pages — pick the type of help you need from the MOSS team (condo report, work up a contract, schedule the buyer, build / refresh a pre-approval, custom ask) and submit in two clicks.",
    highlights: [
      "Adds a MOSS Request button to the Salesforce action bar, right next to the Send VPA Email button. Click opens a modal with the common MOSS asks pre-listed: look up condo report, work up a contract, call this buyer at a specific time (with a date/time picker), initial outreach to buyer, get buyer scheduled on my calendar, work up a pre-approval, update a pre-approval, or a free-form custom request.",
      "Captures the request locally (record ID, borrower name, request type, notes, optional call time) so you have a personal audit trail of what you've submitted on each record — the modal surfaces the last three requests on the same record at the top so you can see what's already in flight.",
      "Preview build (v1). Direct submission into the MOSS Work Discovery /tasks queue (zhl-work-discovery-prod.corp.zgcp-itrc-prod-k8s.zg-int.net/tasks) is the v2 target — for now the confirmation toast offers a one-click link to the MOSS desktop so you can drop the request the usual way with the captured details still on hand."
    ],
    sections: ["sf-moss-request"]
  },
  {
    version: "1.60.1",
    category: "improvement",
    headline: "Hard Pull Guardrail: matrix updated to match ZHL's revised hard-pull guidelines. No-soft-on-file now warns to pull a soft first, and the 680–699 LLPA carve-out has been removed — only 700–719 still allows an optional hard for pricing.",
    highlights: [
      "Updated guidance matrix (per the revised ZHL hard-pull guidelines): No soft on file → pull a soft first (was: hard OK). Less than 620 → hard OK. ≥ 620 + DU Approval or LPA Accept → pull a soft (was already correct). ≥ 620 + both AUS Refer → hard OK. Optional 700–719 → hard OK for potential 720 LLPA pricing.",
      "Removed the 680–699 LLPA carve-out — borrowers in that range with an AUS approval now correctly trigger the soft-pull warning. The 700–719 window is the only optional-hard-for-pricing band that remains.",
      "Warning dialog reason line now reads 'no soft on file' instead of a numeric score when no soft scores are present in the credit panel. Matrix table inside the dialog updated to match the new five-row guidance."
    ],
    sections: ["hard-pull-guardrail"]
  },
  {
    version: "1.60.0",
    category: "improvement",
    headline: "Added a remote kill switch so the admin can pause every installed copy of the extension within ~10 minutes if a security or compliance issue comes up — without uninstalling and without losing your saved configuration.",
    highlights: [
      "Service worker now polls a small JSON file in the GitHub repo every 10 minutes (chrome.alarms-driven) and writes the result into chrome.storage.local under zhl_kill_switch. Every module's IIFE wrapper checks that flag before running. When the file flips to {\"killSwitch\": true}, every installed copy short-circuits all modules until it flips back. Your LO profile, templates, and feature toggles are NEVER touched — they stay in storage and resume the instant the switch flips off.",
      "Fail-OPEN by design: if the fetch fails (offline, GitHub down, repo moved), the flag is left unchanged. The extension is never disabled by a transient network issue — only by an authoritative {\"killSwitch\": true} payload from the source of truth file.",
      "Admin Controls card added to Setup, visible only when lo_email matches the admin address. Shows current state, last poll time, source-file 'updated' timestamp, and a Force-poll-now button. Direct edit link to kill-switch.json on GitHub for flipping the switch.",
      "New permission: 'alarms' (used for the 10-minute polling cycle). Fetch URL: raw.githubusercontent.com/case2392/zhlextensions/main/kill-switch.json — covered by the existing <all_urls> host permission."
    ],
    sections: []
  },
  {
    version: "1.59.4",
    category: "improvement",
    headline: "Copy LOP file panel: buttons no longer mid-word-wrap on narrow viewports. 'Stage from this file' renamed 'Copy Old LOP', 'Paste from staged' renamed 'Paste New LOP'.",
    highlights: [
      "Panel now uses flex-wrap with a row-gap so the whole row breaks cleanly to a second line on narrow viewports — buttons stay full-width on their own line instead of cramming and wrapping their text mid-label. Added white-space:nowrap to the Copy Old LOP, Paste New LOP, Pricing Exception Workflow, and Generate Loan Story for Encompass buttons so each label always renders on one line.",
      "Button text renamed: Stage from this file → Copy Old LOP, Paste from staged → Paste New LOP. Reads more obviously as a directional copy-then-paste pair. Modal copy that referenced the old names ('click Stage from this file first' / 'click Paste from staged') updated to match."
    ],
    sections: ["lop-file-copy"]
  },
  {
    version: "1.59.3",
    category: "improvement",
    headline: "Intro Email: Karson Carter / Goosehead Insurance is now the real default insurance agent — fully populated on first click, even if Setup is never opened.",
    highlights: [
      "Insurance Agent fields in Setup now seed with Karson Carter / Goosehead Insurance / (336) 596-3603 / Karson.carter@goosehead.com on first load (as actual editable values, not placeholder hints). Seeds are written to chrome.storage.local on first Setup visit, so the Intro Email module sees them on next read.",
      "Module-side fallback added too: getLoSettings() falls back to the same Karson defaults when the four IA storage keys are empty. So clicking Insurance Intro on a brand-new install, before ever opening Setup, sends a fully-populated draft with Karson auto-CC'd — no '[Insurance Agent Name]' brackets, no missing CC.",
      "If you want a different agent, type over the values in Setup → Send Intro Email from Salesforce → Default homeowners insurance agent. Your changes save on input as before and override Karson on subsequent sends."
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.59.2",
    category: "bugfix",
    headline: "Scenario Snapshot: lead source capture now actually fires (was clicking the wrong element + .click() not triggering React Router).",
    highlights: [
      "Lead source's trigger is a <button> wrapped inside a <p aria-haspopup='dialog'>. Popper.js binds the open-popover handler to the WRAPPER, not the inner button. Clicking the button alone did nothing. Updated findLeadSourceTrigger() to prefer the [aria-haspopup='dialog'] wrapper when present and fall back to the button.",
      "Navigation between Scenarios ↔ Pricing wasn't always firing because .click() on a React Router <a> doesn't always trigger the synthetic-event handler. Replaced with a real-click sequence (pointerdown / mousedown / pointerup / mouseup / click) — same pattern other modules in the pack use. Element gets scrollIntoView()'d first so the click target is interactable.",
      "Settle window after navigation bumped from 350ms to 450ms — gives React more headroom to mount the new tab's content before we look for the trigger.",
      "Defensive fallback: if the popover anchor click doesn't open the dialog, we try clicking the inner button as a backup before giving up.",
      "Added [ZHL Snapshot] console.log diagnostics so the lead-source flow is debuggable from devtools without redeploying."
    ],
    sections: ["scenario-snapshot"]
  },
  {
    version: "1.59.1",
    category: "improvement",
    headline: "Intro Email: Borrower Information block restyled as a clean two-column table (was a wall of single-line Field: value entries).",
    highlights: [
      "Default template's bottom Borrower Information block is now a proper aligned table — label column in gray, value column in dark text, blank-row spacers between Borrower / Co-Borrower / Property sub-groups. Renders cleanly in Gmail / Outlook / Word.",
      "Reminder: existing saved templates are not touched. Click Reset to default on the Setup → Send Intro Email from Salesforce → Intro Email template panel to pick up the new layout. (Same Reset also picks up the v1.58.2 signature removal if you haven't already.)"
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.59.0",
    category: "improvement",
    headline: "Scenario Snapshot: now also grabs Lead source info (LSH record, hierarchy, Marksman, Incentive program) from the Pricing tab. Modal opens with the scenario card facsimile at the top. Copy writes rich HTML + plain so paste looks clean everywhere.",
    highlights: [
      "Lead source capture added. When Snapshot is triggered from the Scenarios tab, the module now navigates over to the Pricing sibling tab under a grey progress overlay, clicks the 'Lead source information' trigger, parses the popover (LSH record / Lead source hierarchy / Marksman pricing / Incentive program), closes it, then navigates back to Scenarios. Same Snapshot triggered from the Pricing tab does the capture in place. Same grey-overlay treatment the Copy LOP file and SMS Mark All As Read modules use for background work.",
      "Scenario card facsimile is now in the snapshot modal — green ASSIGNED TO LOAN bar (or red RE-PRICE), centered title, subtitle, Priced timestamp, divider, and all field rows in the same label / value layout as the live LOP card. The previous header + flat field list duplicated the same info; now the facsimile IS the header. Detail dialog sections (Adjustments / Payment breakdown / Closing costs / Cash to/from / Lead source) follow below.",
      "Copy now writes BOTH a rich HTML version and the plain-text version to the clipboard via ClipboardItem. Paste targets that support HTML (Outlook, Word, Slack, ticket bodies with WYSIWYG) get the styled card facsimile + dialog sections. Targets that only support plain text get the existing fixed-column padded text. Same one-click paste, different rendering per destination.",
      "Modal now opens with all data already rendered — capture happens under the page-level grey overlay before the modal builds, so there's no in-modal spinner / no enabling buttons after async work. Cleaner flow + less perceived latency."
    ],
    sections: ["scenario-snapshot"]
  },
  {
    version: "1.58.2",
    category: "improvement",
    headline: "Intro Email: drop the in-template signature block. Gmail's own signature adds itself to every compose tab — having ours in the body too was producing duplicates.",
    highlights: [
      "Removed the 'Best, {LO Name} / Mortgage Loan Officer | Zillow Home Loans / NMLS #{NMLS}' block from the default Intro Email body (HTML + plain). Gmail's auto-signature handles it. The body now closes with the 'text or call me anytime' line, then the hr divider, then the Borrower Information summary. Hit Reset to default on the Intro Email template panel to pick up the new default — existing saved templates aren't touched."
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.58.1",
    category: "improvement",
    headline: "Intro Email: greeting now includes co-borrower, insurance agent is a Setup config that auto-CCs on every draft, borrower phone + email + Property Street/City/State/Zip + Purchase Price added. Button renamed 'Insurance Intro'.",
    highlights: [
      "Greeting placeholder changed: was {First Name} (always primary only). Default body now uses {Greeting} which expands to 'Ryan & Timmy' when there's a co-borrower and 'Ryan' otherwise — same pattern as the VPA email greeting. {First Name} still works for cases where you want only the primary's first name.",
      "Insurance Agent is now a Setup configuration block, not a hardcoded Karson Carter / Goosehead block. New fields under the Intro Email card: agent name, agency/company, agent phone, agent email. Email is auto-CC'd on every Intro Email draft (alongside the co-borrower). Default body template uses {Insurance Agent Name / Company / Phone / Email} placeholders.",
      "Borrower Information block at the bottom of the body now includes phone + email for both borrower and co-borrower. New placeholders: {Borrower Phone}, {Borrower Email}, {Co-Borrower Phone}, {Co-Borrower Email}. Pulled from the Contact Roles related list during the same scrape that gets the names.",
      "Property Address scraping rewritten: was looking for a single 'Property Address' field that doesn't exist on most Opportunities. Now reads Property Street / City / State / Zip individually and combines into 'Street, City, State Zip'. Falls back to the single-field lookup if the split fields aren't present.",
      "New {Purchase Price} placeholder reads from the Opportunity's Purchase Price field — available for templates that mention loan amount.",
      "Button text changed from 'Send Intro Email' to 'Insurance Intro' so the intent is obvious in the Opportunity action ribbon."
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.58.0",
    category: "feature",
    headline: "NEW: Send Intro Email from Salesforce — pre-filled disclosures-signed intro draft for the borrower(s) on every Opportunity, customizable subject + body from Setup.",
    highlights: [
      "Adds a Send Intro Email button to the Opportunity action ribbon — same slot as Send VPA Email is on the Lead / Contact pages. Only on Opportunity records (URL matches /lightning/r/Opportunity/...).",
      "Scrapes the Borrower + Co-Borrower from the Contact Roles related list (name + email) and reads Close Date + Loan Number from the Opportunity highlights panel. Property Address grabbed from the page when visible; falls back to a [Property Address] bracket placeholder otherwise. Buyer's Agent role is ignored — only borrower-role contacts get pulled.",
      "Opens a Gmail compose tab with To = primary borrower email, CC = co-borrower email (when present), subject + body populated from the customizable template. The Gmail companion content script (modules/gmail-intro-paste.js) auto-pastes the formatted HTML body once compose loads — same belt-and-suspenders pattern as the VPA email (HTML stash in chrome.storage.local under zhlIntroPendingPaste, clipboard fallback, plain body in the compose URL as last-resort).",
      "Setup → Send Intro Email from Salesforce → Intro Email template panel mirrors the VPA editor: subject input, rich body editor (B/I/U + lists + link + clear), clickable placeholder chips ({First Name}, {Borrower Name}, {Co-Borrower Name}, {Property Address}, {Loan Number}, {Closing Date}, {LO Name}, {LO Email}, {NMLS}), Reset to default, saved-status indicator. Stored under intro_subject_tmpl and intro_body_html_tmpl.",
      "Default body matches the LO's intro template: three numbered steps (initial UW review, processor intro, homeowners insurance), Karson Carter / Goosehead Insurance contact block, signature with NMLS, and the Borrower Information summary block at the bottom. 'Zillow Home Loans' mention styled in the brand Georgia serif cobalt (#0E35C4) — same treatment as the VPA email body."
    ],
    sections: ["sf-intro-email"]
  },
  {
    version: "1.57.3",
    category: "bugfix",
    headline: "Loan Story button now only appears on Full Application — was leaking onto Premier Agent / Tasks / etc.",
    highlights: [
      "The injection logic preferred the existing Copy LOP file panel as its anchor (correct), but fell back to mounting onto the persistent subnav row when the panel wasn't there yet. On non-Full-App pages the panel doesn't exist, so the fallback fired and attached our button to the subnav — which doesn't get torn down between tabs. Result: button stuck around on Premier Agent / Tasks.",
      "Removed the subnav fallback entirely. Only anchor next to the Copy LOP file panel, and explicitly remove our button when the user navigates away from Full Application (or when the panel disappears). Same lifecycle as the Copy from Stage and Pricing Exception Workflow buttons now."
    ],
    sections: ["loan-story-generator"]
  },
  {
    version: "1.57.2",
    category: "improvement",
    headline: "Pricing Exception Workflow: removed the 'Copy body only' and 'Copy subject only' buttons. Open in Gmail already handles both reliably.",
    highlights: [
      "Open in Gmail + copy body auto-pastes the formatted HTML body into the new compose tab, copies it to the clipboard as a Ctrl+V fallback, AND includes the plain-text body in the compose URL as a last-resort fallback — all three paths covered by the primary button. The two secondary copy buttons were leftover from before the auto-paste flow was solid; with auto-paste working consistently they're dead clicks taking up UI real estate. Removed."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.57.1",
    category: "improvement",
    headline: "Setup brand mark + VPA email now use the new Zillow logo and brand-typed 'Zillow Home Loans' wordmark. Accent color updated to the cobalt sampled from the brand PNG (#0E35C4).",
    highlights: [
      "Setup page header now uses the Zillow Z logo PNG (extension/images/zhl-logo.png) instead of the 'ZHL' text mark — pulled from the matching brand PNGs the user committed to main.",
      "VPA Email body template leads with a Zillow Home Loans brand banner image (the wordmark PNG), and the inline 'What's Next?' Zillow icon now points at the new Zillow Logo PNG. Both images hosted on raw.githubusercontent.com/case2392/ZHLExtensions/main so they load in the recipient's email client without OAuth or Drive sharing.",
      "Inline 'Zillow Home Loans' text mentions in the main body (the pre-approval announcement, the No Cost Appraisal bullet) are now wrapped in a styled span using Georgia serif bold in the brand cobalt #0E35C4 — matching the wordmark PNG. Disclaimer footnote keeps default styling (gray italic small) so disclosures still read as disclosures.",
      "Accent color changed from #1a73e8 to #0E35C4 across the VPA email: Congratulations <h1>, {Amount} highlight, Zillow Webpage link, What's Next? / Don't Forget section headers, closing Congratulations again, and the LO Name mailto link. Heading + section labels switched to Georgia serif bold to match the brand typography. The brand image already provides the canonical wordmark at the top of the email.",
      "Existing saved templates are NOT overwritten — only the default kicks in when vpa_body_html_tmpl is unset. Click Reset to default on the Setup → VPA Email template panel to pick up the new branding."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.57.0",
    category: "feature",
    headline: "VPA Email is now fully customizable from Setup — edit the subject line, the HTML body (rich editor), and your Zillow Webpage URL. Mirrors the original SFGmail setup.",
    highlights: [
      "LO Profile card now has a Zillow Webpage URL field (lo_zillow_url). Used in the VPA email body's \"You can also click here to view my Zillow Webpage!\" link. If left blank, the link still renders but goes nowhere — edit the body template to remove the sentence if you don't want it.",
      "Send VPA Email module card now has a VPA Email template panel: subject line input + rich body editor (bold / italic / underline / bullets / link / clear formatting toolbar) + clickable placeholder chips ({Greeting}, {Borrower}, {Full Names}, {Amount}, {Agent}, {Agent Name}, {LO Name}, {LO Email}, {Zillow URL}) + Reset to default button. Saves on every edit (debounced); status indicator confirms.",
      "Placeholder substitution happens at send time. Plain-text placeholders like {Greeting} / {Amount} / {Borrower} resolve to escaped text; {Agent} and {LO Name} resolve to fully-styled HTML (mailto link in red bold / blue bold when an email is available, plain styled span when not). Same substitution logic the original SFGmail extension used.",
      "Default templates extracted as DEFAULT_SUBJECT_TMPL and DEFAULT_BODY_HTML_TMPL in sf-vpa-email.js. Customizations live under chrome.storage.local keys vpa_subject_tmpl and vpa_body_html_tmpl; if either is empty the default is used. Click-handler reads templates from storage on every send so changes are live without reloading anything."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.56.2",
    category: "improvement",
    headline: "Send VPA Email now produces the full HTML-formatted email — same big blue Congratulations headline, Zillow / Bonus icons, branded bullet lists, and disclaimer footnote as the original SFGmail proof-of-concept. No more plain text.",
    highlights: [
      "Gmail compose URLs only carry plain text in &body=, which is why the previous version was sending the VPA out as flat unstyled text. The fix follows the same belt-and-suspenders pattern the Pricing Exception Workflow uses: the click handler builds the full HTML body, stashes it in chrome.storage.local under zhlVpaPendingPaste (TTL 60 s), and copies HTML + plain to the clipboard. The compose URL still opens with the plain body as a final fallback.",
      "New companion content script — modules/gmail-vpa-paste.js — runs on mail.google.com, polls for the pending paste once the new compose tab loads, finds Gmail's contenteditable body, and replaces the plain content with the formatted HTML via document.execCommand('insertHTML'). Verify-and-retry loop handles Gmail's URL-driven body fill landing AFTER our paste (re-pastes up to 6 times across 3 seconds). On verified success, the storage entry is cleared so no other compose tab picks it up.",
      "HTML body is a faithful port of the original SFGmail templates/vpa-template.html — same wording, same Calibri 14.5px / line-height 1.5 styling, same inline images for What's Next and Don't Forget (drive.google.com/uc?export=view URLs), same blue Congratulations <h1>, same agent name styled red and bold, same disclaimer at 10px italic gray. LO name + email pulled from Setup's LO Profile (lo_name, lo_email); Zillow webpage link reads lo_zillow_url (omits the line if unset)."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.56.1",
    category: "improvement",
    headline: "Scenario Snapshot: Detailed cost summary now parses cleanly; printout shows a card facsimile at the top. Loan Story now auto-expands collapsed employment rows so income-type breakdown actually reads.",
    highlights: [
      "Detailed cost summary parsing rewritten. The previous version mis-detected the outer Flex container (wrapping 'Loan costs' and 'Other costs' blocks) as a single KV row, which produced a giant text glob. The KV detector now rejects containers whose label or value text exceeds 80 chars, contains a separator/divider, or has multiple nested Flex descendants — so only true leaf-level rows match.",
      "Section headers in Detailed cost summary and Cash to/from were rendered as <span> inside Spacer <div> wrappers (not <p>), so the old <p>-only header detection missed them. Added a Spacer-DIV header detector keyed on the stable per-dialog class patterns (sc-7e7c7851-1 / -2 / -3 for Detailed cost summary; sc-66fe4c72-0 / -1 for Cash to/from). 'Total'-row wrappers (-3, -1) descend transparently so the inner KV row gets emitted instead of the wrapper text.",
      "Print view now leads with a styled scenario-card facsimile — green ASSIGNED TO LOAN bar (or red RE-PRICE), centered title, Purchase / loan amount subtitle, Priced timestamp, divider, and all field rows in the same label / value layout as the original LOP card. The detail-dialog sections follow below. The visual context is on every printout.",
      "Loan Story for Encompass now expands any collapsed employment rows before reading. The inner employment-incomes-table is only mounted in the DOM when the row is expanded — previously the breakdown came back empty if rows were collapsed, so B2 with Overtime + Bonus showed up as just '$X/mo' instead of 'Has overtime + bonus on top of base'. The preflight clicks every chevron-down icon and waits ~260ms for React to mount the income tables, then reads."
    ],
    sections: ["scenario-snapshot", "loan-story-generator"]
  },
  {
    version: "1.56.0",
    category: "improvement",
    headline: "Scenario Snapshot now lives in the 3-dots menu next to View details and captures EVERY detail dialog — Points, P&I, Closing costs, Cash to/from — into one snapshot. Loan Story now reads income-type breakdown (Base only vs. Base + OT + Bonus).",
    highlights: [
      "Scenario Snapshot moved from under-card button to a 'Snapshot' menuitem inside the 3-dots overflow menu, next to 'View details'. Cleaner card layout — no extra button at the bottom of every scenario.",
      "Snapshot now opens each of the four blue-link detail dialogs in sequence (Points / Price → Adjustments and compliance · Monthly P&I / PITI → Payment breakdown · Total closing costs → Detailed cost summary · Cash (to)/from → Cash (to)/from breakdown), parses every label / value / tab panel / table inside, and closes the dialog before moving to the next. The single resulting snapshot now includes every piece of data behind those links — Breakeven, full Compliance section (Investor Eligibility, HPML, QM block, HOEPA block), Payment breakdown line items, full Closing costs hierarchy (Loan costs / Other costs / Credits with all sub-sections), and Cash to/from breakdown (Upfront costs, Deductions, Total). Copy as text and Print both pick up all of it.",
      "Loan Story for Encompass now reads the employment-incomes-table inside each expanded employment row. Output reflects only the income types actually present: 'Base income only ($X/mo)' when there's only base, or 'Has overtime + bonus on top of base ($X/mo total)' when there are non-base components. Replaces the v1 generic 'review for variable components' callout."
    ],
    sections: ["scenario-snapshot", "loan-story-generator"]
  },
  {
    version: "1.55.1",
    category: "improvement",
    headline: "Send VPA Email: subject + body now match the original SFGmail template exactly, and the draft opens in a new tab instead of a popup window.",
    highlights: [
      "Subject is back to the canonical 'Verified Pre-Approval for {fullNames} - Up to {amount}! - {LO Name} from Zillow Home Loans' wording — with co-borrower name handling that collapses 'Tracey Smith & Andrew Smith' into 'Tracey & Andrew Smith' when last names match. Pulls the LO name from the Setup page's LO Profile.",
      "Body is a faithful plain-text port of the original VPA HTML template — same wording, same bullet order, same disclaimer footnote — only the HTML formatting / images are dropped (since Gmail compose URLs can't carry HTML). Gmail's signature will still render normally below the draft.",
      "Compose tab now opens in a regular browser tab in the LO's current Gmail session, not a standalone popup window. Matches how the Pricing Exception Workflow opens Gmail — same URL pattern (mail.google.com/mail/?view=cm&fs=1) and same plain window.open(url, '_blank') call (no windowFeatures string, which was what was triggering the popup behavior)."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.55.0",
    category: "feature",
    headline: "NEW: Generate Loan Story for Encompass — auto-drafts the five ZG-Loan-Story sections from the LOP file in an editable modal with per-section Copy buttons.",
    highlights: [
      "Adds a Generate Loan Story for Encompass button to the Full Application subnav, next to the existing Copy LOP file / PE Workflow buttons. The button stays disabled until a hard credit pull is on file (per the Hard score grid in the Credit section) — tooltip explains why. Once activated, one click opens a modal with five editable textareas — Property Notes, Borrower Notes, Employment / Income Notes, Asset Notes, Credit Notes — each populated from the file and each with its own Copy button.",
      "Auto-surfaces what processors actually use: property type / PUD / construction-status / state, FTHB from Declarations, per-borrower employment timeline with current and prior employer dates, gift fund totals and sources, liabilities the LO has flagged for payoff or excluded from DTI, and callouts when the collections 5% rule or FHA / DU / LPA / VA student-loan calc method needs to be verified. Reuses logic from the existing Collections and student-loan calculator modules where possible.",
      "Voice is medium — one short sentence per insight, terse enough to skim but specific enough to be useful. Every textarea is editable so the LO can type over the auto-draft, add bullets the file can't tell us (main point of contact, loan goals, non-borrowing spouse), then Copy and paste into the matching Encompass field. Nothing is committed automatically — the modal just hands you text."
    ],
    sections: ["loan-story-generator"]
  },
  {
    version: "1.54.0",
    category: "feature",
    headline: "NEW: Send VPA Email from Salesforce — one-click pre-filled Gmail draft on Pre-Approval leads. No OAuth, no Connected App, no test-user cap.",
    highlights: [
      "Adds a Send VPA Email button to the Salesforce Lead / Contact action bar. The button stays disabled until the lead reaches the Pre-Approval path stage. One click scrapes the borrower name, email, purchase price, co-borrower (with hover-card email extraction), and Buyer's Agent (with hover-card email extraction), then opens a pre-filled Gmail compose tab — To, CC, Subject, and Body all populated with the standard VPA congratulations email.",
      "Uses the public Gmail compose URL (mail.google.com/mail/u/0/?view=cm&fs=1&...) instead of the Gmail API — so no OAuth client, no Connected App enrollment, no per-user verification. The LO attaches the Verified Pre-Approval PDF to the draft manually before sending. Folds the standalone SFGmail proof-of-concept into the main toolkit with one less moving part."
    ],
    sections: ["sf-vpa-email"]
  },
  {
    version: "1.53.0",
    category: "feature",
    headline: "NEW: Scenario Snapshot — one-click capture of every field on a scenario card for app-support tickets. No more scrolling and stitching multiple screenshots.",
    highlights: [
      "Adds a Snapshot button under every scenario card on the Pricing & Scenarios → Scenarios page. Clicking it opens a clean, single-viewport modal listing every label/value row from the card — title, Purchase/Refi subtitle, ASSIGNED TO LOAN / RE-PRICE status, Priced: timestamp, and every field below. Modal includes a Print button that opens a print-formatted new tab and auto-fires the print dialog (save as PDF for the ticket attachment or send straight to a printer), and a Copy as text button that writes a plain-text version to the clipboard with labels padded into fixed columns so it pastes cleanly into a Slack code block or ticket body.",
      "Built in response to a request from the App Support team — they couldn't get a full valid snapshot of a scenario when LOs submitted tickets, and were forced to ask for repeat scroll-and-stitch screenshots. This eliminates that loop."
    ],
    sections: ["scenario-snapshot"]
  },
  {
    version: "1.52.6",
    category: "improvement",
    headline: "2% Grant PDF: added MD, NJ, and VA to the eligible-states list — eligible set is now CA, DC, GA, MD, NJ, PA, TX, VA.",
    highlights: [
      "Per product update from the 2% Grant program owners, Maryland, New Jersey, and Virginia are now in scope. GRANT_ELIGIBLE_STATES constant updated, the disabled-button tooltip naming the eligible states updated to match, and the Setup + Walkthrough descriptions updated so the docs stay in sync. No other behavior changed — every other gate (Conf Home Ready 30 Yr Fixed product, ≤ $350k loan amount, all selected scenarios must qualify) still applies."
    ],
    sections: ["loan-comparison-pdf"]
  },
  {
    version: "1.52.5",
    category: "improvement",
    headline: "Hard Pull Guardrail now reads LPA in addition to DU, and treats EITHER AUS approval (DU Approve* or LPA Accept*) as sufficient to suggest a soft pull.",
    highlights: [
      "Previously the guardrail only inspected the DU panel and looked for 'Approve' — and the comment block referenced a 'DU Deny' that doesn't actually exist (DU's non-approval is 'Refer/Eligible' or 'Refer/Ineligible'). Both halves fixed: the AUS reader is now generalized to find the most recent non-error status by label (DU or LPA), the decision logic treats either DU starting with 'Approve' OR LPA starting with 'Accept' as approval, and the warning dialog shows BOTH AUS statuses in its detected-state line so the LO can see exactly what triggered it. Telemetry events now carry both du and lpa fields for downstream analysis. Behavior unchanged when the score is below 620 or in the 680-719 LLPA optional-pricing window."
    ],
    sections: ["hard-pull-guardrail"]
  },
  {
    version: "1.52.4",
    category: "fix",
    headline: "Hard Pull Guardrail now sorts to the top of the Walkthrough's New section the way every other recent feature does.",
    highlights: [
      "The walkthrough's New-features list sorts cards by the newest version that touches each card's id (via the sections array in changelog.js). The Hard Pull Guardrail's entry wasn't carrying a sections array, so it was falling to the bottom of the list with the untagged cards. Added sections:[\"hard-pull-guardrail\"] to v1.52.1 — and since 1.52.1 is the newest version that touches any walkthrough card, the Guardrail now lands first."
    ]
  },
  {
    version: "1.52.3",
    category: "improvement",
    headline: "Hard Pull Guardrail card added to the Setup page and the Walkthrough page so it's discoverable like every other module.",
    highlights: [
      "Setup page now lists Hard Pull Guardrail as its own module card with an enable / disable toggle. Walkthrough page has a matching what's-new entry with the warning-dialog mockup so a new install (or anyone reviewing what's running) can see exactly what the guardrail does and how to turn it off if they want."
    ]
  },
  {
    version: "1.52.2",
    category: "improvement",
    headline: "Hard Pull Guardrail flipped from default-off to default-on for the author's personal install. Other users continue to receive whatever version they already have until live updates resume.",
    highlights: [
      "Feature gate changed from 'must be explicitly true' to 'skip only if explicitly false' — matches the pattern other LOP modules use. Behavior of the guardrail itself is unchanged from v1.52.1: intercepts the click on Pull Credit when pullType=Hard, reads the worst soft qualifying score across borrowers + the most recent non-error DU result, and only fires a warning when soft is greater than 620 with DU approved and the score is outside the 680-719 LLPA optional-pricing window. Not a hard stop — the warning has a Proceed-Anyway path."
    ]
  },
  {
    version: "1.52.1",
    category: "fix",
    headline: "NEW (hidden / preview): Hard Pull Guardrail — warns the LO when a Hard credit pull is outside ZHL's guidance matrix, with the matrix shown right in the confirmation dialog. Default OFF — enable in chrome.storage with feature_hardPullGuardrail:true.",
    highlights: [
      "Module intercepts the click on LOP's Pull Credit dialog when pullType=Hard, reads the worst soft qualifying score across borrowers + the most recent non-error DU result, and applies ZHL's guidance: warns when soft is greater than 620 + DU shows approval, UNLESS the score is in the 680-719 LLPA optional-pricing window. The warning shows the full matrix as a compact table and gives the LO two buttons — Cancel (keeps the Pull Credit dialog open) or Proceed Anyway (re-fires the click bypassing our handler). Not a hard stop. Built behind feature_hardPullGuardrail (default off) so it can ride along quietly while leadership decides scope and rollout policy."
    ],
    sections: ["hard-pull-guardrail"]
  },
  {
    version: "1.52.0",
    category: "improvement",
    headline: "SMS Quick-Add: when the Salesforce API lookup fails, read the phone directly out of the hover preview that opens and add the participant automatically — instead of asking the LO to copy it manually.",
    highlights: [
      "All four Quick-Add buttons (Add Borrower, Add Co-Borrower, Add Buyer's Agent, Add Loan Officer) now have a stronger fallback when the SF REST lookup can't return a phone (stale tab after extension update, permission edge case, etc.). The buttons still dispatch the hover so SF's preview card opens — but instead of stopping there with a 'copy from here' toast, the extension reads the phone straight out of <span class=\"uiOutputPhone\"> inside the preview and adds it as a participant directly. Matches by contact name so the right preview is picked when multiple are open at once. If the preview still can't be read within ~3.5s, falls back to the existing manual-copy toast."
    ]
  },
  {
    version: "1.51.9",
    category: "fix",
    headline: "DTI Max Estimator now caches the selected PITI from the collapsed products view — so expanding the panel no longer shifts the Est. max figure (the 1.51.7 fix didn't catch this LOP layout).",
    highlights: [
      "v1.51.7 tried to detect the selected row via DOM markers (checkbox, aria-selected, class). On some LOP layouts none of those signals are present on the highlighted row, so we fell through to lowest-PITI per type — letting a deep-buydown row win in the expanded view and shifting Est. max by tens of thousands. The estimator now caches the PITI from the collapsed view (which by definition renders only the selected row) and uses that PITI to identify the same row when the panel is expanded. Three-tier fallback in order: cached PITI match → existing isSelected DOM markers → lowest PITI (original behavior, last resort). Net result: Est. max stays the same regardless of whether the products panel is open or closed."
    ]
  },
  {
    version: "1.51.8",
    category: "fix",
    headline: "Calc Student Loans: clamp the computed monthly payment to $1 — LOP's form rejects anything below that, and small balances at 0.5% were calculating to e.g. $0.89.",
    highlights: [
      "On a $178 balance × 0.5% the formula returned $0.89, which LOP's liability edit form rejected with \"Monthly payment must be greater than or equal to $1\" — and the row never saved. The computed value is now floored at $1 so the row commits cleanly. Math is unchanged for any balance ≥ $200 at the 0.5% programs (FHA/LPA/Conventional)."
    ]
  },
  {
    version: "1.51.7",
    category: "fix",
    headline: "DTI Max Estimator: the Est. max figure no longer shifts when the products panel is expanded vs. collapsed.",
    highlights: [
      "The collapsed products panel renders only the LO's selected rate row; the expanded panel renders ~30 rate options including buydown rows with much lower PITI. The previous \"lowest PITI per loan type\" pick let those buydown rows win once the panel expanded, which moved the Est. max figure by tens of thousands. The estimator now pins to the SELECTED row (checked / aria-selected / highlighted) so the figure stays stable regardless of whether the products panel is open or closed. Falls back to the old behavior only if no row reports as selected in the DOM (collapsed views without an interactive checkbox)."
    ]
  },
  {
    version: "1.51.6",
    category: "fix",
    headline: "Scenario Sort \"Select all\" now skips the assigned-to-loan card — fixes the bug where deleting the surrounding scenarios also hid the assigned card from view until refresh.",
    highlights: [
      "Clicking Select all and then deleting put LOP into a UI state where the assigned-to-loan card disappeared alongside the deleted ones, even though it was still saved on the backend (refresh brought it back). Root cause: our Select all clicked the assigned card's checkbox along with the others, and LOP's React state didn't handle that combination cleanly when the surrounding scenarios were then removed. The assigned card can't actually be deleted alongside the others anyway (you'd have to unassign it first), so Select all now filters it out — clicking still selects every UNASSIGNED scenario, but the assigned card's state is left alone, and the post-delete view shows the assigned card right where it should be."
    ]
  },
  {
    version: "1.51.5",
    category: "improvement",
    headline: "Pricing Exception Workflow now prompts for the ZG # when the loan is locked and the extension can't auto-detect one — so the rest of the locked-path flow uses the real Encompass loan number instead of the LOP UUID.",
    highlights: [
      "When you pick \"Yes — locked\" on the first step of the Pricing Exception Workflow, the extension now checks whether it could find a ZG # on the page. If it couldn't, a new step asks you to enter it before continuing. Validates the format (ZG followed by 6+ digits), normalizes the leading # and casing, and threads the captured value through the rest of the workflow so snip filenames and the eventual PE email both use the right loan number. Enter-to-submit is wired."
    ]
  },
  {
    version: "1.51.4",
    category: "improvement",
    headline: "Add Co-Borrower to Salesforce button now always appears on the co-borrower's row — greyed out with a hover explanation when required fields (legal name + cell or email) are still missing, instead of silently disappearing.",
    highlights: [
      "Previously the button anchored on the co-borrower's \"Resend Link\" button, which LOP doesn't render until the email is filled. The button now anchors on the co-borrower's section header itself, so it's always visible. When the co-borrower is missing a legal first name, last name, or both cell phone AND email, the button shows in grey with a not-allowed cursor and a tooltip explaining exactly which field is missing. The moment the LO fills the missing field, the next scan tick re-enables the button — no refresh needed."
    ]
  },
  {
    version: "1.51.3",
    category: "fix",
    headline: "Clone PA Contact ID modal: closed the transparent gap between the body and the Cancel / OK footer.",
    highlights: [
      "Salesforce's clone-confirmation modal hard-codes its inner content container to height:250px. Our banner pushed the total content past that height, so the footer detached from the body and a transparent strip appeared between them showing the page underneath. The injection now grows the inner container to height:auto (with a 250px min-height) when the banner is inserted, so the body, banner, message, and footer all stack flush."
    ]
  },
  {
    version: "1.51.2",
    category: "fix",
    headline: "Clone PA Contact ID: full-width modal banner, grey processing overlay during auto-paste, and a more thorough Save sequence so the inline edit actually commits.",
    highlights: [
      "Confirmation-modal banner now spans the full modal width (inserted above the inner slds-grid instead of inside the right-side message column), and the empty 3-of-12 leading column is collapsed so the \"Are you sure...\" text aligns flush left below the banner.",
      "Auto-paste now shows a full-viewport grey overlay (same style as Copy LOP File and SMS Mark All Read) with progress text: Opening the field → Typing value → Saving. Removes any ambiguity about what the extension is doing.",
      "Save did not always commit because Lightning's inline-edit needs the input to be marked \"dirty\" before the SaveEdit button accepts the click. The paste now focuses the input, sets the value, fires keydown/keyup, blurs to commit, waits 400ms for state to settle, and verifies the Save button isn't disabled before clicking it with a realistic pointer-event sequence (pointerdown / mousedown / pointerup / mouseup / click). After the click it waits for the inline edit to actually disappear before declaring success — so a partial save no longer reports as ✓ in the toast."
    ]
  },
  {
    version: "1.51.1",
    headline: "Clone PA Contact ID: fixed the \"new lead already has the same ID\" false positive (was reading from the hidden source workspace tab) and tightened the confirmation-modal banner layout so it lines up with the message.",
    highlights: [
      "When two Lead workspace tabs are open in a Lightning Console (the source and the new clone), Lightning keeps both mounted in the DOM but only one is visible at a time. The auto-paste check was finding the FIRST \"PA Contact ID\" label in the deep query — which could be the hidden source tab — and seeing its value match the captured one, then skipping the paste on the actually-blank new lead. The reader now filters by visibility so it only ever reads the active workspace tab's value.",
      "The confirmation-modal banner is now inserted inside the same .statusContainer column as the \"Are you sure...\" message, so it lines up with the message instead of getting offset by the inner 3-of-12 empty grid column. Padding and font sizes also trimmed to fit the modal's fixed height cleanly."
    ]
  },
  {
    version: "1.51.0",
    headline: "NEW: auto-paste PA Contact ID when cloning an Unqualified Salesforce Lead — no more remembering and manually pasting it onto every new lead.",
    highlights: [
      "When you click Clone on a Lead, the extension grabs the source lead's PA Contact ID and stashes it. The clone-confirmation modal (\"Are you sure you want to copy this lead?\") gets a brand-blue banner explaining what's about to happen, plus the ID itself rendered in monospace as a manual fallback in case the auto-paste doesn't land. Once the new lead opens, the extension waits for the details panel to render, clicks the pencil next to PA Contact ID, sets the value, and clicks Save — with a green confirmation toast on the new lead. Skips silently if the new lead already has a PA Contact ID set (won't overwrite). 5-minute TTL on the stashed value; cleared after success.",
      "Why this matters: PA Contact ID is what syncs the agent's FUB lead with the Salesforce lead. Forgetting to copy it onto every clone breaks that sync — this removes the manual step entirely."
    ]
  },
  {
    version: "1.50.13",
    headline: "Copy LOP file: auto-dismiss the \"Select a City\" modal during pricing scenario paste when a ZIP maps to multiple municipalities.",
    highlights: [
      "When the staged ZIP code is shared by multiple cities (e.g. 28081 covers Centerview / Fisher Town / Glass / Kannapolis / Royal Oaks / Shady Brook), LOP popped a \"Select a City\" modal that blocked the rest of the pricing form paste and Run pricing. The paste now watches for the modal after writing propertyZIP, finds the row matching the staged city (state too when available), clicks the radio, and clicks Select. Falls back to leaving the modal open for the LO if no row matches — better than silently picking the wrong municipality on a real loan."
    ]
  },
  {
    version: "1.50.12",
    headline: "Copy LOP file: capture & paste the HMDA \"demographic information provided through\" Select — and fall back to FaceToFace when the source was blank, so save validation doesn't bounce (which had been cascading into rolled-back credit consent).",
    highlights: [
      "Stage from this file / Paste from staged now explicitly captures the two collection.method <select>s on the Government Monitoring page (primaryBorrower.collection.method and coBorrower.collection.method) — HMDA-required fields the LO is often left blank on the source loan, which then blocks save validation on the destination. When source was blank, paste falls back to FaceToFace (the most common LO method) so the page validates and the rest of the save flow — including credit consent commit on the brand-new co-borrower section — actually persists. LO can override on the page after paste if a different collection method should apply."
    ]
  },
  {
    version: "1.50.11",
    headline: "Gmail drag: defensive force-draggable on attachment chips (experimental — covers the case where Gmail stopped marking chips draggable).",
    highlights: [
      "Targeted experiment for the Gmail → LOP drag failure where the cursor doesn't switch to the grab hand. The chip scanner now force-sets draggable=\"true\" on each detected attachment chip wrapper so native HTML5 drag will fire even if Gmail (or an intermediary) has stripped the attribute. The dragstart hijack was already at document capture phase, so that half of the experiment was already in place. If this doesn't restore drag, the remaining likely cause is Gmail's main-world code calling preventDefault on dragstart, which extensions cannot block — that would need to be raised with Gmail / IT."
    ]
  },
  {
    version: "1.50.10",
    headline: "Fixed Gmail attachment drag dying instantly (no grab cursor, no drag) — the Reply All Button's drag-mask was firing on attachment drags and aborting them.",
    highlights: [
      "The Reply All Button feature applied a display:none mask at dragstart capture phase to keep Gmail's More-row from expanding mid-drag. That mask is only meant for Gmail's CUSTOM mouse-based email drag (which doesn't fire dragstart), but it was also catching native HTML5 dragstart events — i.e. every attachment chip drag. Mutating the DOM at dragstart capture phase causes Chrome to abort the drag instantly, which is why the cursor stayed as a pointer and nothing happened. The mask now only triggers on the mousedown/mousemove path (Gmail email drags); attachment drags pass through untouched. Pre-existing bug; surfaced recently as Gmail tweaked its layout."
    ]
  },
  {
    version: "1.50.9",
    headline: "Add Co-Borrower to Salesforce: fixed the false \"No matching Salesforce lead tab open\" when the borrower's lead is clearly the active tab.",
    highlights: [
      "The Salesforce-side lead match leaned too heavily on finding a visible record-highlights node via deep-shadow traversal, so it would miss the open lead (e.g. 'Edward Saleeby | Lead') even when that console tab was active — reporting 'No matching Salesforce lead tab open.' Matching now also reads the console workspace tab strip (preferring the active tab, but accepting any tab whose label names the borrower), broadens the header selectors, and adds a visible-text last resort. It still requires BOTH the first and last name, so it won't fill the wrong lead.",
      "When no lead matches, the button now shows the specific reason from Salesforce (e.g. 'This Salesforce tab is not Edward Saleeby') instead of the generic 'No matching Salesforce lead tab open,' so it's clear whether the tab isn't open vs. the lead wasn't recognized."
    ]
  },
  {
    version: "1.50.8",
    headline: "Fixed the stuck grab/hand cursor — Scenario Sort no longer makes a giant page element draggable when there's only one scenario.",
    highlights: [
      "Scenario Sort's drag-to-reorder set cursor:grab + draggable on each scenario card's wrapper. With only ONE scenario, the wrapper-finder walked all the way up to a near-<body> ancestor, so the whole page showed the grab hand instead of the normal pointer. Drag-reorder now only turns on when there are 2+ scenario cards that share a common parent; otherwise any leftover drag styling is stripped. This removes the page-wide hand cursor LOs were seeing."
    ]
  },
  {
    version: "1.50.7",
    headline: "5% Collections button now also updates charge-offs that were submitted to collection (e.g. the Verizon account), matching the Total Collections badge.",
    highlights: [
      "The badge already counted remarks-only collections after v1.50.6, but the 5% Collections button still only acted on type=Collection/Unknown rows, so it skipped the Verizon account. It now reuses the same React-probe collection determination (which reads the 'SUBMITTED TO COLLECTION' remark) and matches it to the liabilities table by payee + balance, so those accounts get the 5%-of-balance monthly payment too."
    ]
  },
  {
    version: "1.50.6",
    headline: "FHA Collections / Disputed badges now catch charge-offs that were submitted to collection (e.g. an original-creditor account whose remarks say 'ACCT SUBMITTED TO COLLECTION').",
    highlights: [
      "A charge-off used to be dropped from both the Collections and Disputed totals. But a charge-off that was also placed/submitted to a collection agency IS a collection account — the badges missed those (e.g. the Verizon Wireless account) while correctly catching the separate collection-agency tradelines (LVNV Funding).",
      "Detection now also reads the Remarks for 'submitted/placed/assigned to collection' (and 'collection account' / 'in collection'). A charge-off is only excluded when it isn't also a collection; once it's in collection it counts toward the $2k collections cap and, if 'ACCT IN DISPUTE' is stamped, the $1k disputed cap too."
    ]
  },
  {
    version: "1.50.5",
    headline: "2% Grant PDF: fixed the state read — the loan header sometimes shows just the state (\"TX\") instead of \"City, ST\".",
    highlights: [
      "The eligibility check reported 'couldn't read the property state' on loans whose header chip is just a 2-letter state (e.g. TX) rather than 'City, ST'. It now anchors on the 'Open in Salesforce' header link and accepts either format, validated against the real state/territory list so it won't match stray two-letter words."
    ]
  },
  {
    version: "1.50.4",
    headline: "New: 2% Grant PDF on the Scenarios page — a ZHL Comparison PDF that shows ZHL paying 2% of the loan toward the down payment, lowering cash to close.",
    highlights: [
      "Adds a '2% Grant PDF' button next to ZHL Comparison PDF. The generated doc mirrors the comparison PDF but adds a 'ZHL Grant — 2% of loan amount' credit line and a 'Cash to close after ZHL Grant' headline number.",
      "Only clickable when ALL selected scenarios are Conf Home Ready 30 Yr Fixed with a loan amount of $350,000 or less, AND the property state is CA, DC, GA, PA, or TX. When it's not eligible the button is disabled and the hover tooltip says exactly why (wrong product, state not eligible, loan over $350k, or nothing selected)."
    ]
  },
  {
    version: "1.50.3",
    headline: "Add Co-Borrower to Salesforce: now matches the open lead in a Salesforce console (multiple lead tabs) instead of saying 'no matching tab.'",
    highlights: [
      "The lead-name match was too narrow — it only checked a couple of highlights selectors and missed the lead name in a Lightning console layout, so it reported 'No matching Salesforce lead tab open' even when the lead was right there. It now checks the visible record header, the active console workspace tab title, and the document title, scoped to VISIBLE nodes so it locks onto the ACTIVE lead (console apps keep inactive lead tabs mounted but hidden).",
      "New Contact now clicks the visible (active-tab) button, so on a multi-lead console it acts on the lead you're looking at."
    ]
  },
  {
    version: "1.50.2",
    headline: "VA Entitlement Calculator: ZIP now reads from LOP's Loan Details, county dropdown removed — just ZIP + an editable county loan limit.",
    highlights: [
      "Fixed ZIP detection. There are multiple 'Zip code' labels on the page (the Addresses form keeps its value in an <input>, so its text has no digits); the calculator was locking onto the wrong one. It now scans every 'Zip code' label and takes the first with a real 5-digit value — the right-rail Loan Details row.",
      "Removed the county dropdown. The panel is now just an editable Property ZIP (auto-fills the limit from the 2026 high-cost table when it matches) and an editable County loan limit field you can type any value into. Unit count still adjusts the 1–4 unit limit, and the FHFA lookup link is right there."
    ]
  },
  {
    version: "1.50.1",
    headline: "VA Entitlement Calculator: now reads the property ZIP reliably and shows an editable ZIP box.",
    highlights: [
      "Fixed ZIP detection — the right-rail Zip code value isn't a direct sibling of its label, so the calculator was reporting 'No ZIP found.' It now walks up from the Zip label and reads the value out of the row.",
      "Added an editable Property ZIP field at the top of the panel. Type or correct the ZIP and it re-derives the high-cost county pre-selection on the fly; the county dropdown + editable limit still override anything the ZIP can't pin down."
    ]
  },
  {
    version: "1.50.0",
    headline: "New: VA Entitlement Calculator — next to Run Residual Income Calc. Enter the entitlement used and it shows the max $0-down loan, plus the down payment required above that.",
    highlights: [
      "Full entitlement (nothing used) → no VA county limit and $0 down at any loan amount (subject to lender/investor max). Partial entitlement → available guaranty = 25% × county limit − used, max $0-down loan = 4 × available, and down for a higher target = 25% × loan − available.",
      "County loan limit comes from the 2026 FHFA table (all 150+ above-baseline counties embedded, with 1/2/3/4-unit limits). The property ZIP pre-selects the county for the common metros; a county dropdown + editable limit field cover everything else, with an FHFA lookup link. Defaults to the 2026 baseline ($832,750 / $1,066,250 / $1,288,800 / $1,602,750).",
      "Counts as 5 minutes saved per run."
    ]
  },
  {
    version: "1.49.24",
    headline: "VA Manual analyzer: Chapter 4 broken into individual checks (AUS auto-detected), each with a how-to-verify tooltip + ZHL Matrix and VA HB Ch. 4 links. Manual analyzers now count as 10 min saved.",
    highlights: [
      "The single 'Meets all requirements of VA Handbook Chapter 4' box is now five line items: AUS findings (Refer / Manual Downgrade), satisfactory credit, mortgage/rental history (1×30×12), BK/foreclosure/short-sale seasoning, and stable income — plus the separate VA guaranty confirmation.",
      "AUS findings auto-check when a 'Refer' / 'Manual Downgrade' recommendation is detected on the page; otherwise it falls back to a manual confirmation. Each manual item has a hover tooltip explaining exactly how to verify it, plus inline links to the ZHL VA Matrix and VA Handbook Chapter 4.",
      "Both manual-UW analyzers (FHA and VA) now record 10 minutes saved per run instead of 3, and the VA run logs under its own va-manual-eligible telemetry event."
    ]
  },
  {
    version: "1.49.23",
    headline: "Manual UW pill + analyzer now switch to VA on VA loans — VA Manual Eligible/Ineligible at a 660 floor, with a VA-specific analyzer (660 score, 43% DTI, residual income).",
    highlights: [
      "When the loan's Product name is VA, the Credit-section pill reads 'VA Manual Eligible / VA Manual Ineligible' against ZHL's 660 manual-UW floor (FHA loans still use 640).",
      "The Analyze Manual UW button opens a VA-specific analysis: minimum credit score 660, maximum DTI 43%, and residual income via the VA table (auto-pulled from the VA Residual Income Calc; 120% of the requirement when DTI > 41%), plus manual confirmations for VA Handbook Ch. 4 and VA guaranty eligibility. No FHA ratio tiers or compensating factors on the VA path.",
      "Per ZHL, the VA path intentionally leaves out investor-specific credit-score language — 660 is the floor, full stop."
    ]
  },
  {
    version: "1.49.22",
    headline: "Update toast now reads its headline straight from the changelog, so every new version gets a real toast (the hard-coded list had drifted ~30 releases out of date).",
    highlights: [
      "The bottom-right 'What's new' toast used a hard-coded headline map inside update-toast.js that hadn't been updated since v1.47.2 — so recent versions showed a bland 'Updated from X to Y' (or you may have missed it entirely). changelog.js is now loaded as a content script right before the toast, and the toast overlays window.ZHL_CHANGELOG headlines onto its fallback map. New releases now surface their real headline automatically with no hand-copying.",
      "Tip: reloading the unpacked extension doesn't re-run content scripts on already-open tabs — refresh the LOP / Gmail / Salesforce tab once after an update to see the toast."
    ]
  },
  {
    version: "1.49.21",
    headline: "Add Co-Borrower to Salesforce button moved next to the co-borrower's name, so Resend Link stays put at the far right.",
    highlights: [
      "v1.49.20 appended the button to the outer header row, but that row uses space-between with two items — adding a third pushed Resend Link into the middle. The button now appends inside the role-tag wrapper (right next to the name pill), so the outer row keeps its two children and Resend Link stays pinned at the far right where it's always been. Still a trailing append, so no header scramble / no refresh needed."
    ]
  },
  {
    version: "1.49.20",
    headline: "Fix: the Add Co-Borrower to Salesforce button no longer jumbles the borrower header (no refresh needed).",
    highlights: [
      "The button was inserted between React's existing header children (the co-borrower role tag and Resend Link). Inserting mid-list corrupts React's child reconciliation, so on its next re-render React mis-placed its own nodes and the header stayed scrambled until a full page refresh. The button is now appended to the end of the header row, which React's diff leaves alone — layout stays stable with no refresh."
    ]
  },
  {
    version: "1.49.19",
    headline: "New: Add Co-Borrower to Salesforce — one click takes the co-borrower from LOP into a Salesforce New Contact.",
    highlights: [
      "Adds an 'Add Co-Borrower to Salesforce' button next to the co-borrower's Resend Link on the Full Application page. It reads the co-borrower's first name, last name, cell phone, and email.",
      "The background worker finds your open Salesforce Lightning tab, confirms the lead matches the primary borrower by name, focuses it, clicks New Contact, and fills First / Last / Phone / Email with Role = Co-Borrower (Company auto-fills).",
      "Stops before saving on purpose — the filled New Contact modal is left on screen so you review it and click Next / Save yourself. If no Salesforce tab is open or the lead doesn't match the borrower, you get an inline message and nothing is changed."
    ]
  },
  {
    version: "1.49.18",
    headline: "Anonymous usage telemetry is now always on — the setup toggle is replaced with a locked \"Always on\" indicator.",
    highlights: [
      "isTelemetryEnabled() in the background worker now always returns true, so telemetry can't be disabled (and re-enables for anyone who'd turned it off previously). It still carries no borrower PII — tool name, duration, and work email only.",
      "The setup card's on/off switch is replaced with a locked \"🔒 Always on\" badge, and the \"Toggle off any time\" bullet now explains that it stays on because it's how the admin decides which modules to keep building."
    ]
  },
  {
    version: "1.49.17",
    headline: "Walkthrough + setup: documented 5 features that were missing, and gave every setup card a screenshot.",
    highlights: [
      "Five features were live (and toggleable in setup) but had no card on the walkthrough Tour: Pricing Exception Workflow, Print Buyer Worksheet, VA + non-spouse co-borrower warning, ZHL Loan Comparison PDF, and Max purchase price estimator. All five now have walkthrough cards in the Loan Officer Portal section and surface under New features.",
      "Added screenshots to the two setup cards that were missing them (VA + non-spouse co-borrower warning, Print Buyer Worksheet) so every module card on the setup page now shows a visual.",
      "Fixed the Print Buyer Worksheet setup copy to say three scenarios per page (it was still describing the original one-per-page layout)."
    ]
  },
  {
    version: "1.49.16",
    headline: "VA Residual Income: family size now counts co-borrowers (was always 1 for the primary).",
    highlights: [
      "Family size used to be 1 + (married ? 1 : 0) + dependents — so a joint VA file with two unmarried borrowers showed family size 1 and used the wrong VA table requirement. Now we count visible marital-status selects (one per borrower) and take the max of borrower-count vs. solo-married, so two unmarried borrowers gives family size 2; a married primary with a co-borrower spouse still gives 2 (no double-counting); a solo married borrower with 1 dependent still gives 3."
    ]
  },
  {
    version: "1.49.15",
    headline: "VA Residual Income Calc: the co-borrower now gets their own button when both borrowers are on the same tab (was only injecting on the primary).",
    highlights: [
      "On joint files where the primary and co-borrower are rendered side-by-side on one tab (e.g. Jessica & Brandon both veterans), the formScope walk-up was finding the WHOLE tab pane as the ancestor with an Employment table — both borrowers' walks landed on the same scope, and the de-dup dropped the co-borrower's section. Now the walk requires the ancestor to contain exactly one veteranType select, so each borrower gets their own section. Falls back to the old wider behavior if no narrower ancestor exists (legacy tab layouts).",
      "The inline \"Meets VA requirement\" chip next to Surviving Spouse also picks up the co-borrower automatically, since it iterates the same findMilitarySections() result."
    ]
  },
  {
    version: "1.49.14",
    headline: "Copy LOP file: staged loans now expire after 24 hours so the \"Paste from staged\" picker stays current.",
    highlights: [
      "Anything staged more than 24h ago is dropped from chrome.storage on the next load and never shows up in the picker. A loan staged this morning is useful at 4 PM; one staged 3 days ago almost certainly isn't — and seeing it next to fresh stages was just noise.",
      "Expiry runs on every load, so existing stale entries from before this update will be swept on the first next \"Paste from staged\" click."
    ]
  },
  {
    version: "1.49.13",
    headline: "New: VA + non-spouse co-borrower warning — sticky red banner when a non-veteran co-borrower is on a VA loan without being the veteran's married spouse.",
    highlights: [
      "Same visual language as the FHA + Non-Permanent Resident Alien warning: sticky red banner across the top of the page, plus a red outline on the offending fields (the non-vet co-borrower's Veteran type and any borrower's Marital status that isn't Married).",
      "Triggers when ALL of: (1) Product is VA, (2) at least one borrower is a qualifying veteran (Regular military / National Guard or reserves), (3) at least one OTHER borrower is non-veteran, AND (4) any borrower on the file isn't marked Married. ZHL only allows non-veteran co-borrowers on a VA loan when they're the veteran's legally married spouse, or when they independently qualify for VA themselves.",
      "Banner auto-clears as soon as you fix the cause — change the product off VA, set the co-borrower to a qualifying veteran type, or mark both borrowers Married."
    ]
  },
  {
    version: "1.49.12",
    headline: "VA Residual Income pass/fail chip is now on the main page next to Surviving spouse — no need to open the calc panel to see it.",
    highlights: [
      "Pulled the pass/caution/fail chips out of the residual income panel (both the title bar chip from v1.49.10 and the per-row dots from v1.49.11). The panel is back to its original look.",
      "The same chip now sits on the borrower form, inline next to the \"Surviving spouse\" checkbox. Same logic — green ✓ \"Meets VA (120%) requirement\", yellow ! \"Close to VA requirement\" (within $200), red ✗ \"Below VA requirement\". Label says \"VA 120% requirement\" vs \"VA requirement\" depending on whether the current scenario's DTI clears the 41% threshold.",
      "Live: recomputes whenever LOP re-renders or the LO edits income, debts, PITI, or scenario. Computed per-borrower from the form scope, so a veteran primary + non-veteran co-borrower file shows the chip on the veteran's side only. Hover the chip for the underlying residual / requirement / DTI numbers."
    ]
  },
  {
    version: "1.49.11",
    headline: "VA Residual Income chip now explicitly accounts for the 120% rule based on the current scenario's DTI — labeled \"VA 120%\" or \"VA table\" so you can see which one is being tested.",
    highlights: [
      "When the scenario's DTI is over 41%, the title chip now says \"Meets/Close to/Below VA 120% requirement\" instead of just \"VA requirement\" — so it's obvious which rule is being applied.",
      "Added a small \"120% rule\" / \"Base table\" tag next to the DTI row in the body, so you can confirm at a glance which tier the current DTI puts the borrower in.",
      "Each requirement row now gets its own compact pass/caution/fail dot. The base \"VA table requirement\" row shows pass against the table value; the \"Required at 120%\" row shows pass against the 120% bumped value. Both visible at once so you can see whether you'd still pass if DTI dropped under 41% (and vice versa)."
    ]
  },
  {
    version: "1.49.10",
    headline: "VA Residual Income Calc: title bar now shows a green ✓ / yellow ! / red ✗ chip telling you whether the borrower meets the VA table requirement.",
    highlights: [
      "Same visual language as the FHA Manual Eligibility badge — a colored pill next to the residual income number in the panel header. Green ✓ \"Meets VA requirement\" when residual clears the effective requirement by more than $200; yellow ! \"Close to VA requirement\" when residual is within $200 above the requirement (passing but a small tax or debt swing could flip them); red ✗ \"Below VA requirement\" when residual is under the requirement.",
      "The effective requirement is the 120% bumped value when DTI > 41%, otherwise the base VA table value — same number the panel already showed in the bottom rows. The chip's tooltip spells out the exact residual, effective requirement (and which one it is), and the delta."
    ]
  },
  {
    version: "1.49.9",
    headline: "Print Buyer Worksheet: fixed CSP error that prevented the print dialog from auto-firing.",
    highlights: [
      "The generated worksheet HTML used an inline <script> tag to call window.print() after load. The new tab (about:blank) inherits LOP's Content Security Policy, which blocks inline scripts — so the print dialog never fired and the console logged a CSP violation. Now print is triggered from the opener side (no script inside the printed doc), which doesn't run afoul of CSP."
    ]
  },
  {
    version: "1.49.8",
    headline: "Print Buyer Worksheet: only ONE button per section now (was duplicating), title is no longer \"Pre-approval Letter,\" and the layout fits 3 options per page instead of 1.",
    highlights: [
      "Fixed duplicate buttons in each section header. The walk-up that finds the header bar matched several nested ancestors at once; now we keep only the innermost, so exactly one button lands in each LTV section header next to Base Loan Amount.",
      "Dropped the borrower-name scrape. It was a heuristic regex and was matching the literal text \"Pre-approval Letter\" off some part of LOP's chrome, then rendering THAT as the h1. The handout now just says \"Rate Options\" under a \"Mortgage Rate Worksheet\" eyebrow, which matches what this tool actually is — a rate-shop comparison sheet, not a pre-approval.",
      "Redesigned the layout to 3 scenarios per page. Page header (LTV info + LO contact) and footer (timestamp + disclaimer) print once per page; each scenario gets a compact card with rate, monthly payment, cash to close, points/credit, closing costs, and breakeven. With 1–3 selected you get one page; 4–6 fills two; etc."
    ]
  },
  {
    version: "1.49.7",
    headline: "New: \"Print Buyer Worksheet\" button on the eligibility / pricing-results table — checks the rows you want, click once, get a Zillow-blue borrower handout.",
    highlights: [
      "On the pricing-results table (the rate-shop view with every available rate per LTV section), a \"Print Buyer Worksheet\" button appears in each LTV section header next to Base Loan Amount. Tick one or more rows in that section, click the button, and a new tab opens with a borrower-friendly handout — one scenario per page, single-column layout, Zillow-blue branded.",
      "The handout leads with two big numbers (Estimated monthly payment, Estimated cash to close), then a clean details table with purchase price, down payment, loan amount, rate, points (with plain-English explanation of credit vs. cost), closing costs, and breakeven. DTI is intentionally omitted — the borrower doesn't need their qualifying ratio on a comparison sheet.",
      "Auto-fires the print dialog so you can Save-as-PDF or send straight to the printer. Disabled state with hover-tooltip when nothing is checked in the section. Existing ZHL Comparison PDF on the saved-scenarios page is unaffected — this is a separate flow that works directly from the rate-shop table."
    ]
  },
  {
    version: "1.49.6",
    headline: "Time-saved toast: \"(as of …)\" suffix now always includes the date (e.g. \"5/26 4:15 PM\"), not just the time.",
    highlights: [
      "v1.49.5 only showed the date when the global-total cache was from a different day; today's refreshes showed time only. Now the date is always present so there's no ambiguity about which day the across-all-users number was pulled."
    ]
  },
  {
    version: "1.49.5",
    headline: "Time-saved toast: \"Across all users\" line now shows an \"(as of HH:MM)\" timestamp and refreshes faster (~10 min vs. up to 1h15m).",
    highlights: [
      "Extension cache TTL on the global total dropped from 1 hour to 10 minutes; Apps Script side dropped from 15 min to 5 min. Net effect: when you trigger the toast, the across-all-users number is at most ~15 min stale instead of up to ~75 min.",
      "Added an \"(as of HH:MM)\" suffix next to the global total so you can see exactly when the number was last refreshed from the server. If the timestamp doesn't tick over between toasts, you're seeing the cached value — fire one more action and the background refresh will land for the next toast."
    ]
  },
  {
    version: "1.49.4",
    headline: "PE Workflow: locked path no longer shows the \"Don't forget to attach 2 files\" reminder or auto-snips the scenario — comp pricing and LE are already in Encompass for locked loans.",
    highlights: [
      "On the email-preview step, the yellow attachment callout, the \"Capture scenario snip\" button, and the auto-capture step inside \"Open in Gmail + copy body\" are all suppressed when the LO answered \"Yes — locked\" on Q1. The RM only needs the email body for locked PE requests; the comp pricing and competitor LE live in Encompass already. Unlocked path is unchanged — still gets the reminder, the snip button, and the pre-Gmail auto-capture."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.49.3",
    headline: "PE Workflow Scenario snip: fixed \"captureVisibleTab failed: Either the '<all_urls>' or 'activeTab' permission is required\" by adding <all_urls> host permission.",
    highlights: [
      "Chrome's chrome.tabs.captureVisibleTab API requires either <all_urls> host permission or activeTab — host permission for the specific captured URL (https://operator.zillowhomeloans.com/*) does NOT satisfy the check, so the v1.49.0 auto-snip path was failing for everyone with the error above and falling back to the manual-snip message. activeTab wouldn't help here because it's only granted when the LO clicks the extension's action button / context menu / keyboard shortcut, not when they click a button inside the in-page PE modal. So <all_urls> was the only path that keeps the one-click auto-snip flow.",
      "Chrome will re-prompt to accept the broader site access on update. Nothing else in the extension uses the new permission — it's there strictly so captureVisibleTab can grab the LOP tab for the Scenario snip."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.49.2",
    headline: "PE Workflow Scenario snip: auto-navigates to the Scenarios tab first instead of failing when you're on Full application.",
    highlights: [
      "LOs reported the new snip step always errored with \"No ASSIGNED TO LOAN scenario found on this page\" because they always trigger the PE workflow from the Full application screen, not from Scenarios. The snip now drives the SPA — clicks the Pricing & Scenarios top-nav link, then the Scenarios sub-tab — before looking for the assigned scenario card. Waits up to 5s for the card to mount, then runs the existing snip + download flow. Doesn't navigate back afterwards (LO is about to open Gmail anyway, and SPA back-navigation isn't reliable enough to risk losing state).",
      "Warning callout on the email-preview step now mentions the page hop so the LO isn't surprised when the LOP tab changes screens during the capture."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.49.1",
    headline: "PE Workflow: removed the \"Have you uploaded the Comp LE to Tasks?\" checklist step in the unlocked path — the LO uploads it manually before requesting the PE anyway.",
    highlights: [
      "The unlocked path used to route U-assigned-scenario → U-comp-le-tasks → U-enter-pricing. Now it goes U-assigned-scenario → U-enter-pricing directly. The locked path's \"uploaded Comp LE to eFolder?\" question is unchanged — it asks about a different destination (eFolder vs Tasks)."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.49.0",
    headline: "Pricing Exception Workflow: auto-snips the assigned Scenario details to Downloads, auto-detects >2.5 pts from the entered numbers (no more manual question), email palette is now Zillow blue, and the email-preview step has a big yellow attachment reminder.",
    highlights: [
      "Scenario details snip: when you click \"Open in Gmail + copy body\" (or the new \"Capture scenario snip\" button), the workflow finds the ASSIGNED TO LOAN card, clicks its three-dots → View details, screenshots just that modal via chrome.tabs.captureVisibleTab, crops to the modal's bounding box, and saves it as Scenario_Details_<ZG#>.png to your Downloads folder. The PE workflow modal hides itself during the capture so it's not in the snip. Closes the View details modal when done.",
      "Attachment reminder: the email-preview step now has a yellow callout listing the EXACT two files you need to drag into Gmail — (1) the Scenario details snip we just auto-saved, (2) the competitor LE / worksheet. Used to say \"Attached: ZHL pricing summary, comp pricing summary, comp LE\" in the email body itself; both that line and the reminder now list only the two files that are actually required.",
      "Auto-detect >2.5 pts in the unlocked path: the workflow used to ask you \"Is your PE request under 2.5 points?\" right after computing the PE amount. Now it just reads s.pePoints from the calculation, sets isOver25 = (pePoints >= 2.5), and routes you straight to either the justification step or the email step. The locked path still asks because we don't have the PE size in that branch.",
      "Email body palette: section headers (\"Loan scenario\", \"Pricing comparison\", etc.), the competitor column header, and the comp column values all switched from amber (#b45309) to Zillow blue (#0b5cab). Section-header underline switched from light amber to light blue. The ZHL column was already blue, so the whole email now reads on-brand."
    ],
    sections: ["pricing-exception-workflow"]
  },
  {
    version: "1.48.2",
    headline: "Revert v1.48.1 scroll-to-top in SMS Mark All As Read — the scroll call left the messaging panel in a stuck 'no conversations with this person' state until the user manually toggled the Unread filter to refresh.",
    highlights: [
      "v1.48.1 tried to snap the inbox back to scrollTop=0 after a Mark All As Read run so the user landed on the newest thread instead of wherever the last marked thread sat. The scroll-container walk-up landed on the wrong element after the unread-filter re-render, and setting scrollTop on that parent put Salesforce's LWC into a state where the inbox rendered the empty 'You have no conversations with this person' card instead of the thread list. Flipping the Unread filter on and off manually was the only way to recover.",
      "Reverted to the v1.48.0 behavior — the inbox stays scrolled to wherever the marking loop ended. Will revisit with a safer scroll-target lookup later."
    ],
    sections: ["sms-mark-all-read"]
  },
  {
    version: "1.48.1",
    headline: "SMS Mark All As Read: after a run finishes, the inbox now scrolls back to the top instead of leaving you wherever the last thread happened to be.",
    highlights: [
      "Before: clicking Mark All As Read walked every unread thread, marking each one, then left the inbox scrolled to wherever the last marked thread sat in the list — usually somewhere in the middle. Users had to manually scroll back up to the most recent thread.",
      "Now: after the unread toggle is restored, the messaging panel's inbox scroll container is snapped back to scrollTop=0 so the user lands on the newest thread. Done in the finally block so it runs even if the marking loop bails out mid-run.",
      "NOTE: this change was reverted in v1.48.2 because the scroll call put the messaging panel into a stuck empty state. Keeping the entry here so the history reads continuous."
    ],
    sections: ["sms-mark-all-read"]
  },
  {
    version: "1.48.0",
    headline: "New \"5% Collections\" button on the Liabilities table — auto-applies the FHA 4000.1 5%-of-balance DTI rule to every non-medical collection in one click.",
    highlights: [
      "FHA 4000.1 says when cumulative non-medical collection balances total $2,000 or more, the lender must either pay them off, document an active payment plan, OR include 5% of each collection's unpaid balance as a monthly debt in DTI. Option 3 is the path most LOs take, but it meant expanding every collection row, calculating 5% by hand, and typing the payment in — slow and easy to mistype.",
      "Now: a \"5% Collections\" button sits next to Calc Student Loans / Exclude SelfReport on the Liabilities header. Click it and the extension expands each collection (Account type = Collection or Unknown), sets Monthly payment to balance × 0.05, and saves. Skips medical collections (excluded from FHA DTI), rows already marked Exclude or Payoff, and rows where you've already typed a payment manually (won't clobber a verified per-agreement number).",
      "Summary panel at the end shows every row updated, every row skipped, and the reason — same look as the Calc Student Loans summary so the audit trail reads the same. Updated payments are tagged in storage as calc:'collections-5pct' so a future re-run is idempotent."
    ],
    sections: ["va-calc"]
  },
  {
    version: "1.47.2",
    headline: "Exclude SelfReport now also excludes UTILITY SELFREPORTED lines — was only matching TELECOM SELFREPORTED.",
    highlights: [
      "User reported a credit report where Exclude SelfReport zeroed out two TELECOM SELFREPORTED rows correctly but left two UTILITY SELFREPORTED rows untouched ($252 and $212 — both still counted in DTI). Both line types follow the same rule (consumer-reported installment accounts that get excluded with reason 'Installment debt less than 10 payments'), so there was no reason for one to skip the other.",
      "Fix: payee matching switched from the single literal string 'TELECOM SELFREPORTED' to a regex /\\b(TELECOM|UTILITY)\\s+SELFREPORTED\\b/i so both variants get caught in the same pass. Button tooltip and the completion alert now mention both types. Telemetry event name (exclude_telecom_selfreport) stays the same so the historical time-saved series doesn't reset."
    ],
    sections: ["va-calc"]
  },
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
