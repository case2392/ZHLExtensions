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
    if (depth > 14 || !obj || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (looksLikeLiabArray(obj)) {
      out.push({ path: path, count: obj.length, sample: obj[0], array: obj });
      return;
    }
    // Also handle the "object map" case — LOP could store rows keyed
    // by id rather than as an array.
    if (!Array.isArray(obj) && typeof obj === 'object') {
      const values = Object.values(obj);
      if (values.length > 1 && values.every(function (v) { return v && typeof v === 'object'; })) {
        if (looksLikeLiabArray(values)) {
          out.push({ path: path + '/values()', count: values.length, sample: values[0], array: values });
          return;
        }
      }
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

  // Diagnostic: top-level shape of an object (keys + each value's
  // primitive type, length if array, or first sub-keys if object).
  // Used so we can SEE what data each fiber's props/state hold even
  // if our liability-array heuristic doesn't match.
  function describeShape(obj, maxKeys) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (Array.isArray(obj)) return 'Array(' + obj.length + ')';
    if (typeof obj !== 'object') return typeof obj;
    const out = {};
    const keys = Object.keys(obj);
    let shown = 0;
    for (const k of keys) {
      if (shown >= (maxKeys || 30)) { out['...'] = (keys.length - shown) + ' more'; break; }
      let v;
      try { v = obj[k]; } catch (_) { out[k] = '<inaccessible>'; shown++; continue; }
      if (v === null) out[k] = 'null';
      else if (Array.isArray(v)) out[k] = 'Array(' + v.length + ')';
      else if (typeof v === 'object') out[k] = '{ ' + Object.keys(v).slice(0, 5).join(', ') + (Object.keys(v).length > 5 ? ', ...' : '') + ' }';
      else if (typeof v === 'function') out[k] = 'fn';
      else if (typeof v === 'string') out[k] = '"' + v.slice(0, 40) + (v.length > 40 ? '…' : '') + '"';
      else out[k] = String(v);
      shown++;
    }
    return out;
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
    info.fiberShapes = [];
    let cur = fiber;
    let depth = 0;
    while (cur && depth < 40) {
      const name = fiberDisplayName(cur);
      info.fiberChain.push(name);
      try {
        if (cur.memoizedProps) deepFind(cur.memoizedProps, '[' + depth + ':' + name + '].props', 0, info.hits, new WeakSet());
        if (cur.memoizedState) deepFind(cur.memoizedState, '[' + depth + ':' + name + '].state', 0, info.hits, new WeakSet());
      } catch (_) {}
      // Diagnostic shape dump for components that look like data
      // holders (named, non-DOM elements). Skip plain html tags and
      // styled-component wrappers whose name is a single char or
      // begins with a quoted styled identifier.
      if (typeof cur.type !== 'string' && name !== '?' && depth < 35) {
        const shape = { depth: depth, name: name };
        try {
          if (cur.memoizedProps && typeof cur.memoizedProps === 'object') {
            shape.propsShape = describeShape(cur.memoizedProps, 30);
          }
        } catch (_) {}
        try {
          if (cur.memoizedState && typeof cur.memoizedState === 'object') {
            // memoizedState for function components is a linked list of
            // hook states. Walk through it.
            if (cur.memoizedState.next !== undefined && cur.memoizedState.baseState !== undefined) {
              const hooks = [];
              let h = cur.memoizedState;
              let hi = 0;
              while (h && hi < 20) {
                hooks.push({ hook: hi, baseState: describeShape(h.baseState, 8), memoizedState: describeShape(h.memoizedState, 8) });
                h = h.next;
                hi++;
              }
              shape.hooks = hooks;
            } else {
              shape.stateShape = describeShape(cur.memoizedState, 30);
            }
          }
        } catch (_) {}
        info.fiberShapes.push(shape);
      }
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

  // Look for an Apollo Client or TanStack Query Client somewhere in
  // the page. Apollo exposes its client via React Context, which we
  // can reach by walking up the fiber tree from the liabilities
  // table and inspecting each fiber's dependencies / memoizedProps
  // for an object that looks Apollo-shaped (.cache.extract() method,
  // or .readQuery, or a queryManager).
  function findClientInFiberTree(fiber) {
    let cur = fiber;
    let depth = 0;
    while (cur && depth < 60) {
      // 1. memoizedProps.client (ApolloProvider sets this directly)
      try {
        const p = cur.memoizedProps;
        if (p && typeof p === 'object' && p.client) {
          const c = p.client;
          if (c && (typeof c.readQuery === 'function' || (c.cache && typeof c.cache.extract === 'function'))) {
            return { kind: 'apollo', client: c, foundAt: depth, fiberName: fiberDisplayName(cur) };
          }
          if (c && (typeof c.getQueryCache === 'function' || typeof c.getQueryData === 'function')) {
            return { kind: 'reactQuery', client: c, foundAt: depth, fiberName: fiberDisplayName(cur) };
          }
        }
      } catch (_) {}
      // 2. Context values on this fiber (Provider components hold value in memoizedProps.value).
      try {
        const p = cur.memoizedProps;
        if (p && typeof p === 'object' && p.value) {
          const v = p.value;
          if (v && (typeof v.readQuery === 'function' || (v.cache && typeof v.cache.extract === 'function'))) {
            return { kind: 'apollo', client: v, foundAt: depth, fiberName: fiberDisplayName(cur), via: 'context value' };
          }
          if (v && (typeof v.getQueryCache === 'function' || typeof v.getQueryData === 'function')) {
            return { kind: 'reactQuery', client: v, foundAt: depth, fiberName: fiberDisplayName(cur), via: 'context value' };
          }
        }
      } catch (_) {}
      // 3. stateNode (class components) might hold the client.
      try {
        const sn = cur.stateNode;
        if (sn && typeof sn === 'object' && sn.client) {
          const c = sn.client;
          if (c && (typeof c.readQuery === 'function' || (c.cache && typeof c.cache.extract === 'function'))) {
            return { kind: 'apollo', client: c, foundAt: depth, fiberName: fiberDisplayName(cur), via: 'stateNode.client' };
          }
        }
      } catch (_) {}
      cur = cur.return;
      depth++;
    }
    return null;
  }

  function snapshotApolloIfReachable(table) {
    let fiber = findFiber(table);
    if (!fiber) {
      const probes = [table.querySelector('tbody'), table.querySelector('tbody tr')];
      let p = table.parentElement;
      for (let d = 0; d < 10 && p; d++) { probes.push(p); p = p.parentElement; }
      for (const n of probes) { if (n && !fiber) fiber = findFiber(n); }
    }
    if (!fiber) return null;
    const found = findClientInFiberTree(fiber);
    if (!found) return null;
    if (found.kind === 'apollo') {
      try {
        const cache = found.client.cache && found.client.cache.extract && found.client.cache.extract();
        if (cache && typeof cache === 'object') {
          const keys = Object.keys(cache);
          const liabKeys = keys.filter(function (k) { return /liabilit|borrower|account|derog|tradeline|credit/i.test(k); });
          // Find any cache value that contains an array of liability-like objects.
          const matches = [];
          for (const k of keys) {
            const v = cache[k];
            if (!v || typeof v !== 'object') continue;
            // Walk one level deep looking for liability-shaped arrays.
            for (const sub of Object.keys(v)) {
              const sv = v[sub];
              if (Array.isArray(sv) && looksLikeLiabArray(sv)) {
                matches.push({ cacheKey: k, fieldKey: sub, count: sv.length, sample: sv[0] });
              }
              if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
                // Apollo cache often stores arrays as { __ref: 'Type:id' } pointers in a parent
                // and the real data under a normalized key. Capture keys that look interesting.
              }
            }
          }
          return {
            kind: 'apollo',
            foundAt: found.foundAt,
            fiberName: found.fiberName,
            via: found.via || 'props.client',
            cacheKeys: keys.length,
            sampleCacheKeys: keys.slice(0, 20),
            liabilityishKeys: liabKeys,
            liabilityArrayMatches: matches
          };
        }
      } catch (e) {
        return { kind: 'apollo', error: String(e && e.message || e) };
      }
    }
    if (found.kind === 'reactQuery') {
      try {
        const queries = found.client.getQueryCache && found.client.getQueryCache().getAll();
        if (queries) {
          const keys = queries.map(function (q) { return q.queryKey; });
          return { kind: 'reactQuery', foundAt: found.foundAt, queryCount: queries.length, queryKeys: keys.slice(0, 30) };
        }
      } catch (e) {
        return { kind: 'reactQuery', error: String(e && e.message || e) };
      }
    }
    return found;
  }

  // Targeted read for the LOP liabilities array. The table is
  // rendered by an internal "TableSection" component (minified name
  // is "nO" in production) whose memoizedProps include the marker
  // entityNamePlural === "liabilities" alongside the data array. We
  // walk fibers from the table up looking for that marker and
  // return the data array directly.
  function readLiabilitiesArray(table) {
    let fiber = findFiber(table);
    if (!fiber) {
      const probes = [table.querySelector('tbody'), table.querySelector('tbody tr')];
      let p = table.parentElement;
      for (let d = 0; d < 10 && p; d++) { probes.push(p); p = p.parentElement; }
      for (const n of probes) { if (n && !fiber) fiber = findFiber(n); }
    }
    if (!fiber) return { found: false, reason: 'no fiber on table' };
    let cur = fiber;
    let depth = 0;
    while (cur && depth < 40) {
      try {
        const p = cur.memoizedProps;
        if (p && typeof p === 'object') {
          const isLiabSection = p.entityNamePlural === 'liabilities' ||
                                p.entityNameSingular === 'liability';
          if (isLiabSection && Array.isArray(p.data)) {
            return {
              found: true,
              depth: depth,
              fiberName: fiberDisplayName(cur),
              count: p.data.length,
              items: p.data
            };
          }
        }
      } catch (_) {}
      cur = cur.return;
      depth++;
    }
    return { found: false, reason: 'no entityNamePlural=liabilities fiber found within 40 ancestors' };
  }

  function probe(payload) {
    const out = { tables: [], globals: snapshotGlobals() };
    const tables = document.querySelectorAll('table[aria-label="Table for liabilities"]');
    for (let i = 0; i < tables.length; i++) {
      if (payload && payload.mode === 'readLiabilities') {
        const read = readLiabilitiesArray(tables[i]);
        out.tables.push({ tableIndex: i, read: read });
        continue;
      }
      const info = probeTable(tables[i], i);
      info.apolloProbe = snapshotApolloIfReachable(tables[i]);
      // Also include the targeted read so we can see what fields each
      // liability object has, even when the user is just probing.
      info.read = readLiabilitiesArray(tables[i]);
      out.tables.push(info);
    }
    // For "read" / default probe requests we trim the hits array
    // for postMessage (strip live arrays, keep sample[0] or items
    // depending on mode). The "readLiabilities" mode pushed
    // { tableIndex, read } objects above — those have no .hits
    // field, so the trim step would throw "Cannot read properties
    // of undefined (reading 'map')". Skip the trim entirely when
    // we're in readLiabilities mode.
    if (payload && payload.mode === 'readLiabilities') {
      // No-op — out.tables already has the right shape.
    } else if (payload && payload.mode === 'read') {
      out.tables = out.tables.map(function (info) {
        const trimmed = Object.assign({}, info);
        trimmed.hits = (info.hits || []).map(function (h) {
          return { path: h.path, count: h.count, items: h.array };
        });
        return trimmed;
      });
    } else {
      out.tables = out.tables.map(function (info) {
        const trimmed = Object.assign({}, info);
        trimmed.hits = (info.hits || []).map(function (h) {
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

  // (Hello-world install log removed in v1.14.3 to keep production
  // consoles quiet. To verify the bridge is alive, dispatch a
  // ZHL_LOP_PROBE_REQUEST and watch for ZHL_LOP_PROBE_RESPONSE.)
})();
