# Telemetry setup — admin dashboard

This is a one-time setup. End-users don't need to do anything beyond reloading the extension once you push the new version.

## What you'll have when you're done

- A **Google Sheet** with three tabs:
  - `Events` — every action, one row per event, with the user's email, name, version, and props.
  - `Users` — one row per person who's used the extension, with first/last seen dates and total event count.
  - `Daily` — per-day per-user per-event counts, ready to drop into a chart.
- A **Web App URL** that the extension POSTs to. Only you have access to the Sheet; the URL itself just accepts events.

## Steps

### 1. Create the Sheet + Apps Script

1. Make a new Google Sheet. Name it whatever (e.g. `ZHL Productivity Pack — Telemetry`). Keep this Sheet private — only your account.
2. Inside that Sheet: **Extensions → Apps Script**. A new tab opens.
3. Replace the default `Code.gs` contents with the contents of `apps-script/Code.gs` from this repo.
4. Save (Ctrl+S). Name the project (e.g. `ZHL Pack Telemetry`).
5. In the Apps Script toolbar, change the function dropdown to `setup`, click **Run**, authorize when prompted. (It only asks for access to "this spreadsheet".)
6. You'll see an alert "Setup complete." and three new tabs in the Sheet: `Events`, `Users`, `Daily`.

### 2. Deploy as a Web App

1. **Deploy → New deployment**.
2. Choose:
   - **Type:** Web app
   - **Description:** `ZHL Pack telemetry`
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone *(this is required so the extension can POST without auth — anyone who has the URL can append events, but they can't read the Sheet)*
3. Click **Deploy**. Authorize again if prompted.
4. **Copy the Web app URL.** It looks like `https://script.google.com/macros/s/AKfyc.../exec`.

### 3. Wire the URL into the extension

1. Open `extension/background.js`.
2. Find the line `const TELEMETRY_ENDPOINT = "";`
3. Paste your Web app URL between the quotes:
   ```js
   const TELEMETRY_ENDPOINT = "https://script.google.com/macros/s/.../exec";
   ```
4. Bump `extension/manifest.json` `version` (e.g. `1.8.0` → `1.8.1`).
5. Commit, push, and reload the extension.

### 4. Test

1. Reload the extension in `chrome://extensions`.
2. Open Gmail (so identity capture fires).
3. Use any module — e.g. open the 2-1 Buydown panel, run VA Calc, sort scenarios.
4. Within ~30 seconds, refresh the Sheet. You should see rows appearing in `Events`, your email in `Users`, and counts in `Daily`.

## How identity works

- The first time the user has any Gmail tab open, the extension reads the email and display name from the Google account button's `aria-label`. That email becomes their stable identifier.
- Until that capture happens, events are sent with an anonymous UUID. Once the email is captured, future events are tagged with the email and the `Users` upsert merges any anonymous activity into the right person.
- **Reinstall:** The anonymous UUID is wiped, but the next Gmail capture re-binds the same email. The existing row in `Users` is updated; no new user is created.
- **New version:** Same. Every event includes the running extension version, so you can see adoption per release in the `Events.Version` column.

## Admin dashboard

Open the same Web App URL in your browser (the one ending in `/exec`). You'll see the dashboard:

- **Summary cards** — total users, total events, events in the last 24h, latest version in the wild.
- **Events per day** chart — see usage trend over the selected window.
- **Top tools** — bar list, click any tool to filter the rest of the page to just that event.
- **Users table** — sorted by event count desc; click any row to drill into just that user.
- **Recent events** — last 100 events, newest first.

The dashboard auto-refreshes every 60 seconds and reads live from the `Events` and `Users` sheets, so changes show up immediately. Window is adjustable (1 day → 1 year).

Because the deployment URL is domain-restricted (`/a/macros/zillowgroup.com/`), only people signed into a `zillowgroup.com` Google account can load it. That's how it stays admin-only without an explicit login.

## Updating the dashboard / receiver code

Apps Script needs an explicit "new deployment version" for changes to take effect:

1. Open your Apps Script project.
2. Edit `Code.gs`, save.
3. **Deploy → Manage deployments** → pencil icon next to your active deployment → **Version: New version** → **Deploy**.
4. The URL stays the same. Refresh the dashboard tab in your browser.

## Adding more events

Inside any module file, after the file's existing setup:

```js
function track(event, props) {
  try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
}

// then anywhere:
track('my_new_event', { whatever: 'props' });
```

## Privacy

- No email contents, SMS contents, Salesforce record contents, or phone numbers are sent.
- Events contain: feature name, action name, occasionally a small numeric prop (e.g. how many cards were sorted), and the URL of the page the event fired on.
- Users see a setup-page toggle ("Anonymous usage telemetry") and can opt out at any time.
