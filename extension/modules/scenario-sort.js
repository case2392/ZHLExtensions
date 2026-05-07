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

  // For each scenario card, find the LARGEST ancestor that contains
  // ONLY that card (no other scenario cards). That ancestor is the
  // per-card "wrapper" — what we move when sorting / dragging. By
  // construction the wrappers are pairwise disjoint, so they can be
  // freely reordered as siblings.
  function findUniqueWrapper(card, allCards) {
    let cur = card;
    while (cur.parentElement && cur.parentElement !== document.body) {
      const parent = cur.parentElement;
      const containsOther = allCards.some((c) => c !== card && parent.contains(c));
      if (containsOther) return cur;
      cur = parent;
    }
    return cur;
  }

  function getCardWrappers() {
    const cards = getScenarioCardElements();
    if (cards.length === 0) return [];
    return cards.map((card) => findUniqueWrapper(card, cards));
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

  // Snapshot the ORIGINAL parent → ordered children list once, the very
  // first time the user takes any reordering action. We capture EVERY
  // child of each affected parent (not just our tracked wrappers) so a
  // sibling like the unassigned-cards sub-container slots back into its
  // original position rather than getting pushed to the end by appendChild.
  const originalState = new Map(); // parent -> [...all original children]
  function captureOriginalIfNeeded() {
    if (originalState.size > 0) return;
    const cards = getScenarioCardElements();
    const wrappers = cards.map((card) => findUniqueWrapper(card, cards));
    const parents = new Set();
    // Capture parents of BOTH the cards themselves and their wrappers.
    // Sort moves the StyledCard elements directly (so we need their
    // original parent — e.g. the assigned sub-container — to put each
    // card back). Drag-and-drop moves wrappers (so we need the wrapper
    // parents too, in case the user only ever drags).
    for (const c of cards) if (c.parentElement) parents.add(c.parentElement);
    for (const w of wrappers) if (w.parentElement) parents.add(w.parentElement);
    for (const p of parents) {
      originalState.set(p, Array.from(p.children));
    }
  }

  function revertToOriginal() {
    if (originalState.size === 0) {
      flashStatus('Nothing to revert');
      return;
    }
    for (const [parent, kids] of originalState) {
      if (!parent || !parent.isConnected) continue;
      // appendChild moves the node if it's already in the DOM. Iterating in
      // original order and appending each places them at the end of `parent`
      // in their original order — so the tracked siblings end up right after
      // any non-tracked children (toolbar etc.) stayed put.
      for (const kid of kids) {
        if (kid && kid.isConnected) parent.appendChild(kid);
      }
    }
    refreshSelectionsToMatchDom();
    flashStatus('Reverted to original order');
  }

  // Pick the parent that already contains the most card wrappers — that's
  // the unassigned-cards grid. Moving all wrappers there sorts the
  // assigned card alongside the others while keeping each wrapper intact.
  function pickWrapperTarget(wrappers) {
    const counts = new Map();
    for (const w of wrappers) {
      const p = w.parentElement;
      if (!p) continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = null, max = 0;
    for (const [p, n] of counts) {
      if (n > max) { max = n; best = p; }
    }
    return best;
  }

  // Sort by moving each card's WRAPPER (card + its 2-1 Buydown button +
  // any per-card layout chrome) into one common parent, in rate order.
  // We can't move just the StyledCard — the buydown button is injected
  // as a sibling of the card inside the card's wrapper, so moving the
  // card alone orphans the button. Moving the whole wrapper keeps each
  // card-and-button pair together.
  function sortByRate(direction) {
    const cards = getScenarioCardElements();
    if (cards.length < 2) return;
    captureOriginalIfNeeded();
    const wrappers = cards.map((card) => findUniqueWrapper(card, cards));
    const target = pickWrapperTarget(wrappers);
    if (!target) {
      console.warn('[Scenario Sort] no sort target — aborting');
      return;
    }
    const items = wrappers.map((wrapper, i) => ({ wrapper, rate: parseRate(cards[i]) }));
    items.sort((a, b) => {
      const aBad = !isFinite(a.rate);
      const bBad = !isFinite(b.rate);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return direction === 'desc' ? b.rate - a.rate : a.rate - b.rate;
    });
    for (const item of items) target.appendChild(item.wrapper);
    console.log('[Scenario Sort] sorted ' + items.length + ' wrappers (' + direction + ') into <' + target.tagName.toLowerCase() + '>');
    refreshSelectionsToMatchDom();
    flashStatus('Sorted by rate (' + (direction === 'desc' ? 'high → low' : 'low → high') + ')');
  }

  // After we move cards around, the page's React selection state can
  // still hold the OLD click-order — Generate PDF uses that order, not
  // the current DOM. Force a refresh by un-checking every checked
  // checkbox and re-clicking them in the new DOM order, so the
  // selection list ends up matching what the user sees.
  function refreshSelectionsToMatchDom() {
    const boxes = findScenarioCheckboxes();
    const wereChecked = new Set();
    for (const cb of boxes) if (cb.checked) wereChecked.add(cb);
    if (wereChecked.size === 0) return;
    for (const cb of wereChecked) cb.click();
    setTimeout(() => {
      const reordered = findScenarioCheckboxes();
      for (const cb of reordered) {
        if (wereChecked.has(cb)) cb.click();
      }
    }, 100);
  }

  // ---- Select all checkboxes -----------------------------------------

  function findScenarioCheckboxes() {
    return Array.from(document.querySelectorAll('input[name="selectScenario"]'));
  }

  function toggleSelectAll() {
    const boxes = findScenarioCheckboxes();
    if (boxes.length === 0) {
      flashStatus('No scenario checkboxes found');
      return;
    }
    const anyUnchecked = boxes.some((cb) => !cb.checked);
    let changed = 0;
    for (const cb of boxes) {
      if (anyUnchecked && !cb.checked) { cb.click(); changed++; }
      else if (!anyUnchecked && cb.checked) { cb.click(); changed++; }
    }
    flashStatus(anyUnchecked ? ('Selected all (' + changed + ')') : ('Deselected all (' + changed + ')'));
  }

  // ---- Toolbar UI -----------------------------------------------------

  function makeToolbar() {
    // Outer wrapper so the actual bar can use width: fit-content without
    // collapsing inside parents that ignore inline-flex.
    const wrap = document.createElement('div');
    wrap.id = TOOLBAR_ID;
    wrap.setAttribute('style', 'display: block; padding: 0; margin: 0 0 12px 0; font-family: inherit;');

    const bar = document.createElement('div');
    bar.setAttribute('style',
      'display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;' +
      'padding: 8px 10px; ' +
      'background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px;' +
      'font-family: inherit; font-size: 13px; color: #374151; max-width: 100%;'
    );
    wrap.appendChild(bar);

    const label = document.createElement('span');
    label.textContent = 'Sort:';
    label.setAttribute('style', 'font-weight: 600; margin-right: 2px;');
    bar.appendChild(label);

    bar.appendChild(makeButton('Rate ↑', () => sortByRate('asc'), { primary: true }));
    bar.appendChild(makeButton('Rate ↓', () => sortByRate('desc'), { primary: true }));
    bar.appendChild(makeButton('Reset', () => revertToOriginal(), { primary: true }));

    const sep = document.createElement('span');
    sep.setAttribute('style', 'width: 1px; height: 18px; background: #d1d5db; margin: 0 4px;');
    bar.appendChild(sep);

    bar.appendChild(makeButton('Select all', () => toggleSelectAll(), { primary: true }));

    const status = document.createElement('span');
    status.id = TOOLBAR_ID + '-status';
    status.setAttribute('style', 'color: #047857; font-size: 12px; opacity: 0; transition: opacity 0.2s ease; margin-left: 6px;');
    bar.appendChild(status);

    return wrap;
  }

  function makeButton(label, onClick, opts) {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    let bg = '#ffffff', fg = '#006aff', border = '#006aff', hoverBg = '#eef4ff';
    if (opts.primary) { bg = '#006aff'; fg = '#ffffff'; border = '#006aff'; hoverBg = '#0056d2'; }
    if (opts.secondary) { bg = '#ffffff'; fg = '#374151'; border = '#d1d5db'; hoverBg = '#f3f4f6'; }
    btn.setAttribute('style',
      'display: inline-flex; align-items: center;' +
      'padding: 8px 15px; background: ' + bg + '; color: ' + fg + ';' +
      'border: 1px solid ' + border + '; border-radius: 5px;' +
      'font-family: inherit; font-size: 19px; font-weight: 500;' +
      'cursor: pointer; white-space: nowrap; line-height: 1.2;'
    );
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; if (opts.primary) btn.style.color = '#ffffff'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = bg; btn.style.color = fg; });
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
      captureOriginalIfNeeded();
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
      if (!parent) return;
      // Allow cross-parent drops — the assigned card lives in a different
      // sub-container than the unassigned cards; without this gate the
      // dragged card would silently fail to move into the target's row.
      const r = wrapper.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      if (before) parent.insertBefore(draggingWrapper, wrapper);
      else parent.insertBefore(draggingWrapper, wrapper.nextSibling);
      flashStatus('Reordered manually');
    });
  }

  // ---- Lifecycle ------------------------------------------------------

  function isFlexRow(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display !== 'flex' && cs.display !== 'inline-flex') return false;
    const dir = cs.flexDirection || 'row';
    return dir === 'row' || dir === 'row-reverse';
  }

  function ensureToolbar(ancestor) {
    if (document.getElementById(TOOLBAR_ID)) return;
    if (!ancestor) return;

    // Walk up past every flex-row ancestor of the cards' container —
    // inserting a full-width sibling inside a flex-row would push the
    // cards horizontally off-screen. Stop at the first ancestor that's
    // block / flex-column / grid — safe to insert a row-level sibling
    // there.
    let pathChild = ancestor;
    while (pathChild.parentElement && isFlexRow(pathChild.parentElement)) {
      pathChild = pathChild.parentElement;
    }
    const container = pathChild.parentElement;
    if (!container) return;

    const bar = makeToolbar();
    container.insertBefore(bar, pathChild);
    console.log('[Scenario Sort] toolbar inserted in <' + container.tagName.toLowerCase() + '> before <' + pathChild.tagName.toLowerCase() + '>');
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
    const allCards = document.querySelectorAll(STYLED_CARD_SELECTOR);
    const cards = getScenarioCardElements();
    if (cards.length === 0) {
      diag('no scenario cards yet. raw StyledCard hits=' + allCards.length);
      return;
    }
    const ancestor = deepestCommonAncestor(cards);
    if (!ancestor) {
      diag('found ' + cards.length + ' cards but no common ancestor');
      return;
    }
    // Note: per-card unique wrappers may have *different* immediate
    // parents (e.g. the assigned card sits in a different sub-container
    // than the unassigned cards). That's fine — the toolbar just needs
    // to live above them, and the sort button flattens the wrappers
    // into one common ancestor at click time.
    diag('found ' + cards.length + ' cards. common ancestor=' + describe(ancestor));
    ensureToolbar(ancestor);
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
