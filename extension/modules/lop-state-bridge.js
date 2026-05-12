// ZHL Productivity Pack — MAIN-world bridge for LOP page state.
//
// Content scripts run in an isolated world that can't see the page's
// React fibers or hydrated globals (__NEXT_DATA__ etc.). This module
// runs in the page's MAIN world (per manifest "world": "MAIN") so it
// has direct access to React internals. The isolated-world side asks
// for data via window.postMessage; we respond on the same channel.
//
// All requests/responses are nonce-scoped (requestId) so a future
// caller can fan multiple probes out in parallel without crossing
// streams.
(function () {
  'use strict';
  if (window.__zhlLopStateBridgeInstalled) return;
  window.__zhlLopStateBridgeInstalled = true;

  function findFiber(node) {
    if (!node) return null;
    const names = Object.getOwnPropertyNames(node);
    for (const k of names) {
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) return node[k];
    }
    for (const k of names) {
      if (k.indexOf('_') !== 0 && k.indexOf('__') !== 0) continue;
      let v;
      try { v = node[k]; } catch (_) { continue; }
      if (v && typeof v === 'object' && ('return' in v || 'stateNode' in v || 'memoizedProps' in v)) return v;
    }
    return null;
  }

  function fiberDisplayName(f) {
    if (!f) return '?';
    const t = f.type;
    if (typeof t === 'string') return t;
    if (t && t.displayName) return t.displayName;
    if (t && t.name) return t.name;
    return '?';
  }

  function looksLikeLiabArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    const s = arr[0];
    if (!s || typeof s !== 'object') return false;
    const keys = Object.keys(s).map(function (k) { return k.toLowerCase(); });
    const needles = [
      'payee', 'company', 'companyname',
      'unpaidbalance', 'balance',
      'accounttype', 'highestadverse', 'adverserating',
      'remarks', 'monthlypayment', 'minimumpayment',
      'thirtydayslate', 'sixtydayslate', 'ninetydayslate',
      'lastdelinquency'
    ];
    let hits = 0;
    for (const needle of needles) {
      for (const k of keys) { if (k.indexOf(needle) !== -1) { hits++; break; } }
    }
    return hits >= 2;
  }

  function deepFind(obj, path, depth, out, seen) {
    if (depth > 8 || !obj || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (looksLikeLiabArray(obj)) {
      out.push({ path: path, count: obj.length, sample: obj[0], array: obj });
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 50); i++) {
        try { deepFind(obj[i], path + '[' + i + ']', depth + 1, out, seen); } catch (_) {}
      }
      return;
    }
    const keys = Object.keys(obj);
    for (const k of keys) {
      try { deepFind(obj[k], path + '.' + k, depth + 1, out, seen); } catch (_) {}
    }
  }

  // Build the probe payload for one liabilities table.
  function probeTable(table, tableIndex) {
    const info = {
      tableIndex: tableIndex,
      rowCount: table.querySelectorAll('tbody tr').length,
      keysOnTable: Object.getOwnPropertyNames(table).filter(function (k) { return k.indexOf('_') === 0; }),
      fiberFound: false,
      fiberChain: [],
      hits: []
    };
    let fiber = findFiber(table);
    if (!fiber) {
      const probes = [table.querySelector('tbody'), table.querySelector('tbody tr')];
      let p = table.parentElement;
      for (let d = 0; d < 10 && p; d++) { probes.push(p); p = p.parentElement; }
      for (const n of probes) { if (n && !fiber) fiber = findFiber(n); }
    }
    info.fiberFound = !!fiber;
    let cur = fiber;
    let depth = 0;
    while (cur && depth < 30) {
      info.fiberChain.push(fiberDisplayName(cur));
      try {
        if (cur.memoizedProps) deepFind(cur.memoizedProps, '[' + depth + ':' + fiberDisplayName(cur) + '].props', 0, info.hits, new WeakSet());
        if (cur.memoizedState) deepFind(cur.memoizedState, '[' + depth + ':' + fiberDisplayName(cur) + '].state', 0, info.hits, new WeakSet());
      } catch (_) {}
      cur = cur.return;
      depth++;
    }
    return info;
  }

  function snapshotGlobals() {
    const g = { hasApollo: !!window.__APOLLO_CLIENT__, hasDevTools: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ };
    try {
      if (window.__NEXT_DATA__) {
        g.nextDataKeys = Object.keys(window.__NEXT_DATA__);
        if (window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
          g.nextPagePropsKeys = Object.keys(window.__NEXT_DATA__.props.pageProps);
        }
      }
    } catch (_) {}
    return g;
  }

  function probe(payload) {
    const out = { tables: [], globals: snapshotGlobals() };
    const tables = document.querySelectorAll('table[aria-label="Table for liabilities"]');
    for (let i = 0; i < tables.length; i++) {
      out.tables.push(probeTable(tables[i], i));
    }
    // For read requests, strip the live .array reference (not
    // serializable across postMessage) but keep the row data
    // (sample[0] only on probe; full liabilities on read).
    if (payload && payload.mode === 'read') {
      out.tables = out.tables.map(function (info) {
        const trimmed = Object.assign({}, info);
        trimmed.hits = info.hits.map(function (h) {
          return { path: h.path, count: h.count, items: h.array };
        });
        return trimmed;
      });
    } else {
      out.tables = out.tables.map(function (info) {
        const trimmed = Object.assign({}, info);
        trimmed.hits = info.hits.map(function (h) {
          return { path: h.path, count: h.count, sample: h.sample };
        });
        return trimmed;
      });
    }
    return out;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.type !== 'ZHL_LOP_PROBE_REQUEST') return;
    let result;
    try {
      result = probe(d.payload || {});
      // Round-trip through JSON so postMessage's structured clone
      // doesn't choke on functions / DOM refs that might still be
      // embedded in deeply-nested sample objects.
      result = JSON.parse(JSON.stringify(result));
    } catch (err) {
      result = { error: String(err && err.message || err) };
    }
    window.postMessage({ type: 'ZHL_LOP_PROBE_RESPONSE', requestId: d.requestId, result: result }, '*');
  }, false);

  // Tiny hello-world log so the user can confirm the bridge actually
  // loaded into the MAIN world (visible to the page console).
  try { console.log('[ZHL LOP bridge] installed in MAIN world'); } catch (_) {}
})();
