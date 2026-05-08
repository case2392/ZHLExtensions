// ZHL Productivity Pack module — feature key: feature_gmailTweaks
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_gmailTweaks';
  function __zhlRunModule() {
// Gmail Reply All Button - content script
// For each open email header, injects a "Reply all" button between the
// Reply control and the per-message ⋮ menu. Clicking it opens that menu
// and picks "Reply all" — same result as doing it by hand.

(function () {
  'use strict';

  const INJECTED_ATTR = 'data-gm-reply-all-injected';
  const BUTTON_CLASS = 'gm-reply-all-btn';

  const REPLY_SELECTOR = '[aria-label="Reply"]';

  // Gmail labels the per-message ⋮ differently across layouts:
  //   reading-pane / modern:  <button aria-label="More message options">
  //   full-thread / older:    <div role="button" aria-label="More email options">
  // We intentionally do NOT match the inbox-toolbar ⋮ ("More email options"
  // but nowhere near a Reply button) — findMoreNear requires the match to
  // share a close ancestor with the Reply anchor.
  const MORE_COMBINED = [
    '[aria-label="More message options"]',
    '[role="button"][aria-label="More email options"]',
  ].join(',');

  const REPLY_ALL_ICON = `<img src="https://ssl.gstatic.com/ui/v1/icons/mail/gm3/1x/reply_all_baseline_nv700_20dp.png" width="20" height="20" alt="" aria-hidden="true" draggable="false">`;

  function findReplyAllMenuItem() {
    // Gmail pre-renders many hidden menus (help, inbox ⋮, other messages' ⋮).
    // Their menuitems stay in the DOM but have zero-size rects. Only the
    // just-opened menu's items are actually visible — match against those.
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (item.getAttribute('aria-disabled') === 'true') continue;
      const text = (item.textContent || '').trim();
      const aria = item.getAttribute('aria-label') || '';
      if (
        /^reply all$/i.test(text) ||
        /^reply to all$/i.test(text) ||
        /\breply all\b/i.test(aria)
      ) {
        return item;
      }
    }
    return null;
  }

  function triggerReplyAll(moreBtn) {
    if (!moreBtn || !document.contains(moreBtn)) return;
    moreBtn.click();

    let attempts = 0;
    const maxAttempts = 25; // ~500ms
    const interval = setInterval(() => {
      attempts++;
      const item = findReplyAllMenuItem();
      if (item) {
        clearInterval(interval);
        item.click();
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        // Single-recipient email: no Reply all in the menu. Close it.
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      }
    }, 20);
  }

  function findMoreNear(reply) {
    let cur = reply.parentElement;
    for (let i = 0; i < 10 && cur; i++, cur = cur.parentElement) {
      const more = cur.querySelector(MORE_COMBINED);
      if (more) return more;
    }
    return null;
  }

  function createButton(resolveMoreBtn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.setAttribute('aria-label', 'Reply all');
    btn.setAttribute('title', 'Reply all');
    btn.innerHTML = REPLY_ALL_ICON;

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const moreBtn = resolveMoreBtn();
      if (moreBtn) triggerReplyAll(moreBtn);
    };

    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });

    return btn;
  }

  function injectButtons() {
    document.querySelectorAll(REPLY_SELECTOR).forEach((reply) => {
      if (reply.hasAttribute(INJECTED_ATTR)) return;
      const moreBtn = findMoreNear(reply);
      if (!moreBtn) return;
      reply.setAttribute(INJECTED_ATTR, '1');

      const resolveMoreBtn = () =>
        document.contains(moreBtn) ? moreBtn : findMoreNear(reply);

      const btn = createButton(resolveMoreBtn);

      // Reading-pane wraps each button in <span data-is-tooltip-wrapper>.
      // Insert after that wrapper so we become a toolbar-level sibling;
      // fall back to the reply element itself in layouts without wrappers.
      const anchor = reply.closest('[data-is-tooltip-wrapper]') || reply;
      anchor.parentElement?.insertBefore(btn, anchor.nextSibling);
    });
  }

  function startInjection() {
    injectButtons();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          injectButtons();
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // At document_start, document.body may not exist yet.
  if (document.body) startInjection();
  else document.addEventListener('DOMContentLoaded', startInjection, { once: true });

  console.log('[Gmail Reply All Button] loaded');
})();

// Suppress Gmail's auto-expansion of the sidebar's "More" section when an
// email is dragged toward the sidebar. If the user had it collapsed before
// the drag, keep it collapsed throughout.
(function () {
  'use strict';

  const MORE_COLLAPSED = '[aria-label="More labels"]';
  const MORE_EXPANDED = '[aria-label="Less labels"]';
  const MASK_CLASS = 'gm-more-drag-mask-target';

  let dragActive = false;
  let dragStartedCollapsed = false;
  let maskedEl = null;

  const findToggle = () => document.querySelector(`${MORE_COLLAPSED}, ${MORE_EXPANDED}`);
  const isExpanded = (el) => el?.getAttribute('aria-label') === 'Less labels';

  function applyMaskIfNeeded() {
    if (!dragActive || !dragStartedCollapsed) return;
    const toggle = findToggle();
    if (!toggle) return;
    const row = toggle.closest('.n6');
    const sibling = row?.nextElementSibling;
    if (!sibling || sibling === maskedEl) return;
    // Tag unconditionally: the sibling slot next to the More row is reused
    // as the expand container — when collapsed it's empty, when expanded
    // Gmail populates it. Our display:none !important applies either way,
    // so tagging up front keeps the expansion invisible the instant Gmail
    // decides to populate it during a drag.
    sibling.classList.add(MASK_CLASS);
    maskedEl = sibling;
    console.log('[Gmail Reply All Button] masked More-row sibling', {
      tag: sibling.tagName.toLowerCase(),
      cls: sibling.className,
      id: sibling.id,
      textPrefix: (sibling.textContent || '').slice(0, 40),
    });
  }

  function removeMask() {
    if (maskedEl) {
      maskedEl.classList.remove(MASK_CLASS);
      maskedEl = null;
    }
  }

  function getMoreRowRect() {
    const toggle = findToggle();
    const row = toggle?.closest('.n6');
    return row?.getBoundingClientRect() || null;
  }

  function beginDrag() {
    if (dragActive) return;
    dragActive = true;
    const toggle = findToggle();
    // Only fight expansion if the user had it collapsed when the drag began;
    // a manually-expanded state should survive the drag.
    dragStartedCollapsed = !!toggle && !isExpanded(toggle);
    console.log('[Gmail Reply All Button] drag detected, startedCollapsed =', dragStartedCollapsed);
    if (dragStartedCollapsed) {
      // Gmail's expand mechanism doesn't go through DOM events we can block,
      // so instead of preventing expansion we mask it visually. Tag the
      // expanded-content sibling immediately — it's already in the DOM
      // even when "More" is collapsed, and our display:none override
      // keeps it hidden regardless of Gmail's internal state.
      applyMaskIfNeeded();
    }
  }

  const endDrag = () => {
    if (dragActive) console.log('[Gmail Reply All Button] drag ended');
    dragActive = false;
    dragStartedCollapsed = false;
    removeMask();
  };

  document.addEventListener('dragstart', beginDrag, true);
  document.addEventListener('dragend', endDrag, true);
  document.addEventListener('drop', endDrag, true);

  // Gmail uses a custom mouse-based drag for emails — no dragstart fires.
  // Detect it: left-button mousedown, then movement past a threshold.
  let downPos = null;
  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    downPos = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e) => {
    if (!downPos || dragActive) return;
    const dx = e.clientX - downPos.x;
    const dy = e.clientY - downPos.y;
    if (Math.hypot(dx, dy) > 8) beginDrag();
  };
  const onUp = () => {
    downPos = null;
    if (dragActive) endDrag();
  };
  ['mousedown', 'pointerdown'].forEach((t) =>
    document.addEventListener(t, onDown, true)
  );
  ['mousemove', 'pointermove'].forEach((t) =>
    document.addEventListener(t, onMove, { capture: true, passive: true })
  );
  // NOTE: intentionally not listening for mouseleave — capture-phase listeners
  // on document fire for every element-level mouseleave during the drag, which
  // would end our drag state after the first cursor motion.
  ['mouseup', 'pointerup', 'pointercancel'].forEach((t) =>
    document.addEventListener(t, onUp, true)
  );

  // Previous attempts set pointer-events: none on the More row/block, but
  // Gmail's expand handler sits on an ancestor that still receives events
  // — pointer-events only hides the element as a target, not as a bubble
  // path. Instead, intercept pointer events at the window capture phase:
  // when a drag is live and the cursor is within the More row's bounding
  // box, stopImmediatePropagation so no handler (including Gmail's) sees
  // the event. No sidebar-wide side effects.
  function interceptIfOverMoreRow(e) {
    if (!dragActive || !dragStartedCollapsed) return;
    const rect = getMoreRowRect();
    if (!rect) return;
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      e.stopImmediatePropagation();
    }
  }
  [
    'mousemove',
    'pointermove',
    'mouseover',
    'pointerover',
    'mouseenter',
    'pointerenter',
    'dragover',
    'dragenter',
  ].forEach((t) => {
    window.addEventListener(t, interceptIfOverMoreRow, true);
  });

  // Fallback: if Gmail re-creates the sibling div during the drag (child
  // list change on .wT), catch it and re-tag.
  const expansionObserver = new MutationObserver(() => {
    applyMaskIfNeeded();
  });

  function startObserving() {
    const toggle = findToggle();
    if (!toggle) {
      setTimeout(startObserving, 500);
      return;
    }
    const container =
      toggle.closest('.yJ, .nM, [role="navigation"]') || toggle.parentElement;
    expansionObserver.observe(container, {
      attributes: true,
      attributeFilter: ['aria-label'],
      childList: true,
      subtree: true,
    });
  }
  startObserving();
})();

// Move the inline reply / reply-all / forward compose panel to the top of
// the thread. By default Gmail renders it below the last message, which
// pushes the most recent message off-screen — forcing a scroll-up to read
// the message you're replying to.
(function () {
  'use strict';

  // The compose and the email body don't share a wrapper class — only the
  // compose has a <div class="gA gt"> wrapper; the email body lives under
  // <div class="adn ads"> instead. Both sit as sibling direct children of
  // a common ancestor (the thread content container, whose id is dynamic,
  // e.g. "avWBGd-8"). To move the compose above the email, find that
  // common ancestor at runtime by walking up both chains, and insert the
  // compose's branch before the email's branch at that level.
  const COMPOSE_SELECTOR = '.aDg';
  // Tracks which compose elements are currently visible so we can detect
  // the hidden→visible transition. Gmail reuses the same <.aDg> element
  // for delete+reopen cycles, so without this we'd short-circuit silently
  // and never scroll the viewport to the compose on the second reply.
  const composeVisibility = new WeakMap();

  function moveComposesToTop() {
    document.querySelectorAll(COMPOSE_SELECTOR).forEach((compose) => {
      const cr = compose.getBoundingClientRect();
      const isVisible = cr.width > 0 && cr.height > 0;
      const wasVisible = composeVisibility.get(compose) === true;
      composeVisibility.set(compose, isVisible);
      if (!isVisible) return;
      const justBecameVisible = !wasVisible;

      // Anchor on a visible email body to locate the common ancestor.
      const body = [...document.querySelectorAll('.a3s')].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!body) return;

      // Collect body's ancestor set, then walk up from compose to the first
      // ancestor whose parent is also in body's ancestor set — that parent
      // is the lowest common ancestor.
      const bodyAncestors = new Set();
      for (let p = body; p; p = p.parentElement) bodyAncestors.add(p);

      let composeBranch = null;
      let commonAncestor = null;
      for (let p = compose; p && p.parentElement; p = p.parentElement) {
        if (bodyAncestors.has(p.parentElement)) {
          composeBranch = p;
          commonAncestor = p.parentElement;
          break;
        }
      }
      if (!commonAncestor) return;

      // Body's direct child of the common ancestor.
      let bodyBranch = body;
      while (bodyBranch.parentElement !== commonAncestor) {
        bodyBranch = bodyBranch.parentElement;
      }

      if (composeBranch === bodyBranch) return;
      const alreadyBefore = composeBranch.nextElementSibling === bodyBranch;

      if (!alreadyBefore) {
        console.log('[Gmail Reply All Button] moving compose branch above email body branch');
        commonAncestor.insertBefore(composeBranch, bodyBranch);
      }

      // Scroll if we just moved the compose OR if the compose is newly
      // visible (new reply, or reopen after delete — Gmail reuses the
      // already-at-top wrapper so nothing moves but the viewport stayed
      // wherever the user left it). Skip scroll on mutations that happen
      // while the user is typing in an already-positioned compose.
      if (!alreadyBefore || justBecameVisible) {
        console.log('[Gmail Reply All Button] scrolling compose into view (moved=%s newlyVisible=%s)', !alreadyBefore, justBecameVisible);
        const scrollIn = () => {
          const r = composeBranch.getBoundingClientRect();
          console.log('[Gmail Reply All Button] scrollIn, branch y =', Math.round(r.y));
          composeBranch.scrollIntoView({ block: 'start', behavior: 'auto' });
        };
        scrollIn();
        setTimeout(scrollIn, 150);
        setTimeout(scrollIn, 400);
        setTimeout(scrollIn, 800);
        setTimeout(scrollIn, 1500);
        setTimeout(scrollIn, 2500);
      }
    });
  }

  function start() {
    moveComposesToTop();
    const observer = new MutationObserver(() => moveComposesToTop());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

// Map the Delete key to the same action as Gmail's # shortcut: click the
// visible Delete button in the toolbar. Inbox view → deletes selected
// emails; thread view → deletes the open thread. Skipped while focus is
// in an input / textarea / compose body so it doesn't interfere with
// editing text. Also accepts Backspace because on Mac the key labeled
// "Delete" sends key="Backspace" (only fn+Delete sends key="Delete").
(function () {
  'use strict';

  function isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function findVisibleDeleteButton() {
    const candidates = document.querySelectorAll('[aria-label="Delete"]');
    for (const btn of candidates) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return btn;
    }
    return null;
  }

  // Synthesize a full mouse-click sequence at the element's center. Gmail's
  // jsaction listeners on toolbar buttons fire on mousedown/mouseup, not on
  // a bare .click() — which is why a plain element.click() didn't actually
  // trigger deletion in v1.0.36. Synthetic keyboard events get rejected
  // (isTrusted=false), but mouse events on a real element get processed.
  function syntheticMouseClick(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      detail: 1,
    };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (isEditableTarget(e.target)) return;

    const btn = findVisibleDeleteButton();
    if (!btn) {
      console.log('[Gmail Reply All Button] %s pressed but no visible Delete button', e.key);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    console.log('[Gmail Reply All Button] %s → mouse-click sequence on Delete', e.key);
    syntheticMouseClick(btn);
  }, true);
})();

// Draggable floating compose -------------------------------------------------
// Lets the user pick up the "New Message" compose dialog by its title bar
// and drop it anywhere in the Gmail window. Gmail anchors compose to the
// bottom-right by default; this gives the user free placement so the
// compose doesn't cover the message they're referencing.
(function () {
  'use strict';

  const DRAG_ATTR = 'data-zhl-compose-drag';
  let active = null;
  // Mousedown + mouseup on the same element fires a click. Gmail's title
  // bar click toggles minimize, so right after a drag ends the compose
  // would minimize. Track a short window during which we swallow clicks
  // that come from a real drag (moveCount > 0).
  let clickGuardUntil = 0;
  document.addEventListener('click', (e) => {
    if (Date.now() < clickGuardUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.log('[Gmail Compose Drag] click swallowed (post-drag guard)');
    }
  }, true);

  function isInteractiveTarget(el) {
    return !!(el && el.closest && el.closest(
      'button, [role="button"], img, input, textarea, [contenteditable="true"], a'
    ));
  }

  function setImportant(el, prop, val) {
    el.style.setProperty(prop, val, 'important');
  }

  function readTranslate(dlg) {
    const cs = getComputedStyle(dlg);
    if (!cs.transform || cs.transform === 'none') return { tx: 0, ty: 0 };
    const m = /^matrix\(([^)]+)\)$/.exec(cs.transform);
    if (!m) return { tx: 0, ty: 0 };
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    if (p.length < 6) return { tx: 0, ty: 0 };
    return { tx: p[4], ty: p[5] };
  }

  function describeToolbarChain(dlg) {
    // Find the bottom Send button and walk up to <body>, recording each
    // ancestor's tag, classes, position, and whether it's inside the
    // dialog. This tells us whether the toolbar follows the dialog
    // naturally (transform creates a containing block for fixed
    // descendants) or whether we need to move it separately.
    const sendBtn = document.querySelector(
      '[role="button"][data-tooltip^="Send"], [role="button"][aria-label="Send"]'
    );
    if (!sendBtn) return null;
    const chain = [];
    let cur = sendBtn;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      chain.push({
        tag: cur.tagName,
        cls: (cur.className || '').toString().slice(0, 60),
        id: cur.id || '',
        position: cs.position,
        inDialog: dlg.contains(cur)
      });
      cur = cur.parentElement;
    }
    return chain;
  }

  function startDrag(dlg, handle, e) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const rect = dlg.getBoundingClientRect();
    const { tx, ty } = readTranslate(dlg);
    active = {
      dlg, handle,
      startX: e.clientX,
      startY: e.clientY,
      startTx: tx,
      startTy: ty,
      startRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    };
    document.body.style.userSelect = 'none';
    handle.style.cursor = 'grabbing';
    // Re-apply in case Gmail re-set position:fixed since attach.
    unfixInnerToolbars(dlg);
    console.log('[Gmail Compose Drag] start. startX=' + e.clientX + ' startY=' + e.clientY
      + ' rect=' + JSON.stringify({ l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) })
      + ' startTranslate=' + JSON.stringify({ tx: Math.round(tx), ty: Math.round(ty) })
      + ' vh=' + window.innerHeight + ' vw=' + window.innerWidth);
    const toolbarChain = describeToolbarChain(dlg);
    console.log('[Gmail Compose Drag] Send button parent chain: ' + JSON.stringify(toolbarChain, null, 2));
  }

  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    const { dlg, startX, startY, startTx, startTy, startRect } = active;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let tx = startTx + dx;
    let ty = startTy + dy;
    // Visual position after applying transform.
    const visLeft = startRect.left + (tx - startTx);
    const visTop = startRect.top + (ty - startTy);
    // Clamp so at least ~80px stays in the viewport on each side.
    if (visLeft + dlg.offsetWidth < 80) tx = startTx + (80 - dlg.offsetWidth - startRect.left);
    if (visLeft > window.innerWidth - 80) tx = startTx + (window.innerWidth - 80 - startRect.left);
    if (visTop < 0) ty = startTy + (-startRect.top);
    if (visTop > window.innerHeight - 40) ty = startTy + (window.innerHeight - 40 - startRect.top);
    // Use CSS transform — moves the dialog visually WITHOUT touching its
    // position, and (critically) creates a containing block for any
    // position:fixed descendants. Gmail's bottom send/format toolbar is
    // position:fixed and was anchored to the viewport otherwise; with
    // transform on the dialog it now resolves against the dialog and
    // follows on every drag.
    setImportant(dlg, 'transform', 'translate(' + tx + 'px, ' + ty + 'px)');
    active.moveCount = (active.moveCount || 0) + 1;
    active.lastTx = tx;
    active.lastTy = ty;
    const now = Date.now();
    if (!active.lastLogAt || now - active.lastLogAt > 200) {
      active.lastLogAt = now;
      const cs = getComputedStyle(dlg);
      console.log('[Gmail Compose Drag] move #' + active.moveCount
        + ' cursor=' + e.clientX + ',' + e.clientY
        + ' translate=' + JSON.stringify({ tx: Math.round(tx), ty: Math.round(ty) })
        + ' transform=' + cs.transform);
    }
  }, true);

  function endDrag(reason, e) {
    if (!active) return;
    const { dlg, moveCount, lastTx, lastTy } = active;
    const cs = getComputedStyle(dlg);
    document.body.style.userSelect = '';
    active.handle.style.cursor = 'move';
    // If the user actually dragged (any movement), block the synthetic
    // click that follows mouseup — otherwise Gmail's title-bar click
    // handler toggles the compose to minimized.
    if ((moveCount || 0) > 0) {
      clickGuardUntil = Date.now() + 200;
    }
    console.log('[Gmail Compose Drag] end. reason=' + reason
      + ' moveCount=' + (moveCount || 0)
      + ' lastTranslate=' + JSON.stringify({ tx: Math.round(lastTx || 0), ty: Math.round(lastTy || 0) })
      + ' transform=' + cs.transform
      + ' event target=' + (e && e.target && e.target.tagName));
    active = null;
  }
  // Only end on a real mouseup. Don't end on mouseleave: when the
  // cursor briefly crosses out of the document (toward the browser
  // chrome, or over a subframe), mouseleave fires and the drag would
  // appear to "get stuck" — even though the user is still pressing
  // the button. mouseup will fire when they actually release.
  document.addEventListener('mouseup', (e) => {
    // Suppress propagation on a real drag's mouseup so Gmail's title
    // bar listeners (mouseup or click) don't toggle the compose to
    // minimized. We end our drag explicitly.
    if (active && (active.moveCount || 0) > 0) {
      e.stopImmediatePropagation();
    }
    endDrag('mouseup', e);
  }, true);
  // Also end if the user releases outside the window (window blur).
  window.addEventListener('blur', () => endDrag('blur'), true);

  function isComposeDialog(dlg) {
    // Matches the floating "New Message" / reply compose popups: they're
    // role=dialog elements with the compose body controls inside. Skip
    // nested role=dialogs — we only want the outermost compose container.
    if (!dlg.querySelector) return false;
    if (!dlg.querySelector('textarea[name="to"], input[name="subjectbox"]')) return false;
    const parentDlg = dlg.parentElement && dlg.parentElement.closest('[role="dialog"]');
    return !parentDlg;
  }

  // Walk up from the role=dialog to find the OUTERMOST positioned
  // ancestor (the .dw wrapper Gmail uses for the compose). We need to
  // move that wrapper, not just the inner dialog — Gmail's bottom send
  // toolbar lives inside the outer wrapper but anchors itself
  // independently, so moving the inner dialog leaves the toolbar
  // behind on the screen.
  function findOuterContainer(dlg) {
    let outermost = dlg;
    let cur = dlg;
    while (cur.parentElement && cur.parentElement !== document.body) {
      const parent = cur.parentElement;
      const cs = getComputedStyle(parent);
      if (cs.position === 'absolute' || cs.position === 'fixed') {
        outermost = parent;
        cur = parent;
      } else {
        break;
      }
    }
    return outermost;
  }

  function findHandle(dlg) {
    // The compose title bar (strip showing "New Message" with the
    // minimize/expand/close icons). Prefer a wider element (the .Ht
    // table that spans the full title-bar width) over the inner .Hp
    // text container — that way the user can grab anywhere on the strip,
    // not just on the title text.
    const dlgRect = dlg.getBoundingClientRect();
    // Broadest selectors first; we'll keep the widest match near the top.
    const candidates = dlg.querySelectorAll(
      '.Ht, .aCk, .Njo3Cf, .Hy, .aDh, .Hp, .aDg, .aoP'
    );
    let best = null;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.height > 80) continue;
      if (r.top - dlgRect.top > 30) continue;
      if (r.width < 200) continue;
      if (!best || r.width > best.rect.width) best = { el, rect: r };
    }
    return (best && best.el) || dlg.firstElementChild || null;
  }

  function unfixInnerToolbars(dlg) {
    // Gmail wraps the bottom Send/formatting toolbar in a div with
    // class .aDj (often .aDj.ahe). That wrapper is position:fixed and
    // anchored via a viewport-y `top` value — so when we transform the
    // dialog, the new containing block doesn't help because Gmail's
    // top still points outside the dialog's local space.
    //
    // Keep position:fixed (so the toolbar stays out of the dialog's
    // normal flow — switching it to static caused a scrollbar because
    // it added vertical content the dialog frame couldn't fit). But
    // override the inset values so it pins to the dialog's BOTTOM edge:
    // top:auto + bottom:0 (resolved against the dialog because our
    // transform makes the dialog the containing block).
    const candidates = dlg.querySelectorAll('.aDj, .ahe, .aDj.ahe');
    let count = 0;
    candidates.forEach((el) => {
      if (getComputedStyle(el).position !== 'fixed') return;
      // Idempotency: skip when our overrides are already in place. The
      // 33ms heartbeat was firing this function for every wrapper every
      // tick (because our own CSS keeps them position:fixed), spamming
      // the console with thousands of "re-anchored" lines per minute.
      if (el.style.top === 'auto' && el.style.bottom === '0px') return;
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('right', '0', 'important');
      el.style.setProperty('bottom', '0', 'important');
      el.style.setProperty('left', '0', 'important');
      el.style.setProperty('width', 'auto', 'important');
      count++;
    });
    if (count > 0) console.log('[Gmail Compose Drag] re-anchored', count, 'inner toolbar wrapper(s) to dialog bottom');
  }

  // Auto-diagnostic: when an attachment row appears in a compose dialog,
  // log its layout against the toolbar exactly once per (dialog, chip-set).
  // The user can't call window.zhlInspectCompose from the page console
  // (content script lives in an isolated world), so we log on detection.
  const inspectedKeys = new WeakSet();
  function inspectIfAttachment(outer) {
    const dlg = outer.querySelector('[role="dialog"]') || outer;
    // Gmail attachment chips: .dL is the row container, .GM is the
    // chip wrapper, .aZo is each chip.
    const chips = dlg.querySelectorAll('.GM, .dL .aZo, .dL > div');
    if (!chips.length) return;
    // Key on the dialog + chip count so a second attachment retriggers.
    const key = chips.length + ':' + (dlg.id || '');
    if (outer.__zhlLastInspectKey === key) return;
    outer.__zhlLastInspectKey = key;

    const dlgRect = dlg.getBoundingClientRect();
    const tb = dlg.querySelector('.aDj, .ahe');
    const tbRect = tb && tb.getBoundingClientRect();
    console.group('[Gmail Compose Inspect] attachments detected');
    console.log('dialog rect:', { l: Math.round(dlgRect.left), t: Math.round(dlgRect.top), w: Math.round(dlgRect.width), h: Math.round(dlgRect.height) });
    if (tb) {
      const cs = getComputedStyle(tb);
      console.log('toolbar rect:', { l: Math.round(tbRect.left), t: Math.round(tbRect.top), w: Math.round(tbRect.width), h: Math.round(tbRect.height) },
        'position=' + cs.position, 'top=' + cs.top, 'bottom=' + cs.bottom);
    }
    chips.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      if (r.height < 4) return;
      const overlap = tbRect ? (r.bottom - tbRect.top) : null;
      console.log('chip[' + i + '] cls=' + (c.className || '').toString().slice(0, 50)
        + ' rect=' + JSON.stringify({ t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) })
        + ' visibility=' + cs.visibility + ' display=' + cs.display
        + (overlap !== null ? (overlap > 0 ? ' OVERLAPS toolbar by ' + Math.round(overlap) + 'px' : ' clears toolbar by ' + Math.round(-overlap) + 'px') : ''));
    });
    // Walk up from a chip and report each ancestor's overflow until the dialog.
    if (chips.length) {
      let cur = chips[0];
      const chain = [];
      while (cur && cur !== dlg && cur !== document.body) {
        const cs = getComputedStyle(cur);
        chain.push({
          tag: cur.tagName,
          cls: (cur.className || '').toString().slice(0, 40),
          overflow: cs.overflow + '/' + cs.overflowY,
          position: cs.position,
          height: Math.round(cur.getBoundingClientRect().height)
        });
        cur = cur.parentElement;
      }
      chain.forEach((c, i) => console.log('  chain[' + i + ']', c.tag + '.' + c.cls,
        'h=' + c.height, 'pos=' + c.position, 'overflow=' + c.overflow));
    }
    console.groupEnd();
  }

  function attachToDialog(dlg) {
    if (!dlg || !isComposeDialog(dlg)) return;
    const outer = findOuterContainer(dlg);
    if (!outer) return;
    // Establish the dialog as the containing block for fixed descendants
    // even before any drag has happened. Without an actual transform on
    // the outer, our bottom:0 override on .aDj resolves against the
    // viewport, so the toolbar ends up pinned to the page bottom-left
    // instead of the dialog bottom. translate(0,0) triggers the
    // containing block (per CSS spec, any non-`none` transform value
    // does) without visually shifting anything.
    const cs = getComputedStyle(outer);
    if (!cs.transform || cs.transform === 'none') {
      setImportant(outer, 'transform', 'translate(0px, 0px)');
    }
    // Re-apply the toolbar anchor on every scan, not just first attach.
    // Gmail flips .aDj back to position:fixed (with viewport-y values)
    // when the user minimizes and restores the compose, so we need to
    // re-override after each restore. unfixInnerToolbars short-circuits
    // when the position is already what we want.
    unfixInnerToolbars(dlg);
    if (outer.hasAttribute(DRAG_ATTR)) return;
    const handle = findHandle(dlg);
    if (!handle) return;
    outer.setAttribute(DRAG_ATTR, '1');
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => startDrag(outer, handle, e), true);
    // Watch .aDj's style attribute for flips by Gmail (its
    // minimize/restore animation overwrites our inline overrides).
    // Fires synchronously on each style write — much faster than the
    // childList observer which doesn't see attribute-only mutations.
    dlg.querySelectorAll('.aDj, .ahe').forEach((tb) => {
      try {
        const tbObs = new MutationObserver(() => unfixInnerToolbars(dlg));
        tbObs.observe(tb, { attributes: true, attributeFilter: ['style'] });
      } catch (_) {}
    });
    console.log('[Gmail Compose Drag] attached. outer=', outer, 'handle=', handle);
  }

  function scan() {
    document.querySelectorAll('div[role="dialog"]').forEach(attachToDialog);
    document.querySelectorAll('[' + DRAG_ATTR + ']').forEach(inspectIfAttachment);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  // Heartbeat backstop: catches anything the targeted attribute
  // observers miss (e.g. when Gmail re-creates .aDj nodes during
  // restore so the previous observer is no longer attached).
  // 33ms ≈ 2 frames at 60fps — fast enough that the misplacement
  // flash is imperceptible, cheap enough to run continuously.
  setInterval(scan, 33);

  // Debug helper — content scripts run in an isolated world, so a
  // function set on `window` is invisible from the page console. Trigger
  // a manual dump by dispatching a custom event from the page world:
  //   document.dispatchEvent(new Event('zhl-inspect-compose'))
  document.addEventListener('zhl-inspect-compose', () => zhlInspectCompose());
  function zhlInspectCompose() {
    const dlgs = document.querySelectorAll('[' + DRAG_ATTR + ']');
    if (!dlgs.length) {
      console.log('[zhlInspectCompose] no compose dialog with ' + DRAG_ATTR + ' found');
      return;
    }
    dlgs.forEach((outer, i) => {
      const dlg = outer.querySelector('[role="dialog"]') || outer;
      const dlgRect = dlg.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      const ocs = getComputedStyle(outer);
      console.group('[zhlInspectCompose] dialog #' + i);
      console.log('outer rect:', { l: Math.round(outerRect.left), t: Math.round(outerRect.top), w: Math.round(outerRect.width), h: Math.round(outerRect.height) });
      console.log('outer transform:', ocs.transform, 'position:', ocs.position, 'overflow:', ocs.overflow);
      console.log('dialog rect:', { l: Math.round(dlgRect.left), t: Math.round(dlgRect.top), w: Math.round(dlgRect.width), h: Math.round(dlgRect.height) });

      // Toolbar wrappers (.aDj, .ahe).
      const toolbars = dlg.querySelectorAll('.aDj, .ahe');
      toolbars.forEach((tb, j) => {
        const r = tb.getBoundingClientRect();
        const cs = getComputedStyle(tb);
        console.log('toolbar[' + j + '] cls=' + (tb.className || '').toString().slice(0, 60)
          + ' rect=' + JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
          + ' position=' + cs.position
          + ' top=' + cs.top + ' bottom=' + cs.bottom);
      });

      // Attachment chip area. Gmail uses .GM (chip wrapper), .aZo (chip),
      // .dL (attachment list container), .GE.HI / .GP for body/wrappers.
      const attachContainers = dlg.querySelectorAll('.GM, .dL, .aZo');
      console.log('attachment-related nodes found:', attachContainers.length);
      attachContainers.forEach((ac, j) => {
        const r = ac.getBoundingClientRect();
        const cs = getComputedStyle(ac);
        console.log('attach[' + j + '] cls=' + (ac.className || '').toString().slice(0, 80)
          + ' rect=' + JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
          + ' position=' + cs.position
          + ' visibility=' + cs.visibility + ' display=' + cs.display
          + ' overflow=' + cs.overflow);
      });

      // Compose body inner wrappers — the ones the old overflow:hidden
      // rules targeted. Shows their current overflow and whether they
      // clip children.
      const wrappers = dlg.querySelectorAll('.GP, .qz, .Hd, .Hp, .nH');
      wrappers.forEach((w, j) => {
        const r = w.getBoundingClientRect();
        const cs = getComputedStyle(w);
        if (r.height < 20) return;
        console.log('wrapper[' + j + '] cls=' + (w.className || '').toString().slice(0, 60)
          + ' rect=' + JSON.stringify({ t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) })
          + ' overflow=' + cs.overflow + '/' + cs.overflowY
          + ' position=' + cs.position);
      });

      // Overlap check: is an attachment row's bottom below a toolbar's top?
      if (toolbars.length && attachContainers.length) {
        const tb = toolbars[0];
        const tbRect = tb.getBoundingClientRect();
        attachContainers.forEach((ac, j) => {
          const r = ac.getBoundingClientRect();
          if (r.height < 4) return;
          const overlap = r.bottom - tbRect.top;
          if (overlap > 0) {
            console.warn('attach[' + j + '] OVERLAPS toolbar by ' + Math.round(overlap) + 'px (attachBottom=' + Math.round(r.bottom) + ' toolbarTop=' + Math.round(tbRect.top) + ')');
          } else {
            console.log('attach[' + j + '] clears toolbar by ' + Math.round(-overlap) + 'px');
          }
        });
      }
      console.groupEnd();
    });
  }
  console.log('[Gmail Compose Drag] debug helper ready — dispatch zhl-inspect-compose event to dump layout, or attach an attachment to auto-log');
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

// Telemetry identity capture — runs regardless of Gmail Tweaks toggle so
// the admin dashboard can identify the user even with all feature
// modules disabled. Gated only by feature_telemetry. As long as the user
// is signed into the same Google account, the email re-binds across
// reinstalls and version updates the next time they open Gmail.
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(['feature_telemetry'], function (data) {
    if (data.feature_telemetry === false) return;

    function tryCapture() {
      // Method 1: aria-label on the Google Account button.
      // e.g. "Google Account: Justin Case (justinca@zillowhomeloans.com)"
      const candidates = document.querySelectorAll(
        'a[aria-label*="Google Account"], a[href*="SignOutOptions"]'
      );
      for (const a of candidates) {
        const label = (a.getAttribute('aria-label') || '').trim();
        if (!label) continue;
        const both = /:\s*(.+?)\s*\(([^)]+@[^)]+)\)/.exec(label);
        if (both) {
          const name = both[1].trim();
          const email = both[2].trim();
          try {
            chrome.runtime.sendMessage({ type: 'IDENTIFY', email, name });
            chrome.runtime.sendMessage({ type: 'TRACK', event: 'identity_captured', props: { source: 'gmail_aria' } });
          } catch (_) {}
          return true;
        }
        const onlyEmail = /\(([^)]+@[^)]+)\)/.exec(label);
        if (onlyEmail) {
          try {
            chrome.runtime.sendMessage({ type: 'IDENTIFY', email: onlyEmail[1].trim() });
            chrome.runtime.sendMessage({ type: 'TRACK', event: 'identity_captured', props: { source: 'gmail_aria_partial' } });
          } catch (_) {}
          return true;
        }
      }
      // Method 2: document.title fallback. Gmail's title is reliably
      // "Inbox - <email> - Gmail" (or similar) regardless of UI variant
      // — works across light/dark, multi-account, and reduced-data modes.
      const titleMatch = /\s-\s([^\s@]+@[^\s@]+)\s-\sGmail/i.exec(document.title || '');
      if (titleMatch) {
        try {
          chrome.runtime.sendMessage({ type: 'IDENTIFY', email: titleMatch[1].trim() });
          chrome.runtime.sendMessage({ type: 'TRACK', event: 'identity_captured', props: { source: 'gmail_title' } });
        } catch (_) {}
        return true;
      }
      return false;
    }

    // Gmail's DOM isn't ready at document_start. Try a few times over
    // the first ~30s; once we capture, stop. Cheap: just a querySelectorAll.
    let attempts = 0;
    const t = setInterval(() => {
      if (tryCapture() || ++attempts > 12) clearInterval(t);
    }, 2500);
    setTimeout(tryCapture, 1500);
  });
})();

