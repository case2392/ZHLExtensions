// ZHL Productivity Pack — telemetry receiver (Google Apps Script).
//
// Deploy this as a Web App bound to a Google Sheet. The extension's
// background worker POSTs JSON event batches here; this script appends
// rows to an `Events` sheet and upserts a per-user row to a `Users`
// sheet.
//
// SETUP (one-time, ~5 minutes):
//   1. Create a new Google Sheet. Name it whatever you want (e.g. "ZHL
//      Productivity Pack — Telemetry").
//   2. In that Sheet: Extensions → Apps Script. A new tab opens.
//   3. Replace the default `Code.gs` contents with THIS file's contents.
//   4. Save (Ctrl+S). Name the project (e.g. "ZHL Pack Telemetry").
//   5. In the Apps Script toolbar, click the function dropdown, choose
//      `setup`, then click Run. Authorize when prompted (it needs
//      access to "this spreadsheet" only).
//   6. Click Deploy → New deployment.
//        - Type: Web app
//        - Description: ZHL Pack telemetry
//        - Execute as: Me (your account)
//        - Who has access: Anyone   ← required for the extension to POST
//        - Click Deploy. Authorize again if prompted.
//   7. Copy the "Web app" URL it gives you. It looks like:
//        https://script.google.com/macros/s/AKfyc.../exec
//   8. Paste that URL into `extension/background.js` as the value of
//      `TELEMETRY_ENDPOINT`. Bump the extension version, reload the
//      extension. Done.
//
// To re-deploy after editing this script: Deploy → Manage deployments
// → pencil icon → Version: New version → Deploy. The URL stays the
// same (no extension change needed).

const SHEET_EVENTS = 'Events';
const SHEET_USERS = 'Users';
const SHEET_DAILY = 'Daily';

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run this from the Sheet whose Apps Script project this is.');

  let s = ss.getSheetByName(SHEET_EVENTS);
  if (!s) {
    s = ss.insertSheet(SHEET_EVENTS);
    s.appendRow(['Timestamp', 'Email', 'Name', 'AnonId', 'Version', 'Event', 'Props (JSON)', 'URL', 'BatchSentAt']);
    s.setFrozenRows(1);
    s.setColumnWidth(1, 170);
    s.setColumnWidth(2, 220);
    s.setColumnWidth(3, 160);
    s.setColumnWidth(7, 320);
  }

  let u = ss.getSheetByName(SHEET_USERS);
  if (!u) {
    u = ss.insertSheet(SHEET_USERS);
    u.appendRow(['Email', 'Name', 'AnonId', 'FirstSeen', 'LastSeen', 'LatestVersion', 'EventCount']);
    u.setFrozenRows(1);
    u.setColumnWidth(1, 240);
  }

  let d = ss.getSheetByName(SHEET_DAILY);
  if (!d) {
    d = ss.insertSheet(SHEET_DAILY);
    d.appendRow(['Date', 'Email', 'Event', 'Count']);
    d.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert('Setup complete. Now Deploy → New deployment → Web app, and paste the URL into background.js.');
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const events = Array.isArray(payload.events) ? payload.events : [];
    const user = payload.user || {};
    const email = (user.email || '').toString().trim();
    const name = (user.name || '').toString().trim();
    const anonId = (user.id || '').toString().trim();
    const version = (payload.extensionVersion || '').toString();
    const sentAt = payload.sentAt || new Date().toISOString();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s = ss.getSheetByName(SHEET_EVENTS) || ss.insertSheet(SHEET_EVENTS);
    if (s.getLastRow() === 0) {
      s.appendRow(['Timestamp', 'Email', 'Name', 'AnonId', 'Version', 'Event', 'Props (JSON)', 'URL', 'BatchSentAt']);
      s.setFrozenRows(1);
    }

    const rows = events.map(function (evt) {
      return [
        new Date(evt.ts || Date.now()),
        email,
        name,
        anonId,
        version,
        (evt.name || '').toString(),
        JSON.stringify(evt.props || {}),
        (evt.url || '').toString(),
        sentAt
      ];
    });
    if (rows.length > 0) {
      s.getRange(s.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    upsertUser_(ss, { email, name, anonId, version, eventDelta: rows.length });
    rollupDaily_(ss, email, events);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, accepted: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Upsert a row in the Users sheet, keyed by email when known and by
// anonId otherwise. When a batch arrives with both an email AND an
// anonId, AND we already have an anon-only row for that anonId from
// earlier batches, we MERGE the anon row's eventCount into the email
// row and delete the anon row. This stops the dashboard from showing
// the same person twice (one anon, one identified) once Gmail
// identity capture catches up.
function upsertUser_(ss, info) {
  const u = ss.getSheetByName(SHEET_USERS);
  if (!u) return;
  if (!info.email && !info.anonId) return;

  const data = u.getDataRange().getValues();
  let emailRow = -1;
  let anonRow = -1;

  for (var i = 1; i < data.length; i++) {
    const rowEmail = (data[i][0] || '').toString();
    const rowAnon = (data[i][2] || '').toString();
    if (info.email && rowEmail === info.email) emailRow = i + 1;
    // Only consider anon rows (rowEmail empty) for anonId match — an
    // anonId attached to an email row is just metadata.
    if (info.anonId && rowAnon === info.anonId && !rowEmail) anonRow = i + 1;
  }

  const now = new Date();

  if (info.email) {
    // Identified batch — upsert the email row, then fold any matching
    // anon row into it.
    if (emailRow === -1) {
      u.appendRow([info.email, info.name, info.anonId, now, now, info.version, info.eventDelta]);
      emailRow = u.getLastRow();
    } else {
      if (info.name) u.getRange(emailRow, 2).setValue(info.name);
      if (info.anonId && !data[emailRow - 1][2]) u.getRange(emailRow, 3).setValue(info.anonId);
      u.getRange(emailRow, 5).setValue(now);
      if (info.version) u.getRange(emailRow, 6).setValue(info.version);
      u.getRange(emailRow, 7).setValue((Number(data[emailRow - 1][6]) || 0) + info.eventDelta);
    }
    if (anonRow !== -1) {
      const orphanCount = Number(data[anonRow - 1][6]) || 0;
      const currentEmailCount = Number(u.getRange(emailRow, 7).getValue()) || 0;
      u.getRange(emailRow, 7).setValue(currentEmailCount + orphanCount);
      u.deleteRow(anonRow);
    }
  } else {
    // Anonymous batch — upsert the anon row.
    if (anonRow === -1) {
      u.appendRow(['', info.name, info.anonId, now, now, info.version, info.eventDelta]);
    } else {
      u.getRange(anonRow, 5).setValue(now);
      if (info.version) u.getRange(anonRow, 6).setValue(info.version);
      u.getRange(anonRow, 7).setValue((Number(data[anonRow - 1][6]) || 0) + info.eventDelta);
    }
  }
}

// Daily rollup: per-day per-user per-event counts. Cheap denormalized
// table the dashboard reads instead of scanning Events on every refresh.
function rollupDaily_(ss, email, events) {
  const d = ss.getSheetByName(SHEET_DAILY);
  if (!d) return;
  const tz = Session.getScriptTimeZone();
  const counts = {};
  events.forEach(function (evt) {
    const day = Utilities.formatDate(new Date(evt.ts || Date.now()), tz, 'yyyy-MM-dd');
    const key = day + '' + email + '' + (evt.name || '');
    counts[key] = (counts[key] || 0) + 1;
  });
  const data = d.getDataRange().getValues();
  const index = {};
  for (var i = 1; i < data.length; i++) {
    const k = data[i][0] + '' + (data[i][1] || '') + '' + (data[i][2] || '');
    index[k] = i + 1;
  }
  const newRows = [];
  Object.keys(counts).forEach(function (k) {
    if (index[k]) {
      const rownum = index[k];
      const current = Number(d.getRange(rownum, 4).getValue()) || 0;
      d.getRange(rownum, 4).setValue(current + counts[k]);
    } else {
      const parts = k.split('');
      newRows.push([parts[0], parts[1], parts[2], counts[k]]);
    }
  });
  if (newRows.length > 0) {
    d.getRange(d.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
}

// One-time admin utility. Run from the Apps Script editor (function
// dropdown → cleanupAnonRows → Run) to retroactively merge any anon
// Users rows whose anonId has since been seen with an email in the
// Events sheet. Cleans up the historical (anon) rows you can see on
// the dashboard right now.
function cleanupAnonRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const evSheet = ss.getSheetByName(SHEET_EVENTS);
  const usSheet = ss.getSheetByName(SHEET_USERS);
  if (!evSheet || !usSheet) throw new Error('Run setup() first.');

  // Build anonId → email map from Events. Only rows where BOTH email
  // and anonId are non-empty contribute — that's the link.
  const evRows = evSheet.getDataRange().getValues();
  const anonToEmail = {};
  for (var i = 1; i < evRows.length; i++) {
    const email = (evRows[i][1] || '').toString();
    const anonId = (evRows[i][3] || '').toString();
    if (email && anonId && !anonToEmail[anonId]) anonToEmail[anonId] = email;
  }

  // Walk Users from the bottom up so deletions don't shift indices.
  const usRows = usSheet.getDataRange().getValues();
  let merged = 0;
  for (var r = usRows.length - 1; r >= 1; r--) {
    const rowEmail = (usRows[r][0] || '').toString();
    const rowAnon = (usRows[r][2] || '').toString();
    const rowCount = Number(usRows[r][6]) || 0;
    if (rowEmail) continue; // already identified
    if (!rowAnon || !anonToEmail[rowAnon]) continue;
    const targetEmail = anonToEmail[rowAnon];
    // Find the email row to merge into.
    let targetRow = -1;
    for (var t = 1; t < usRows.length; t++) {
      if ((usRows[t][0] || '').toString() === targetEmail) { targetRow = t + 1; break; }
    }
    if (targetRow === -1) {
      // Promote the anon row to an email row in place.
      usSheet.getRange(r + 1, 1).setValue(targetEmail);
    } else {
      const targetCount = Number(usSheet.getRange(targetRow, 7).getValue()) || 0;
      usSheet.getRange(targetRow, 7).setValue(targetCount + rowCount);
      usSheet.deleteRow(r + 1);
    }
    merged++;
  }

  SpreadsheetApp.getUi().alert('Done. Merged ' + merged + ' anon row(s) into their identified counterparts.');
}

function doGet() {
  // Serve the admin dashboard at the same /exec URL the extension POSTs
  // to. Domain-restricted deployments (URL contains /a/macros/<domain>/)
  // automatically gate this to your Workspace, so only people in your
  // org with the URL can see it.
  return HtmlService.createHtmlOutput(DASHBOARD_HTML_)
    .setTitle('ZHL Productivity Pack — Telemetry Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Lightweight aggregator. Reads the pre-summarized Daily and Users
// sheets (small, already keyed) and only the LAST chunk of Events for
// the recent-events table. Avoids scanning the full Events sheet on
// every dashboard refresh — that was the resource hog before.
function getDashboardData(opts) {
  opts = opts || {};
  const daysBack = Math.max(1, Math.min(365, Number(opts.daysBack) || 30));
  const filterUser = (opts.filterUser || '').toString().toLowerCase().trim();
  const filterEvent = (opts.filterEvent || '').toString().trim();
  const tz = Session.getScriptTimeZone();
  const cutoffMs = Date.now() - daysBack * 86400 * 1000;
  const cutoffDay = Utilities.formatDate(new Date(cutoffMs), tz, 'yyyy-MM-dd');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dailySheet = ss.getSheetByName(SHEET_DAILY);
  const usersSheet = ss.getSheetByName(SHEET_USERS);
  const eventsSheet = ss.getSheetByName(SHEET_EVENTS);
  if (!dailySheet || !usersSheet || !eventsSheet) {
    throw new Error('Run setup() first to create the Events / Users / Daily sheets.');
  }

  // ---- Aggregations from the small Daily sheet ----------------------
  const byDayCount = {};
  const byEventCount = {};
  const byUserCount = {};
  let totalEvents = 0;

  const dailyValues = dailySheet.getDataRange().getValues();
  for (var i = 1; i < dailyValues.length; i++) {
    const r = dailyValues[i];
    const date = (r[0] || '').toString();
    const email = (r[1] || '').toString();
    const event = (r[2] || '').toString();
    const count = Number(r[3]) || 0;
    if (!date || count === 0) continue;
    if (date < cutoffDay) continue;
    if (filterUser && email.toLowerCase() !== filterUser) continue;
    if (filterEvent && event !== filterEvent) continue;
    byDayCount[date] = (byDayCount[date] || 0) + count;
    byEventCount[event] = (byEventCount[event] || 0) + count;
    const userKey = email || '(anonymous)';
    byUserCount[userKey] = (byUserCount[userKey] || 0) + count;
    totalEvents += count;
  }

  // ---- Recent events: read the last 200 rows of Events directly,
  // not the whole sheet. Ranged read is much cheaper than a full scan.
  const lastRow = eventsSheet.getLastRow();
  const recent = [];
  if (lastRow > 1) {
    const want = 200;
    const start = Math.max(2, lastRow - want + 1);
    const numRows = lastRow - start + 1;
    const recentValues = eventsSheet.getRange(start, 1, numRows, 9).getValues();
    for (var j = recentValues.length - 1; j >= 0 && recent.length < 50; j--) {
      const r = recentValues[j];
      const ts = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
      if (!ts || ts < cutoffMs) continue;
      const email = (r[1] || '').toString();
      const event = (r[5] || '').toString();
      if (filterUser && email.toLowerCase() !== filterUser) continue;
      if (filterEvent && event !== filterEvent) continue;
      recent.push({
        ts: ts,
        email: email,
        name: (r[2] || '').toString(),
        version: (r[4] || '').toString(),
        event: event,
        props: (r[6] || '').toString()
      });
    }
  }

  // ---- 24h count: count Events rows with ts >= 24h ago ---------------
  // Cheap because we're already iterating the recent slice.
  let eventsLast24h = 0;
  const oneDayAgo = Date.now() - 24 * 3600 * 1000;
  for (var k = 0; k < recent.length; k++) {
    if (recent[k].ts >= oneDayAgo) eventsLast24h++;
  }

  // ---- Users: read the (small) Users sheet directly ------------------
  const users = [];
  const usersValues = usersSheet.getDataRange().getValues();
  for (var u = 1; u < usersValues.length; u++) {
    const row = usersValues[u];
    const email = (row[0] || '').toString();
    if (filterUser && email.toLowerCase() !== filterUser) continue;
    users.push({
      email: email,
      name: (row[1] || '').toString(),
      anonId: (row[2] || '').toString(),
      firstSeen: row[3] instanceof Date ? row[3].getTime() : null,
      lastSeen: row[4] instanceof Date ? row[4].getTime() : null,
      latestVersion: (row[5] || '').toString(),
      eventCount: Number(row[6]) || 0
    });
  }
  users.sort(function (a, b) { return (b.eventCount || 0) - (a.eventCount || 0); });

  // ---- Latest version = top-eventCount user's version ----------------
  const latestVersion = users.length > 0 ? users[0].latestVersion : '';

  return {
    summary: {
      totalUsers: Object.keys(byUserCount).length,
      totalEvents: totalEvents,
      eventsLast24h: eventsLast24h,
      latestVersion: latestVersion,
      windowDays: daysBack
    },
    byEvent: Object.keys(byEventCount).map(function (k) { return { event: k, count: byEventCount[k] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 20),
    byDay: Object.keys(byDayCount).map(function (k) { return { date: k, count: byDayCount[k] }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
    users: users.slice(0, 100),
    recent: recent
  };
}

// Lightweight dashboard — pure CSS, no Chart.js, no auto-refresh.
// Rebuilt to be GPU-friendly: the previous version used Chart.js
// inside the Apps Script iframe sandbox and triggered constant
// redraws that black-screened low-end machines.
const DASHBOARD_HTML_ =
'<!doctype html><html><head><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>ZHL Pack — Telemetry</title>' +
'<style>' +
':root{--bg:#0f1115;--card:#171a21;--card2:#1f232c;--bd:#2a2f3a;--fg:#e6e8ee;--mut:#8a93a6;--accent:#3b82f6}' +
'*{box-sizing:border-box}body{margin:0;font:14px -apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}' +
'header{padding:16px 22px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:14px;flex-wrap:wrap}' +
'header h1{margin:0;font-size:17px;font-weight:600}' +
'header .controls{margin-left:auto;display:flex;gap:8px;align-items:center}' +
'select,button{background:var(--card2);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:6px 10px;font:inherit}' +
'button{cursor:pointer}button:hover{background:var(--bd)}' +
'main{padding:16px 22px;display:grid;grid-template-columns:repeat(12,1fr);gap:12px}' +
'.card{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:12px}' +
'.card h2{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}' +
'.kpi{font-size:26px;font-weight:700}' +
'.s3{grid-column:span 3}.s6{grid-column:span 6}.s8{grid-column:span 8}.s12{grid-column:span 12}' +
'@media(max-width:1100px){.s3{grid-column:span 6}.s6,.s8{grid-column:span 12}}' +
'@media(max-width:640px){.s3,.s6,.s8{grid-column:span 12}}' +
'table{width:100%;border-collapse:collapse;font-size:13px}' +
'th,td{padding:6px 9px;text-align:left;border-bottom:1px solid var(--bd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}' +
'th{color:var(--mut);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px}' +
'tbody tr{cursor:pointer}tbody tr:hover{background:var(--card2)}' +
'.bar{height:5px;background:var(--bd);border-radius:3px;overflow:hidden;margin-top:3px}.bar>span{display:block;height:100%;background:var(--accent)}' +
'.muted{color:var(--mut)}.right{text-align:right}' +
'.chip{padding:2px 8px;border-radius:99px;font-size:12px;background:var(--accent);color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:5px;border:none}' +
'.chip .x{opacity:.85}' +
'.scroll{max-height:520px;overflow:auto}' +
'.daybars{display:flex;align-items:flex-end;gap:2px;height:120px;padding:6px 0}' +
'.daybars>div{flex:1;background:var(--accent);min-height:2px;border-radius:2px 2px 0 0;position:relative}' +
'.daybars>div:hover::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--card2);border:1px solid var(--bd);padding:3px 7px;border-radius:4px;font-size:11px;white-space:nowrap;z-index:10}' +
'.daylabels{display:flex;justify-content:space-between;font-size:10px;color:var(--mut);margin-top:6px}' +
'#status{font-size:12px;color:var(--mut);min-width:90px;text-align:right}' +
'.empty{padding:24px;text-align:center;color:var(--mut)}' +
'</style></head><body>' +
'<header>' +
'<h1>ZHL Pack — Telemetry</h1>' +
'<div id="filters" style="display:flex;gap:5px"></div>' +
'<div class="controls">' +
'<label class="muted" style="font-size:12px">Window</label>' +
'<select id="days"><option value="7">7d</option><option value="30" selected>30d</option><option value="90">90d</option><option value="365">1yr</option></select>' +
'<button id="refresh">Refresh</button>' +
'<span id="status">—</span>' +
'</div>' +
'</header>' +
'<main id="grid">' +
'<div class="card s3"><h2>Users</h2><div class="kpi" id="kpi-users">—</div></div>' +
'<div class="card s3"><h2>Events</h2><div class="kpi" id="kpi-events">—</div></div>' +
'<div class="card s3"><h2>Last 24h</h2><div class="kpi" id="kpi-24h">—</div></div>' +
'<div class="card s3"><h2>Version</h2><div class="kpi" id="kpi-version">—</div></div>' +
'<div class="card s8"><h2>Events per day</h2><div class="daybars" id="daybars"></div><div class="daylabels"><span id="lbl-from"></span><span id="lbl-to"></span></div></div>' +
'<div class="card s6"><h2>Top tools (click to filter)</h2><div id="top-tools"></div></div>' +
'<div class="card s6"><h2>Users (click to filter)</h2><div class="scroll"><table id="users-table"><thead><tr><th>Email</th><th class="right">Events</th><th>Last seen</th></tr></thead><tbody></tbody></table></div></div>' +
'<div class="card s12"><h2>Recent events</h2><div class="scroll"><table id="events-table"><thead><tr><th>When</th><th>User</th><th>Event</th><th>Props</th></tr></thead><tbody></tbody></table></div></div>' +
'</main>' +
'<script>' +
'var state={daysBack:30,filterUser:"",filterEvent:""};' +
'function fmtRel(ts){if(!ts)return"—";var d=Date.now()-ts;if(d<60000)return"now";if(d<3600000)return Math.floor(d/60000)+"m";if(d<86400000)return Math.floor(d/3600000)+"h";if(d<7*86400000)return Math.floor(d/86400000)+"d";return new Date(ts).toLocaleDateString()}' +
'function setText(id,t){document.getElementById(id).textContent=t}' +
'function refresh(){setText("status","Loading…");google.script.run.withSuccessHandler(render).withFailureHandler(function(err){setText("status","Error")}).getDashboardData(state)}' +
'function render(d){setText("status",new Date().toLocaleTimeString().slice(0,5));' +
'setText("kpi-users",d.summary.totalUsers);setText("kpi-events",d.summary.totalEvents);setText("kpi-24h",d.summary.eventsLast24h);setText("kpi-version",d.summary.latestVersion||"—");' +
'var f=document.getElementById("filters");f.innerHTML="";' +
'function chip(label,clear){var c=document.createElement("button");c.className="chip";c.innerHTML=label+\' <span class="x">×</span>\';c.onclick=clear;return c}' +
'if(state.filterUser)f.appendChild(chip("user: "+state.filterUser,function(){state.filterUser="";refresh()}));' +
'if(state.filterEvent)f.appendChild(chip("event: "+state.filterEvent,function(){state.filterEvent="";refresh()}));' +
'var tt=document.getElementById("top-tools");tt.innerHTML="";var max=(d.byEvent[0]||{}).count||1;' +
'd.byEvent.forEach(function(e){var row=document.createElement("div");row.style.cssText="margin:5px 0;cursor:pointer";' +
'row.innerHTML=\'<div style="display:flex;justify-content:space-between"><span>\'+e.event+\'</span><span class="muted">\'+e.count+\'</span></div><div class="bar"><span style="width:\'+(100*e.count/max)+\'%"></span></div>\';' +
'row.onclick=function(){state.filterEvent=e.event;refresh()};tt.appendChild(row)});' +
'if(!d.byEvent.length)tt.innerHTML=\'<div class="empty">No events.</div>\';' +
'var db=document.getElementById("daybars");db.innerHTML="";var dmax=1;d.byDay.forEach(function(x){if(x.count>dmax)dmax=x.count});' +
'd.byDay.forEach(function(x){var bar=document.createElement("div");bar.style.height=Math.max(2,Math.round(118*x.count/dmax))+"px";bar.setAttribute("data-tip",x.date+": "+x.count);db.appendChild(bar)});' +
'setText("lbl-from",(d.byDay[0]||{}).date||"");setText("lbl-to",(d.byDay[d.byDay.length-1]||{}).date||"");' +
'var ub=document.querySelector("#users-table tbody");ub.innerHTML="";' +
'd.users.forEach(function(u){var tr=document.createElement("tr");tr.innerHTML="<td>"+(u.email||\'<span class="muted">(anon)</span>\')+\'</td><td class="right">\'+u.eventCount+"</td><td>"+fmtRel(u.lastSeen)+"</td>";' +
'tr.onclick=function(){state.filterUser=u.email||"";refresh()};ub.appendChild(tr)});' +
'if(!d.users.length)ub.innerHTML=\'<tr><td colspan="3" class="empty">No users.</td></tr>\';' +
'var eb=document.querySelector("#events-table tbody");eb.innerHTML="";' +
'd.recent.forEach(function(e){var tr=document.createElement("tr");tr.innerHTML="<td>"+fmtRel(e.ts)+\'</td><td>\'+(e.email||\'<span class="muted">(anon)</span>\')+"</td><td>"+e.event+\'</td><td class="muted">\'+(e.props==="{}"?"":e.props)+"</td>";eb.appendChild(tr)});' +
'if(!d.recent.length)eb.innerHTML=\'<tr><td colspan="4" class="empty">No recent events.</td></tr>\'' +
'}' +
'document.getElementById("refresh").onclick=refresh;' +
'document.getElementById("days").onchange=function(){state.daysBack=Number(this.value);refresh()};' +
'refresh();' +
'</script></body></html>';
