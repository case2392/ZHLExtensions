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

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
  }

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
    clearAssignedWrapperOverrides();
    refreshSelectionsToMatchDom();
    flashStatus('Reverted to original order');
    track('scenario_sort_reset');
  }

  // The assigned-card wrapper has its own outer styling (green border,
  // ASSIGNED TO LOAN banner) and is normally laid out by a different
  // parent than the unassigned-cards grid. When we move it into the grid
  // for sorting, the original container's layout rules (width, margins,
  // flex sizing) no longer apply, so it can render at the wrong size and
  // break the gap between cards. Copy a non-assigned wrapper's computed
  // box metrics onto the assigned wrapper after sort to keep the row
  // visually uniform. On Reset we clear these inline overrides.
  const ASSIGNED_OVERRIDE_KEYS = [
    'width', 'minWidth', 'maxWidth',
    'flex', 'flexBasis', 'flexGrow', 'flexShrink',
    'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
    'boxSizing', 'display', 'overflow', 'transform'
  ];
  const ASSIGNED_OVERRIDE_ATTR = 'data-zhl-assigned-styled';
  const PARENT_ALIGN_ATTR = 'data-zhl-parent-align-saved';
  const WRAPPER_LAYOUT_ATTR = 'data-zhl-wrapper-layout-saved';

  function isAssignedWrapper(wrapper) {
    if (!wrapper) return false;
    return /ASSIGNED\s*TO\s*LOAN/i.test(wrapper.textContent || '');
  }

  function findAssignedBanner(assigned) {
    // The "ASSIGNED TO LOAN" banner lives INSIDE the StyledCard (not as
    // a sibling of the card in the wrapper). Find the smallest element
    // whose normalized text is exactly "ASSIGNED TO LOAN" — that's the
    // banner element itself, and its height is the offset we need to
    // compensate for to bottom-align the card body with neighbors.
    const all = assigned.querySelectorAll('*');
    let best = null;
    for (const el of all) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^ASSIGNED\s*TO\s*LOAN$/i.test(text)) {
        if (!best || best.contains(el)) best = el;
      }
    }
    return best;
  }

  function alignAssignedWrapper(wrappers) {
    const assigned = wrappers.find(isAssignedWrapper);
    if (!assigned) {
      console.log('[Scenario Sort align] no assigned wrapper detected');
      return;
    }
    const reference = wrappers.find((w) => w !== assigned && !isAssignedWrapper(w));
    if (!reference) {
      console.log('[Scenario Sort align] no reference (non-assigned) wrapper');
      return;
    }
    const refRect = reference.getBoundingClientRect();
    const refCs = getComputedStyle(reference);
    if (!assigned.hasAttribute(ASSIGNED_OVERRIDE_ATTR)) {
      const original = {};
      for (const k of ASSIGNED_OVERRIDE_KEYS) original[k] = assigned.style[k] || '';
      try { assigned.setAttribute(ASSIGNED_OVERRIDE_ATTR, JSON.stringify(original)); } catch (_) {}
    }
    if (refRect.width > 0) {
      const w = refRect.width + 'px';
      assigned.style.setProperty('width', w, 'important');
      assigned.style.setProperty('min-width', w, 'important');
      assigned.style.setProperty('max-width', w, 'important');
      assigned.style.setProperty('flex-basis', w, 'important');
    }
    assigned.style.setProperty('flex-grow', '0', 'important');
    assigned.style.setProperty('flex-shrink', '0', 'important');
    assigned.style.setProperty('margin-left', refCs.marginLeft, 'important');
    assigned.style.setProperty('margin-right', refCs.marginRight, 'important');
    assigned.style.setProperty('margin-bottom', refCs.marginBottom, 'important');
    assigned.style.setProperty('box-sizing', refCs.boxSizing, 'important');
    if (refCs.display && refCs.display !== 'block') {
      assigned.style.setProperty('display', refCs.display, 'important');
    }
    // Don't let the assigned wrapper's banner overflow get clipped above
    // the row — set overflow visible just in case.
    assigned.style.setProperty('overflow', 'visible', 'important');

    // The banner is inside the StyledCard, so wrapper.top === card.top.
    // Find the banner element directly and use its height as the up-shift.
    const banner = findAssignedBanner(assigned);
    const bannerRect = banner ? banner.getBoundingClientRect() : null;
    const bannerHeight = bannerRect ? bannerRect.height : 0;
    const wrapperRect = assigned.getBoundingClientRect();
    const parent = assigned.parentElement;
    const parentCs = parent ? getComputedStyle(parent) : null;
    console.log('[Scenario Sort align]',
      'wrapper=', shortDescribe(assigned),
      'banner=', shortDescribe(banner),
      'bannerHeight=', bannerHeight,
      'wrapperHeight=', wrapperRect.height,
      'refHeight=', refRect.height,
      'parent.display=', parentCs && parentCs.display,
      'parent.alignItems=', parentCs && parentCs.alignItems,
      'parent.gap=', parentCs && parentCs.gap);
    if (bannerHeight > 1) {
      // Bottom-align card bodies WITHOUT pushing the whole row down.
      // align-items:flex-end on the parent moved every wrapper to the
      // bottom of the parent's cross-axis — but the parent has extra
      // height beyond the cards, so the row visibly dropped on the
      // page. Instead: keep parent at its default stretch (so wrappers
      // fill row height naturally), and turn each wrapper into a flex
      // column with content justified to the bottom. Wrappers stretch
      // to row height (= max natural item height = assigned wrapper's
      // height), and inside each wrapper the card content sits at the
      // bottom — so neighbor card bodies and the assigned card body
      // share the same bottom Y, and the row itself stays at top.
      assigned.style.setProperty('margin-top', refCs.marginTop, 'important');
      assigned.style.removeProperty('transform');
      if (parent && parent.hasAttribute(PARENT_ALIGN_ATTR)) {
        const orig = parent.getAttribute(PARENT_ALIGN_ATTR);
        parent.style.alignItems = orig || '';
        parent.removeAttribute(PARENT_ALIGN_ATTR);
      }
      for (const w of wrappers) {
        if (!w.hasAttribute(WRAPPER_LAYOUT_ATTR)) {
          const orig = {
            display: w.style.display || '',
            flexDirection: w.style.flexDirection || '',
            justifyContent: w.style.justifyContent || ''
          };
          try { w.setAttribute(WRAPPER_LAYOUT_ATTR, JSON.stringify(orig)); } catch (_) {}
        }
        w.style.setProperty('display', 'flex', 'important');
        w.style.setProperty('flex-direction', 'column', 'important');
        w.style.setProperty('justify-content', 'flex-end', 'important');
      }
      console.log('[Scenario Sort align] applied per-wrapper flex-column + justify-content:flex-end to', wrappers.length, 'wrappers');
    } else {
      assigned.style.setProperty('margin-top', refCs.marginTop, 'important');
      assigned.style.removeProperty('transform');
      console.log('[Scenario Sort align] no banner found / zero height — using ref marginTop=', refCs.marginTop);
    }
  }

  function clearAssignedWrapperOverrides() {
    document.querySelectorAll('[' + ASSIGNED_OVERRIDE_ATTR + ']').forEach((el) => {
      let original = {};
      try { original = JSON.parse(el.getAttribute(ASSIGNED_OVERRIDE_ATTR)) || {}; } catch (_) {}
      for (const k of ASSIGNED_OVERRIDE_KEYS) el.style[k] = original[k] || '';
      el.removeAttribute(ASSIGNED_OVERRIDE_ATTR);
    });
    document.querySelectorAll('[' + PARENT_ALIGN_ATTR + ']').forEach((el) => {
      const original = el.getAttribute(PARENT_ALIGN_ATTR);
      el.style.alignItems = original || '';
      el.removeAttribute(PARENT_ALIGN_ATTR);
    });
    document.querySelectorAll('[' + WRAPPER_LAYOUT_ATTR + ']').forEach((el) => {
      let orig = {};
      try { orig = JSON.parse(el.getAttribute(WRAPPER_LAYOUT_ATTR)) || {}; } catch (_) {}
      el.style.display = orig.display || '';
      el.style.flexDirection = orig.flexDirection || '';
      el.style.justifyContent = orig.justifyContent || '';
      el.removeAttribute(WRAPPER_LAYOUT_ATTR);
    });
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
    alignAssignedWrapper(items.map((it) => it.wrapper));
    console.log('[Scenario Sort] sorted ' + items.length + ' wrappers (' + direction + ') into <' + target.tagName.toLowerCase() + '>');
    refreshSelectionsToMatchDom();
    flashStatus('Sorted by rate (' + (direction === 'desc' ? 'high → low' : 'low → high') + ')');
    track('scenario_sort_rate', { direction, count: items.length });
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

  // Keep the Select all / Deselect all label in sync with the actual
  // checkbox state — flips to "Deselect all" once every card is checked,
  // back to "Select all" otherwise. Called from toggleSelectAll() and
  // from tick() so it tracks clicks on individual card checkboxes too.
  function updateSelectAllLabel() {
    const btn = document.getElementById(TOOLBAR_ID + '-select-all-btn');
    if (!btn) return;
    const boxes = findScenarioCheckboxes();
    if (boxes.length === 0) {
      btn.textContent = 'Select all';
      return;
    }
    const allChecked = boxes.every((cb) => cb.checked);
    const desired = allChecked ? 'Deselect all' : 'Select all';
    if (btn.textContent !== desired) btn.textContent = desired;
  }

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
    track('scenario_sort_select_all', { action: anyUnchecked ? 'select' : 'deselect', changed });
    updateSelectAllLabel();
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

    const selectAllBtn = makeButton('Select all', () => toggleSelectAll(), { primary: true });
    selectAllBtn.id = TOOLBAR_ID + '-select-all-btn';
    bar.appendChild(selectAllBtn);

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

  function dndLog() {
    const args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['[Scenario Sort DnD]'].concat(args));
  }

  function shortDescribe(el) {
    if (!el) return 'null';
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';
    const cls = el.getAttribute && el.getAttribute('class');
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return '<' + tag + (cls ? ' class="' + String(cls).slice(0, 50) + '"' : '') + '> "' + txt + '"';
  }

  function enableDragAndDrop(wrapper) {
    if (wrapper.hasAttribute('data-zhl-dnd')) return;
    wrapper.setAttribute('data-zhl-dnd', '1');
    wrapper.setAttribute('draggable', 'true');
    wrapper.style.cursor = 'grab';
    dndLog('attached handlers to', shortDescribe(wrapper), '(draggable=true)');

    wrapper.addEventListener('dragstart', (e) => {
      captureOriginalIfNeeded();
      draggingWrapper = wrapper;
      wrapper.classList.add(DRAGGING_CLASS);
      wrapper.style.opacity = '0.55';
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'zhl');
        dndLog('dragstart OK on', shortDescribe(wrapper));
      } catch (err) {
        dndLog('dragstart dataTransfer error:', err);
      }
    });
    wrapper.addEventListener('dragend', (e) => {
      dndLog('dragend on', shortDescribe(wrapper), 'dropEffect=', e && e.dataTransfer && e.dataTransfer.dropEffect);
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
      if (!draggingWrapper) { dndLog('dragover ignored — no draggingWrapper'); return; }
      if (draggingWrapper === wrapper) return;
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
      dndLog('drop fired. dragging=', shortDescribe(draggingWrapper), 'target=', shortDescribe(wrapper));
      if (!draggingWrapper) { dndLog('drop aborted — no draggingWrapper'); return; }
      if (draggingWrapper === wrapper) { dndLog('drop aborted — dropped on self'); return; }
      const parent = wrapper.parentElement;
      if (!parent) { dndLog('drop aborted — target has no parentElement'); return; }
      const sourceParent = draggingWrapper.parentElement;
      const crossParent = sourceParent !== parent;
      const movedNode = draggingWrapper;
      const sourceIdx = sourceParent ? Array.from(sourceParent.children).indexOf(movedNode) : -1;
      const targetIdx = Array.from(parent.children).indexOf(wrapper);
      try {
        let mode;
        if (!crossParent && sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx) {
          // Same-parent drop on another card → SWAP the two cards'
          // positions. Dropping 6.49 (idx 5) onto 6.75 (idx 7) puts
          // 6.49 at 6.75's slot and 6.75 at 6.49's old slot, which is
          // what users expect for "move this card to that card's
          // position". Plain insert-before/insert-after caused 6.49 and
          // its right neighbor to look like they swapped instead.
          mode = 'swap';
          const targetNextSibling = wrapper.nextSibling === movedNode ? movedNode.nextSibling : wrapper.nextSibling;
          const sourceNextSibling = movedNode.nextSibling === wrapper ? wrapper.nextSibling : movedNode.nextSibling;
          parent.insertBefore(wrapper, sourceNextSibling);
          parent.insertBefore(movedNode, targetNextSibling);
        } else {
          // Cross-parent drop (or unknown source idx): fall back to
          // insert-before / insert-after based on cursor position.
          mode = 'insert';
          const r = wrapper.getBoundingClientRect();
          const before = e.clientX < r.left + r.width / 2;
          if (before) parent.insertBefore(movedNode, wrapper);
          else parent.insertBefore(movedNode, wrapper.nextSibling);
        }
        const idxAfterDrop = Array.from(parent.children).indexOf(movedNode);
        const targetIdxAfter = Array.from(parent.children).indexOf(wrapper);
        dndLog('drop OK — mode=' + mode,
          'sourceIdx=' + sourceIdx, '→ finalIdx=' + idxAfterDrop,
          'targetIdx=' + targetIdx, '→ targetFinalIdx=' + targetIdxAfter,
          'crossParent=' + crossParent);
        flashStatus('Reordered manually');
        // Re-align the assigned wrapper after a manual reorder — if it
        // was the dragged element OR its position changed in the row,
        // its banner-above margin-top may need re-application.
        const cards = getScenarioCardElements();
        const wrappers = cards.map((c) => findUniqueWrapper(c, cards));
        alignAssignedWrapper(wrappers);
        // Verify the move persists. The page is React-driven; if React
        // reconciles the DOM back to its model, our change is undone.
        // Re-check at 50ms / 250ms / 1000ms and log if the index changes.
        verifyMovePersists(movedNode, parent, idxAfterDrop);
      } catch (err) {
        dndLog('drop insertBefore error:', err);
      }
    });
  }

  function verifyMovePersists(node, originalParent, expectedIdx) {
    const checkpoints = [50, 250, 1000];
    checkpoints.forEach((ms) => {
      setTimeout(() => {
        if (!node.isConnected) {
          dndLog('verify@' + ms + 'ms: node was REMOVED from DOM (React likely re-rendered).');
          return;
        }
        const nowParent = node.parentElement;
        if (nowParent !== originalParent) {
          dndLog('verify@' + ms + 'ms: node MOVED to different parent', shortDescribe(nowParent),
            '(was in', shortDescribe(originalParent) + ').');
          return;
        }
        const nowIdx = Array.from(nowParent.children).indexOf(node);
        if (nowIdx !== expectedIdx) {
          dndLog('verify@' + ms + 'ms: node REORDERED idx', expectedIdx, '→', nowIdx, '(React reconciled).');
        } else {
          dndLog('verify@' + ms + 'ms: node still at idx', nowIdx, '— move persisted.');
        }
      }, ms);
    });
  }

  // Parent-level drop: lets the user drop onto empty space at the end
  // of the row (past the last card) — the per-wrapper handlers don't
  // fire there because the drop target isn't a wrapper. Append to the
  // end of the common parent.
  function attachParentDropHandler(parent) {
    if (!parent || parent.hasAttribute('data-zhl-dnd-parent')) return;
    parent.setAttribute('data-zhl-dnd-parent', '1');
    parent.addEventListener('dragover', (e) => {
      if (!draggingWrapper) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    });
    parent.addEventListener('drop', (e) => {
      if (!draggingWrapper) return;
      // If the drop bubbled up from a wrapper that already handled it,
      // the wrapper called stopPropagation — we won't see it here.
      e.preventDefault();
      dndLog('parent-level drop. dragging=', shortDescribe(draggingWrapper), 'parent=', shortDescribe(parent));
      try {
        parent.appendChild(draggingWrapper);
        dndLog('parent-level drop OK — appended to end of', shortDescribe(parent));
        flashStatus('Reordered manually');
        const cards = getScenarioCardElements();
        const wrappers = cards.map((c) => findUniqueWrapper(c, cards));
        alignAssignedWrapper(wrappers);
      } catch (err) {
        dndLog('parent-level drop error:', err);
      }
    });
    dndLog('attached parent-level drop handler to', shortDescribe(parent));
  }

  // The page may steal drag events at the document level (preventing the
  // browser from firing dragstart/drop on our wrappers). Listen at the
  // document level too so we can see whether events ARE happening, even
  // if our per-wrapper handlers don't fire. Only logs when over a card.
  document.addEventListener('dragstart', (e) => {
    const w = e.target && e.target.closest && e.target.closest('[data-zhl-dnd]');
    if (w) dndLog('document-level dragstart, default prevented?', e.defaultPrevented, 'on', shortDescribe(w));
  }, true);
  document.addEventListener('drop', (e) => {
    const w = e.target && e.target.closest && e.target.closest('[data-zhl-dnd]');
    if (w) dndLog('document-level drop, default prevented?', e.defaultPrevented, 'on', shortDescribe(w));
  }, true);

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
    const wrappers = getCardWrappers();
    wrappers.forEach(enableDragAndDrop);
    const parents = new Set();
    for (const w of wrappers) if (w.parentElement) parents.add(w.parentElement);
    parents.forEach(attachParentDropHandler);
  }

  function tearDown() {
    const bar = document.getElementById(TOOLBAR_ID);
    if (bar) bar.remove();
    // Strip draggable=true / cursor:grab from anything we tagged. Without
    // this, navigating from the scenarios page to another LOP page leaves
    // the hand cursor on whichever wrappers React keeps in memory.
    document.querySelectorAll('[data-zhl-dnd]').forEach((el) => {
      el.removeAttribute('data-zhl-dnd');
      el.removeAttribute('draggable');
      el.style.cursor = '';
      el.style.opacity = '';
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.classList.remove(DRAGGING_CLASS, DROP_TARGET_CLASS);
    });
    document.querySelectorAll('[data-zhl-dnd-parent]').forEach((el) => {
      el.removeAttribute('data-zhl-dnd-parent');
    });
    // Also clear any alignment overrides we left on assigned wrapper /
    // its parent / sibling wrappers — same lingering-state risk.
    clearAssignedWrapperOverrides();
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
    updateSelectAllLabel();
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
