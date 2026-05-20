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
