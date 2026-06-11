// ZHL Productivity Pack module — feature key: feature_sfMossRequest
//
// COMING SOON as of v1.63.11. The MOSS Request workflow is on the roadmap
// but the cross-team scoping isn't finished (Work Discovery's
// task-creation endpoint, LO-side auth, the intake schema). Until that
// lands, this module short-circuits — no button is injected into the
// Salesforce action bar, no storage is read or written. The Setup page
// and walkthrough surface a "Coming Soon" badge in place of the live
// toggle so LOs see the feature is on the radar.
//
// The full implementation below is preserved so re-enabling is a single
// commit (remove the early return + flip the Setup card back to the
// regular toggle UI).
//
// MOSS = Mortgage Origination Support Specialist. Caps preferred
// per the team's own convention.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_sfMossRequest';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[ZHL MOSS Request v' + VERSION + '] coming soon — module short-circuiting, no button injected. Source preserved below for the v2 build.');
  return;

  const BUTTON_ID  = 'zhl-moss-request-btn';
  const MODAL_ID   = 'zhl-moss-request-modal';
  const TOAST_ID   = 'zhl-moss-request-toast';
  const STORAGE_KEY = 'zhlMossPendingRequests';
  const RECORD_URL_PATTERN = /\/lightning\/r\/(Lead|Contact|Opportunity)\/([a-zA-Z0-9]{15,18})\/view/;
  const MOSS_DESKTOP_URL = 'https://zhl-work-discovery-prod.corp.zgcp-itrc-prod-k8s.zg-int.net/tasks';

  // Catalog of request types the LO can pick from. Keep these short
  // and verb-led — the LO sees them as a list of clickable cards.
  const REQUEST_TYPES = [
    {
      id: 'condo_report',
      label: 'Look up condo report',
      desc: 'Pull the project review / questionnaire for the subject condo.'
    },
    {
      id: 'work_up_contract',
      label: 'Work up a contract',
      desc: 'Prep a fee worksheet + LE figures from the executed purchase agreement.'
    },
    {
      id: 'call_buyer_at_time',
      label: 'Call this buyer at a specific time',
      desc: 'Reach out to the borrower at the time below to take next steps.',
      requiresTime: true
    },
    {
      id: 'initial_outreach',
      label: 'Initial outreach to buyer',
      desc: 'First-touch call to introduce yourself, confirm details, and warm-hand off to me.'
    },
    {
      id: 'schedule_buyer_on_calendar',
      label: 'Get buyer scheduled on my calendar',
      desc: 'Coordinate with the borrower and drop a meeting on my calendar.'
    },
    {
      id: 'work_up_preapproval',
      label: 'Work up a pre-approval',
      desc: 'Build a fresh pre-approval from scratch — credit, AUS, scenarios.'
    },
    {
      id: 'update_preapproval',
      label: 'Update a pre-approval',
      desc: 'Refresh an existing pre-approval (new purchase price, new property, new term).'
    },
    {
      id: 'other',
      label: 'Other / custom request',
      desc: 'Describe what you need in the notes box below.'
    }
  ];

  function getRecordInfo() {
    const match = window.location.pathname.match(RECORD_URL_PATTERN);
    if (!match) return null;
    return { objectType: match[1], recordId: match[2] };
  }

  function scrapeBorrowerName() {
    // Best-effort grab of the page header. This is shown in the modal
    // ("MOSS request for <Name>") and stored alongside the request.
    // If we can't find a name we still let the LO submit — the
    // record ID is enough for the MOSS specialist to open the file.
    const selectors = [
      'lightning-formatted-name',
      'records-highlights-details-item lightning-formatted-text',
      '.slds-page-header__title',
      'h1.slds-page-header__title',
      'h1'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        const txt = el.textContent.trim();
        // Skip obvious non-name headers
        if (/^(home|dashboard|setup|reports?)$/i.test(txt)) continue;
        if (txt.length < 80) return txt;
      }
    }
    return null;
  }

  // ---- Action-bar discovery (mirrors sf-vpa-email.js) -------------
  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findActionBar() {
    const knownLabels = ['Follow', 'Edit', 'Clone', 'New Note'];
    for (const label of knownLabels) {
      for (const btn of document.querySelectorAll('button, a.slds-button')) {
        const t = btn.textContent.trim();
        if (t !== label && t !== '+ ' + label) continue;
        if (!isElementVisible(btn)) continue;
        const list = btn.closest('ul');
        if (list) return list;
      }
    }
    const selectors = [
      'runtime_platform_actions-actions-ribbon ul.slds-button-group-list',
      'lightning-actions-ribbon ul.slds-button-group-list',
      '.slds-page-header__col-actions ul.slds-button-group-list'
    ];
    for (const s of selectors) {
      for (const el of document.querySelectorAll(s)) {
        if (isElementVisible(el)) return el;
      }
    }
    return null;
  }

  // ---- Modal UI ---------------------------------------------------
  function openModal() {
    if (document.getElementById(MODAL_ID)) return;
    const borrowerName = scrapeBorrowerName();
    const recordInfo = getRecordInfo();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(15,23,42,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:12px',
      'max-width:640px', 'width:92vw', 'max-height:88vh',
      'overflow:auto',
      'padding:22px 26px',
      'box-shadow:0 18px 48px rgba(0,0,0,0.3)',
      'color:#0f172a'
    ].join(';');

    const heading = borrowerName
      ? 'MOSS request for ' + borrowerName
      : 'MOSS request';

    let html = '';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">';
    html += '<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:#dbeafe;color:#1d4ed8;font-weight:800;font-size:13px;letter-spacing:0.5px;">MOSS</span>';
    html += '<h3 style="margin:0;font:700 18px/1.2 inherit;color:#0f172a;">' + heading + '</h3>';
    html += '</div>';
    html += '<div style="font:12px/1.4 inherit;color:#64748b;margin-bottom:14px;">Submit a request to the Mortgage Origination Support Specialist team. Pick one of the options below, add any notes or a due time, then submit.</div>';

    // Request type cards
    html += '<div id="zhl-moss-type-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">';
    REQUEST_TYPES.forEach(function (t, i) {
      html += '<label data-moss-type="' + t.id + '" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;transition:background 0.12s,border-color 0.12s;">';
      html += '<input type="radio" name="zhl-moss-type" value="' + t.id + '"' + (i === 0 ? ' checked' : '') + ' style="margin-top:3px;accent-color:#1d4ed8;">';
      html += '<div style="flex:1;">';
      html += '<div style="font:600 13px inherit;color:#0f172a;">' + t.label + '</div>';
      html += '<div style="font:12px/1.4 inherit;color:#64748b;margin-top:2px;">' + t.desc + '</div>';
      html += '</div>';
      html += '</label>';
    });
    html += '</div>';

    // Optional time field (shown only for call_buyer_at_time, but
    // rendered always and hidden via display logic for simplicity)
    html += '<div id="zhl-moss-time-row" style="display:none;margin-bottom:12px;">';
    html += '<label style="display:block;font:600 12px inherit;color:#334155;margin-bottom:4px;">Preferred call time</label>';
    html += '<input id="zhl-moss-time" type="datetime-local" style="width:100%;padding:8px 10px;font:13px inherit;border:1px solid #cbd5e1;border-radius:6px;">';
    html += '</div>';

    // Notes textarea
    html += '<label style="display:block;font:600 12px inherit;color:#334155;margin-bottom:4px;">Notes for MOSS (optional)</label>';
    html += '<textarea id="zhl-moss-notes" rows="3" placeholder="Any context the MOSS specialist should know — property address, contract deadline, borrower preferences, etc." style="width:100%;padding:8px 10px;font:13px inherit;border:1px solid #cbd5e1;border-radius:6px;resize:vertical;margin-bottom:12px;box-sizing:border-box;"></textarea>';

    // Recent-requests roll-up (read from storage on render)
    html += '<div id="zhl-moss-recent-wrap" style="display:none;margin-bottom:14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">';
    html += '<div style="font:600 12px inherit;color:#334155;margin-bottom:6px;">Recent requests on this record</div>';
    html += '<ul id="zhl-moss-recent-list" style="margin:0;padding:0;list-style:none;font:12px/1.5 inherit;color:#475569;"></ul>';
    html += '</div>';

    // V2 hand-off banner
    html += '<div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;padding:9px 12px;font:11.5px/1.45 inherit;color:#78350f;margin-bottom:16px;">';
    html += '<b>Heads up — preview.</b> Submitting captures the request locally and shows a confirmation. Direct hand-off into the MOSS team\'s <a href="' + MOSS_DESKTOP_URL + '" target="_blank" rel="noopener" style="color:#78350f;font-weight:700;text-decoration:underline;">Work Discovery /tasks queue</a> is being wired up next. Until then, you can click the link to open the MOSS desktop and surface the request the usual way — the captured details are still saved here so you can copy them over.';
    html += '</div>';

    // Action row
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
    html += '<button id="zhl-moss-cancel" style="padding:9px 16px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;font:600 13px inherit;cursor:pointer;">Cancel</button>';
    html += '<button id="zhl-moss-submit" style="padding:9px 16px;background:#1d4ed8;color:#fff;border:1px solid #1d4ed8;border-radius:6px;font:600 13px inherit;cursor:pointer;">Submit MOSS request</button>';
    html += '</div>';
    html += '<div style="margin-top:10px;font:11px/1.4 inherit;color:#94a3b8;">Built by Justin Case. Karma appreciated 💛</div>';

    card.innerHTML = html;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // ---- Interactions ---------------------------------------------
    function syncTypeRowHighlight() {
      const sel = card.querySelector('input[name="zhl-moss-type"]:checked');
      const id = sel ? sel.value : null;
      const t  = REQUEST_TYPES.find(function (x) { return x.id === id; });
      const timeRow = card.querySelector('#zhl-moss-time-row');
      timeRow.style.display = (t && t.requiresTime) ? '' : 'none';
      card.querySelectorAll('label[data-moss-type]').forEach(function (lab) {
        const on = lab.getAttribute('data-moss-type') === id;
        lab.style.background   = on ? '#eff6ff' : '#fff';
        lab.style.borderColor  = on ? '#1d4ed8' : '#e2e8f0';
      });
    }
    syncTypeRowHighlight();
    card.querySelectorAll('input[name="zhl-moss-type"]').forEach(function (r) {
      r.addEventListener('change', syncTypeRowHighlight);
    });

    // Populate "recent requests on this record" if storage has any
    try {
      chrome.storage.local.get([STORAGE_KEY], function (data) {
        const all = (data && data[STORAGE_KEY]) || [];
        const here = all.filter(function (r) {
          return recordInfo && r.recordId === recordInfo.recordId;
        }).slice(-3).reverse();
        if (!here.length) return;
        const wrap = card.querySelector('#zhl-moss-recent-wrap');
        const list = card.querySelector('#zhl-moss-recent-list');
        wrap.style.display = '';
        here.forEach(function (r) {
          const t = REQUEST_TYPES.find(function (x) { return x.id === r.type; });
          const when = r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '';
          const li = document.createElement('li');
          li.style.cssText = 'padding:3px 0;border-bottom:1px dashed #e2e8f0;';
          li.textContent = '• ' + (t ? t.label : r.type) + (when ? ' — ' + when : '');
          list.appendChild(li);
        });
      });
    } catch (_) {}

    function closeModal() { overlay.remove(); }

    card.querySelector('#zhl-moss-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    card.querySelector('#zhl-moss-submit').addEventListener('click', function () {
      const sel = card.querySelector('input[name="zhl-moss-type"]:checked');
      const typeId = sel ? sel.value : null;
      if (!typeId) {
        showToast('Pick a request type first.', 'warn');
        return;
      }
      const t = REQUEST_TYPES.find(function (x) { return x.id === typeId; });
      const notes = (card.querySelector('#zhl-moss-notes').value || '').trim();
      const time  = (card.querySelector('#zhl-moss-time').value || '').trim();
      if (t && t.requiresTime && !time) {
        showToast('Add a preferred call time for this request.', 'warn');
        return;
      }
      const record = {
        type:        typeId,
        typeLabel:   t ? t.label : typeId,
        notes:       notes,
        callTime:    time || null,
        borrower:    borrowerName || null,
        recordId:    recordInfo ? recordInfo.recordId : null,
        objectType:  recordInfo ? recordInfo.objectType : null,
        recordUrl:   window.location.href,
        submittedAt: Date.now()
      };
      stashRequest(record, function () {
        try {
          chrome.runtime.sendMessage({
            type: 'TRACK',
            event: 'moss_request_submitted',
            props: { typeId: typeId, hasNotes: !!notes, hasTime: !!time, objectType: record.objectType }
          });
        } catch (_) {}
        closeModal();
        showToast('MOSS request captured. Open the MOSS desktop to submit it →', 'ok', MOSS_DESKTOP_URL);
      });
    });
  }

  function stashRequest(record, done) {
    try {
      chrome.storage.local.get([STORAGE_KEY], function (data) {
        const arr = (data && data[STORAGE_KEY]) || [];
        arr.push(record);
        // Keep the last 100 requests; older ones drop off so the
        // bundle never grows unbounded.
        const trimmed = arr.slice(-100);
        const payload = {};
        payload[STORAGE_KEY] = trimmed;
        chrome.storage.local.set(payload, function () { done && done(); });
      });
    } catch (_) { done && done(); }
  }

  // ---- Toast ------------------------------------------------------
  function showToast(message, kind, linkUrl) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    const color = kind === 'warn' ? '#b45309' : '#0f172a';
    const bg    = kind === 'warn' ? '#fef3c7' : '#dcfce7';
    const bd    = kind === 'warn' ? '#f59e0b' : '#16a34a';
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px',
      'z-index:2147483647',
      'background:' + bg, 'color:' + color,
      'border:1px solid ' + bd, 'border-radius:8px',
      'padding:10px 14px', 'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
      'max-width:380px',
      'cursor:' + (linkUrl ? 'pointer' : 'default')
    ].join(';');
    el.textContent = message;
    if (linkUrl) {
      el.addEventListener('click', function () {
        try { window.open(linkUrl, '_blank', 'noopener'); } catch (_) {}
      });
    }
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 6500);
  }

  // ---- Button injection -------------------------------------------
  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!getRecordInfo()) return;
    const bar = findActionBar();
    if (!bar) return;

    const li = document.createElement('li');
    li.className = 'slds-button-group-item';
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'slds-button slds-button_neutral';
    button.style.cssText = [
      'display:inline-flex', 'align-items:center', 'gap:6px',
      'background:#fff', 'color:#1d4ed8',
      'border:1px solid #1d4ed8', 'border-radius:4px',
      'font:600 12px Arial,sans-serif',
      'padding:0 12px', 'height:32px',
      'cursor:pointer'
    ].join(';');
    button.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:18px;border-radius:4px;background:#1d4ed8;color:#fff;font-weight:800;font-size:10px;letter-spacing:0.5px;">MOSS</span> Request';
    button.title = 'Submit a request to the Mortgage Origination Support Specialist team';
    button.addEventListener('click', openModal);
    li.appendChild(button);

    try {
      // Land right after the VPA button if it's there; otherwise as
      // the first child of the action bar (same fall-back as VPA).
      const vpaLi = bar.querySelector('li.slds-button-group-item button#zhl-vpa-send-email-btn');
      const anchorLi = vpaLi ? vpaLi.closest('li.slds-button-group-item') : null;
      if (anchorLi && anchorLi.parentNode === bar) {
        if (anchorLi.nextSibling) bar.insertBefore(li, anchorLi.nextSibling);
        else bar.appendChild(li);
      } else if (bar.firstChild) {
        bar.insertBefore(li, bar.firstChild);
      } else {
        bar.appendChild(li);
      }
    } catch (_) { return; }
  }

  function init() {
    let lastUrl = location.href;
    function tick() {
      try {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          document.querySelectorAll('#' + BUTTON_ID).forEach(function (el) {
            const li = el.closest('li.slds-button-group-item');
            if (li) li.remove(); else el.remove();
          });
        }
        if (!getRecordInfo()) return;
        const existing = document.getElementById(BUTTON_ID);
        if (existing && isElementVisible(existing)) return;
        if (existing) {
          const li = existing.closest('li.slds-button-group-item');
          if (li) li.remove(); else existing.remove();
        }
        injectButton();
      } catch (e) { console.error('[ZHL MOSS] tick error', e); }
    }
    tick();
    setInterval(tick, 1000);
  }

  init();
})();
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([__ZHL_FEATURE_KEY, 'zhl_kill_switch'], function (data) {
      if (data.zhl_kill_switch === true) return;
      if (data[__ZHL_FEATURE_KEY] === false) return;
      __zhlRunModule();
    });
  } else {
    __zhlRunModule();
  }
})();
