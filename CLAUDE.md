# ZHL Productivity Pack — instructions for Claude Code

## Repo / remote situation

- This project's home is Zillow's internal GitLab:
  `gitlab.zgtools.net/zillow-home-loans/code-owners/quaffle/zhl-productivity-pack-extension`
- When working on Justin's laptop (Documents\zhl-productivity-pack-extension),
  `origin` IS that GitLab repo. GitLab is only reachable on the ZG VPN.
- The old public GitHub repo (case2392/ZHLExtensions) is historical/personal.
  Do not treat it as the source of truth and do not add it as a remote.

## Versioning conventions

- Every user-visible change bumps `extension/manifest.json` version
  (e.g. 1.64.38 → 1.64.39) and adds a matching entry at the TOP of
  `extension/changelog.js` (version, category, headline, highlights).
- Commit messages: first line `v<version>: <short summary>`, then a body
  explaining what/why in plain English.

## REQUIRED: end-of-work push instructions

After completing any change (especially a version bump), ALWAYS end your
final reply with a copy-paste block of the exact commands Justin types
into Command Prompt to push the work to GitLab, in this form:

```
cd %USERPROFILE%\Documents\zhl-productivity-pack-extension
git add -A
git commit -m "v1.64.XX: one-line summary of the change"
git push origin main
```

- Substitute the real version number and a real one-line summary.
- If you already committed during the session, omit the add/commit lines
  and give only the push line — never make him commit twice.
- If you are able to run git yourself in his environment, you may run
  add/commit directly, but still print the push line for him unless the
  push has verifiably succeeded.
- Remind him the ZG VPN must be on for the push to work.

## Feature-sunset checklist (when LOP/Genesys ships a feature natively)

Remove ALL of: the module file in `extension/modules/`, its
`content_scripts` entry in `manifest.json`, its `data-feature` card in
`setup.html`, its key in `setup.js` AND `background.js` FEATURE_KEYS,
its walkthrough entry, and its SVG in `extension/images/`. Then bump the
version + changelog as usual. (Precedent: ZHL Loan Amount Field, v1.64.38.)
