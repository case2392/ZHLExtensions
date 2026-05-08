/**
 * Options page script.
 * Handles loading/saving settings, OAuth status, and progress checklist.
 */

'use strict';

const FIELDS = [
  'driveFileId1',
  'driveFileId2',
  'nameFieldLabel',
  'coBorrowerFieldLabel',
  'amountFieldLabel',
  'agentFieldLabel',
  'loName',
  'loEmail',
  'defaultAgentName',
  'zillowWebpageUrl',
  'emailSubject',
  'emailTemplate',
];

const DEFAULT_SUBJECT = 'Verified Pre-Approval for {Greeting} - Up to {Amount}! - {LO Name} from Zillow Home Loans';

const DEFAULT_TEMPLATE = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">

<h1 style="color: #1a73e8; font-size: 26px; font-weight: bold; margin-bottom: 16px;">Congratulations {Greeting}!</h1>

<p>I'm excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to <span style="color: #1a73e8; font-weight: bold; text-decoration: underline;">{Amount}</span> at Zillow Home Loans!&nbsp; Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.&nbsp; You can also click here to view my <a href="{Zillow URL}" style="color: #1a73e8; text-decoration: underline;">Zillow Webpage</a>!</p>

<p><strong>This is a significant milestone on your homebuying journey.&nbsp; Now, armed with the Verified Pre-Approval, you're one step closer to finding your dream home!</strong></p>

<p><strong>Feel free to reach out to me if you have any questions or need assistance moving forward. I'm here to help make your homeownership dreams a reality.</strong></p>

<br/>

<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">
  <tr>
    <td style="vertical-align: middle; padding-right: 8px;">
      <img src="https://drive.google.com/uc?export=view&id=1DfbFqOFCz3OnUUPxHoNnVh3JIUzjAitV" alt="Zillow" width="36" height="36" style="display: block;"/>
    </td>
    <td style="vertical-align: middle;">
      <span style="color: #1a73e8; font-size: 22px; font-weight: bold; font-style: italic;">What's Next?</span>
    </td>
  </tr>
</table>

<ul style="margin: 8px 0 16px 0; padding-left: 24px;">
  <li style="margin-bottom: 6px;">Continue to stay in touch with your Loan Officer, <a href="mailto:{LO Email}" style="color: #1a73e8; font-weight: bold; text-decoration: none;">{LO Name}</a> and your Real Estate Agent, <span style="color: #cc0000; font-weight: bold;">{Agent}</span>.</li>
  <li style="margin-bottom: 6px;">Continue to pay all bills on time.</li>
  <li style="margin-bottom: 6px;">Do Not open any new lines of credit nor acquire new debt.</li>
  <li style="margin-bottom: 6px;">Do Not increase balances on your current credit obligations.</li>
  <li style="margin-bottom: 6px;">Do Not make changes to your employment outside of promotions or simply moving physical locations.</li>
  <li style="margin-bottom: 6px;">Avoid any unnecessary movement of monies between accounts.</li>
  <li style="margin-bottom: 6px;">Do Not dimmish your savings or assets required for your home purchase.</li>
</ul>

<br/>

<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">
  <tr>
    <td style="vertical-align: middle; padding-right: 8px;">
      <img src="https://drive.google.com/uc?export=view&id=1XWel1Mh3_SbuGxz4tb0jF_4iQqMP2TdV" alt="Bonus" width="40" height="50" style="display: block;"/>
    </td>
    <td style="vertical-align: middle;">
      <span style="color: #1a73e8; font-size: 22px; font-weight: bold; font-style: italic;">Don't Forget</span>
    </td>
  </tr>
</table>

<ul style="margin: 8px 0 16px 0; padding-left: 24px;">
  <li style="margin-bottom: 6px;">No Cost Appraisal – By financing with Zillow Home Loans and working with a Zillow Premier Agent partner, Zillow Home Loans will cover the cost of your appraisal*.</li>
  <li style="margin-bottom: 6px;">Very comfortable 21-Day closings</li>
</ul>

<p style="font-size: 20px; font-weight: bold; font-style: italic; margin: 20px 0;">Congratulations again {Greeting}, and best of luck with your home search!</p>

<p style="font-size: 10px; color: #666666; font-style: italic; line-height: 1.4;">* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.</p>

</div>`;

const DEFAULTS = {
  driveFileId1: '13zuOmBVhHnDtJQJO9b5luvj9yTWnTC8E',
  driveFileId2: '1Fs80lxfvGqMZs2pXADRGSa_XqFBOzVBA',
  nameFieldLabel: 'Name',
  coBorrowerFieldLabel: 'Co-Borrower',
  amountFieldLabel: 'Max Affordability',
  agentFieldLabel: "Buyer's Agent",
  loName: '',
  loEmail: '',
  defaultAgentName: '',
  zillowWebpageUrl: 'https://www.zillow.com/home-loans/loan-officer/justincase',
  emailSubject: DEFAULT_SUBJECT,
  emailTemplate: DEFAULT_TEMPLATE,
};

// ─── Toast Notifications ─────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast--visible toast--${type}`;
  setTimeout(() => {
    toast.classList.remove('toast--visible');
  }, 3000);
}

// ─── Progress Checklist ──────────────────────────────────────────────────────

function setProgressItem(id, done) {
  const el = document.getElementById('progress-' + id);
  if (!el) return;
  if (done) el.classList.add('done');
  else el.classList.remove('done');
}

function setStepStatus(badgeId, done) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (done) {
    badge.textContent = '✓ Complete';
    badge.className = 'step-status-badge complete';
  }
}

function updateProgress() {
  const loName = document.getElementById('loName').value.trim();
  const loEmail = document.getElementById('loEmail').value.trim();
  const loFilled = !!(loName && loEmail);
  setProgressItem('lo', loFilled);
  setStepStatus('loBadge', loFilled);

  const driveId1 = document.getElementById('driveFileId1').value.trim();
  const driveId2 = document.getElementById('driveFileId2').value.trim();
  // Don't count Justin's defaults as "done" — user needs their own
  const justinDefaults = ['13zuOmBVhHnDtJQJO9b5luvj9yTWnTC8E', '1Fs80lxfvGqMZs2pXADRGSa_XqFBOzVBA'];
  const driveChanged = driveId1 && driveId2 &&
    (!justinDefaults.includes(driveId1) || !justinDefaults.includes(driveId2));
  setProgressItem('drive', driveChanged);

  const driveBadge = document.getElementById('driveBadge');
  if (driveBadge) {
    if (driveChanged) {
      driveBadge.textContent = '✓ Updated';
      driveBadge.className = 'step-status-badge complete';
    } else {
      driveBadge.textContent = 'Action Needed';
      driveBadge.className = 'step-status-badge required';
    }
  }
}

// ─── Welcome Banner ──────────────────────────────────────────────────────────

function checkFirstTimeSetup() {
  chrome.storage.local.get('setupComplete', (data) => {
    if (!data.setupComplete) {
      const banner = document.getElementById('welcomeBanner');
      if (banner) banner.classList.remove('hidden');
    }
  });
}

function markSetupComplete() {
  chrome.storage.local.set({ setupComplete: true });
}

// ─── Load Settings ───────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    for (const field of FIELDS) {
      const input = document.getElementById(field);
      if (input) {
        input.value = settings[field] || '';
      }
    }
    // Load rich editor with template HTML
    const editor = document.getElementById('emailEditor');
    if (editor) {
      editor.innerHTML = settings.emailTemplate || DEFAULT_TEMPLATE;
    }
    updateProgress();
  });
}

// ─── Save Settings ───────────────────────────────────────────────────────────

function gatherSettings() {
  // Sync rich editor content to hidden textarea before gathering
  const editor = document.getElementById('emailEditor');
  const textarea = document.getElementById('emailTemplate');
  if (editor && textarea) {
    textarea.value = editor.innerHTML;
  }

  const settings = {};
  for (const field of FIELDS) {
    const input = document.getElementById(field);
    if (input) {
      settings[field] = input.value.trim();
    }
  }
  return settings;
}

function saveSettings() {
  const settings = gatherSettings();

  // Validate required fields
  if (!settings.loName || !settings.loEmail) {
    showToast('Please enter your name and email before saving.', 'error');
    return;
  }

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showToast('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showToast('Settings saved successfully!', 'success');
      setProgressItem('saved', true);
      markSetupComplete();
      updateProgress();
    }
  });
}

// ─── Auth Status ─────────────────────────────────────────────────────────────

function checkAuthStatus() {
  const statusEl = document.getElementById('authStatus');
  const btnEl = document.getElementById('authBtn');

  chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
    if (response && response.authenticated) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status-badge status-badge--connected';
      btnEl.textContent = 'Reconnect';
      btnEl.className = 'btn btn-outline';
      setProgressItem('google', true);
      setStepStatus('googleBadge', true);
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.className = 'status-badge status-badge--disconnected';
      btnEl.textContent = 'Connect Google Account';
      btnEl.className = 'btn btn-primary';
      setProgressItem('google', false);
    }
  });
}

function handleAuth() {
  const btnEl = document.getElementById('authBtn');
  btnEl.disabled = true;
  btnEl.textContent = 'Connecting...';

  chrome.runtime.sendMessage({ type: 'AUTHENTICATE' }, (response) => {
    btnEl.disabled = false;
    if (response && response.success) {
      showToast('Google account connected!', 'success');
    } else {
      showToast('Connection failed: ' + (response?.error || 'Unknown error'), 'error');
    }
    checkAuthStatus();
  });
}

// ─── Test Email ──────────────────────────────────────────────────────────────

function handleTestEmail() {
  const settings = gatherSettings();

  if (!settings.loName || !settings.loEmail) {
    showToast('Please enter your name and email first, then save.', 'error');
    return;
  }

  const testBtn = document.getElementById('testBtn');
  testBtn.disabled = true;
  testBtn.textContent = 'Sending test...';

  chrome.storage.sync.set(settings, () => {
    chrome.runtime.sendMessage({ type: 'SEND_TEST_EMAIL' }, (response) => {
      testBtn.disabled = false;
      testBtn.textContent = 'Send Test Email';

      if (response && response.success) {
        showToast('Test draft created! Check your Gmail drafts.', 'success');
        setProgressItem('test', true);
      } else {
        showToast(
          'Test failed: ' + (response?.error || 'Unknown error'),
          'error'
        );
      }
    });
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

function handleResetTemplate() {
  document.getElementById('emailSubject').value = DEFAULT_SUBJECT;
  document.getElementById('emailTemplate').value = DEFAULT_TEMPLATE;
  const editor = document.getElementById('emailEditor');
  if (editor) editor.innerHTML = DEFAULT_TEMPLATE;
  showToast('Template reset to default. Click Save to apply.', 'info');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkAuthStatus();
  checkFirstTimeSetup();

  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetTemplateBtn').addEventListener('click', handleResetTemplate);
  document.getElementById('authBtn').addEventListener('click', handleAuth);
  document.getElementById('testBtn').addEventListener('click', handleTestEmail);

  // Live-update progress as user types
  ['loName', 'loEmail', 'driveFileId1', 'driveFileId2'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateProgress);
  });
});
