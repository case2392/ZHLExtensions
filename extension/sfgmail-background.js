/**
 * Service Worker (Background Script)
 * Handles OAuth token management, Gmail API draft creation, and Google Drive file fetching.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const MIME_BOUNDARY = '----VPAEmailBoundary_' + Date.now();

// ─── Email Template ──────────────────────────────────────────────────────────

const EMAIL_TEMPLATE = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 14.5px; color: #000000; line-height: 1.5;">

<h1 style="color: #1a73e8; font-size: 26px; font-weight: bold; margin-bottom: 16px;">Congratulations {{Greeting}}!</h1>

<p>I'm excited to inform you that after reviewing your credit, income, and assets, you have been pre-approved for up to <span style="color: #1a73e8; font-weight: bold; text-decoration: underline;">{{Amount}}</span> at Zillow Home Loans!&nbsp; Please find your preapproval letter attached, a copy of your appraisal waiver certificate, and my profile.&nbsp; You can also click here to view my <a href="{{ZillowWebpageURL}}" style="color: #1a73e8; text-decoration: underline;">Zillow Webpage</a>!</p>

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
  <li style="margin-bottom: 6px;">Continue to stay in touch with your Loan Officer, <a href="mailto:{{LOEmail}}" style="color: #1a73e8; font-weight: bold; text-decoration: none;">{{LOName}}</a> and your Real Estate Agent, {{AgentNameHtml}}.</li>
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

<p style="font-size: 20px; font-weight: bold; font-style: italic; margin: 20px 0;">Congratulations again {{Greeting}}, and best of luck with your home search!</p>

<p style="font-size: 10px; color: #666666; font-style: italic; line-height: 1.4;">* *While the appraisal fee will appear as a loan cost on your initial disclosures, your final disclosure will show Zillow Home Loans covering the cost. Offer available on initial appraisal for purchase and refinance transactions only, where an appraisal is required by Zillow Home Loans. Zillow Home Loans must order appraisal. Appraisal fee will not be charged to the borrower when the loan closes with Zillow Home Loans. Offer does not apply to any subsequent appraisal, including re-inspections, desk reviews, etc. Zillow Home Loans, in its sole discretion, reserves the right to change or end promotion at any time.</p>

</div>`;

// ─── OAuth Token Management ──────────────────────────────────────────────────

/**
 * Get an OAuth token using chrome.identity, with interactive prompt if needed.
 */
function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('No auth token received'));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Remove a cached token and get a fresh one.
 */
async function refreshAuthToken(oldToken) {
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token: oldToken }, async () => {
      try {
        const newToken = await getAuthToken(true);
        resolve(newToken);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Make an authenticated API request, refreshing the token on 401.
 */
async function authenticatedFetch(url, options = {}) {
  let token = await getAuthToken(false).catch(() => getAuthToken(true));

  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${token}`;

  let response = await fetch(url, options);

  if (response.status === 401) {
    token = await refreshAuthToken(token);
    options.headers['Authorization'] = `Bearer ${token}`;
    response = await fetch(url, options);
  }

  return response;
}

// ─── Google Drive ────────────────────────────────────────────────────────────

/**
 * Fetch file metadata from Google Drive.
 */
async function getDriveFileMetadata(fileId) {
  const url = `${DRIVE_API_BASE}/${fileId}?fields=name,mimeType,size`;
  const response = await authenticatedFetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to get Drive file metadata for ${fileId}: ${error.error?.message || response.statusText}`
    );
  }

  return response.json();
}

/**
 * Fetch file content from Google Drive as ArrayBuffer.
 */
async function getDriveFileContent(fileId) {
  const url = `${DRIVE_API_BASE}/${fileId}?alt=media`;
  const response = await authenticatedFetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to download Drive file ${fileId}: ${error.error?.message || response.statusText}`
    );
  }

  return response.arrayBuffer();
}

/**
 * Fetch a Drive file's metadata and content, returning base64-encoded content.
 * Uses a local cache so subsequent calls are instant.
 */
async function fetchDriveAttachment(fileId) {
  // Check cache first
  const cacheKey = `attachment_${fileId}`;
  const cached = await new Promise((resolve) => {
    chrome.storage.local.get(cacheKey, (result) => resolve(result[cacheKey]));
  });
  if (cached) return cached;

  const [metadata, content] = await Promise.all([
    getDriveFileMetadata(fileId),
    getDriveFileContent(fileId),
  ]);

  const base64Content = arrayBufferToBase64(content);

  const attachment = {
    filename: metadata.name,
    mimeType: metadata.mimeType || 'application/pdf',
    base64Content,
  };

  // Cache for future use
  chrome.storage.local.set({ [cacheKey]: attachment });

  return attachment;
}

// ─── MIME Message Construction ───────────────────────────────────────────────

/**
 * Convert ArrayBuffer to base64 string using chunked approach.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(chunks.join(''));
}

/**
 * Encode a string to base64url (RFC 4648 §5) using chunked approach.
 */
function base64urlEncode(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  const chunkSize = 8192;
  const chunks = [];
  for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
    const chunk = utf8Bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  const base64 = btoa(chunks.join(''));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Split a base64 string into lines of 76 characters (MIME standard).
 */
function splitBase64Lines(base64Str) {
  return base64Str.replace(/.{76}/g, '$&\r\n');
}

/**
 * Build the full MIME multipart message.
 */
function buildMimeMessage({ to, cc, subject, htmlBody, attachments, fromEmail }) {
  const boundary = MIME_BOUNDARY;
  const lines = [];

  // Headers
  lines.push(`From: ${fromEmail || 'justinca@zillowhomeloans.com'}`);
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${subject}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');

  // HTML body part
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: text/html; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push('');
  lines.push(splitBase64Lines(btoa(unescape(encodeURIComponent(htmlBody)))));
  lines.push('');

  // Attachment parts
  for (const attachment of attachments) {
    lines.push(`--${boundary}`);
    lines.push(
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`
    );
    lines.push(
      `Content-Disposition: attachment; filename="${attachment.filename}"`
    );
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push('');
    lines.push(splitBase64Lines(attachment.base64Content));
    lines.push('');
  }

  // End boundary
  lines.push(`--${boundary}--`);

  return lines.join('\r\n');
}

// ─── Gmail API ───────────────────────────────────────────────────────────────

/**
 * Create a draft in Gmail.
 */
async function createGmailDraft(mimeMessage) {
  const raw = base64urlEncode(mimeMessage);

  const response = await authenticatedFetch(`${GMAIL_API_BASE}/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: raw,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Gmail API error: ${error.error?.message || response.statusText}`
    );
  }

  return response.json();
}

// ─── Template Processing ─────────────────────────────────────────────────────

/**
 * Build the greeting name, including co-borrower if present.
 * e.g. "Tracey" or "Tracey & Andrew"
 */
function buildGreeting(leadData) {
  if (leadData.coBorrowerFirstName) {
    return `${leadData.firstName} & ${leadData.coBorrowerFirstName}`;
  }
  return leadData.firstName;
}

/**
 * Build the full names for the subject line, including co-borrower if present.
 * Same last name:  "Tracey & Andrew Smith"
 * Different last:  "Tracey Smith & Andrew Jones"
 * No co-borrower:  "Tracey Smith"
 */
function buildFullNames(leadData) {
  if (leadData.coBorrowerFirstName) {
    const sameLastName =
      leadData.lastName &&
      leadData.coBorrowerLastName &&
      leadData.lastName.toLowerCase() === leadData.coBorrowerLastName.toLowerCase();

    if (sameLastName) {
      return `${leadData.firstName} & ${leadData.coBorrowerFirstName} ${leadData.lastName}`;
    }
    const coBorrowerFull = leadData.coBorrowerLastName
      ? `${leadData.coBorrowerFirstName} ${leadData.coBorrowerLastName}`
      : leadData.coBorrowerFullName || leadData.coBorrowerFirstName;
    return `${leadData.firstName} ${leadData.lastName} & ${coBorrowerFull}`;
  }
  return `${leadData.firstName} ${leadData.lastName}`;
}

/**
 * Fill the email template with lead data.
 */
/**
 * Replace user-friendly placeholder codes in a string.
 */
function replacePlaceholders(text, leadData, settings) {
  const greeting = buildGreeting(leadData);

  let agentHtml;
  if (leadData.agentEmail) {
    agentHtml = `<a href="mailto:${leadData.agentEmail}" style="color: #cc0000; font-weight: bold; text-decoration: none;">${leadData.agentName}</a>`;
  } else {
    agentHtml = `<span style="color: #cc0000; font-weight: bold;">${leadData.agentName}</span>`;
  }

  return text
    .replace(/\{Greeting\}/g, greeting)
    .replace(/\{Borrower\}/g, leadData.firstName)
    .replace(/\{Amount\}/g, leadData.amount)
    .replace(/\{Agent\}/g, agentHtml)
    .replace(/\{LO Name\}/g, settings.loName)
    .replace(/\{LO Email\}/g, settings.loEmail)
    .replace(/\{Zillow URL\}/g, settings.zillowWebpageUrl)
    // Also support the old {{...}} format for backwards compatibility
    .replace(/\{\{Greeting\}\}/g, greeting)
    .replace(/\{\{FirstName\}\}/g, leadData.firstName)
    .replace(/\{\{Amount\}\}/g, leadData.amount)
    .replace(/\{\{AgentNameHtml\}\}/g, agentHtml)
    .replace(/\{\{AgentName\}\}/g, leadData.agentName)
    .replace(/\{\{LOName\}\}/g, settings.loName)
    .replace(/\{\{LOEmail\}\}/g, settings.loEmail)
    .replace(/\{\{ZillowWebpageURL\}\}/g, settings.zillowWebpageUrl);
}

async function fillTemplate(leadData) {
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        zillowWebpageUrl: 'https://www.zillow.com/home-loans/loan-officer/justincase',
        loName: 'Justin Case',
        loEmail: 'justinca@zillowhomeloans.com',
        emailTemplate: '',
      },
      resolve
    );
  });

  const template = settings.emailTemplate || EMAIL_TEMPLATE;
  return replacePlaceholders(template, leadData, settings);
}

// ─── Main Handler ────────────────────────────────────────────────────────────

/**
 * Handle the CREATE_VPA_DRAFT message from the content script.
 */
async function handleCreateDraft(leadData) {
  // 1. Get settings and start fetching attachments immediately (in parallel with template)
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        driveFileId1: '13zuOmBVhHnDtJQJO9b5luvj9yTWnTC8E',
        driveFileId2: '1Fs80lxfvGqMZs2pXADRGSa_XqFBOzVBA',
        loName: 'Justin Case',
        loEmail: 'justinca@zillowhomeloans.com',
        zillowWebpageUrl: 'https://www.zillow.com/home-loans/loan-officer/justincase',
        emailSubject: '',
      },
      resolve
    );
  });

  const fileIds = [settings.driveFileId1, settings.driveFileId2].filter(Boolean);

  // Start attachments + template in parallel
  const [htmlBody, attachmentResults] = await Promise.all([
    fillTemplate(leadData),
    Promise.allSettled(fileIds.map((fileId) => fetchDriveAttachment(fileId))),
  ]);

  const attachments = [];
  const attachmentErrors = [];
  for (let i = 0; i < attachmentResults.length; i++) {
    if (attachmentResults[i].status === 'fulfilled') {
      attachments.push(attachmentResults[i].value);
    } else {
      console.error(`[VPA Extension] Failed to fetch attachment ${fileIds[i]}:`, attachmentResults[i].reason);
      attachmentErrors.push(attachmentResults[i].reason.message);
    }
  }

  // Add pre-approval letter if provided by the content script
  if (leadData.preApprovalAttachment) {
    attachments.unshift(leadData.preApprovalAttachment);
  }

  // 4. Build the subject line from custom or default template
  const defaultSubject = `Verified Pre-Approval for ${buildFullNames(leadData)} - Up to ${leadData.amount}! - ${settings.loName} from Zillow Home Loans`;
  const subject = settings.emailSubject
    ? replacePlaceholders(settings.emailSubject, leadData, settings)
        .replace(/\{Greeting\}/g, buildFullNames(leadData))
    : defaultSubject;

  // 5. Build To (lead + co-borrower) and CC (agent) addresses
  const toAddresses = [leadData.email, leadData.coBorrowerEmail].filter(Boolean).join(', ');
  const ccAddresses = [leadData.agentEmail].filter(Boolean).join(', ') || null;

  // 6. Build the MIME message
  const mimeMessage = buildMimeMessage({
    to: toAddresses,
    cc: ccAddresses,
    subject,
    htmlBody,
    attachments,
    fromEmail: settings.loEmail,
  });

  // 6. Create the Gmail draft
  const draft = await createGmailDraft(mimeMessage);

  // 7. Open Gmail drafts — force refresh by navigating to inbox first, then drafts
  const gmailTabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  if (gmailTabs.length > 0) {
    const tab = gmailTabs[0];
    await chrome.tabs.update(tab.id, {
      url: 'https://mail.google.com/mail/u/0/#inbox',
      active: true,
    });
    await chrome.windows.update(tab.windowId, { focused: true });
    // Brief delay then navigate to drafts so Gmail refreshes
    setTimeout(() => {
      chrome.tabs.update(tab.id, {
        url: 'https://mail.google.com/mail/u/0/#drafts',
      });
    }, 500);
  } else {
    await chrome.tabs.create({
      url: 'https://mail.google.com/mail/u/0/#drafts',
    });
  }

  return {
    success: true,
    draftId: draft.id,
    messageId: draft.message.id,
    attachmentErrors:
      attachmentErrors.length > 0 ? attachmentErrors : undefined,
  };
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CREATE_VPA_DRAFT') {
    handleCreateDraft(message.data)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error('[VPA Extension] Draft creation failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'GET_AUTH_STATUS') {
    getAuthToken(false)
      .then((token) => {
        sendResponse({ authenticated: true });
      })
      .catch(() => {
        sendResponse({ authenticated: false });
      });
    return true;
  }

  if (message.type === 'AUTHENTICATE') {
    getAuthToken(true)
      .then((token) => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'SEND_TEST_EMAIL') {
    handleTestEmail()
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'PREFETCH_ATTACHMENTS') {
    prefetchAttachments();
    return false;
  }
});

// ─── Test Email ──────────────────────────────────────────────────────────────

/**
 * Send a test VPA email to the user's own Gmail address.
 */
async function handleTestEmail() {
  // Get the user's email from the Gmail API
  const token = await getAuthToken(true);
  const profileResponse = await authenticatedFetch(
    `${GMAIL_API_BASE}/profile`
  );

  if (!profileResponse.ok) {
    throw new Error('Could not get Gmail profile');
  }

  const profile = await profileResponse.json();
  const userEmail = profile.emailAddress;

  const testData = {
    firstName: 'Tracey',
    lastName: 'Smith',
    coBorrowerFirstName: 'Andrew',
    coBorrowerLastName: 'Smith',
    coBorrowerFullName: 'Andrew Smith',
    email: userEmail,
    amount: '$500,000',
    agentName: 'Olivia Wright',
  };

  return handleCreateDraft(testData);
}

// ─── Installation ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'options/options.html' });
  }
  // Pre-fetch attachments into cache on install/update
  prefetchAttachments();
});

/**
 * Pre-fetch and cache Drive attachments so they're ready instantly.
 */
async function prefetchAttachments() {
  try {
    const token = await getAuthToken(false).catch(() => null);
    if (!token) return;

    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(
        { driveFileId1: '13zuOmBVhHnDtJQJO9b5luvj9yTWnTC8E', driveFileId2: '1Fs80lxfvGqMZs2pXADRGSa_XqFBOzVBA' },
        resolve
      );
    });

    const fileIds = [settings.driveFileId1, settings.driveFileId2].filter(Boolean);
    await Promise.allSettled(fileIds.map((id) => fetchDriveAttachment(id)));
  } catch (e) {
    // Silent fail — will fetch on demand
  }
}
