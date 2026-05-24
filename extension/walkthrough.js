// Walkthrough page logic. Renders the "What's new" block from
// changelog.js, fills in the current version pill, smooth-scrolls
// to deep-linked sections (#fha-manual etc.), and fires a lightweight
// telemetry event when the page is opened or when a section anchor
// in the TOC is clicked.

(function () {
  'use strict';

  const VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';
  document.getElementById('version-pill').textContent = 'v' + VERSION;

  // ---- Render "What's new" ------------------------------------------------
  const changelog = window.ZHL_CHANGELOG || [];
  const root = document.getElementById('whats-new-content');

  // ?since=<version> tells us the user just upgraded from that version (the
  // toast's "View what's new" button passes it). We render a banner +
  // pre-expand the diff so they don't have to click through Older Versions.
  const earlyParams = new URLSearchParams(location.search);
  const sinceVersion = earlyParams.get('since') || '';
  function parseVer(v) { return String(v || '').split('.').map(function (n) { return parseInt(n, 10) || 0; }); }
  function cmpVer(a, b) {
    const pa = parseVer(a), pb = parseVer(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x - y; }
    return 0;
  }

  let sinceRendered = false;
  if (changelog.length) {
    // "Changes since vX.Y.Z" banner — only shown when the toast deep-linked
    // us with the user's previous version. Lists every entry between then
    // and now (newest first) so the upgrade story is the diff, not just the
    // current headline.
    if (sinceVersion) {
      const newer = changelog.filter(function (e) { return cmpVer(e.version, sinceVersion) > 0; });
      if (newer.length) {
        sinceRendered = true;
        const banner = document.createElement('div');
        banner.setAttribute('style',
          'margin:0 0 16px;padding:12px 14px;background:linear-gradient(90deg,#dbeafe 0%,#eff6ff 100%);' +
          'border:2px solid #2563eb;border-radius:8px;color:#1e3a8a;font:14px/1.5 Arial,sans-serif;');
        banner.innerHTML =
          '<div style="font-weight:700;font-size:15px;margin-bottom:6px;">' +
            '🆙 You just updated from <strong>v' + sinceVersion + '</strong> &rarr; <strong>v' + VERSION + '</strong>' +
            ' &middot; ' + newer.length + ' release' + (newer.length === 1 ? '' : 's') +
          '</div>' +
          '<div style="font-size:12px;color:#1e40af;">Here\'s everything that landed in between — newest first.</div>';
        root.appendChild(banner);
        newer.forEach(function (entry, i) {
          const wrap = document.createElement('div');
          wrap.className = i === 0 ? '' : 'older-version';
          wrap.style.marginBottom = '14px';
          const head = document.createElement('div');
          head.className = i === 0 ? 'ver' : '';
          if (i === 0) {
            head.textContent = 'v' + entry.version + ' · ' + entry.headline;
          } else {
            head.innerHTML = '<strong>v' + entry.version + '</strong> &middot; ' + entry.headline;
          }
          wrap.appendChild(head);
          const ul = document.createElement('ul');
          (entry.highlights || []).forEach(function (h) {
            const li = document.createElement('li');
            li.textContent = h;
            ul.appendChild(li);
          });
          wrap.appendChild(ul);
          root.appendChild(wrap);
        });
        // Older-than-since versions collapsed under a separate details block
        // so the page still has the full history if anyone wants to scroll.
        const earlier = changelog.filter(function (e) { return cmpVer(e.version, sinceVersion) <= 0; });
        if (earlier.length) {
          const det = document.createElement('details');
          const sum = document.createElement('summary');
          sum.textContent = 'Even older (' + earlier.length + ' — pre-update releases)';
          det.appendChild(sum);
          earlier.forEach(function (entry) {
            const w = document.createElement('div');
            w.className = 'older-version';
            const h = document.createElement('div');
            h.innerHTML = '<strong>v' + entry.version + '</strong> &middot; ' + entry.headline;
            w.appendChild(h);
            const oul = document.createElement('ul');
            (entry.highlights || []).forEach(function (hl) {
              const li = document.createElement('li');
              li.textContent = hl;
              oul.appendChild(li);
            });
            w.appendChild(oul);
            det.appendChild(w);
          });
          root.appendChild(det);
        }
      }
    }

    if (sinceRendered) {
      // Default-path render skipped because the since-diff banner already
      // rendered the changelog. Drop to the post-render code (NEW cards
      // clone, click handlers, etc.).
    } else {
    const latest = changelog[0];
    const verLine = document.createElement('div');
    verLine.className = 'ver';
    verLine.textContent = 'v' + latest.version + ' · ' + latest.headline;
    root.appendChild(verLine);

    const ul = document.createElement('ul');
    (latest.highlights || []).forEach(function (h) {
      const li = document.createElement('li');
      li.textContent = h;
      ul.appendChild(li);
    });
    root.appendChild(ul);

    // Older versions — collapsed.
    if (changelog.length > 1) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'Older versions (' + (changelog.length - 1) + ')';
      det.appendChild(sum);
      changelog.slice(1).forEach(function (entry) {
        const wrap = document.createElement('div');
        wrap.className = 'older-version';
        const head = document.createElement('div');
        head.innerHTML = '<strong>v' + entry.version + '</strong> &middot; ' + entry.headline;
        wrap.appendChild(head);
        const oul = document.createElement('ul');
        (entry.highlights || []).forEach(function (h) {
          const li = document.createElement('li');
          li.textContent = h;
          oul.appendChild(li);
        });
        wrap.appendChild(oul);
        det.appendChild(wrap);
      });
      root.appendChild(det);
    }
    }
  } else {
    root.textContent = 'No changelog entries yet.';
  }

  // ---- Clone every .is-new card into the top "New features" section -------
  // Single-source-of-truth: NEW cards live in their canonical app section
  // (LOP / Gmail / Salesforce). We clone them up here so users see the
  // freshest stuff first without scrolling. Each clone gets its ID
  // stripped (originals keep theirs so TOC anchors still scroll to them
  // — which is the same content, just the deeper copy). The clones still
  // run their own SVG animations independently because the CSS in each
  // demo SVG is scoped via @keyframes that apply per-element.
  //
  // Order: most-recently-introduced first. We compute "recency" from
  // changelog.js by finding the newest version whose `sections` array
  // references each card's id. Cards not referenced anywhere in the
  // changelog fall to the bottom in their original DOM order.
  (function populateNewFeatures() {
    const host = document.getElementById('new-features-host');
    if (!host) return;
    const news = Array.from(document.querySelectorAll('.feature.is-new'));
    if (!news.length) {
      const sec = document.getElementById('new-features');
      if (sec) sec.style.display = 'none';
      const tocLink = document.querySelector('nav.toc a[href="#new-features"]');
      if (tocLink) tocLink.style.display = 'none';
      return;
    }

    function newestVersionFor(sectionId) {
      const log = window.ZHL_CHANGELOG || [];
      // changelog is maintained newest-first; the first hit is therefore
      // the most-recent version that touched this section.
      for (const entry of log) {
        if (!entry || !entry.sections) continue;
        if (entry.sections.indexOf(sectionId) !== -1) return entry.version;
      }
      return null;
    }
    function cmpVersionDesc(a, b) {
      // Treat missing version as oldest. Otherwise lexicographic
      // comparison of numeric parts (semver-ish).
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      const pa = String(a).split('.').map(function (n) { return parseInt(n, 10) || 0; });
      const pb = String(b).split('.').map(function (n) { return parseInt(n, 10) || 0; });
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return y - x;
      }
      return 0;
    }

    // Stable sort by recency: capture the original DOM index as the
    // tiebreaker so cards introduced in the same version stay in their
    // original order.
    const annotated = news.map(function (el, i) {
      return {
        el: el,
        version: newestVersionFor(el.id || ''),
        domIndex: i
      };
    });
    annotated.sort(function (a, b) {
      const cmp = cmpVersionDesc(a.version, b.version);
      return cmp !== 0 ? cmp : (a.domIndex - b.domIndex);
    });

    annotated.forEach(function (entry) {
      const clone = entry.el.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
      host.appendChild(clone);
    });
  })();

  // ---- Smooth-scroll deep-links + telemetry --------------------------------
  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event: event, props: props || {} }); } catch (_) {}
  }

  // Fire once on page open. Read the source from the URL query so we know
  // whether the user got here from install / update toast / setup link.
  // Accepts both `?from=...` (current) and `?src=...` (back-compat with
  // links generated by v1.20.0/1.20.1 that may still be open in tabs).
  const params = new URLSearchParams(location.search);
  const src = params.get('from') || params.get('src') || 'direct';
  track('walkthrough_opened', { source: src, version: VERSION });

  // If the URL has a hash, scroll to it after the page is laid out.
  if (location.hash) {
    requestAnimationFrame(function () {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Track TOC clicks so we can see which sections people care about.
  document.querySelectorAll('nav.toc a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function () {
      track('walkthrough_section_clicked', { section: a.getAttribute('href').slice(1) });
    });
  });

  // Karma-link clicks anywhere on the page get telemetry too — useful
  // signal for "did the banner actually drive traffic to the Zall Wall".
  document.querySelectorAll('a[data-zhl-karma-link]').forEach(function (a) {
    a.addEventListener('click', function () {
      track('karma_link_clicked', { source: a.getAttribute('data-zhl-karma-link') || 'walkthrough', version: VERSION });
    });
  });
})();
