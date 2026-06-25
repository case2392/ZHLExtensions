// Setup page logic — feature toggles only.
// Caller ID still works using its built-in defaults from background.js;
// the config UI was removed per user request.

const FEATURE_KEYS = [
  "feature_gmailTweaks",
  "feature_salesforcePromotions",
  "feature_contactSms",
  "feature_loanAmount",
  "feature_vaCalc",
  "feature_buydownCalc",
  "feature_callerId",
  "feature_smsAddParticipants",
  "feature_sfVpaEmail",
  "feature_sfMossRequest",
  "feature_zohoBookingAutoNote",
  "feature_sfIntroEmail",
  "feature_loanStoryGenerator",
  "feature_autoCallDetailsTab",
  "feature_autoMessagingTab",
  "feature_scenarioSort",
  "feature_pricingResultsPrint",
  "feature_coborrowerToSf",
  "feature_gmailDragAttachments",
  "feature_appraisalBlast",
  "feature_calendarReminders"
  // feature_telemetry intentionally omitted — telemetry is always on
  // (no toggle in the UI; isTelemetryEnabled() in background.js always
  // returns true).
];

// Gmail Tweaks covers both the Gmail mail.google.com fixes and the
// Salesforce "Show Promotions" auto-disable. They live in separate content
// scripts but share one toggle so the user sees one row per "thing" rather
// than one row per script file.
const GMAIL_TWEAKS_LINKED = ["feature_gmailTweaks", "feature_salesforcePromotions"];

const $ = (id) => document.getElementById(id);

function showStatus(msg) {
  const el = $("save-status");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => el.classList.remove("show"), 1400);
}

async function loadFeatureStates() {
  const data = await chrome.storage.local.get(FEATURE_KEYS);
  document.querySelectorAll('input[data-feature]').forEach((input) => {
    const key = input.dataset.feature;
    const enabled = data[key] !== false; // default to enabled if unset
    input.checked = enabled;
    syncCardState(input);
  });
}

function syncCardState(input) {
  const card = input.closest('[data-module]');
  if (!card) return;
  card.classList.toggle('disabled', !input.checked);
}

document.querySelectorAll('input[data-feature]').forEach((input) => {
  input.addEventListener('change', async () => {
    const key = input.dataset.feature;
    const value = input.checked;
    const updates = { [key]: value };
    if (key === "feature_gmailTweaks") {
      for (const linked of GMAIL_TWEAKS_LINKED) updates[linked] = value;
    }
    await chrome.storage.local.set(updates);
    syncCardState(input);
    showStatus(value ? "Enabled — reload affected tabs" : "Disabled — reload affected tabs");
  });
});

// Loan Officer Profile — name / NMLS / phone / email used by
// borrower-facing PDFs. Stored in chrome.storage.local under the
// lo_* keys. Saves on input (debounced) so the user doesn't have
// to click a Save button.
const LO_FIELDS = ['lo_name', 'lo_nmls', 'lo_phone', 'lo_email', 'lo_zillow_url'];
async function loadLoProfile() {
  const data = await chrome.storage.local.get(LO_FIELDS);
  document.querySelectorAll('input[data-lo-field]').forEach((input) => {
    const key = input.dataset.loField;
    if (data[key] != null) input.value = data[key];
  });
}
const loSaveTimers = {};
document.querySelectorAll('input[data-lo-field]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.loField;
    clearTimeout(loSaveTimers[key]);
    loSaveTimers[key] = setTimeout(async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() });
      showStatus('Profile saved');
    }, 400);
  });
});
loadLoProfile();

// Meeting Reminders settings — the comma-separated lead times
// (minutes-before-start) that the Calendar Reminders module reads,
// plus a status line showing when (and whether) the Calendar-tab
// scraper last ran.
const CAL_FIELDS = ['cal_lead_times'];
async function loadCalSettings() {
  const data = await chrome.storage.local.get(CAL_FIELDS);
  document.querySelectorAll('input[data-cal-field]').forEach((input) => {
    const key = input.dataset.calField;
    if (data[key] != null && data[key] !== '') input.value = data[key];
    else if (key === 'cal_lead_times') input.value = '15';
  });
}
const calSaveTimers = {};
document.querySelectorAll('input[data-cal-field]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.calField;
    clearTimeout(calSaveTimers[key]);
    calSaveTimers[key] = setTimeout(async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() });
      showStatus('Meeting reminder settings saved');
    }, 500);
  });
});
loadCalSettings();

// Calendar status line — read zhlCalMeta to tell the LO whether their
// open Calendar tab is being scraped. Updates every 5s while the
// Setup page is open. "Stale" = no scrape in the last 30s, which
// almost always means no calendar.google.com tab is currently open
// in this browser.
function setCalStatus(text, color) {
  const el = document.getElementById('cal-status-detail');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '#6b7280';
}
async function refreshCalStatus() {
  try {
    const data = await chrome.storage.local.get(['zhlCalMeta', 'zhlCalEvents']);
    const meta = data.zhlCalMeta || {};
    const events = Array.isArray(data.zhlCalEvents) ? data.zhlCalEvents.length : 0;
    if (!meta.lastScrapeMs) {
      setCalStatus('no Calendar tab detected yet — open calendar.google.com', '#b91c1c');
      return;
    }
    const ageMs = Date.now() - meta.lastScrapeMs;
    if (ageMs < 30000) {
      setCalStatus('Calendar tab active · ' + events + ' upcoming event' + (events === 1 ? '' : 's') + ' loaded', '#16a34a');
    } else {
      const mins = Math.round(ageMs / 60000);
      setCalStatus('last scrape ' + (mins < 1 ? '<1 min' : mins + ' min') + ' ago — Calendar tab may be closed', '#b45309');
    }
  } catch (_) { /* ignore */ }
}
refreshCalStatus();
setInterval(refreshCalStatus, 5000);

// "Show test reminder" — writes a synthetic event a couple minutes out
// so the reminder card pops in any open Gmail tab immediately, without
// waiting for a real meeting or relying on the scraper. Bypasses the
// scraper entirely (writes straight to zhlCalEvents). Tagged uid
// "zhl-test*" so the Gmail side removes it on dismiss.
const calTestBtn = document.getElementById('cal-test-btn');
if (calTestBtn) {
  calTestBtn.addEventListener('click', async () => {
    const testStatus = document.getElementById('cal-test-status');
    try {
      const now = Date.now();
      const data = await chrome.storage.local.get(['zhlCalEvents', 'zhlCalDismissed', 'zhlCalSnooze']);
      const prev = Array.isArray(data.zhlCalEvents) ? data.zhlCalEvents : [];
      // Drop any earlier test events, then add a fresh one ~2 min out.
      const cleaned = prev.filter((e) => !(e && String(e.uid).indexOf('zhl-test') === 0));
      // Three preview reminders at different intervals so the LO can see
      // the stacked layout, the red "soon" coloring, a Join button, and
      // the ALL DAY badge all at once. Start times are spread so each
      // shows a distinct "in X minutes" (and one all-day).
      cleaned.push({
        uid: 'zhl-test-a-' + now,
        _tab: 'zhl-test-preview',
        startMs: now + 3 * 60000,    // in ~3 min → red "soon"
        endMs: now + 33 * 60000,
        title: 'Borrower call — Test preview',
        location: '',
        meet: 'https://meet.google.com/test-zhl-demo',
        allDay: false
      });
      cleaned.push({
        uid: 'zhl-test-b-' + now,
        _tab: 'zhl-test-preview',
        startMs: now + 25 * 60000,   // in ~25 min → blue
        endMs: now + 55 * 60000,
        title: 'Team standup — Test preview',
        location: '',
        meet: 'https://zillowgroup.zoom.us/j/0000000000',
        allDay: false
      });
      cleaned.push({
        uid: 'zhl-test-c-' + now,
        _tab: 'zhl-test-preview',
        // All-day preview: real all-day events anchor at 8am, but for the
        // preview we put startMs near now so it isn't filtered as expired
        // no matter when you click. The allDay flag is what drives the
        // "ALL DAY" badge — the exact start time is irrelevant for it.
        startMs: now + 60000,
        endMs: now + 31 * 60000,
        title: 'Quarterly planning (all-day) — Test preview',
        location: '',
        meet: '',
        allDay: true
      });
      // Clear any prior dismiss/snooze on test instances so it re-shows.
      const dism = data.zhlCalDismissed || {};
      const snz = data.zhlCalSnooze || {};
      Object.keys(dism).forEach((k) => { if (k.indexOf('zhl-test') === 0) delete dism[k]; });
      Object.keys(snz).forEach((k) => { if (k.indexOf('zhl-test') === 0) delete snz[k]; });
      await chrome.storage.local.set({ zhlCalEvents: cleaned, zhlCalDismissed: dism, zhlCalSnooze: snz });

      // Is a Gmail tab open to show it in?
      let gmailOpen = false;
      try {
        const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
        gmailOpen = tabs && tabs.length > 0;
        if (gmailOpen && tabs[0].id != null) {
          // Bring the first Gmail tab forward so the card is visible.
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId != null) chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } catch (_) {}

      if (testStatus) {
        testStatus.textContent = gmailOpen
          ? '✓ 3 test reminders sent — check your Gmail tab (brought to front).'
          : '✓ 3 test reminders queued — open a Gmail tab to see the pop-up.';
        testStatus.style.color = '#16a34a';
      }
    } catch (e) {
      if (testStatus) { testStatus.textContent = 'Error: ' + (e && e.message || e); testStatus.style.color = '#b91c1c'; }
    }
  });
}

// Insurance Agent defaults — used by the Intro Email module and auto-CC'd
// on every Intro Email draft. Same auto-save-on-input pattern as the LO
// Profile fields.
const IA_FIELDS = ['insurance_agent_name', 'insurance_agent_company', 'insurance_agent_phone', 'insurance_agent_email', 'insurance_agent_pronouns'];
// Default insurance agent. New installs see these pre-filled in Setup
// (not as placeholder hints — as actual editable values) so clicking
// Insurance Intro for the first time before touching Setup still sends
// a fully-populated draft. Kept in sync with KARSON_DEFAULTS in
// sf-intro-email.js.
const IA_DEFAULTS = {
  insurance_agent_name:    'Karson Carter',
  insurance_agent_company: 'Goosehead Insurance',
  insurance_agent_phone:   '(336) 596-3603',
  insurance_agent_email:   'Karson.carter@goosehead.com',
  insurance_agent_pronouns:'she/her'
};
async function loadInsuranceAgent() {
  const data = await chrome.storage.local.get(IA_FIELDS);
  const seeds = {};
  document.querySelectorAll('input[data-ia-field], select[data-ia-field]').forEach((input) => {
    const key = input.dataset.iaField;
    if (data[key] != null && data[key] !== '') {
      input.value = data[key];
    } else {
      // First time seeing this field — seed with the canonical default
      // AND write it to storage so the Intro Email module reads it.
      const def = IA_DEFAULTS[key] || '';
      input.value = def;
      if (def) seeds[key] = def;
    }
  });
  if (Object.keys(seeds).length) {
    try { await chrome.storage.local.set(seeds); } catch (_) {}
  }
}
const iaSaveTimers = {};
document.querySelectorAll('input[data-ia-field], select[data-ia-field]').forEach((input) => {
  const evt = input.tagName === 'SELECT' ? 'change' : 'input';
  input.addEventListener(evt, () => {
    const key = input.dataset.iaField;
    clearTimeout(iaSaveTimers[key]);
    iaSaveTimers[key] = setTimeout(async () => {
      await chrome.storage.local.set({ [key]: input.value.trim() });
      showStatus('Insurance agent saved');
    }, 400);
  });
});
loadInsuranceAgent();

// "Pull from Salesforce" button — asks the SW to fetch the current user's
// Name / Email / Phone from chatter/users/me and (best effort) NMLS from
// a User custom field discovered via describe. Only fills inputs that
// come back populated; never blanks out a value the user already typed.
const loPullBtn = $('lo-pull-from-sf');
const loPullStatus = $('lo-pull-status');
function setLoPullStatus(text, color) {
  if (!loPullStatus) return;
  loPullStatus.textContent = text || '';
  loPullStatus.style.color = color || '#6b7280';
}
function setInputValue(field, value) {
  const input = document.querySelector(`input[data-lo-field="${field}"]`);
  if (!input || value == null || String(value).trim() === '') return false;
  input.value = String(value).trim();
  return true;
}
if (loPullBtn) {
  loPullBtn.addEventListener('click', async () => {
    loPullBtn.disabled = true;
    setLoPullStatus('Looking up…', '#6b7280');
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SF_LO_PROFILE' });
      if (!resp || !resp.ok) {
        setLoPullStatus(resp && resp.error ? resp.error : 'Lookup failed', '#b91c1c');
        return;
      }
      const filled = [];
      const updates = {};
      if (setInputValue('lo_name', resp.name))  { filled.push('Name');  updates.lo_name  = resp.name.trim(); }
      if (setInputValue('lo_email', resp.email)) { filled.push('Email'); updates.lo_email = resp.email.trim(); }
      if (setInputValue('lo_phone', resp.phone)) { filled.push('Phone'); updates.lo_phone = resp.phone.trim(); }
      if (setInputValue('lo_nmls', resp.nmls))   { filled.push('NMLS');  updates.lo_nmls  = resp.nmls.trim(); }
      if (Object.keys(updates).length) await chrome.storage.local.set(updates);
      if (filled.length === 0) {
        setLoPullStatus('Connected to Salesforce but nothing to fill.', '#b91c1c');
      } else {
        const missingNmls = !resp.nmls;
        const note = missingNmls
          ? ` (NMLS not found${resp.nmlsFieldName ? ` in field ${resp.nmlsFieldName}` : ''} — enter manually)`
          : '';
        setLoPullStatus(`Filled: ${filled.join(', ')}${note}`, '#15803d');
      }
    } catch (e) {
      setLoPullStatus(String(e && e.message || e), '#b91c1c');
    } finally {
      loPullBtn.disabled = false;
    }
  });
}

loadFeatureStates();

// Karma-link telemetry — fires when anyone clicks the "drop me karma"
// link in the banner. Lets us see whether the banner actually drives
// traffic to the Zall Wall.
document.querySelectorAll('a[data-zhl-karma-link]').forEach((a) => {
  a.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({
        type: 'TRACK',
        event: 'karma_link_clicked',
        props: { source: a.getAttribute('data-zhl-karma-link') || 'setup' }
      });
    } catch (_) {}
  });
});

// ---------------------------------------------------------------------------
// First-run wizard
//
// Triggered by background's onInstalled when lo_name is empty (opens this
// page with ?firstrun=1). Also self-triggers if the user lands here through
// any other path and lo_name is blank — covers the case where someone opens
// setup themselves without ever filling in their profile.
//
// One-click flow: show banner → user clicks "Auto-fill from Salesforce" →
// reuse the existing Pull-from-Salesforce button's handler → highlight the
// LO Profile card with a brief pulse → dismiss banner on success.
// ---------------------------------------------------------------------------
(function initFirstRunWizard() {
  const banner   = document.getElementById('firstrun-banner');
  const pullBtn  = document.getElementById('firstrun-pull-btn');
  const manual   = document.getElementById('firstrun-manual-btn');
  const dismiss  = document.getElementById('firstrun-dismiss-btn');
  const status   = document.getElementById('firstrun-status');
  if (!banner) return;

  const params      = new URLSearchParams(location.search);
  const explicitRun = params.get('firstrun') === '1';

  function setStatus(text, color) {
    if (!status) return;
    status.textContent = text || '';
    status.style.color = color || '#1e40af';
  }
  function scrollToProfile() {
    const card = document.querySelector('[data-profile]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.style.transition = 'box-shadow .3s, outline .3s';
    card.style.outline = '3px solid #2563eb';
    card.style.boxShadow = '0 0 0 6px rgba(37,99,235,0.18)';
    setTimeout(function () {
      card.style.outline = '';
      card.style.boxShadow = '';
    }, 2400);
  }
  function hideBanner() { banner.style.display = 'none'; }

  // Decide whether to show. Either firstrun=1 OR lo_name is blank AND the
  // user hasn't already dismissed this banner in this Chrome profile.
  chrome.storage.local.get(['lo_name', '_zhl_firstrun_dismissed'], function (data) {
    const nameMissing = !data.lo_name || !String(data.lo_name).trim();
    const dismissed   = !!data._zhl_firstrun_dismissed;
    if (!explicitRun && (!nameMissing || dismissed)) return;
    banner.style.display = 'block';
    try {
      chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_shown', props: { explicit: explicitRun, nameMissing: nameMissing } });
    } catch (_) {}
    // If we came here via ?firstrun=1, auto-trigger the SF pull after a
    // beat so the user sees the banner first and the action feels caused
    // by their visit rather than mysteriously instant.
    if (explicitRun) setTimeout(function () { runPull('auto'); }, 600);
  });

  function runPull(source) {
    if (!pullBtn) return;
    pullBtn.disabled = true;
    setStatus('Looking up your Salesforce profile…', '#1e40af');
    try {
      chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_pull_clicked', props: { source: source } });
    } catch (_) {}
    chrome.runtime.sendMessage({ type: 'GET_SF_LO_PROFILE' }, function (resp) {
      pullBtn.disabled = false;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        const err = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Lookup failed — make sure you\'re signed into Salesforce.';
        setStatus('⚠ ' + err + ' You can still fill in below.', '#b91c1c');
        scrollToProfile();
        return;
      }
      const filled = [];
      const updates = {};
      if (setInputValue('lo_name',  resp.name))  { filled.push('Name');  updates.lo_name  = resp.name.trim(); }
      if (setInputValue('lo_email', resp.email)) { filled.push('Email'); updates.lo_email = resp.email.trim(); }
      if (setInputValue('lo_phone', resp.phone)) { filled.push('Phone'); updates.lo_phone = resp.phone.trim(); }
      if (setInputValue('lo_nmls',  resp.nmls))  { filled.push('NMLS');  updates.lo_nmls  = resp.nmls.trim(); }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
      if (filled.length === 0) {
        setStatus('Connected to Salesforce but nothing to fill — please type it in below.', '#b91c1c');
        scrollToProfile();
        return;
      }
      const missingNmls = !resp.nmls;
      setStatus('✓ Filled: ' + filled.join(', ') + (missingNmls ? ' (NMLS not found — enter manually)' : '') + '. You\'re all set!', '#15803d');
      try {
        chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_pull_success', props: { fields: filled.length, missingNmls: missingNmls } });
      } catch (_) {}
      // Persist dismissal so we don't pop again next time the user opens setup.
      chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
      scrollToProfile();
      // Auto-hide banner after a beat so the user sees the success message.
      setTimeout(function () {
        if (missingNmls) return; // leave open if NMLS needs manual entry
        hideBanner();
      }, missingNmls ? 0 : 2200);
    });
  }
  if (pullBtn)  pullBtn.addEventListener('click', function () { runPull('click'); });
  if (manual) manual.addEventListener('click', function () {
    chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_manual_clicked' }); } catch (_) {}
    hideBanner();
    scrollToProfile();
  });
  if (dismiss) dismiss.addEventListener('click', function () {
    chrome.storage.local.set({ _zhl_firstrun_dismissed: true });
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: 'firstrun_dismissed' }); } catch (_) {}
    hideBanner();
  });
})();

// ---------------------------------------------------------------------------
// VPA Email template editor
//
// Lets the LO customize the subject line and HTML body of the Send VPA
// Email module. Storage keys: vpa_subject_tmpl, vpa_body_html_tmpl.
// Defaults are read from window.__ZHL_VPA_DEFAULT_SUBJECT and
// window.__ZHL_VPA_DEFAULT_BODY_HTML (set by sf-vpa-email.js when it
// loads), with a local copy below as a fallback for the case where
// setup.html is opened in a context that doesn't have the module
// loaded in the same window.
// ---------------------------------------------------------------------------
(function initVpaTemplateEditor() {
  const subjectInput = document.getElementById('vpa-subject-tmpl');
  const bodyEditor   = document.getElementById('vpa-body-tmpl');
  const resetBtn     = document.getElementById('vpa-reset-btn');
  const statusEl     = document.getElementById('vpa-status');
  const toolbar      = document.querySelector('.vpa-body-toolbar');
  const tags         = document.querySelectorAll('.vpa-placeholders .placeholder-tag');
  if (!subjectInput || !bodyEditor) return;

  // Local fallback default (kept in sync with sf-vpa-email.js's
  // DEFAULT_BODY_HTML_TMPL). The module exposes the live default on
  // window when it runs in the same document; setup.html doesn't load
  // sf-vpa-email.js though, so we always end up using these locals.
  const LOCAL_DEFAULT_SUBJECT =
    'Verified Pre-Approval for {Full Names} - Up to {Amount}! - {LO Name} from Zillow Home Loans';

  // Brand asset URLs + styled "Zillow Home Loans" span (kept in sync with
  // sf-vpa-email.js DEFAULT_BODY_HTML_TMPL).
  const __ZHL_LOGO_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/logo%20no%20border.png';
  const __ZHL_TEXT_URL = 'https://raw.githubusercontent.com/case2392/ZHLExtensions/main/ZIllow%20Home%20Loans%20Text.png';
  const __ZHL_BRAND = '<span style="font-family: Georgia, \'Times New Roman\', serif; color: #0E35C4; font-weight: bold;">Zillow Home Loans</span>';

  const LOCAL_DEFAULT_BODY_HTML = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<img src="' + __ZHL_TEXT_URL + '" alt="Zillow Home Loans" width="300" height="44" style="display: block; margin: 0 0 18px 0;"/>' +
      '<h1 style="color: #0E35C4; font-size: 26px; font-weight: bold; margin-bottom: 16px; font-family: Georgia, \'Times New Roman\', serif;">Congratulations {Greeting}!</h1>' +
      '<p>I\'m excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to <span style="color: #0E35C4; font-weight: bold; text-decoration: underline;">{Amount}</span> at ' + __ZHL_BRAND + '!&nbsp; Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.&nbsp; You can also click here to view my <a href="{Zillow URL}" style="color: #0E35C4; text-decoration: underline;">Zillow Webpage</a>!</p>' +
      '<p><strong>This is a significant milestone on your homebuying journey.&nbsp; Now, armed with the Verified Pre-Approval, you\'re one step closer to finding your dream home!</strong></p>' +
      '<p><strong>Feel free to reach out to me if you have any questions or need assistance moving forward. I\'m here to help make your homeownership dreams a reality.</strong></p>' +
      '<br/>' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">' +
        '<tr>' +
          '<td style="vertical-align: middle; padding-right: 10px;">' +
            '<img src="' + __ZHL_LOGO_URL + '" alt="Zillow" width="40" height="40" style="display: block;"/>' +
          '</td>' +
          '<td style="vertical-align: middle;">' +
            '<span style="color: #0E35C4; font-size: 22px; font-weight: bold; font-style: italic; font-family: Georgia, \'Times New Roman\', serif;">What\'s Next?</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<ul style="margin: 8px 0 16px 0; padding-left: 24px;">' +
        '<li style="margin-bottom: 6px;">Continue to stay in touch with your Loan Officer, {LO Name} and your Real Estate Agent, {Agent}.</li>' +
        '<li style="margin-bottom: 6px;">Continue to pay all bills on time.</li>' +
        '<li style="margin-bottom: 6px;">Do Not open any new lines of credit nor acquire new debt.</li>' +
        '<li style="margin-bottom: 6px;">Do Not increase balances on your current credit obligations.</li>' +
        '<li style="margin-bottom: 6px;">Do Not make changes to your employment outside of promotions or simply moving physical locations.</li>' +
        '<li style="margin-bottom: 6px;">Avoid any unnecessary movement of monies between accounts.</li>' +
        '<li style="margin-bottom: 6px;">Do Not dimmish your savings or assets required for your home purchase.</li>' +
      '</ul>' +
      '<br/>' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">' +
        '<tr>' +
          '<td style="vertical-align: middle; padding-right: 8px;">' +
            '<img src="https://drive.google.com/uc?export=view&id=1XWel1Mh3_SbuGxz4tb0jF_4iQqMP2TdV" alt="Bonus" width="40" height="50" style="display: block;"/>' +
          '</td>' +
          '<td style="vertical-align: middle;">' +
            '<span style="color: #0E35C4; font-size: 22px; font-weight: bold; font-style: italic; font-family: Georgia, \'Times New Roman\', serif;">Don\'t Forget</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<ul style="margin: 8px 0 16px 0; padding-left: 24px;">' +
        '<li style="margin-bottom: 6px;">No Cost Appraisal &ndash; By financing with ' + __ZHL_BRAND + ' and working with a Zillow Premier Agent partner, ' + __ZHL_BRAND + ' will cover the cost of your appraisal*.</li>' +
        '<li style="margin-bottom: 6px;">Very comfortable 21-Day closings</li>' +
      '</ul>' +
      '<p style="font-size: 20px; font-weight: bold; font-style: italic; margin: 20px 0; color: #0E35C4; font-family: Georgia, \'Times New Roman\', serif;">Congratulations again {Greeting}, and best of luck with your home search!</p>' +
      '<p style="font-size: 10px; color: #666666; font-style: italic; line-height: 1.4;">* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.</p>' +
    '</div>'
  );

  function getDefaultSubject() {
    try { return window.__ZHL_VPA_DEFAULT_SUBJECT || LOCAL_DEFAULT_SUBJECT; }
    catch (_) { return LOCAL_DEFAULT_SUBJECT; }
  }
  function getDefaultBodyHtml() {
    try { return window.__ZHL_VPA_DEFAULT_BODY_HTML || LOCAL_DEFAULT_BODY_HTML; }
    catch (_) { return LOCAL_DEFAULT_BODY_HTML; }
  }

  // Load saved values (or defaults)
  chrome.storage.local.get(['vpa_subject_tmpl', 'vpa_body_html_tmpl'], function (data) {
    subjectInput.value = (data && data.vpa_subject_tmpl) || getDefaultSubject();
    bodyEditor.innerHTML = (data && data.vpa_body_html_tmpl) || getDefaultBodyHtml();
  });

  // Status helper
  let statusTimer = null;
  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 1800);
  }

  // Debounced save on subject change
  let subjectTimer = null;
  subjectInput.addEventListener('input', function () {
    clearTimeout(subjectTimer);
    subjectTimer = setTimeout(function () {
      chrome.storage.local.set({ vpa_subject_tmpl: subjectInput.value.trim() }, function () {
        setStatus('Subject saved');
      });
    }, 400);
  });

  // Debounced save on body edit
  let bodyTimer = null;
  bodyEditor.addEventListener('input', function () {
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(function () {
      chrome.storage.local.set({ vpa_body_html_tmpl: bodyEditor.innerHTML }, function () {
        setStatus('Body saved');
      });
    }, 600);
  });

  // Toolbar buttons → document.execCommand on the editor
  if (toolbar) {
    toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('.vpa-tb');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      bodyEditor.focus();
      if (cmd === 'createLink') {
        const url = window.prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      // Save the edit
      chrome.storage.local.set({ vpa_body_html_tmpl: bodyEditor.innerHTML });
    });
  }

  // Placeholder chip click → insert at caret
  tags.forEach(function (tag) {
    tag.addEventListener('click', function () {
      const code = tag.getAttribute('data-insert') || tag.textContent.trim();
      // Decide which input has focus. If neither does, default to the body.
      const active = document.activeElement;
      if (active === subjectInput) {
        const start = subjectInput.selectionStart || subjectInput.value.length;
        const end   = subjectInput.selectionEnd   || start;
        const before = subjectInput.value.slice(0, start);
        const after  = subjectInput.value.slice(end);
        subjectInput.value = before + code + after;
        const pos = before.length + code.length;
        subjectInput.setSelectionRange(pos, pos);
        subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
        subjectInput.focus();
      } else {
        bodyEditor.focus();
        document.execCommand('insertText', false, code);
        bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  // Reset to defaults
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('Reset the VPA Email subject and body to the default template? Your customizations will be replaced.')) return;
      subjectInput.value    = getDefaultSubject();
      bodyEditor.innerHTML  = getDefaultBodyHtml();
      chrome.storage.local.set({
        vpa_subject_tmpl:    subjectInput.value,
        vpa_body_html_tmpl:  bodyEditor.innerHTML
      }, function () { setStatus('Reset to default'); });
    });
  }
})();

// ---------------------------------------------------------------------------
// Intro Email template editor — mirrors the VPA editor, different storage
// keys (intro_subject_tmpl, intro_body_html_tmpl) and a different default
// body. Defaults come from window.__ZHL_INTRO_DEFAULT_* (set by
// sf-intro-email.js); a local fallback below keeps the Setup page
// self-contained.
// ---------------------------------------------------------------------------
(function initIntroTemplateEditor() {
  const subjectInput = document.getElementById('intro-subject-tmpl');
  const bodyEditor   = document.getElementById('intro-body-tmpl');
  const resetBtn     = document.getElementById('intro-reset-btn');
  const statusEl     = document.getElementById('intro-status');
  const toolbar      = bodyEditor && bodyEditor.previousElementSibling;
  const tags         = subjectInput && subjectInput.closest('.vpa-email-config').querySelectorAll('.vpa-placeholders .placeholder-tag');
  if (!subjectInput || !bodyEditor) return;

  const LOCAL_DEFAULT_SUBJECT = 'Disclosures signed — here\'s what happens next';

  const LOCAL_DEFAULT_BODY_HTML = (
    '<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">' +
      '<p>Hi {Greeting},</p>' +
      '<p>Great news &mdash; your initial disclosures are signed and your file is officially moving. Here\'s what to expect over the next several days so nothing catches you off guard.</p>' +
      '<p><strong>1. Initial underwriting review.</strong> Your file goes into an early underwriter review so we can get ahead of any conditions before they become time crunches later. The goal is to surface anything we need from you now, while we have runway, rather than at the closing table.</p>' +
      '<p><strong>2. Loan processor introduction.</strong> One of our processors will reach out shortly to introduce themselves and become your day-to-day point of contact for documentation. They\'ll let you know if anything additional is needed beyond what you\'ve already provided. I\'m still quarterbacking the whole file, so don\'t worry &mdash; you\'re not getting handed off, just adding a teammate.</p>' +
      '<p><strong>3. Homeowners insurance.</strong> This is the one item I\'d ask you to start on this week. You\'ll need a homeowners insurance policy in place before we can close, and quotes can take a few days to come back. I\'ve cc\'d <strong>{Insurance Agent Name}</strong> with {Insurance Agent Company} on this email &mdash; she/he can shop multiple carriers for you to find the best coverage and rate. Feel free to reply all or reach her/him directly:</p>' +
      '<p style="margin-left: 24px;">' +
        '<strong>{Insurance Agent Name}</strong><br>' +
        '{Insurance Agent Company}<br>' +
        '{Insurance Agent Phone}<br>' +
        '<a href="mailto:{Insurance Agent Email}" style="color: #0E35C4;">{Insurance Agent Email}</a>' +
      '</p>' +
      '<p>Once you have a policy selected, just let me know so we can coordinate the rest.</p>' +
      '<p>If any questions come up between now and closing, text or call me anytime &mdash; that\'s what I\'m here for. We\'ll keep this moving.</p>' +
      '<hr style="border: none; border-top: 1px solid #d1d5db; margin: 16px 0;">' +
      '<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 2px; font-family: Calibri, Arial, sans-serif; font-size: 12px; color: #4b5563; border-collapse: collapse;">' +
        '<tr><td colspan="2" style="padding: 0 0 6px; font: 700 11px Arial, sans-serif; color: #0b3a73; letter-spacing: 0.5px; text-transform: uppercase;">Borrower Information</td></tr>' +
        '<tr><td style="padding: 2px 18px 2px 0; color: #6b7280; vertical-align: top; white-space: nowrap;">Borrower</td><td style="padding: 2px 0; color: #111827;">{Borrower Name}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Phone</td><td style="padding: 1px 0; color: #111827;">{Borrower Phone}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Email</td><td style="padding: 1px 0; color: #111827;">{Borrower Email}</td></tr>' +
        '<tr><td colspan="2" style="padding: 4px 0;"></td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Co-Borrower</td><td style="padding: 1px 0; color: #111827;">{Co-Borrower Name}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Phone</td><td style="padding: 1px 0; color: #111827;">{Co-Borrower Phone}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Email</td><td style="padding: 1px 0; color: #111827;">{Co-Borrower Email}</td></tr>' +
        '<tr><td colspan="2" style="padding: 4px 0;"></td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Property</td><td style="padding: 1px 0; color: #111827;">{Property Address}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Loan #</td><td style="padding: 1px 0; color: #111827;">{Loan Number}</td></tr>' +
        '<tr><td style="padding: 1px 18px 1px 0; color: #6b7280; vertical-align: top;">Est. Closing</td><td style="padding: 1px 0; color: #111827;">{Closing Date}</td></tr>' +
      '</table>' +
    '</div>'
  );

  function getDefaultSubject() {
    try { return window.__ZHL_INTRO_DEFAULT_SUBJECT || LOCAL_DEFAULT_SUBJECT; }
    catch (_) { return LOCAL_DEFAULT_SUBJECT; }
  }
  function getDefaultBodyHtml() {
    try { return window.__ZHL_INTRO_DEFAULT_BODY_HTML || LOCAL_DEFAULT_BODY_HTML; }
    catch (_) { return LOCAL_DEFAULT_BODY_HTML; }
  }

  chrome.storage.local.get(['intro_subject_tmpl', 'intro_body_html_tmpl'], function (data) {
    subjectInput.value   = (data && data.intro_subject_tmpl)   || getDefaultSubject();
    bodyEditor.innerHTML = (data && data.intro_body_html_tmpl) || getDefaultBodyHtml();
  });

  let statusTimer = null;
  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 1800);
  }

  let subjectTimer = null;
  subjectInput.addEventListener('input', function () {
    clearTimeout(subjectTimer);
    subjectTimer = setTimeout(function () {
      chrome.storage.local.set({ intro_subject_tmpl: subjectInput.value.trim() }, function () {
        setStatus('Subject saved');
      });
    }, 400);
  });

  let bodyTimer = null;
  bodyEditor.addEventListener('input', function () {
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(function () {
      chrome.storage.local.set({ intro_body_html_tmpl: bodyEditor.innerHTML }, function () {
        setStatus('Body saved');
      });
    }, 600);
  });

  if (toolbar && toolbar.classList && toolbar.classList.contains('vpa-body-toolbar')) {
    toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('.vpa-tb');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.getAttribute('data-cmd');
      if (!cmd) return;
      bodyEditor.focus();
      if (cmd === 'createLink') {
        const url = window.prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      chrome.storage.local.set({ intro_body_html_tmpl: bodyEditor.innerHTML });
    });
  }

  if (tags && tags.length) {
    tags.forEach(function (tag) {
      tag.addEventListener('click', function () {
        const code = tag.getAttribute('data-insert') || tag.textContent.trim();
        const active = document.activeElement;
        if (active === subjectInput) {
          const start = subjectInput.selectionStart || subjectInput.value.length;
          const end   = subjectInput.selectionEnd   || start;
          const before = subjectInput.value.slice(0, start);
          const after  = subjectInput.value.slice(end);
          subjectInput.value = before + code + after;
          const pos = before.length + code.length;
          subjectInput.setSelectionRange(pos, pos);
          subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
          subjectInput.focus();
        } else {
          bodyEditor.focus();
          document.execCommand('insertText', false, code);
          bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!window.confirm('Reset the Intro Email subject and body to the default template? Your customizations will be replaced.')) return;
      subjectInput.value   = getDefaultSubject();
      bodyEditor.innerHTML = getDefaultBodyHtml();
      chrome.storage.local.set({
        intro_subject_tmpl:   subjectInput.value,
        intro_body_html_tmpl: bodyEditor.innerHTML
      }, function () { setStatus('Reset to default'); });
    });
  }
})();

// -------------------------------------------------------------------------
// Admin Controls — kill switch dashboard. Visible only when lo_email matches
// the admin address. The card itself does NOT push changes to the remote
// kill-switch.json — that is done by editing the file directly on GitHub.
// This card just surfaces current state + a "poll now" convenience button.
// -------------------------------------------------------------------------
(function () {
  const ADMIN_EMAIL = 'justinca@zillowhomeloans.com';
  const card = document.getElementById('admin-controls-card');
  if (!card) return;

  function fmtTs(ms) {
    if (!ms) return 'never';
    try {
      const d = new Date(ms);
      return d.toLocaleString();
    } catch (_) { return String(ms); }
  }

  function refreshKsCard() {
    chrome.storage.local.get([
      'zhl_kill_switch',
      'zhl_kill_switch_message',
      'zhl_kill_switch_updated',
      'zhl_kill_switch_last_poll'
    ], function (data) {
      const on = data.zhl_kill_switch === true;
      const badge = document.getElementById('ks-state-badge');
      if (badge) {
        badge.textContent = on ? 'ON — all features disabled' : 'OFF — features running';
        badge.style.background = on ? '#fee2e2' : '#dcfce7';
        badge.style.color      = on ? '#991b1b' : '#166534';
      }
      const last = document.getElementById('ks-last-poll');
      if (last) last.textContent = fmtTs(data.zhl_kill_switch_last_poll);
      const upd = document.getElementById('ks-source-updated');
      if (upd) upd.textContent = data.zhl_kill_switch_updated || 'unknown';
      const msg = document.getElementById('ks-message');
      if (msg) msg.textContent = data.zhl_kill_switch_message || '(none)';
    });
  }

  function maybeShowAdmin() {
    chrome.storage.local.get(['lo_email'], function (data) {
      const email = (data.lo_email || '').trim().toLowerCase();
      if (email === ADMIN_EMAIL) {
        card.style.display = '';
        refreshKsCard();
      } else {
        card.style.display = 'none';
      }
    });
  }

  // Re-check on storage changes (email may get filled in after page load
  // by the Salesforce auto-pull).
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.lo_email) maybeShowAdmin();
    if (changes.zhl_kill_switch ||
        changes.zhl_kill_switch_message ||
        changes.zhl_kill_switch_updated ||
        changes.zhl_kill_switch_last_poll) {
      refreshKsCard();
    }
  });

  const pollBtn = document.getElementById('ks-poll-now-btn');
  const pollStatus = document.getElementById('ks-poll-status');
  if (pollBtn) {
    pollBtn.addEventListener('click', function () {
      if (pollStatus) pollStatus.textContent = 'Polling…';
      chrome.runtime.sendMessage({ type: 'ZHL_KILL_SWITCH_POLL_NOW' }, function (resp) {
        if (pollStatus) pollStatus.textContent = (resp && resp.ok) ? 'Polled ✓' : 'Poll failed';
        refreshKsCard();
        setTimeout(function () { if (pollStatus) pollStatus.textContent = ''; }, 2500);
      });
    });
  }

  maybeShowAdmin();
})();
