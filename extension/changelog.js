// Version highlights surfaced in the walkthrough page's "What's new"
// section and in the bottom-right update toast on LOP/Gmail/Salesforce
// tabs. Newest at the top. Each entry:
//
//   version:    semver string, must match manifest.json on the release
//                that introduced these changes.
//   headline:   one-line summary used in the toast.
//   highlights: short bullet strings rendered in the walkthrough
//                "What's new" section.
//   sections:   optional array of walkthrough section ids to deep-link
//                from the toast's "View what's new" button.

window.ZHL_CHANGELOG = [
  {
    version: "1.21.2",
    headline: "Mark All As Read: accurate success counts + clean UX",
    highlights: [
      "Fixed: 'Marked 0 of N as read' dialog when threads were actually being marked correctly. The success check used to run while the thread view was still open — now it re-queries the inbox after Back to confirm the conversation is gone from the unread list.",
      "Added: 'Marking 2/3 threads as read…' overlay during the run so users don't see threads flickering open and closed.",
      "Button now hides itself when you have a conversation open — it only makes sense in the inbox view. Reappears when you click Back.",
      "Honest about the constraint: Salesforce only marks threads read by opening them (PubNub READ broadcast fires on open). There's no public 'mark as read' API to call directly."
    ],
    sections: ["sms-mark-read"]
  },
  {
    version: "1.21.1",
    headline: "Multiple workspace fixes + dedicated New Features section in the walkthrough",
    highlights: [
      "Auto Call Details Tab + Salesforce Promotions auto-hide: now work across multiple open Lead workspace tabs in Console mode (tracked per DOM node instead of per URL — Console mounts every open workspace simultaneously so the URL-keyed approach only fired on the first tab).",
      "SMS Mark All As Read: clicks now use composed:true events so they cross shadow DOM into LWC handlers, and the module tries multiple inner targets (.row-container → c-slds-sms-inbox-thread → h3 → .preview → li) instead of giving up after the first one didn't navigate.",
      "Walkthrough page: NEW features now appear in a dedicated 'New features' section at the top of the page in addition to their app sections, so the freshest stuff is always above the fold."
    ],
    sections: ["new-features"]
  },
  {
    version: "1.21.0",
    headline: "Mark all SMS threads as read with one button",
    highlights: [
      "Salesforce Messaging panel gets a Mark All As Read button next to New thread.",
      "Walks each unread thread, opens it (which is what Salesforce uses to mark a thread as read), then clicks Back to return to the inbox.",
      "Heavy console logging at every step so any failure mode is debuggable from the F12 console."
    ],
    sections: ["sms-mark-read"]
  },
  {
    version: "1.20.3",
    headline: "Toast 'View' button bypasses adblockers + clearer Copy-addresses demo",
    highlights: [
      "Update toast's View what's new button now opens the walkthrough through the service worker so uBlock / privacy extensions can't block it.",
      "Copy-addresses demo animation now actually shows the address landing in the co-borrower section (was sliding down and fading without arriving)."
    ],
    sections: ["whats-new", "address-copy"]
  },
  {
    version: "1.20.2",
    headline: "Fixed: update toast now actually appears on first page load after an update",
    highlights: [
      "Update toast was silently stamping 'seen' on the first load when no prior version was stored — meaning existing users updating to v1.20.0 never saw it.",
      "Fresh installs vs. existing users are now distinguished via chrome.runtime.onInstalled instead of guessing from storage.",
      "Added startup console.log so you can verify the toast module loaded and see why it did/didn't show."
    ],
    sections: ["whats-new"]
  },
  {
    version: "1.20.0",
    headline: "New: in-extension walkthrough page + update notifications",
    highlights: [
      "Walkthrough page collects every feature in one place with screenshots and 'where to find it' hints.",
      "Bottom-right toast appears on LOP/Gmail/Salesforce when the extension updates so you don't miss new features.",
      "Fresh installs now auto-open the walkthrough instead of the setup page."
    ],
    sections: ["whats-new"]
  },
  {
    version: "1.19.8",
    headline: "Drag Gmail attachments to your INLINE reply (not just popups)",
    highlights: [
      "Gmail Drag — inline replies (no popup) now accept attachment drops instead of pasting the filename as text.",
      "Copy addresses — confirm dialog skipped when the destination is empty.",
      "Copy addresses — ~700ms faster per address.",
      "FHA Manual Eligible pill — hover for the full Manual UW guideline matrix.",
      "FHA Disputed badge — now reads ACCT IN DISPUTE from the Remarks field (LOP's structured dispute flags are never populated)."
    ],
    sections: ["gmail-drag", "address-copy", "fha-manual"]
  },
  {
    version: "1.19.0",
    headline: "FHA Manual UW eligibility badge under the Credit section",
    highlights: [
      "Pill under the Credit heading shows ✓ FHA Manual Eligible (green) or ✗ FHA Manual Ineligible (red).",
      "Uses the LOWER middle score across borrowers; hover reveals the full UW guideline matrix.",
      "Copy addresses primary → co-borrower button on every empty co-borrower section."
    ],
    sections: ["fha-manual", "address-copy"]
  },
  {
    version: "1.18.0",
    headline: "Branded 2-1 Buydown PDF + LO Profile",
    highlights: [
      "One 2-1 Buydown PDF button (side-by-side scenario columns, PITIA payment labels).",
      "Pull LO Profile (Name/Email/Phone) straight from Salesforce on the setup page.",
      "Attribution tooltip — hover any ZHL Pack UI element to see who built it."
    ],
    sections: ["buydown-pdf"]
  },
  {
    version: "1.15.0",
    headline: "FHA + Non-Permanent Resident Alien warning banner",
    highlights: [
      "Sticky red banner when FHA + NPRA borrowers are detected (HUD removed NPRA from FHA eligibility May 25, 2025)."
    ],
    sections: ["fha-npr"]
  },
  {
    version: "1.12.0",
    headline: "FHA Collections + Disputed badges with $2k / $1k cumulative caps",
    highlights: [
      "Live badges on the Liabilities section showing total Collections and Disputed against the FHA cumulative caps.",
      "Tasks bulk-delete — checkbox column + Delete Selected button on Unsent and Awaiting borrower tables."
    ],
    sections: ["fha-badges", "task-bulk"]
  }
];
