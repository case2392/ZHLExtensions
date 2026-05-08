// ZHL Productivity Pack module — feature key: feature_sfGmail
// Wraps SFGmail's original Salesforce content script in the pack's
// feature-flag check so users can disable VPA email integration from
// the setup page without affecting any other module.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_sfGmail';
  function __zhlRunModule() {
/**
 * Salesforce Content Script
 * Injects "Send VPA Email" button on Lead/Contact pages and scrapes lead data.
 */

(function () {
  'use strict';

  const BUTTON_ID = 'vpa-send-email-btn';
  const RECORD_URL_PATTERN = /\/lightning\/r\/(Lead|Contact)\/([a-zA-Z0-9]{15,18})\/view/;

  // Cached pre-scraped data for instant button clicks
  let cachedLeadData = null;
  let preScrapeInProgress = false;
  let isReady = false;

  /**
   * Check if the current page is a Lead or Contact record page.
   */
  function getRecordInfo() {
    const match = window.location.pathname.match(RECORD_URL_PATTERN);
    if (!match) return null;
    return { objectType: match[1], recordId: match[2] };
  }

  /**
   * Format a raw number as US currency.
   */
  function formatCurrency(value) {
    if (!value) return null;
    const cleaned = value.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  /**
   * Clean scraped text by removing Salesforce accessibility artifacts.
   * SF lookup fields append "Open {Name} Preview" directly after the name
   * with no space, e.g. "Noah ClarkOpen Noah Clark Preview".
   */
  function cleanScrapedValue(text) {
    if (!text) return text;
    return text
      .replace(/Open\s+.+?\s*Preview\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * For a lookup field container, get just the visible link text.
   * SF renders lookup links with the name in a visible span and
   * "Open X Preview" in a hidden assistive-text span.
   */
  function getLookupLinkText(container) {
    const link = container.querySelector('a[data-output-element-id="output-field"]')
      || container.querySelector('a[href*="lightning/r/"]');
    if (!link) return null;

    // Strategy 1: Look for the assistive text span and exclude it
    const assistiveSpan = link.querySelector('.slds-assistive-text, span[class*="assistive"]');
    if (assistiveSpan) {
      const fullText = link.textContent.trim();
      const assistiveText = assistiveSpan.textContent.trim();
      const clean = fullText.replace(assistiveText, '').trim();
      if (clean) return clean;
    }

    // Strategy 2: Get text from non-assistive child spans
    const spans = link.querySelectorAll('span');
    for (const span of spans) {
      if (span.classList.contains('slds-assistive-text') ||
          span.className.includes('assistive')) continue;
      const text = span.textContent.trim();
      if (text && !text.startsWith('Open ') && !text.endsWith('Preview')) return text;
    }

    // Strategy 3: First text node only
    for (const node of link.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) return text;
      }
    }

    // Strategy 4: Fall back to full text with cleanup
    return cleanScrapedValue(link.textContent.trim());
  }

  /**
   * Scrape a field value from the Salesforce Lightning DOM by its label text.
   * Salesforce Lightning renders fields in record-layout-item components.
   */
  /**
   * Check if an element is visible (not in a hidden SF workspace tab).
   */
  function isElementVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scrapeFieldByLabel(label) {
    const allLabels = document.querySelectorAll(
      'span.test-id__field-label, span[class*="field-label"]'
    );
    for (const labelEl of allLabels) {
      if (labelEl.textContent.trim().toLowerCase() === label.toLowerCase()) {
        if (!isElementVisible(labelEl)) continue;
        const container =
          labelEl.closest('records-record-layout-item') ||
          labelEl.closest('[class*="slds-form-element"]') ||
          labelEl.closest('.slds-form-element');
        if (container) {
          // For lookup fields, try to get clean link text first
          const lookupText = getLookupLinkText(container);
          if (lookupText) return lookupText;

          const valueEl =
            container.querySelector('lightning-formatted-text') ||
            container.querySelector('lightning-formatted-email') ||
            container.querySelector('lightning-formatted-name') ||
            container.querySelector('lightning-formatted-number') ||
            container.querySelector('lightning-formatted-phone') ||
            container.querySelector('a[data-output-element-id="output-field"]') ||
            container.querySelector('.slds-form-element__static') ||
            container.querySelector('[class*="field-value"]');
          if (valueEl) {
            return cleanScrapedValue(valueEl.textContent.trim());
          }
        }
      }
    }

    const recordItems = document.querySelectorAll('records-record-layout-item');
    for (const item of recordItems) {
      const itemLabel = item.querySelector('span.test-id__field-label');
      if (
        itemLabel &&
        itemLabel.textContent.trim().toLowerCase() === label.toLowerCase() &&
        isElementVisible(itemLabel)
      ) {
        const valueContainer = item.querySelector(
          '.test-id__field-value, [class*="field-value"]'
        );
        if (valueContainer) {
          const lookupText = getLookupLinkText(valueContainer);
          if (lookupText) return lookupText;

          const valueEl =
            valueContainer.querySelector('lightning-formatted-text') ||
            valueContainer.querySelector('lightning-formatted-email') ||
            valueContainer.querySelector('lightning-formatted-name') ||
            valueContainer.querySelector('lightning-formatted-number') ||
            valueContainer.querySelector('a') ||
            valueContainer;
          return cleanScrapedValue(valueEl.textContent.trim());
        }
      }
    }

    // Strategy 3: Broader search using data attributes
    const allElements = document.querySelectorAll(
      '[field-label], [data-field-label]'
    );
    for (const el of allElements) {
      const fieldLabel =
        el.getAttribute('field-label') || el.getAttribute('data-field-label');
      if (fieldLabel && fieldLabel.toLowerCase() === label.toLowerCase() && isElementVisible(el)) {
        return cleanScrapedValue(el.textContent.trim());
      }
    }

    return null;
  }

  /**
   * Try multiple label variants to find a field value.
   */
  function scrapeFieldByLabels(labels) {
    for (const label of labels) {
      const value = scrapeFieldByLabel(label);
      if (value) return value;
    }
    return null;
  }

  /**
   * Collect all mailto email addresses currently on the page.
   */
  function getAllMailtoEmails() {
    const emails = new Set();
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const email = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email) emails.add(email);
    });
    // Also scan for email patterns in lightning-formatted-email components
    document.querySelectorAll('lightning-formatted-email a').forEach((a) => {
      if (a.href && a.href.startsWith('mailto:')) {
        const email = a.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
        if (email) emails.add(email);
      }
    });
    return emails;
  }

  /**
   * Find the lookup link element for a given field label.
   */
  function findLookupLink(label) {
    const allLabels = document.querySelectorAll(
      'span.test-id__field-label, span[class*="field-label"]'
    );
    for (const labelEl of allLabels) {
      if (labelEl.textContent.trim().toLowerCase() === label.toLowerCase() && isElementVisible(labelEl)) {
        const container =
          labelEl.closest('records-record-layout-item') ||
          labelEl.closest('.slds-form-element');
        if (container) {
          return container.querySelector('a[data-output-element-id="output-field"]')
            || container.querySelector('a[href*="lightning/r/"]');
        }
      }
    }
    return null;
  }

  /**
   * Extract email from a Salesforce hover popup for a lookup field.
   * Snapshots all mailto links before hover, triggers hover, then finds new ones.
   */
  function scrapeEmailFromHoverCard(label, existingEmails) {
    return new Promise((resolve) => {
      const link = findLookupLink(label);
      if (!link) {
        return resolve(null);
      }

      link.scrollIntoView({ behavior: 'instant', block: 'center' });

      const beforeEmails = existingEmails || getAllMailtoEmails();
      let found = false;

      const checkForNewEmails = () => {
        const afterEmails = getAllMailtoEmails();
        for (const email of afterEmails) {
          if (!beforeEmails.has(email)) return email;
        }
        // Also scan for email text patterns in any visible popover
        const popovers = document.querySelectorAll(
          'section.slds-popover, div.slds-popover, [class*="slds-popover"], ' +
          'records-lwc-highlights-panel, records-record-hover-preview, ' +
          'section[role="dialog"], div[role="tooltip"], [class*="popover"]'
        );
        for (const pop of popovers) {
          const text = pop.textContent || '';
          const match = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
          if (match && !beforeEmails.has(match[0].toLowerCase())) {
            return match[0].toLowerCase();
          }
        }
        return null;
      };

      const observer = new MutationObserver(() => {
        if (found) return;
        const newEmail = checkForNewEmails();
        if (newEmail) {
          found = true;
          observer.disconnect();
          dismissHover(link);
          resolve(newEmail);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const rect = link.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const mouseOpts = { bubbles: true, clientX: centerX, clientY: centerY };

      link.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));
      link.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
      link.dispatchEvent(new MouseEvent('mousemove', mouseOpts));

      const pollInterval = setInterval(() => {
        if (found) { clearInterval(pollInterval); return; }
        const newEmail = checkForNewEmails();
        if (newEmail) {
          found = true;
          clearInterval(pollInterval);
          observer.disconnect();
          dismissHover(link);
          resolve(newEmail);
        }
      }, 200);

      setTimeout(() => {
        if (found) return;
        clearInterval(pollInterval);
        observer.disconnect();
        const newEmail = checkForNewEmails();
        dismissHover(link);
        resolve(newEmail);
      }, 2000);
    });
  }

  /**
   * Dismiss a hover card by moving mouse away and clicking elsewhere.
   */
  function dismissHover(link) {
    link.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    // Click an empty area to dismiss any popup
    const header = document.querySelector('.slds-page-header') || document.body;
    header.click();
  }

  /**
   * Parse a full name into first and last name.
   * "Tracey Smith" → { first: "Tracey", last: "Smith" }
   */
  function parseFullName(fullName) {
    if (!fullName) return { first: null, last: null };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    const first = parts[0];
    const last = parts.slice(1).join(' ');
    return { first, last };
  }

  /**
   * Scrape all lead/contact data from the page.
   */
  async function scrapeLeadData() {
    // Get user-configured field labels from storage
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          amountFieldLabel: 'Max Affordability',
          agentFieldLabel: "Buyer's Agent",
          coBorrowerFieldLabel: 'Co-Borrower',
          nameFieldLabel: 'Name',
          defaultAgentName: '',
        },
        resolve
      );
    });

    // Scrape the combined Name field (SF shows "Name" as one field: "Tracey Smith")
    const nameLabels = [settings.nameFieldLabel, 'Name', 'Full Name'];
    const fullName = scrapeFieldByLabels(nameLabels) || null;
    const parsed = parseFullName(fullName);

    // If combined Name doesn't work, fall back to separate First/Last
    const firstName = parsed.first ||
      scrapeFieldByLabels(['First Name', 'FirstName']) || null;
    const lastName = parsed.last ||
      scrapeFieldByLabels(['Last Name', 'LastName']) || null;

    // Co-Borrower (e.g. "Andrew Smith")
    const coBorrowerLabels = [
      settings.coBorrowerFieldLabel,
      'Co-Borrower',
      'CoBorrower',
      'Co Borrower',
    ];
    const coBorrower = scrapeFieldByLabels([...new Set(coBorrowerLabels)]) || null;
    const coBorrowerParsed = parseFullName(coBorrower);

    // Email
    const email =
      scrapeFieldByLabels(['Email', 'Email Address']) || null;

    // Amount — Check Purchase Price first, then fall back to Loan Amount
    const purchasePrice = scrapeFieldByLabels(['Purchase Price']) || null;
    const amountLabels = [
      settings.amountFieldLabel,
      'Max Affordability',
      'Loan Amount',
      'Pre-Approval Amount',
      'Amount',
      'Pre-Approval',
    ];
    const rawAmount = purchasePrice || scrapeFieldByLabels([...new Set(amountLabels)]) || null;
    const amount = rawAmount ? formatCurrency(rawAmount) : null;

    // Agent — "Buyer's Agent" is the primary label on this SF layout
    const agentLabels = [
      settings.agentFieldLabel,
      "Buyer's Agent",
      'Buyers Agent',
      'Referring Agent',
      'Agent',
      'Real Estate Agent',
    ];
    const agentName =
      scrapeFieldByLabels([...new Set(agentLabels)]) || settings.defaultAgentName || null;

    // Get emails from hover popups — snapshot existing emails first,
    // then hover each lookup field and detect new mailto links that appear.
    const baseEmails = getAllMailtoEmails();
    let coBorrowerEmail = null;
    let agentEmail = null;

    if (coBorrower) {
      const coBorrowerLabel = [settings.coBorrowerFieldLabel, 'Co-Borrower']
        .find(l => scrapeFieldByLabel(l));
      if (coBorrowerLabel) {
        coBorrowerEmail = await scrapeEmailFromHoverCard(coBorrowerLabel, baseEmails);
        if (coBorrowerEmail) baseEmails.add(coBorrowerEmail.toLowerCase());
        await new Promise(r => setTimeout(r, 300));
      }
    }
    if (agentName && agentName !== settings.defaultAgentName) {
      const agentLabel = agentLabels.find(l => scrapeFieldByLabel(l));
      if (agentLabel) {
        agentEmail = await scrapeEmailFromHoverCard(agentLabel, baseEmails);
      }
    }

    // Scroll back to top after hover scraping
    window.scrollTo({ top: 0, behavior: 'instant' });

    const recordInfo = getRecordInfo();

    return {
      firstName: firstName || '[FIRST NAME]',
      lastName: lastName || '[LAST NAME]',
      coBorrowerFirstName: coBorrowerParsed.first || null,
      coBorrowerLastName: coBorrowerParsed.last || null,
      coBorrowerFullName: coBorrower || null,
      coBorrowerEmail: coBorrowerEmail || null,
      email: email,
      amount: amount || '[AMOUNT]',
      agentName: agentName || '[AGENT NAME]',
      agentEmail: agentEmail || null,
      recordId: recordInfo ? recordInfo.recordId : null,
      objectType: recordInfo ? recordInfo.objectType : null,
      scrapedFields: {
        name: !!fullName,
        coBorrower: !!coBorrower,
        email: !!email,
        amount: !!rawAmount,
        agentName: !!(agentName && agentName !== settings.defaultAgentName),
      },
    };
  }

  /**
   * Prompt user to pick the pre-approval letter PDF via file picker.
   * Returns { filename, mimeType, base64Content } or null if skipped.
   */
  function pickPreApprovalLetter(lastName) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.style.display = 'none';

      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) { input.remove(); return resolve(null); }

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          input.remove();
          resolve({
            filename: file.name,
            mimeType: file.type || 'application/pdf',
            base64Content: base64,
          });
        };
        reader.onerror = () => { input.remove(); resolve(null); };
        reader.readAsDataURL(file);
      });

      // If user cancels the picker
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Set button state: loading, success, error, or default.
   */
  function setButtonState(button, state, message) {
    button.disabled = ['loading', 'disabled', 'preparing'].includes(state);
    button.classList.remove(
      'vpa-btn--loading',
      'vpa-btn--success',
      'vpa-btn--error',
      'vpa-btn--warning',
      'vpa-btn--disabled',
      'vpa-btn--preparing'
    );

    switch (state) {
      case 'disabled':
        button.classList.add('vpa-btn--disabled');
        button.textContent = '\u{1F4E7} Send VPA Email';
        button.title = 'Only available for Pre-Approval leads';
        break;
      case 'preparing':
        button.classList.add('vpa-btn--preparing');
        button.innerHTML =
          '<span class="vpa-spinner"></span> Preparing...';
        button.title = 'Loading lead data and attachments...';
        break;
      case 'loading':
        button.classList.add('vpa-btn--loading');
        button.innerHTML =
          '<span class="vpa-spinner"></span> Creating Draft...';
        break;
      case 'success':
        button.classList.add('vpa-btn--success');
        button.textContent = 'Draft Created!';
        setTimeout(() => setButtonState(button, 'default'), 3000);
        break;
      case 'error':
        button.classList.add('vpa-btn--error');
        button.textContent = message || 'Error';
        setTimeout(() => setButtonState(button, 'default'), 5000);
        break;
      default:
        button.textContent = '\u{1F4E7} Send VPA Email';
        button.title = '';
        break;
    }
  }

  /**
   * Handle the Send VPA Email button click.
   */
  async function handleSendClick(event) {
    const button = event.currentTarget;

    try {
      // Always scrape fresh data for the current lead
      setButtonState(button, 'loading');
      const leadData = await scrapeLeadData();

      if (!leadData.email) {
        setButtonState(button, 'error', 'No email address found');
        alert(
          'Could not find an email address for this lead/contact. Please ensure the Email field is visible on the page.'
        );
        return;
      }

      // Prompt for pre-approval letter PDF
      const preApprovalFile = await pickPreApprovalLetter(leadData.lastName);
      if (preApprovalFile) {
        leadData.preApprovalAttachment = preApprovalFile;
      }

      setButtonState(button, 'loading');

      // Send data to service worker
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          type: 'CREATE_VPA_DRAFT',
          data: leadData,
        });
      } catch (msgErr) {
        setButtonState(button, 'error', 'Message failed');
        return;
      }
      console.log('[VPA] Draft response:', response);

      if (response && response.success) {
        setButtonState(button, 'success');
        chrome.storage.local.set({
          lastSent: {
            name: `${leadData.firstName} ${leadData.lastName}`,
            email: leadData.email,
            date: new Date().toISOString(),
          },
        });
      } else {
        const errorMsg =
          response && response.error ? response.error : 'Unknown error';
        setButtonState(button, 'error', errorMsg);
        console.error('[VPA Extension] Error:', errorMsg);
      }
    } catch (err) {
      setButtonState(button, 'error', 'Extension error');
      console.error('[VPA Extension] Error:', err);
    }
  }

  /**
   * Find the SF action button bar by looking for the container that holds
   * known action buttons like "Follow", "Edit", "Clone", etc.
   */
  function findActionBar() {
    // Only search within VISIBLE elements — SF workspace tabs keep hidden
    // lead containers in the DOM, so we must skip those.
    const knownButtons = ['Follow', 'Edit', 'Clone', 'New Note', 'Portal'];
    for (const label of knownButtons) {
      const buttons = document.querySelectorAll('button, a.slds-button');
      for (const btn of buttons) {
        if (btn.textContent.trim() === label || btn.textContent.trim() === '+ ' + label) {
          // Check this button is actually visible on screen
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const list = btn.closest('ul');
          if (list) return list;
          const group = btn.closest('[class*="button-group"], [class*="action"]');
          if (group) return group;
        }
      }
    }

    // Strategy 2: Standard SF selectors — check visibility
    const selectors = [
      'runtime_platform_actions-actions-ribbon ul.slds-button-group-list',
      'lightning-actions-ribbon ul.slds-button-group-list',
      '.slds-page-header__col-actions ul.slds-button-group-list',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      }
    }
    return null;
  }

  /**
   * Create and inject the VPA button into the Salesforce page.
   * Single attempt — the 1-second poll in checkPage handles retries.
   */
  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!getRecordInfo()) return;

    const actionBar = findActionBar();
    if (!actionBar) return;

    const li = document.createElement('li');
    li.className = 'slds-button-group-item';

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'slds-button slds-button_brand vpa-send-btn';
    button.addEventListener('click', handleSendClick);

    // Start disabled — will be enabled if Pre-Approval status is confirmed
    setButtonState(button, 'disabled');

    li.appendChild(button);

    try {
      if (actionBar.firstChild) {
        actionBar.insertBefore(li, actionBar.firstChild);
      } else {
        actionBar.appendChild(li);
      }
    } catch (e) {
      // Action bar was replaced by SF before we could insert — poll will retry
      return;
    }

    // Pre-warm attachment cache
    chrome.runtime.sendMessage({ type: 'PREFETCH_ATTACHMENTS' });

    // Check status and enable button only for Pre-Approval leads
    setTimeout(() => {
      if (isPreApprovalStatus()) {
        setButtonState(button, 'default');
      }
    }, 2000);
  }

  /**
   * Check if the lead's status path shows "Pre-Approval" as the current stage.
   */
  function isPreApprovalStatus() {
    // Only check VISIBLE path elements — hidden SF workspace tabs have their own paths
    const activeSteps = document.querySelectorAll(
      '.slds-path__item.slds-is-current span, ' +
      '.slds-path__item.slds-is-active span, ' +
      'lightning-path-step.slds-is-current span, ' +
      '[class*="path__item"][class*="current"] span'
    );
    for (const step of activeSteps) {
      const rect = step.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (step.textContent.trim().toLowerCase().includes('pre-approval')) return true;
    }
    const allPathItems = document.querySelectorAll(
      '.slds-path__item span.slds-path__title, ' +
      'lightning-path-step span'
    );
    for (const item of allPathItems) {
      const rect = item.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const parent = item.closest('.slds-is-current, .slds-is-active, [class*="current"]');
      if (parent && item.textContent.trim().toLowerCase().includes('pre-approval')) return true;
    }
    return false;
  }

  /**
   * Wait for a field label to appear in the DOM, polling up to maxWait ms.
   */
  function waitForField(label, maxWait = 5000) {
    return new Promise((resolve) => {
      if (scrapeFieldByLabel(label)) return resolve(true);
      const start = Date.now();
      const interval = setInterval(() => {
        if (scrapeFieldByLabel(label) || Date.now() - start > maxWait) {
          clearInterval(interval);
          resolve(true);
        }
      }, 500);
    });
  }

  /**
   * Pre-scrape all lead data in the background if status is Pre-Approval.
   */
  async function preScrapIfPreApproval() {
    if (preScrapeInProgress || cachedLeadData) return;
    if (!isPreApprovalStatus()) return;

    preScrapeInProgress = true;
    const button = document.getElementById(BUTTON_ID);
    try {
      cachedLeadData = await scrapeLeadData();
      isReady = true;
      if (button) setButtonState(button, 'default');
    } catch (e) {
      cachedLeadData = null;
      if (button) setButtonState(button, 'default');
    }
    preScrapeInProgress = false;
  }

  /**
   * Fallback: inject a floating button if the SF action bar isn't found.
   */
  function injectFloatingButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'vpa-send-btn vpa-send-btn--floating';
    button.textContent = '\u{1F4E7} Send VPA Email';
    button.addEventListener('click', handleSendClick);

    document.body.appendChild(button);
  }

  /**
   * Remove the button if navigating away from a Lead/Contact page.
   */
  function removeButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      const li = btn.closest('li.slds-button-group-item');
      if (li) {
        li.remove();
      } else {
        btn.remove();
      }
    }
  }

  /**
   * Initialize: inject button and watch for SPA navigation.
   */
  function init() {
    let lastUrl = window.location.href;

    function checkPage() {
      try {
        const currentUrl = window.location.href;
        const urlChanged = currentUrl !== lastUrl;

        if (urlChanged) {
          console.log('[VPA] URL changed:', lastUrl, '->', currentUrl);
          lastUrl = currentUrl;
          cachedLeadData = null;
          isReady = false;
          preScrapeInProgress = false;
          // Remove all VPA buttons from the page
          document.querySelectorAll('#' + BUTTON_ID).forEach(el => {
            const li = el.closest('li.slds-button-group-item');
            if (li) li.remove(); else el.remove();
          });
        }

        if (!getRecordInfo()) return;

        // Check if button is in the DOM and actually visible on screen
        const existingBtn = document.getElementById(BUTTON_ID);
        if (existingBtn) {
          const rect = existingBtn.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && document.body.contains(existingBtn);
          if (isVisible) return; // Button is fine
          // Button exists but not visible — remove it
          const li = existingBtn.closest('li.slds-button-group-item');
          if (li) li.remove(); else existingBtn.remove();
        }

        injectButton();
      } catch (e) {
        console.error('[VPA] checkPage error:', e);
      }
    }

    // Initial check
    checkPage();

    // Poll every second to catch SPA navigation
    setInterval(checkPage, 1000);
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRIGGER_VPA_FROM_POPUP') {
      const button = document.getElementById(BUTTON_ID);
      if (button) {
        button.click();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Button not found on page' });
      }
    }
    if (message.type === 'CHECK_SF_PAGE') {
      const info = getRecordInfo();
      sendResponse({ isSalesforcePage: !!info, recordInfo: info });
    }
    return true;
  });

  init();
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY], function (data) {
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
