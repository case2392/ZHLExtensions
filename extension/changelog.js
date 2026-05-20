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
