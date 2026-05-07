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

  function isInteractiveTarget(el) {
    return !!(el && el.closest && el.closest(
      'button, [role="button"], img, input, textarea, [contenteditable="true"], a'
    ));
  }

  function setImportant(el, prop, val) {
    el.style.setProperty(prop, val, 'important');
  }

  function startDrag(dlg, handle, e) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const rect = dlg.getBoundingClientRect();
    // Lock the dialog's width and height BEFORE switching positioning
    // modes. Gmail's compose derives its size from right/bottom anchors;
    // without locking it would collapse to min content. Use !important
    // so Gmail's own snap-to-anchor scripts can't overwrite us mid-drag.
    setImportant(dlg, 'width', rect.width + 'px');
    setImportant(dlg, 'height', rect.height + 'px');
    setImportant(dlg, 'position', 'fixed');
    setImportant(dlg, 'left', rect.left + 'px');
    setImportant(dlg, 'top', rect.top + 'px');
    setImportant(dlg, 'right', 'auto');
    setImportant(dlg, 'bottom', 'auto');
    setImportant(dlg, 'inset', 'auto');
    setImportant(dlg, 'margin', '0');
    setImportant(dlg, 'transform', 'none');
    active = {
      dlg, handle,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top
    };
    document.body.style.userSelect = 'none';
    handle.style.cursor = 'grabbing';
    console.log('[Gmail Compose Drag] start. startX=', e.clientX, 'startY=', e.clientY,
      'rect=', { l: rect.left, t: rect.top, w: rect.width, h: rect.height },
      'vh=', window.innerHeight, 'vw=', window.innerWidth);
  }

  document.addEventListener('mousemove', (e) => {
    if (!active) return;
    const { dlg, startX, startY, startLeft, startTop } = active;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let nx = startLeft + dx;
    let ny = startTop + dy;
    // Soft clamp: keep ~40px of the dialog visible so the user can grab
    // it back, but allow them to push it well off the edges otherwise.
    nx = Math.max(-(dlg.offsetWidth - 80), Math.min(nx, window.innerWidth - 80));
    ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
    setImportant(dlg, 'left', nx + 'px');
    setImportant(dlg, 'top', ny + 'px');
    setImportant(dlg, 'right', 'auto');
    setImportant(dlg, 'bottom', 'auto');
    setImportant(dlg, 'inset', 'auto');
  }, true);

  function endDrag() {
    if (!active) return;
    document.body.style.userSelect = '';
    active.handle.style.cursor = 'move';
    active = null;
  }
  document.addEventListener('mouseup', endDrag, true);
  document.addEventListener('mouseleave', endDrag, true);

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

  function attachToDialog(dlg) {
    if (!dlg || !isComposeDialog(dlg)) return;
    const outer = findOuterContainer(dlg);
    if (!outer || outer.hasAttribute(DRAG_ATTR)) return;
    const handle = findHandle(dlg);
    if (!handle) return;
    outer.setAttribute(DRAG_ATTR, '1');
    handle.style.cursor = 'move';
    // Capture phase so we run BEFORE Gmail's own title-bar mousedown
    // listeners (which on some builds toggle minimize / resize). We
    // also stopPropagation inside startDrag.
    handle.addEventListener('mousedown', (e) => startDrag(outer, handle, e), true);
    console.log('[Gmail Compose Drag] attached. outer=', outer, 'handle=', handle);
  }

  function scan() {
    document.querySelectorAll('div[role="dialog"]').forEach(attachToDialog);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
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
