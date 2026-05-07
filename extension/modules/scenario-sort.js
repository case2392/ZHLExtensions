// ZHL Productivity Pack module — feature key: feature_scenarioSort
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_scenarioSort';
  function __zhlRunModule() {
(function () {
  'use strict';

  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
    ? chrome.runtime.getManifest().version : '?';
  console.log('[Scenario Sort v' + VERSION + '] loaded in', location.href);

  const TOOLBAR_ID = 'zhl-scenario-sort-toolbar';
  const STYLED_CARD_SELECTOR = '[class*="StyledCard-c11n"]';
  const DRAG_HANDLE_CLASS = 'zhl-scenario-drag-handle';
  const DRAGGING_CLASS = 'zhl-scenario-dragging';
  const DROP_TARGET_CLASS = 'zhl-scenario-drop-target';

  function isOnScenariosPage() {
    return /\/loan-officer-portal\/[^/]+\/pricing-and-scenarios/.test(location.pathname);
  }

  function findRowValue(card, labelText) {
    const target = labelText.replace(/\s+/g, ' ').trim().toLowerCase();
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const t = (span.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t !== target) continue;
      const row = span.parentElement;
      if (!row) continue;
      const p = row.querySelector('p');
      if (p) return (p.textContent || '').trim();
    }
    return null;
  }

  function isScenarioCard(card) {
    const text = card.textContent || '';
    return text.indexOf('Loan purpose') !== -1
      && text.indexOf('Total loan amount') !== -1
      && text.indexOf('Interest rate') !== -1;
  }

  function parseRate(card) {
    const raw = findRowValue(card, 'Interest rate');
    if (!raw) return NaN;
    const m = /(-?\d+(?:\.\d+)?)/.exec(raw);
    return m ? parseFloat(m[1]) : NaN;
  }

  // The wrapper depth between StyledCard and the row container varies
  // (e.g. the assigned card sits in fYkQGX, the rest in fYkQGX ehvoJi).
  // So instead of assuming a fixed parent, find the deepest ancestor
  // that ALL scenario cards share — that's the row container — then for
  // each card walk up until its parent is that row.
  function getScenarioCardElements() {
    const cards = Array.from(document.querySelectorAll(STYLED_CARD_SELECTOR));
    return cards.filter(isScenarioCard);
  }

  function deepestCommonAncestor(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].parentElement || null;
    const chains = elements.map((el) => {
      const chain = [];
      let cur = el;
      while (cur && cur !== document.body) {
        chain.push(cur);
        cur = cur.parentElement;
      }
      return chain;
    });
    const sets = chains.slice(1).map((c) => new Set(c));
    for (const ancestor of chains[0]) {
      if (sets.every((s) => s.has(ancestor))) return ancestor;
    }
    return null;
  }

  function getCardWrappers() {
    const cards = getScenarioCardElements();
    if (cards.length === 0) return [];
    const row = deepestCommonAncestor(cards);
    if (!row) return [];
    const wrappers = [];
    for (const card of cards) {
      let cur = card;
      while (cur && cur.parentElement !== row) cur = cur.parentElement;
      if (cur) wrappers.push(cur);
    }
    return wrappers;
  }

  function commonParent(wrappers) {
    if (wrappers.length === 0) return null;
    const parent = wrappers[0].parentElement;
    if (!parent) return null;
    for (const w of wrappers) {
      if (w.parentElement !== parent) return null;
    }
    return parent;
  }

  function sortByRate(direction) {
    const wrappers = getCardWrappers();
    if (wrappers.length < 2) return;
    const parent = commonParent(wrappers);
    if (!parent) {
      console.warn('[Scenario Sort] cards do not share a common parent — aborting');
      return;
    }
    const items = wrappers.map((wrapper) => {
      const card = wrapper.querySelector(STYLED_CARD_SELECTOR);
      return { wrapper, rate: parseRate(card) };
    });
    items.sort((a, b) => {
      const aBad = !isFinite(a.rate);
      const bBad = !isFinite(b.rate);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return direction === 'desc' ? b.rate - a.rate : a.rate - b.rate;
    });
    for (const item of items) parent.appendChild(item.wrapper);
    flashStatus('Sorted by rate (' + (direction === 'desc' ? 'high → low' : 'low → high') + ')');
  }

  // ---- Toolbar UI -----------------------------------------------------

  function makeToolbar() {
    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.setAttribute('style',
      'display: flex; align-items: center; gap: 8px;' +
      'padding: 10px 12px; margin: 0 0 12px;' +
      'background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px;' +
      'font-family: inherit; font-size: 13px; color: #374151;'
    );
    const label = document.createElement('span');
    label.textContent = 'Sort scenarios:';
    label.setAttribute('style', 'font-weight: 600;');
    bar.appendChild(label);

    const ascBtn = makeButton('Rate ↑ (low → high)', () => sortByRate('asc'));
    const descBtn = makeButton('Rate ↓ (high → low)', () => sortByRate('desc'));
    bar.appendChild(ascBtn);
    bar.appendChild(descBtn);

    const hint = document.createElement('span');
    hint.setAttribute('style', 'margin-left: auto; color: #6b7280; font-size: 12px;');
    hint.textContent = 'or drag a card to reorder manually';
    bar.appendChild(hint);

    const status = document.createElement('span');
    status.id = TOOLBAR_ID + '-status';
    status.setAttribute('style', 'color: #047857; font-size: 12px; opacity: 0; transition: opacity 0.2s ease; margin-left: 8px;');
    bar.appendChild(status);

    return bar;
  }

  function makeButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('style',
      'display: inline-flex; align-items: center;' +
      'padding: 6px 12px; background: #ffffff; color: #006aff;' +
      'border: 1px solid #006aff; border-radius: 4px;' +
      'font-family: inherit; font-size: 12.5px; font-weight: 500;' +
      'cursor: pointer; white-space: nowrap;'
    );
    btn.addEventListener('mouseenter', () => { btn.style.background = '#eef4ff'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#ffffff'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function flashStatus(msg) {
    const el = document.getElementById(TOOLBAR_ID + '-status');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  // ---- Drag-and-drop --------------------------------------------------

  let draggingWrapper = null;

  function enableDragAndDrop(wrapper) {
    if (wrapper.hasAttribute('data-zhl-dnd')) return;
    wrapper.setAttribute('data-zhl-dnd', '1');
    wrapper.setAttribute('draggable', 'true');
    wrapper.style.cursor = 'grab';

    wrapper.addEventListener('dragstart', (e) => {
      draggingWrapper = wrapper;
      wrapper.classList.add(DRAGGING_CLASS);
      wrapper.style.opacity = '0.55';
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'zhl'); }
      catch (_) {}
    });
    wrapper.addEventListener('dragend', () => {
      draggingWrapper = null;
      wrapper.classList.remove(DRAGGING_CLASS);
      wrapper.style.opacity = '';
      document.querySelectorAll('.' + DROP_TARGET_CLASS).forEach((el) => {
        el.classList.remove(DROP_TARGET_CLASS);
        el.style.outline = '';
        el.style.outlineOffset = '';
      });
    });
    wrapper.addEventListener('dragover', (e) => {
      if (!draggingWrapper || draggingWrapper === wrapper) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      wrapper.classList.add(DROP_TARGET_CLASS);
      wrapper.style.outline = '2px dashed #006aff';
      wrapper.style.outlineOffset = '2px';
    });
    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove(DROP_TARGET_CLASS);
      wrapper.style.outline = '';
      wrapper.style.outlineOffset = '';
    });
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove(DROP_TARGET_CLASS);
      wrapper.style.outline = '';
      wrapper.style.outlineOffset = '';
      if (!draggingWrapper || draggingWrapper === wrapper) return;
      const parent = wrapper.parentElement;
      if (!parent || draggingWrapper.parentElement !== parent) return;
      // Decide drop side based on cursor x relative to target center.
      const r = wrapper.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      if (before) parent.insertBefore(draggingWrapper, wrapper);
      else parent.insertBefore(draggingWrapper, wrapper.nextSibling);
      flashStatus('Reordered manually');
    });
  }

  // ---- Lifecycle ------------------------------------------------------

  function ensureToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    const wrappers = getCardWrappers();
    if (wrappers.length === 0) return;
    const cardsRow = commonParent(wrappers);
    if (!cardsRow) return;
    const bar = makeToolbar();
    bar.style.flex = '1 0 100%'; // ensure full row inside flex parents

    // Insert the toolbar as the FIRST child of the same row that contains
    // the cards. That way it appears above them on its own line (the row
    // is wrap-friendly) and doesn't fight any wrapping container.
    if (cardsRow.firstChild) cardsRow.insertBefore(bar, cardsRow.firstChild);
    else cardsRow.appendChild(bar);
    console.log('[Scenario Sort] toolbar inserted into <' + cardsRow.tagName.toLowerCase() + '> with', wrappers.length, 'cards');
  }

  function ensureDnd() {
    getCardWrappers().forEach(enableDragAndDrop);
  }

  function tearDown() {
    const bar = document.getElementById(TOOLBAR_ID);
    if (bar) bar.remove();
  }

  let lastDiag = '';
  function diag(msg) {
    if (msg === lastDiag) return;
    lastDiag = msg;
    console.log('[Scenario Sort DIAG]', msg);
  }

  function describe(el) {
    if (!el) return 'null';
    const cls = (el.getAttribute && el.getAttribute('class')) || '';
    return '<' + el.tagName.toLowerCase() + (cls ? ' class="' + cls.slice(0, 80) + '"' : '') + '>';
  }

  function tick() {
    if (!isOnScenariosPage()) {
      tearDown();
      return;
    }
    // Raw element counts before isScenarioCard filtering — tells us
    // whether the StyledCard selector is finding anything.
    const allCards = document.querySelectorAll(STYLED_CARD_SELECTOR);
    const wrappers = getCardWrappers();
    if (wrappers.length === 0) {
      diag('no scenario cards yet. raw StyledCard hits=' + allCards.length);
      return;
    }
    const parent = commonParent(wrappers);
    if (!parent) {
      diag('found ' + wrappers.length + ' cards but they do not share a common parent. parents seen: ' +
        wrappers.slice(0, 4).map((w) => describe(w.parentElement)).join(' | '));
      return;
    }
    diag('found ' + wrappers.length + ' cards. parent=' + describe(parent) + ', grandparent=' + describe(parent.parentElement));
    ensureToolbar();
    ensureDnd();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { tick(); }
      catch (e) { console.error('[Scenario Sort] tick error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  // Heartbeat in case the React render that adds the cards happens in a
  // way the MutationObserver / rAF debouncer doesn't catch in time.
  setInterval(schedule, 1500);
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
