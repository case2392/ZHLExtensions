// ZHL Productivity Pack module — feature key: feature_vaCalc
// Wraps original module body in a chrome.storage.local feature-flag check.
// If the user disables this module on the setup page the body never runs.
(function () {
  'use strict';
  const __ZHL_FEATURE_KEY = 'feature_vaCalc';
  function __zhlRunModule() {
(function () {
  'use strict';

  const BUTTON_ID = 'rric-run-button';
  const BUTTON_CLASS = 'rric-run-button-cls';
  const PANEL_ID = 'rric-panel';
  const STUDENT_LOAN_BUTTON_ID = 'rric-sloan-button';
  const STUDENT_LOAN_BUTTON_CLASS = 'rric-sloan-button-cls';
  const STUDENT_LOAN_PICKER_ID = 'rric-sloan-picker';
  const STUDENT_LOAN_PANEL_ID = 'rric-sloan-summary';
  const EXCLUDE_TELECOM_BUTTON_ID = 'rric-exclude-telecom-button';
  const EXCLUDE_TELECOM_BUTTON_CLASS = 'rric-exclude-telecom-button-cls';
  const COLLECTIONS_BADGE_CLASS = 'rric-collections-badge-cls';
  const FHA_COLLECTION_CAP = 2000;

  // Identify medical collections by payee name keywords. Medical
  // collections are excluded from the FHA cumulative-balance rule.
  // List below is intentionally broad — false positives are better
  // than false negatives here (under-counting a collection would be
  // worse than over-excluding one in the user's display).
  const MEDICAL_PAYEE_KEYWORDS = [
    'MEDICAL', 'HOSPITAL', 'HOSP ', 'CLINIC', 'HEALTHCARE', 'HEALTH ',
    'PHYSICIAN', 'PHARMACY', 'DENTAL', 'DENTIST', 'AMBULANCE',
    'ANESTHES', 'RADIOLOGY', 'CARDIOLOGY', 'PEDIATRIC', 'ORTHODONTIC',
    'CHIROPRACT', 'PHYSICAL THERAPY', 'PHYSIO', 'EMERGENCY',
    'LABCORP', 'LAB CORP', 'QUEST DIAGN', 'BLUE CROSS', 'KAISER',
    'AR RESOURCES', 'MEDICAL DATA', 'CONIFER HEALTH', 'CONIFER',
    'AMERICAN MEDICAL', 'WAKEMED', 'BAYLOR', 'CLEVELAND CLINIC',
    'MAYO CLINIC', 'BANNER HEALTH', 'INTERMOUNTAIN HEALTH',
    'PROVIDENCE HEALTH', 'SUTTER HEALTH', 'HCA HEALTHCARE',
    'TENET HEALTH', 'COMMUNITY HEALTH', 'OPTUM', 'CIGNA', 'AETNA',
    'UNITED HEALTHCARE', 'CHILDRENS HOSPITAL', 'CHILDREN\'S HOSPITAL'
  ];

  // Heuristic for the FHA cumulative-balance rule. User chose "Both
  // Unknown AND Collection" identification — so we count rows whose
  // Account type column reads "Unknown", "Collection", "Collection
  // Account", "ChargeOff", or "Charge Off". Excludes rows whose
  // Company/Payee name matches the medical keyword list above.
  function isCollectionAccount(accountType) {
    const at = (accountType || '').toUpperCase().trim();
    if (!at) return false;
    if (at === 'UNKNOWN') return true;
    if (/COLLECTION|CHARGE\s*OFF|CHARGEOFF/.test(at)) return true;
    return false;
  }

  function isMedicalPayee(payee) {
    const p = (payee || '').toUpperCase();
    for (const kw of MEDICAL_PAYEE_KEYWORDS) {
      if (p.indexOf(kw) !== -1) return true;
    }
    return false;
  }

  function computeCollectionsTotal(scopeTable) {
    const rows = findLiabilityRows(scopeTable);
    let total = 0;
    const counted = [];
    const excludedMedical = [];
    for (const r of rows) {
      if (!isCollectionAccount(r.accountType)) continue;
      if (isMedicalPayee(r.payee)) {
        excludedMedical.push(r);
        continue;
      }
      total += (r.balance || 0);
      counted.push(r);
    }
    return { total: total, counted: counted, excludedMedical: excludedMedical };
  }

  // Per-table cache of the most recent deep-scan result so the
  // visible badge keeps showing the accurate number across observer
  // ticks. Keyed by table DOM node; the WeakMap auto-clears when the
  // table is removed (tab switch / page leave). Invalidated when the
  // summary-row fingerprint (count + payees + balances) changes — if
  // the user edits a row after scanning, the badge falls back to the
  // fast heuristic and shows a "stale, re-scan" hint.
  const deepScanCache = new WeakMap();
  function tableFingerprint(scopeTable) {
    const rows = findLiabilityRows(scopeTable);
    return rows.map(function (r) {
      return (r.payee || '') + '|' + (r.accountType || '') + '|' + (r.balance || 0);
    }).join(';');
  }

  function ensureCollectionsBadge() {
    const sections = findLiabilitiesHeaders();
    for (const sec of sections) {
      let badge = sec.container.querySelector('.' + COLLECTIONS_BADGE_CLASS);
      if (!badge) {
        badge = document.createElement('div');
        badge.className = COLLECTIONS_BADGE_CLASS;
        badge.style.cssText =
          'display:inline-flex;align-items:center;gap:6px;' +
          'padding:4px 10px;margin-left:12px;border-radius:14px;' +
          'font:600 12px/1.3 Arial,sans-serif;cursor:pointer;' +
          'border:1px solid transparent;user-select:none;';
        badge.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            // Shift-click: probe the React fiber tree above the
            // liabilities table and dump the discovered data to the
            // console. Used to figure out the field shape so we can
            // read liability details without expanding rows.
            probeReactFiber(sec.table);
          } else {
            runDeepScan(sec, badge);
          }
        });
        const heading = sec.container.querySelector('h5');
        if (heading && heading.nextSibling) sec.container.insertBefore(badge, heading.nextSibling);
        else sec.container.appendChild(badge);
      }
      updateCollectionsBadge(sec, badge);
    }
  }

  // ---- React-fiber probe -------------------------------------------------
  //
  // Next.js/React stores component state on the DOM node via an
  // internal "__reactFiber$<hash>" property. Walking up the fiber's
  // .return chain reaches the parent components, where memoizedProps
  // / memoizedState typically hold the full data object that backs
  // the rendered list (liabilities, etc.). If we can identify the
  // node whose props/state holds the liability array with all the
  // fields the form shows, we can read every row's
  // highestAdverseRating / remarks / late counts / lastDelinquencyDate
  // WITHOUT expanding any rows.
  //
  // The probe just logs whatever it finds at each ancestor level so
  // we can see field names and decide which path to read from.
  function findReactFiber(node) {
    if (!node) return null;
    for (const key of Object.keys(node)) {
      if (key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0) {
        return node[key];
      }
    }
    return null;
  }

  // Walks the DOM up from `node` looking for ANY ancestor (or
  // descendant of self) that has a React fiber property. Returns
  // { node, fiber, keys } describing what we found, or null.
  function findReactFiberNearby(node) {
    const visited = new Set();
    function tryNode(n) {
      if (!n || visited.has(n)) return null;
      visited.add(n);
      const keys = [];
      for (const k of Object.keys(n)) {
        if (k.startsWith('__react') || k.startsWith('__P_') || k.startsWith('_owner')) keys.push(k);
      }
      if (keys.length) {
        for (const k of keys) {
          const v = n[k];
          // Fiber-ish objects have .return / .stateNode / .memoizedProps.
          if (v && typeof v === 'object' && ('return' in v || 'stateNode' in v || 'memoizedProps' in v)) {
            return { node: n, fiber: v, keys: keys, hitKey: k };
          }
        }
      }
      return null;
    }
    // Try self.
    let r = tryNode(node);
    if (r) return r;
    // Try ancestors.
    let cur = node && node.parentElement;
    let depth = 0;
    while (cur && depth < 25) {
      r = tryNode(cur);
      if (r) return r;
      cur = cur.parentElement;
      depth++;
    }
    // Try a few descendants of the table (tbody, first tr, first td).
    const descendants = [
      node && node.querySelector ? node.querySelector('tbody') : null,
      node && node.querySelector ? node.querySelector('tbody tr') : null,
      node && node.querySelector ? node.querySelector('tbody td') : null
    ].filter(Boolean);
    for (const d of descendants) {
      r = tryNode(d);
      if (r) return r;
    }
    return null;
  }

  function fiberDisplayName(fiber) {
    if (!fiber) return '?';
    const t = fiber.type;
    if (typeof t === 'string') return t;
    if (t && t.displayName) return t.displayName;
    if (t && t.name) return t.name;
    return '?';
  }

  function isLiabilityLikeArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    // Heuristic: items look like liabilities if they have payee /
    // company / unpaid balance fields.
    const sample = arr[0];
    if (!sample || typeof sample !== 'object') return false;
    const keys = Object.keys(sample).map(function (k) { return k.toLowerCase(); });
    let hits = 0;
    for (const needle of ['payee', 'company', 'companyname', 'unpaidbalance', 'balance', 'accounttype', 'highestadverse', 'remarks', 'monthlypayment']) {
      if (keys.some(function (k) { return k.indexOf(needle) !== -1; })) hits++;
    }
    return hits >= 2;
  }

  function deepFindLiabilityArrays(obj, path, depth, out, seen) {
    if (depth > 6 || !obj || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (isLiabilityLikeArray(obj)) {
      out.push({ path: path, value: obj });
      return;
    }
    for (const key of Object.keys(obj)) {
      try {
        const v = obj[key];
        if (v && typeof v === 'object') {
          deepFindLiabilityArrays(v, path + '.' + key, depth + 1, out, seen);
        }
      } catch (_) {}
    }
  }

  // Inject a script into the page's MAIN world. Content scripts live
  // in an isolated world that can't see __reactFiber$ properties or
  // hydrated page globals, so any state probing has to happen in the
  // page world and post results back.
  function injectMainWorldScript(code) {
    return new Promise(function (resolve) {
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      // The script runs synchronously on insertion.
      s.remove();
      resolve();
    });
  }

  // Request/response over window.postMessage between our isolated
  // content script and the page-world probe.
  function callMainWorldProbe(payload, timeoutMs) {
    return new Promise(function (resolve) {
      const requestId = 'zhl-probe-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const responseType = 'ZHL_LOP_PROBE_RESPONSE';
      const requestType = 'ZHL_LOP_PROBE_REQUEST';
      const timer = setTimeout(function () {
        window.removeEventListener('message', listener);
        resolve(null);
      }, timeoutMs || 3000);
      function listener(e) {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.type !== responseType || d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve(d.result);
      }
      window.addEventListener('message', listener);
      // The MAIN-world probe must already be installed. We post the
      // request via window.postMessage (same origin → reaches both
      // worlds).
      window.postMessage({ type: requestType, requestId: requestId, payload: payload }, '*');
    });
  }

  // Source for the page-world probe. Installs a listener on
  // window.postMessage; when our content script asks for a fiber
  // dump, walks the fiber tree of every liabilities table and posts
  // the discovered data back. Embedded as a template string so it
  // stays a self-contained snippet.
  const MAIN_WORLD_PROBE_SRC = '(function () {\n' +
    '  if (window.__zhlLopProbeInstalled) return;\n' +
    '  window.__zhlLopProbeInstalled = true;\n' +
    '  function findFiber(node) {\n' +
    '    if (!node) return null;\n' +
    '    var names = Object.getOwnPropertyNames(node);\n' +
    '    for (var i = 0; i < names.length; i++) {\n' +
    '      var k = names[i];\n' +
    '      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) return node[k];\n' +
    '    }\n' +
    '    for (var j = 0; j < names.length; j++) {\n' +
    '      var k2 = names[j];\n' +
    '      if (k2.indexOf("_") !== 0 && k2.indexOf("__") !== 0) continue;\n' +
    '      var v = node[k2];\n' +
    '      if (v && typeof v === "object" && ("return" in v || "stateNode" in v || "memoizedProps" in v)) return v;\n' +
    '    }\n' +
    '    return null;\n' +
    '  }\n' +
    '  function dispName(f) {\n' +
    '    if (!f) return "?";\n' +
    '    var t = f.type;\n' +
    '    if (typeof t === "string") return t;\n' +
    '    if (t && t.displayName) return t.displayName;\n' +
    '    if (t && t.name) return t.name;\n' +
    '    return "?";\n' +
    '  }\n' +
    '  function looksLikeLiab(arr) {\n' +
    '    if (!Array.isArray(arr) || !arr.length) return false;\n' +
    '    var s = arr[0];\n' +
    '    if (!s || typeof s !== "object") return false;\n' +
    '    var keys = Object.keys(s).map(function (k) { return k.toLowerCase(); });\n' +
    '    var hits = 0;\n' +
    '    var needles = ["payee", "company", "companyname", "unpaidbalance", "balance", "accounttype", "highestadverse", "remarks", "monthlypayment", "thirtydayslate"];\n' +
    '    for (var i = 0; i < needles.length; i++) {\n' +
    '      for (var j = 0; j < keys.length; j++) if (keys[j].indexOf(needles[i]) !== -1) { hits++; break; }\n' +
    '    }\n' +
    '    return hits >= 2;\n' +
    '  }\n' +
    '  function deepFind(obj, path, depth, out, seen) {\n' +
    '    if (depth > 8 || !obj || typeof obj !== "object") return;\n' +
    '    if (seen.has(obj)) return;\n' +
    '    seen.add(obj);\n' +
    '    if (looksLikeLiab(obj)) { out.push({ path: path, sample: obj[0], count: obj.length, ref: obj }); return; }\n' +
    '    if (Array.isArray(obj)) {\n' +
    '      for (var i = 0; i < Math.min(obj.length, 50); i++) deepFind(obj[i], path + "[" + i + "]", depth + 1, out, seen);\n' +
    '      return;\n' +
    '    }\n' +
    '    var keys = Object.keys(obj);\n' +
    '    for (var k = 0; k < keys.length; k++) {\n' +
    '      try { deepFind(obj[keys[k]], path + "." + keys[k], depth + 1, out, seen); } catch (_) {}\n' +
    '    }\n' +
    '  }\n' +
    '  function probe() {\n' +
    '    var report = { tables: [], globals: {} };\n' +
    '    // Globals snapshot (visible in MAIN world but not isolated)\n' +
    '    try {\n' +
    '      if (window.__NEXT_DATA__) {\n' +
    '        report.globals.nextDataKeys = Object.keys(window.__NEXT_DATA__);\n' +
    '        if (window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {\n' +
    '          report.globals.nextPagePropsKeys = Object.keys(window.__NEXT_DATA__.props.pageProps);\n' +
    '        }\n' +
    '      }\n' +
    '    } catch (_) {}\n' +
    '    report.globals.hasApollo = !!window.__APOLLO_CLIENT__;\n' +
    '    report.globals.hasDevTools = !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__;\n' +
    '    var tables = document.querySelectorAll(\'table[aria-label="Table for liabilities"]\');\n' +
    '    for (var t = 0; t < tables.length; t++) {\n' +
    '      var table = tables[t];\n' +
    '      var info = { tableIndex: t, rowCount: table.querySelectorAll("tbody tr").length, keysOnTable: Object.getOwnPropertyNames(table).filter(function (k) { return k.indexOf("_") === 0; }) };\n' +
    '      var fiber = findFiber(table);\n' +
    '      if (!fiber) {\n' +
    '        // Try ancestors and tbody.\n' +
    '        var probeNodes = [table.querySelector("tbody"), table.querySelector("tbody tr")];\n' +
    '        var p = table.parentElement;\n' +
    '        for (var d = 0; d < 10 && p; d++) { probeNodes.push(p); p = p.parentElement; }\n' +
    '        for (var i = 0; i < probeNodes.length && !fiber; i++) { if (probeNodes[i]) fiber = findFiber(probeNodes[i]); }\n' +
    '      }\n' +
    '      info.fiberFound = !!fiber;\n' +
    '      info.fiberChain = [];\n' +
    '      info.hits = [];\n' +
    '      var cur = fiber;\n' +
    '      var depth = 0;\n' +
    '      while (cur && depth < 30) {\n' +
    '        info.fiberChain.push(dispName(cur));\n' +
    '        try {\n' +
    '          if (cur.memoizedProps) deepFind(cur.memoizedProps, "[" + depth + ":" + dispName(cur) + "].props", 0, info.hits, new WeakSet());\n' +
    '          if (cur.memoizedState) deepFind(cur.memoizedState, "[" + depth + ":" + dispName(cur) + "].state", 0, info.hits, new WeakSet());\n' +
    '        } catch (_) {}\n' +
    '        cur = cur.return;\n' +
    '        depth++;\n' +
    '      }\n' +
    '      // Trim refs before posting; only keep sample + path + count.\n' +
    '      info.hits = info.hits.map(function (h) { return { path: h.path, count: h.count, sample: h.sample }; });\n' +
    '      report.tables.push(info);\n' +
    '    }\n' +
    '    return report;\n' +
    '  }\n' +
    '  window.addEventListener("message", function (e) {\n' +
    '    if (e.source !== window) return;\n' +
    '    var d = e.data;\n' +
    '    if (!d || d.type !== "ZHL_LOP_PROBE_REQUEST") return;\n' +
    '    var result;\n' +
    '    try { result = probe(); } catch (err) { result = { error: String(err && err.message || err) }; }\n' +
    '    // Strip non-cloneable bits before postMessage (sample objects may have functions / DOM refs).\n' +
    '    try { result = JSON.parse(JSON.stringify(result)); } catch (_) { result = { error: "result not serializable" }; }\n' +
    '    window.postMessage({ type: "ZHL_LOP_PROBE_RESPONSE", requestId: d.requestId, result: result }, "*");\n' +
    '  }, false);\n' +
    '})();';

  async function probeReactFiber(table) {
    console.group('[Collections Probe] MAIN-world react fiber walk');
    // The MAIN-world bridge is registered as a content script in the
    // manifest (modules/lop-state-bridge.js with "world": "MAIN"), so
    // it's already installed by the time we get here. No inline
    // injection — that gets blocked by LOP's CSP.
    const result = await callMainWorldProbe({ scope: 'liabilities' }, 4000);
    if (!result) {
      console.warn('No response from MAIN-world bridge within 4s. Check that you see the "[ZHL LOP bridge] installed in MAIN world" log on page load — if not, the manifest content script entry isn\'t running.');
      console.groupEnd();
      return;
    }
    if (result.error) {
      console.warn('MAIN-world probe error:', result.error);
      console.groupEnd();
      return;
    }
    console.log('globals snapshot (MAIN world):', result.globals);
    console.log('found ' + result.tables.length + ' liabilities table(s):');
    for (const info of result.tables) {
      console.group('table[' + info.tableIndex + '] rows=' + info.rowCount + ' fiberFound=' + info.fiberFound);
      console.log('table own-keys:', info.keysOnTable);
      console.log('fiber chain (' + info.fiberChain.length + ' levels):', info.fiberChain.slice(0, 15).join(' → '));
      if (info.hits.length) {
        console.log('found ' + info.hits.length + ' liability-shaped array(s):');
        for (const h of info.hits) {
          console.log('  ' + h.path + ' (' + h.count + ' items)');
          console.log('    sample[0]:', h.sample);
        }
        console.log('Top hit sample (paste this block back to me):');
        console.log(JSON.stringify(info.hits[0].sample, null, 2));
      } else {
        console.warn('  no liability-shaped array found in this fiber tree');
      }
      console.groupEnd();
    }
    console.groupEnd();
    return;

    // (Old isolated-world walk left here as fallback if MAIN-world
    // injection ever gets CSP-blocked.)
    // eslint-disable-next-line no-unreachable
    console.group('[Collections Probe] react fiber walk');

    // Use getOwnPropertyNames so we catch non-enumerable React keys.
    function nodeOwnKeys(n) {
      try {
        return Object.getOwnPropertyNames(n).filter(function (k) { return k.startsWith('_') || k.startsWith('__'); });
      } catch (_) { return []; }
    }
    console.log('table own-keys (incl non-enum):', nodeOwnKeys(table));
    const tbody = table.querySelector('tbody');
    if (tbody) console.log('tbody own-keys:', nodeOwnKeys(tbody));
    let walk = table.parentElement;
    for (let d = 0; d < 5 && walk; d++) {
      console.log('ancestor[' + d + ']=' + walk.tagName + ' own-keys:', nodeOwnKeys(walk));
      walk = walk.parentElement;
    }

    // Page-level diagnostic: which JS frameworks / state stores are
    // available on window? The Next.js __NEXT_DATA__ blob, an Apollo
    // client, Redux store, or React DevTools hook would each open a
    // different route to the liability data.
    console.log('--- page globals ---');
    console.log('typeof window.__NEXT_DATA__:', typeof window.__NEXT_DATA__);
    if (typeof window.__NEXT_DATA__ === 'object') {
      console.log('  __NEXT_DATA__ top-level keys:', Object.keys(window.__NEXT_DATA__ || {}));
      try {
        const pp = window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps;
        if (pp) console.log('  __NEXT_DATA__.props.pageProps keys:', Object.keys(pp));
      } catch (_) {}
    }
    console.log('typeof window.__APOLLO_CLIENT__:', typeof window.__APOLLO_CLIENT__);
    if (window.__APOLLO_CLIENT__) {
      try {
        const cache = window.__APOLLO_CLIENT__.cache && window.__APOLLO_CLIENT__.cache.extract && window.__APOLLO_CLIENT__.cache.extract();
        if (cache) {
          const keys = Object.keys(cache);
          console.log('  Apollo cache size:', keys.length);
          const liabilityKeys = keys.filter(function (k) { return /liabilit|borrower/i.test(k); });
          console.log('  Apollo cache keys matching liability/borrower:', liabilityKeys.slice(0, 20));
        }
      } catch (e) { console.warn('  Apollo cache probe failed', e); }
    }
    console.log('typeof window.__REDUX_STORE__:', typeof window.__REDUX_STORE__);
    console.log('typeof window.__INITIAL_STATE__:', typeof window.__INITIAL_STATE__);
    console.log('typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__:', typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      try {
        const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        const renderers = hook.renderers;
        if (renderers) {
          const ids = typeof renderers.forEach === 'function' ? [] : Object.keys(renderers);
          if (renderers.forEach) renderers.forEach(function (_, id) { ids.push(id); });
          console.log('  React DevTools registered renderer ids:', ids);
        }
      } catch (e) {}
    }

    // Iframe check — if the application is mounted in an iframe, we
    // need to inject into the iframe's frame instead of the top.
    const iframes = document.querySelectorAll('iframe');
    console.log('iframes on page:', iframes.length);

    // Try the wider fiber search.
    const found = findReactFiberNearby(table);
    if (found) {
      console.log('fiber located via key "' + found.hitKey + '" on <' + found.node.tagName.toLowerCase() + '>',
        found.node === table ? '(the table itself)' :
        (found.node.contains(table) ? '(a descendant)' : '(an ancestor)'));
    }

    // Brute-force last resort: scan every element on the page for
    // ANY property whose value is fiber-shaped. Reports the first 10
    // hits with their location. If this turns up empty, React really
    // isn't reachable from this isolated content-script world.
    if (!found) {
      console.log('--- brute-force scan of all elements for fiber-shaped props ---');
      const all = document.querySelectorAll('*');
      console.log('  scanning ' + all.length + ' elements...');
      const hits = [];
      for (const el of all) {
        let names;
        try { names = Object.getOwnPropertyNames(el); } catch (_) { continue; }
        for (const n of names) {
          if (!(n.startsWith('_') || n.startsWith('__'))) continue;
          let v;
          try { v = el[n]; } catch (_) { continue; }
          if (v && typeof v === 'object' && ('return' in v || 'stateNode' in v || 'memoizedProps' in v)) {
            hits.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), key: n });
            if (hits.length >= 10) break;
          }
        }
        if (hits.length >= 10) break;
      }
      console.log('  brute-force hits:', hits);
      console.warn('No fiber found in the ordinary search. Page globals + brute-force results are above. Paste the whole block back.');
      console.groupEnd();
      return;
    }
    const fiber = found.fiber;
    console.log('starting fiber:', fiberDisplayName(fiber));
    let cur = fiber;
    let depth = 0;
    const allHits = [];
    while (cur && depth < 30) {
      const label = '[' + depth + '] ' + fiberDisplayName(cur);
      const propsHits = [];
      const stateHits = [];
      try {
        if (cur.memoizedProps && typeof cur.memoizedProps === 'object') {
          deepFindLiabilityArrays(cur.memoizedProps, 'props', 0, propsHits, new WeakSet());
        }
      } catch (_) {}
      try {
        if (cur.memoizedState && typeof cur.memoizedState === 'object') {
          deepFindLiabilityArrays(cur.memoizedState, 'state', 0, stateHits, new WeakSet());
        }
      } catch (_) {}
      if (propsHits.length || stateHits.length) {
        console.group(label + ' — found ' + (propsHits.length + stateHits.length) + ' candidate array(s)');
        for (const h of propsHits) {
          console.log('PROPS ' + h.path + ' (' + h.value.length + ' items)');
          console.log('  sample[0]:', h.value[0]);
          allHits.push(Object.assign({ fiberDepth: depth, fiberName: fiberDisplayName(cur) }, h));
        }
        for (const h of stateHits) {
          console.log('STATE ' + h.path + ' (' + h.value.length + ' items)');
          console.log('  sample[0]:', h.value[0]);
          allHits.push(Object.assign({ fiberDepth: depth, fiberName: fiberDisplayName(cur) }, h));
        }
        console.groupEnd();
      }
      cur = cur.return;
      depth++;
    }
    if (!allHits.length) {
      console.warn('No liability-like arrays found in the fiber tree above the table.');
    } else {
      console.log('Summary — ' + allHits.length + ' hit(s):');
      for (const h of allHits) {
        console.log('  depth=' + h.fiberDepth + ' ' + h.fiberName + ' @ ' + h.path + ' (' + h.value.length + ' items)');
      }
      console.log('Top hit sample (paste this block back to me):');
      console.log(JSON.stringify(allHits[0].value[0], null, 2));
    }
    console.groupEnd();
  }

  function updateCollectionsBadge(sec, badge) {
    // Prefer a recent deep-scan result if the table hasn't changed
    // since the scan ran. Otherwise compute the fast (summary-only)
    // heuristic and mark the badge as needing a scan.
    const cached = deepScanCache.get(sec.table);
    const currentFp = tableFingerprint(sec.table);
    if (cached && cached.fingerprint === currentFp) {
      paintBadge(badge, cached.result, 'deep');
      return;
    }
    if (cached && cached.fingerprint !== currentFp) {
      // Table changed since scan — discard the stale result.
      deepScanCache.delete(sec.table);
    }
    const result = computeCollectionsTotal(sec.table);
    paintBadge(badge, result, 'fast');
  }

  function paintBadge(badge, result, mode) {
    const overCap = result.total >= FHA_COLLECTION_CAP;
    const icon = overCap ? '✕' : '✓';
    const color = overCap ? '#b91c1c' : '#16a34a';
    const bg = overCap ? '#fee2e2' : '#dcfce7';
    badge.style.background = bg;
    badge.style.color = color;
    badge.style.borderColor = color;
    const medicalNote = result.excludedMedical.length
      ? ' · ' + result.excludedMedical.length + ' medical excluded'
      : '';
    const modeNote = mode === 'deep'
      ? ' · deep scan ✓'
      : ' · click to deep scan';
    badge.textContent = icon + ' Total Collections: $' +
      result.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      medicalNote + modeNote;
    const lines = ['FHA cumulative-balance cap: $' + FHA_COLLECTION_CAP.toLocaleString()];
    if (mode === 'fast') {
      lines.push('(Fast mode — only counts what\'s visible in the summary. Click the badge to deep-scan rows for charge-offs / late pays.)');
    }
    if (result.counted.length) {
      lines.push('');
      lines.push('Counted (' + result.counted.length + '):');
      for (const c of result.counted) {
        const r = c.row || c;
        const why = c.reasons ? ' [' + c.reasons.join(', ') + ']' : '';
        lines.push('  • ' + r.payee + ' [' + r.accountType + ']' + why + ' — $' + (r.balance || 0).toLocaleString());
      }
    }
    if (result.excludedMedical.length) {
      lines.push('');
      lines.push('Excluded as medical (' + result.excludedMedical.length + '):');
      for (const c of result.excludedMedical) {
        const r = c.row || c;
        lines.push('  • ' + r.payee + ' [' + r.accountType + '] — $' + (r.balance || 0).toLocaleString());
      }
    }
    badge.title = lines.join('\n');
  }

  async function runDeepScan(sec, badge) {
    const origText = badge.textContent;
    const origCursor = badge.style.cursor;
    badge.style.cursor = 'progress';
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';
    badge.style.borderColor = '#f59e0b';
    badge.textContent = '⟳ Scanning rows…';
    console.group('[Collections Scan] deep scan started');
    try {
      const result = await deepScanCollections(sec.table, function (i, n, payee) {
        badge.textContent = '⟳ Scanning ' + (i + 1) + '/' + n + ' — ' + payee;
      });
      deepScanCache.set(sec.table, { fingerprint: tableFingerprint(sec.table), result: result });
      paintBadge(badge, result, 'deep');
      console.log('[Collections Scan] result:', result);
    } catch (e) {
      console.error('[Collections Scan] failed:', e);
      badge.textContent = origText;
      alert('Deep scan failed: ' + (e && e.message || e));
    } finally {
      badge.style.cursor = origCursor || 'pointer';
      console.groupEnd();
    }
  }

  function readFieldByLabelInPanel(panel, labelText) {
    const target = normalizeText(labelText);
    const labels = panel.querySelectorAll('label');
    for (const lbl of labels) {
      const t = normalizeText(lbl.textContent);
      if (t === target || t.startsWith(target)) {
        if (lbl.htmlFor) {
          const el = document.getElementById(lbl.htmlFor);
          if (el) return el;
        }
        const sibling = lbl.parentElement && lbl.parentElement.querySelector('input, select, textarea');
        if (sibling) return sibling;
      }
    }
    return null;
  }

  function getSelectedText(sel) {
    if (!sel) return '';
    if (sel.options && sel.options.length) {
      const opt = sel.options[sel.selectedIndex];
      return (opt && (opt.text || opt.value)) || '';
    }
    return sel.value || '';
  }

  function parseLooseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // Try MM/DD/YYYY explicitly.
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
    if (m) {
      const dd = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
      if (!isNaN(dd.getTime())) return dd;
    }
    return null;
  }

  async function deepScanCollections(scopeTable, onProgress) {
    const summaryRows = findLiabilityRows(scopeTable);
    const result = { total: 0, counted: [], excludedMedical: [] };
    const now = Date.now();
    const TWENTY_FOUR_MONTHS_MS = 1000 * 60 * 60 * 24 * 365.25 * 2;

    for (let i = 0; i < summaryRows.length; i++) {
      const row = summaryRows[i];
      if (onProgress) onProgress(i, summaryRows.length, row.payee || '?');
      // Re-resolve the row by accountNo / payee since the table can
      // rerender between iterations.
      const fresh = findLiabilityRows(scopeTable).find(function (r) {
        if (row.accountNo && r.accountNo === row.accountNo) return true;
        return r.payee === row.payee && r.balance === row.balance;
      });
      const target = fresh || row;
      const wasExpanded = isLiabilityRowExpanded(target.tr);
      if (!wasExpanded) {
        const ok = await toggleLiabilityRow(target.tr, true);
        if (!ok) {
          console.warn('[Collections Scan] could not expand row', target.payee);
          continue;
        }
      }
      // Let React render the form.
      await waitMs(200);
      const panel = findEditPanelFor(target.tr);
      let highestAdverse = '';
      let remarks = '';
      let lateCount = 0;
      let lastDelinq = null;
      if (panel) {
        const adverseSel = readFieldByLabelInPanel(panel, 'Highest adverse rating');
        highestAdverse = getSelectedText(adverseSel);
        const remarksInp = readFieldByLabelInPanel(panel, 'Remarks');
        remarks = (remarksInp && remarksInp.value) || '';
        for (const lbl of ['30 days late count', '60 days late count', '90 days late count']) {
          const inp = readFieldByLabelInPanel(panel, lbl);
          if (inp && inp.value) lateCount += parseInt(inp.value, 10) || 0;
        }
        const delinqInp = readFieldByLabelInPanel(panel, 'Last delinquency date');
        if (delinqInp && delinqInp.value) lastDelinq = parseLooseDate(delinqInp.value);
      }

      const reasons = [];
      if (isCollectionAccount(target.accountType)) {
        reasons.push(target.accountType.toUpperCase() === 'UNKNOWN' ? 'unknown→collection' : 'collection type');
      }
      const adverseU = highestAdverse.toUpperCase();
      if (/CHARGE\s*OFF|REPOSSESSION|FORECLOSURE|JUDGMENT/.test(adverseU)) {
        reasons.push('adverse:' + highestAdverse);
      }
      const remarksU = remarks.toUpperCase();
      if (/CHARGE\s*OFF|CHARGED\s*OFF/.test(remarksU)) {
        reasons.push('remarks:charge-off');
      }
      if (lateCount > 0 && lastDelinq) {
        const ageMs = now - lastDelinq.getTime();
        if (ageMs <= TWENTY_FOUR_MONTHS_MS) {
          reasons.push('late ' + lateCount + 'x in 24mo');
        }
      }

      if (reasons.length) {
        const balance = target.balance || 0;
        if (isMedicalPayee(target.payee)) {
          result.excludedMedical.push({ row: target, reasons: reasons });
        } else {
          result.total += balance;
          result.counted.push({ row: target, reasons: reasons, highestAdverse: highestAdverse, remarks: remarks, lateCount: lateCount });
        }
      }

      if (!wasExpanded) {
        await toggleLiabilityRow(target.tr, false);
        await waitMs(120);
      }
    }

    return result;
  }

  // When a borrower-pair tab's Run Residual Income Calc button is
  // clicked, we set this to that borrower's section root. findLabel /
  // findFieldByLabel use it as the default scope, so getVeteranType /
  // getMaritalStatus / etc. read from the right form. Stays set until
  // a different section's button overrides it. findEmploymentSummaryRows
  // also uses it directly.
  let activeFormScope = null;
  const EXCLUDE_TELECOM_PAYEE_MATCH = 'TELECOM SELFREPORTED';
  const EXCLUDE_TELECOM_REASON_VALUE = 'LessThan10Payments';
  const TRIGGER_VETERAN_TYPES = ['Regular military', 'National Guard or reserves'];

  const STUDENT_LOAN_CALCS = [
    { id: 'FHA', label: 'FHA',              desc: '0.5% of balance',     rate: 0.005 },
    { id: 'DU',  label: 'DU Conventional',  desc: '1% of balance',       rate: 0.01 },
    { id: 'LPA', label: 'LPA Conventional', desc: '0.5% of balance',     rate: 0.005 },
    { id: 'VA',  label: 'VA',               desc: '5% of balance ÷ 12', rate: 0.05 / 12 }
  ];

  // Substring matches against the upper-cased payee name. The matcher
  // (isStudentLoanByName below) walks this list and triggers if any
  // entry is a substring of the payee. Each entry should be specific
  // enough to avoid false positives — e.g. "STUDENT" alone is too
  // greedy, but "STUDENT LOAN" is fine. State higher-ed agencies
  // (Missouri Higher Education, Texas Higher Education, Kentucky
  // Higher Education, etc.) often appear under their full state name
  // — "HIGHER EDUC" is the catch-all that gets all of them.
  const STUDENT_LOAN_KEYWORDS = [
    // Department of Education (multiple format variants)
    'DEPT OF ED', 'DEPT ED', 'DEPARTMENT OF ED', 'USDOE', 'US DEPT',
    // Major federal servicers
    'AIDVANTAGE', 'NELNET', 'MOHELA', 'FEDLOAN', 'EDFINANCIAL',
    'ED FINANCIAL', 'GREAT LAKES', 'SALLIE MAE', 'NAVIENT', 'MAXIMUS',
    'ECSI', 'HEARTLAND', 'DEFAULT RESOLUTION', 'CORNERSTONE',
    // Catch-all phrases — covers most state higher-ed agencies and
    // generic student-loan accounts that include the descriptor.
    'HIGHER EDUC', 'STATE EDUCATION', 'EDUCATION LOAN',
    'EDUCATIONAL FINANCING', 'EDUCATIONAL FUNDING',
    'STUDENT LOAN', 'STUDENT AID', 'STUDENT FINANCIAL',
    // State / regional agencies that don't always say "higher educ"
    'GRANITE STATE', 'OSLA',
    'IOWA STUDENT', 'OKLAHOMA STUDENT', 'MASSACHUSETTS EDUC',
    'NEW YORK STATE HIGHER', 'NEW YORK HESC', 'HESC',
    'PHEAA', 'KHEAA', 'NCSEAA', 'CFNC', 'TGSLC', 'VSAC',
    // Private student-loan lenders
    'DISCOVER STUDENT', 'WELLS FARGO STUDENT', 'CITIZENS STUDENT',
    'SOFI STUDENT', 'EARNEST', 'COMMONBOND', 'COLLEGE AVE',
    'FIRSTMARK', 'CONDUENT', 'ACS EDUCATION', 'ASCENT'
  ];

  const FED_TAX_RATE = 0.15;
  const FICA_RATE = 0.07625;
  const STATE_TAX_RATE = 0.02;
  const MAINT_PER_SQFT = 0.14;
  const DEFAULT_SQFT = 2500;
  const NON_TAXABLE_GROSS_UP_RATE = 0.25;
  const BLEND_VA_GROSSUP_FACTOR = 1.25;

  const VA_REGION_BY_STATE = {
    Northeast: ['CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
    Midwest:   ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
    South:     ['AL', 'AR', 'DE', 'DC', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV', 'PR'],
    West:      ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY', 'GU']
  };

  const VA_TABLE_GT_80K = {
    Northeast: { 1: 450, 2: 755, 3: 909, 4: 1025, 5: 1062 },
    Midwest:   { 1: 441, 2: 738, 3: 889, 4: 1003, 5: 1039 },
    South:     { 1: 441, 2: 738, 3: 889, 4: 1003, 5: 1039 },
    West:      { 1: 491, 2: 823, 3: 990, 4: 1117, 5: 1158 }
  };
  const VA_TABLE_LE_80K = {
    Northeast: { 1: 390, 2: 654, 3: 788, 4: 888,  5: 921 },
    Midwest:   { 1: 382, 2: 641, 3: 772, 4: 868,  5: 902 },
    South:     { 1: 382, 2: 641, 3: 772, 4: 868,  5: 902 },
    West:      { 1: 425, 2: 713, 3: 859, 4: 967,  5: 1004 }
  };

  function regionFor(stateCode) {
    const code = (stateCode || '').toUpperCase();
    for (const [region, list] of Object.entries(VA_REGION_BY_STATE)) {
      if (list.includes(code)) return region;
    }
    return null;
  }

  function vaTableRequirement(familySize, region, loanAmount) {
    if (!region || !familySize) return null;
    const useGt80k = !loanAmount || loanAmount > 80000;
    const table = useGt80k ? VA_TABLE_GT_80K : VA_TABLE_LE_80K;
    const r = table[region];
    if (!r) return null;
    if (familySize <= 5) return r[Math.max(1, Math.min(familySize, 5))];
    return r[5] + (familySize - 5) * 75;
  }

  function parseMoney(s) {
    if (s == null) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').replace(/[*.]/g, '').trim().toLowerCase();
  }

  function findLabel(text, scope) {
    const target = normalizeText(text);
    const root = scope || activeFormScope || document;
    const labels = root.querySelectorAll('label');
    for (const lbl of labels) {
      const t = normalizeText(lbl.textContent);
      if (t === target || t === target + ' *') return lbl;
    }
    for (const lbl of labels) {
      const t = normalizeText(lbl.textContent);
      if (t.startsWith(target + ' ') || t.startsWith(target)) return lbl;
    }
    return null;
  }

  function findFieldByLabel(text, scope) {
    const lbl = findLabel(text, scope);
    if (!lbl) return null;
    if (lbl.htmlFor) {
      const el = document.getElementById(lbl.htmlFor);
      if (el) return el;
    }
    let parent = lbl.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const candidates = parent.querySelectorAll('input, select, textarea');
      for (const c of candidates) {
        if (c.type !== 'hidden') return c;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function findSectionScope(headingText) {
    const target = normalizeText(headingText);
    const candidates = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, section');
    for (const el of candidates) {
      if (normalizeText(el.textContent) === target) {
        let s = el.closest('section') || el.parentElement;
        for (let i = 0; i < 4 && s; i++) {
          if (s.querySelectorAll('input, select').length > 0) return s;
          s = s.parentElement;
        }
      }
    }
    return null;
  }

  function getSelectText(el) {
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      return opt ? opt.text : '';
    }
    return el.value || el.textContent || '';
  }

  function getVeteranType() {
    return getSelectText(findFieldByLabel('Veteran type')).trim();
  }

  function getMaritalStatus() {
    return getSelectText(findFieldByLabel('Marital status')).trim().toLowerCase();
  }

  function getDependentCount() {
    const inp = findFieldByLabel('Dependent ages');
    if (!inp) return 0;
    const v = (inp.value || '').trim();
    if (!v) return 0;
    return v.split(/[,\s]+/).filter(Boolean).length;
  }

  function getPropertyState() {
    const scope = findSectionScope('Subject property') || findSectionScope('Property information');
    let stateInp = null;
    if (scope) stateInp = findFieldByLabel('State', scope);
    if (!stateInp) stateInp = findFieldByLabel('Property state');
    if (stateInp) {
      const v = getSelectText(stateInp).trim();
      const m = v.match(/\b([A-Z]{2})\b/);
      if (m) return m[1];
      return v.toUpperCase().slice(0, 2);
    }
    const headerMatch = (document.body.innerText || '').match(/,\s*([A-Z]{2})\b/);
    return headerMatch ? headerMatch[1] : '';
  }

  function getEmploymentIncome() {
    const scope = findSectionScope('Employment');
    if (!scope) return 0;
    let total = 0;
    const inputs = scope.querySelectorAll('input');
    for (const inp of inputs) {
      const lbl = inp.closest('label') || (inp.id && document.querySelector('label[for="' + CSS.escape(inp.id) + '"]'));
      const labelText = lbl ? normalizeText(lbl.textContent) : '';
      if (/(monthly income|base pay|bonus|commission|overtime|gross monthly|other|tips)/.test(labelText)) {
        total += parseMoney(inp.value);
      }
    }
    return total;
  }

  function getPanelNumber(label) {
    const target = normalizeText(label);
    const els = document.querySelectorAll('div, span, td, th, p, dt, dd, li, label');
    for (const el of els) {
      const t = normalizeText(el.textContent);
      if (!t) continue;
      if (t === target) {
        let sib = el.nextElementSibling;
        while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
        if (sib) {
          const n = parseMoney(sib.textContent);
          if (n) return n;
        }
        const parent = el.parentElement;
        if (parent) {
          const txt = parent.textContent.replace(el.textContent, '');
          const n = parseMoney(txt);
          if (n) return n;
        }
      }
    }
    for (const el of els) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const t = normalizeText(raw);
      if (t === target) continue;
      if (t.startsWith(target) && raw.length < label.length + 40) {
        const rest = raw.slice(raw.toLowerCase().indexOf(target) + target.length);
        const n = parseMoney(rest);
        if (n) return n;
      }
    }
    return 0;
  }

  function readOtherIncomeRows() {
    const rows = [];
    const tables = document.querySelectorAll('table[aria-label="Table for other incomes"]');
    for (const table of tables) {
      const headers = table.querySelectorAll('thead th');
      let srcCol = -1, moCol = -1;
      headers.forEach(function (th, i) {
        const t = normalizeText(th.textContent);
        if (t === 'income source') srcCol = i;
        if (t === 'income / mo' || t === 'income/mo') moCol = i;
      });
      if (srcCol < 0 || moCol < 0) continue;
      const trs = table.querySelectorAll('tbody > tr');
      for (const tr of trs) {
        const cells = tr.children;
        if (cells.length <= moCol) continue;
        const sourceText = (cells[srcCol] && cells[srcCol].textContent || '').trim();
        if (!sourceText) continue;
        const monthly = parseMoney(cells[moCol] && cells[moCol].textContent);
        rows.push({ source: sourceText, monthly: monthly });
      }
    }
    return rows;
  }

  function isVACompensationSource(source) {
    return /va\s*(compensation|disability)/i.test(source || '');
  }

  function getDisplayedVACompensation() {
    let total = 0;
    for (const row of readOtherIncomeRows()) {
      if (isVACompensationSource(row.source)) total += row.monthly;
    }
    return total;
  }

  function detectVACompensation() {
    return getDisplayedVACompensation() / BLEND_VA_GROSSUP_FACTOR;
  }

  function detectMilitaryEntitlements() {
    let total = 0;
    const scope = activeFormScope || document;
    // Try the historical name-based selector first (works on older LOP
    // DOMs that named the input militaryEntitlements.amount).
    const namedInputs = scope.querySelectorAll(
      'input[name="militaryEntitlements.amount"], ' +
      'input[name="militaryEntitlements"], ' +
      'input[name*="militaryEntitlement" i], ' +
      'input[name*="MilitaryEntitlement" i]'
    );
    for (const inp of namedInputs) {
      const amount = parseMoney(inp.value);
      if (!amount) continue;
      const row = inp.closest('tr') || inp.closest('[role="row"]') || inp.parentElement;
      let freq = 'Monthly';
      if (row) {
        const sel = row.querySelector('select[name*="frequency" i]');
        if (sel && sel.value) freq = sel.value;
      }
      total += /annual/i.test(freq) ? amount / 12 : amount;
    }
    if (total > 0) return total / BLEND_VA_GROSSUP_FACTOR;

    // Fallback: label-text driven detection. The current LOP Employment
    // Edit panel lists income types ("Base", "Overtime", "Bonus",
    // "Commission", "Military Entitlements", "Other") as left-cell
    // labels with adjacent input + frequency select cells. Find any cell
    // whose text is exactly "Military Entitlements" and read the
    // amount/frequency from its row.
    const cells = scope.querySelectorAll('td, div, span, label');
    const seenRows = new WeakSet();
    for (const el of cells) {
      if (normalizeText(el.textContent) !== 'military entitlements') continue;
      // Walk up to a row container that also contains an input.
      let row = el.parentElement;
      let inp = null;
      for (let i = 0; i < 6 && row; i++) {
        inp = row.querySelector('input[type="text"], input:not([type])');
        if (inp) break;
        row = row.parentElement;
      }
      if (!inp || !row || seenRows.has(row)) continue;
      seenRows.add(row);
      const amount = parseMoney(inp.value);
      if (!amount) continue;
      const sel = row.querySelector('select');
      let freq = 'Monthly';
      if (sel) {
        const opt = sel.options[sel.selectedIndex];
        freq = (opt && (opt.text || opt.value)) || sel.value || 'Monthly';
      }
      total += /annual/i.test(freq) ? amount / 12 : amount;
    }
    return total / BLEND_VA_GROSSUP_FACTOR;
  }

  function detectNonTaxableIncome() {
    return detectVACompensation() + detectMilitaryEntitlements();
  }

  function getOtherIncomeTotal() {
    let total = 0;
    for (const row of readOtherIncomeRows()) {
      total += row.monthly;
    }
    return total;
  }

  function getGrossMonthlyIncome() {
    const panel = getPanelNumber('Monthly income');
    if (panel > 0) return panel;
    return getEmploymentIncome() + getOtherIncomeTotal();
  }

  function getMonthlyDebts() {
    return getPanelNumber('Monthly liabilities') || getPanelNumber('Monthly debts');
  }

  function getProposedPITI() {
    return getPanelNumber('Monthly PITI') || getPanelNumber('PITI');
  }

  function getDTI() {
    const target = 'dti';
    const els = document.querySelectorAll('div, span, td, th, p, dt, dd, li, label');
    for (const el of els) {
      const t = normalizeText(el.textContent);
      if (t !== target) continue;
      const sources = [];
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib) sources.push(sib.textContent);
      if (el.parentElement) {
        sources.push(el.parentElement.textContent.replace(el.textContent, ''));
      }
      for (const txt of sources) {
        const matches = txt.match(/(\d+(?:\.\d+)?)\s*%/g);
        if (matches && matches.length) {
          const nums = matches.map(function (m) { return parseFloat(m); });
          return Math.max.apply(null, nums);
        }
      }
    }
    return null;
  }

  function getLoanAmount() {
    return getPanelNumber('Total loan amt')
      || getPanelNumber('Base loan amt')
      || getPanelNumber('Total loan amount')
      || getPanelNumber('Base loan amount')
      || getPanelNumber('Loan amount')
      || getPanelNumber('Loan amt')
      || 0;
  }

  function readPageInputs() {
    const grossIncome = getGrossMonthlyIncome();
    const nonTaxableIncome = detectNonTaxableIncome();
    const monthlyDebts = getMonthlyDebts();
    const piti = getProposedPITI();
    const married = /^(married|separated)$/.test(getMaritalStatus());
    const familySize = 1 + (married ? 1 : 0) + getDependentCount();
    const state = getPropertyState();
    const region = regionFor(state);
    const loanAmount = getLoanAmount();
    const dti = getDTI();
    return {
      grossIncome,
      nonTaxableIncome,
      monthlyDebts,
      piti,
      maintenance: MAINT_PER_SQFT * DEFAULT_SQFT,
      childcare: 0,
      familySize,
      state,
      region,
      loanAmount,
      dti
    };
  }

  function calculate(state) {
    const gross = state.grossIncome || 0;
    const taxableIncome = Math.max(0, gross - (state.nonTaxableIncome || 0));
    const fedTax = taxableIncome * FED_TAX_RATE;
    const fica = taxableIncome * FICA_RATE;
    const stateTax = taxableIncome * STATE_TAX_RATE;
    const monthlyDebts = state.monthlyDebts || 0;
    const piti = state.piti || 0;
    const maintenance = state.maintenance || 0;
    const childcare = state.childcare || 0;
    const totalDeductions = fedTax + fica + stateTax + monthlyDebts + piti + maintenance + childcare;
    const residual = gross - totalDeductions;
    const requirement = vaTableRequirement(state.familySize, state.region, state.loanAmount);
    const dtiOver41 = state.dti != null && state.dti > 41;
    const requirement120 = requirement != null ? Math.round(requirement * 1.2 * 100) / 100 : null;
    return {
      taxableIncome,
      federalTax: fedTax,
      fica,
      stateTax,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      residualIncome: Math.round(residual * 100) / 100,
      requirement,
      requirement120,
      dtiOver41
    };
  }

  function setReactInputValue(input, value) {
    // The Constellation form library only marks the form dirty (and
    // enables Save) on *trusted* user-input events. Programmatic events
    // dispatched by us are isTrusted=false and get ignored, even though
    // the value visibly changes. document.execCommand('insertText', …)
    // routes through the browser's input pipeline, which produces
    // trusted events — same as if the user typed.
    let viaExec = false;
    try {
      input.focus();
      // Select existing content so insertText replaces it.
      try { input.setSelectionRange(0, (input.value || '').length); }
      catch (_) { try { input.select(); } catch (__) {} }
      viaExec = document.execCommand && document.execCommand('insertText', false, String(value));
    } catch (_) { viaExec = false; }

    if (!viaExec || String(input.value) !== String(value)) {
      // Fallback: native setter + synthetic events.
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // change + blur commits the field in most form libraries.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fmt(n) {
    n = (n == null || isNaN(n)) ? 0 : n;
    return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getPageFontFamily() {
    const candidates = ['label', 'input', 'select', 'button', 'h2', 'h3', 'p'];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const ff = getComputedStyle(el).fontFamily;
      if (ff) return ff;
    }
    return getComputedStyle(document.body).fontFamily || '';
  }

  function findSaveButton() {
    const btn = document.querySelector('button[data-cy="save-loan-file-button"]');
    if (!btn) return null;
    if (btn.disabled) return null;
    if (btn.getAttribute('aria-disabled') === 'true') return null;
    return btn;
  }

  async function autoClickSave() {
    // Give the form library a moment to register the dirty state and
    // re-enable the Save button after our setReactInputValue calls.
    await waitMs(300);
    for (let elapsed = 0; elapsed < 4000; elapsed += 100) {
      const btn = findSaveButton();
      if (btn) {
        try { btn.click(); } catch (_) { simulateClick(btn); }
        console.log('[Residual Income Calc] auto-clicked Save');
        return true;
      }
      await waitMs(100);
    }
    console.warn('[Residual Income Calc] Save button did not become enabled within 4s — values were filled but not auto-saved.');
    return false;
  }

  function track(event, props) {
    try { chrome.runtime.sendMessage({ type: 'TRACK', event, props: props || {} }); } catch (_) {}
  }

  async function applyResults(state, result) {
    const residualField = findFieldByLabel('VA residual income');
    const deductionsField = findFieldByLabel('VA total deductions');
    // Write order matters in this LOP form. Writing residual first
    // triggers a React re-render that recomputes deductions toward 0
    // before our deductions write lands; the subsequent save then
    // POSTs deductions=0. Writing deductions FIRST, then explicitly
    // blurring so React commits the field as its own render (rather
    // than batching both writes into one), then a 250ms settle before
    // residual, keeps both values alive through the save round-trip.
    // Confirmed via 6-second polling in v1.10.12 — deductions stays
    // populated. Don't reorder without re-verifying.
    if (deductionsField && result.totalDeductions != null) {
      setReactInputValue(deductionsField, result.totalDeductions.toFixed(2));
      try { deductionsField.blur(); } catch (_) {}
      await waitMs(250);
    }
    if (residualField) {
      setReactInputValue(residualField, result.residualIncome.toFixed(2));
      try { residualField.blur(); } catch (_) {}
      await waitMs(250);
    }
    track('va_calc_apply');
    // Fire and forget — don't block panel rendering on the save round-trip.
    autoClickSave();
  }

  function showPanel(initialState) {
    track('va_calc_open');
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const state = Object.assign({}, initialState);
    const fontFamily = getPageFontFamily();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'rric-panel';
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';
    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'rric-panel-footer';
    const note = document.createElement('div');
    note.className = 'rric-panel-note';
    note.innerHTML =
      '<strong>Note:</strong> VA residual income must be at least 120% of the table ' +
      'requirement when borrower DTI is over 41%. Edit the highlighted fields, then re-run.';
    const rerun = document.createElement('button');
    rerun.type = 'button';
    rerun.className = 'rric-button rric-rerun';
    rerun.textContent = 'Re-run';
    footer.appendChild(note);
    footer.appendChild(rerun);
    panel.appendChild(footer);

    document.body.appendChild(panel);

    function addRow(label, valueText, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'rric-row'
        + (opts.divider ? ' rric-divider' : '')
        + (opts.emphasis ? ' rric-emphasis' : '')
        + (opts.muted ? ' rric-muted' : '');
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      val.textContent = valueText;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
      return row;
    }

    function addEditableRow(label, value, suffix, onChange) {
      const row = document.createElement('div');
      row.className = 'rric-row rric-editable';
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      const wrap = document.createElement('span');
      wrap.className = 'rric-input-wrap';
      const dollar = document.createElement('span');
      dollar.className = 'rric-input-prefix';
      dollar.textContent = '$';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'rric-input';
      input.value = (Math.round((value || 0) * 100) / 100).toFixed(2);
      input.addEventListener('input', function () { onChange(parseMoney(input.value)); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); rerun.click(); }
      });
      wrap.appendChild(dollar);
      wrap.appendChild(input);
      val.appendChild(wrap);
      if (suffix) {
        const sfx = document.createElement('div');
        sfx.className = 'rric-suffix';
        sfx.textContent = suffix;
        val.appendChild(sfx);
      }
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    }

    function renderBody() {
      body.innerHTML = '';
      const result = calculate(state);
      title.textContent = 'Residual income: ' + fmt(result.residualIncome);

      addRow('Gross monthly income', fmt(state.grossIncome));
      addEditableRow('Non-Taxable Income (VA Disability, BAH, BAS, etc.)', state.nonTaxableIncome, 'Excluded from taxes', function (v) {
        state.nonTaxableIncome = v;
      });
      addRow('Taxable income', fmt(result.taxableIncome), { divider: true });
      addRow('− Federal tax (15%)', '−' + fmt(result.federalTax));
      addRow('− SS / Medicare (7.625%)', '−' + fmt(result.fica));
      addRow('− State tax (2%)', '−' + fmt(result.stateTax));
      addRow('− Monthly debts', '−' + fmt(state.monthlyDebts));
      addRow('− Proposed PITI', '−' + fmt(state.piti));
      addEditableRow('− Maintenance & utilities', state.maintenance, '2,500 sq ft × $0.14 default', function (v) {
        state.maintenance = v;
      });
      addEditableRow('− Childcare / daycare', state.childcare, 'Defaults to $0', function (v) {
        state.childcare = v;
      });
      addRow('= Residual income', fmt(result.residualIncome), { divider: true, emphasis: true });

      addRow('Family size', String(state.familySize), { divider: true });
      addRow('Property state', state.state || '—');
      addRow('VA region', state.region || '—');
      const loanLabel = state.loanAmount ? fmt(state.loanAmount) : 'Unknown — assuming > $80k';
      addRow('Loan amount', loanLabel);
      if (state.dti != null) {
        addRow('DTI', state.dti.toFixed(2) + '%');
      }
      addRow('VA table requirement', result.requirement != null ? fmt(result.requirement) : '—', { emphasis: true });
      if (result.dtiOver41 && result.requirement120 != null) {
        addRow('Required at 120% (DTI > 41%)', fmt(result.requirement120), { emphasis: true });
      }

      applyResults(state, result);
    }

    rerun.addEventListener('click', renderBody);
    renderBody();
  }

  function findEmploymentSummaryRows() {
    const rows = [];
    const root = activeFormScope || document;
    const tables = root.querySelectorAll('table[aria-label="Table for employments"]');
    for (const table of tables) {
      for (const tr of table.querySelectorAll('tbody > tr')) {
        if (tr.children.length < 8) continue;
        const firstCell = tr.children[0];
        if (!firstCell) continue;
        if (!firstCell.querySelector('svg')) continue;
        rows.push(tr);
      }
    }
    return rows;
  }

  function isEmploymentRowExpanded(summaryRow) {
    const next = summaryRow.nextElementSibling;
    return !!(next && next.querySelector('td[colspan]'));
  }

  function simulateClick(el) {
    if (!el) return;
    let rect;
    try { rect = el.getBoundingClientRect(); }
    catch (_) { rect = { left: 0, top: 0, width: 0, height: 0 }; }
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const mouseOpts = {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: cx, clientY: cy
    };
    const pointerOpts = Object.assign({}, mouseOpts, {
      pointerType: 'mouse', isPrimary: true, pointerId: 1, buttons: 1
    });
    function fire(name, Cls, opts) {
      try { el.dispatchEvent(new Cls(name, opts)); return; }
      catch (_) { /* fall through */ }
      try { el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); }
      catch (__) { /* give up on this event */ }
    }
    const hasPointer = typeof PointerEvent !== 'undefined';
    if (hasPointer) fire('pointerover', PointerEvent, pointerOpts);
    if (hasPointer) fire('pointerdown', PointerEvent, pointerOpts);
    fire('mousedown', MouseEvent, mouseOpts);
    if (hasPointer) fire('pointerup', PointerEvent, pointerOpts);
    fire('mouseup', MouseEvent, mouseOpts);
    fire('click', MouseEvent, mouseOpts);
  }

  function waitMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function clickAndWaitFor(target, predicate, maxMs) {
    simulateClick(target);
    const step = 25;
    const max = maxMs || 500;
    for (let elapsed = 0; elapsed < max; elapsed += step) {
      await waitMs(step);
      if (predicate()) return true;
    }
    return false;
  }

  async function toggleEmploymentRow(summaryRow, wantExpanded) {
    const predicate = wantExpanded
      ? function () { return isEmploymentRowExpanded(summaryRow); }
      : function () { return !isEmploymentRowExpanded(summaryRow); };
    if (predicate()) return true;
    const firstCell = summaryRow.children[0];
    const svg = firstCell ? firstCell.querySelector('svg') : null;
    const targets = [svg, firstCell, summaryRow].filter(Boolean);
    for (const target of targets) {
      if (await clickAndWaitFor(target, predicate)) return true;
    }
    return false;
  }

  function runCalculator() {
    runCalcAsync().catch(function (e) {
      console.error('[Residual Income Calc] error', e);
      alert('Calculator error: ' + e.message);
    });
  }

  async function runCalcAsync() {
    const summaryRows = findEmploymentSummaryRows();
    const expandedByUs = [];
    for (const row of summaryRows) {
      if (!isEmploymentRowExpanded(row)) {
        if (await toggleEmploymentRow(row, true)) expandedByUs.push(row);
      }
    }

    let initialState;
    try {
      initialState = readPageInputs();
    } finally {
      for (const row of expandedByUs) {
        await toggleEmploymentRow(row, false);
      }
    }

    if (!initialState || !initialState.grossIncome) {
      alert('Could not read gross monthly income from the Employment section or sidebar.');
      return;
    }
    showPanel(initialState);
  }

  // Find every visible "Military service completed" anchor on the
  // page. Each borrower-pair tab has its own — we treat each as a
  // separate section so the button injection and the calc both scope
  // to the right borrower's form when multiple tabs are mounted.
  function findMilitarySections() {
    const out = [];
    const seen = new WeakSet();
    document.querySelectorAll('input[type="checkbox"][name="completed"]').forEach(function (input) {
      const label = input.id ? document.querySelector('label[for="' + CSS.escape(input.id) + '"]') : null;
      if (!label) return;
      if (normalizeText(label.textContent) !== 'military service completed') return;
      if (input.offsetParent === null) return;
      // Step 1: find the Military Information section by walking up
      // until we hit an ancestor containing a select[name="veteranType"].
      // That section is where the trigger-type check reads from.
      let milSection = input.parentElement;
      let vtSelect = null;
      while (milSection && milSection !== document.body) {
        vtSelect = milSection.querySelector('select[name="veteranType"]');
        if (vtSelect) break;
        milSection = milSection.parentElement;
      }
      if (!vtSelect) return;
      // Step 2: walk further to find the BORROWER tab's form root —
      // an ancestor that contains both veteranType AND an Employment
      // table. Military Entitlements lives in the Employment Edit
      // panel, NOT inside the Military Information section, so the
      // narrow Military section is too small to scope the calc to.
      // The wider form root contains both, and gives us a clean
      // boundary between borrower-pair tabs.
      let formScope = milSection;
      let walker = milSection;
      while (walker && walker !== document.body) {
        if (walker.querySelector('table[aria-label="Table for employments"]')) {
          formScope = walker;
          break;
        }
        walker = walker.parentElement;
      }
      if (seen.has(formScope)) return;
      seen.add(formScope);
      // Anchor for button placement: the row container holding the
      // "Military service completed" checkbox + label, inside the
      // Military Information section (where we want the button to
      // appear visually, not at the wider form root).
      let anchor = input.parentElement;
      for (let i = 0; i < 4 && anchor; i++) {
        if (anchor.children.length > 1 || anchor.offsetWidth > 200) break;
        anchor = anchor.parentElement;
      }
      out.push({ scope: formScope, anchor: anchor || input.parentElement, vtSelect: vtSelect });
    });
    return out;
  }

  function findMilitaryCompletedRow() {
    // Legacy single-anchor finder — still referenced elsewhere if any.
    const sections = findMilitarySections();
    return sections[0] && sections[0].anchor;
  }

  function ensureButtonState() {
    const sections = findMilitarySections();
    for (const sec of sections) {
      const vt = sec.vtSelect;
      const veteranTypeText = (vt.options[vt.selectedIndex] && vt.options[vt.selectedIndex].text) || '';
      const shouldShow = TRIGGER_VETERAN_TYPES.some(function (t) {
        return normalizeText(veteranTypeText) === normalizeText(t);
      });
      const existing = sec.scope.querySelector('.' + BUTTON_CLASS);
      if (!shouldShow) {
        if (existing) existing.remove();
        continue;
      }
      if (existing) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rric-button ' + BUTTON_CLASS;
      btn.textContent = 'Run Residual Income Calc';
      const scope = sec.scope;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        activeFormScope = scope;
        runCalculator();
      });
      sec.anchor.appendChild(btn);
      console.log('[Residual Income Calc] button injected into scope', scope);
    }
  }

  // Returns every visible Liabilities section. Anchored on the table
  // itself (table[aria-label="Table for liabilities"]) — every
  // borrower-pair tab has exactly one, and walking from the table to
  // its parent.parentElement finds the section wrapper that also
  // contains the header row with the "+ Add liability" button.
  // Anchoring on the addBtn directly is unsafe because Assets, Gifts,
  // and Real estate sections each have their own add-entity-button,
  // and walking up from those would falsely pick up the nearby
  // Liabilities table.
  function findLiabilitiesHeaders() {
    const out = [];
    document.querySelectorAll('table[aria-label="Table for liabilities"]').forEach(function (table) {
      if (table.offsetParent === null) return;
      // The DOM observed:
      //   [data-cy="liabilities-section"]
      //     Flex (header)        ← contains <h5> and the addBtn
      //       <h5>Liabilities</h5>
      //       button[data-cy="add-entity-button"]
      //     table[aria-label="Table for liabilities"]
      // The table's parent is the section; the addBtn is in a sibling
      // (the Flex header row).
      const section = table.parentElement;
      if (!section) return;
      const addBtn = section.querySelector('button[data-cy="add-entity-button"]');
      if (!addBtn) return;
      const container = addBtn.parentElement;
      if (!container || container.offsetParent === null) return;
      out.push({ container: container, addBtn: addBtn, table: table });
    });
    return out;
  }

  function ensureStudentLoanButton() {
    const sections = findLiabilitiesHeaders();
    if (!sections.length) return;
    for (const sec of sections) {
      if (sec.container.querySelector('.' + STUDENT_LOAN_BUTTON_CLASS)) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rric-button ' + STUDENT_LOAN_BUTTON_CLASS;
      btn.textContent = 'Calc Student Loans';
      const scopedTable = sec.table;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showStudentLoanPicker(scopedTable);
      });
      sec.container.insertBefore(btn, sec.addBtn);
      console.log('[Calc Student Loans] button injected into section', sec.container);
    }
  }

  // "Exclude SelfReport" — finds every liability whose Company/Payee is
  // "TELECOM SELFREPORTED", expands the row, ticks Exclude, sets the
  // Reason dropdown to "Installment debt less than 10 payments", saves,
  // and moves to the next match. Logs every step to the console.
  function ensureExcludeTelecomButton() {
    const sections = findLiabilitiesHeaders();
    if (!sections.length) return;
    for (const sec of sections) {
      if (sec.container.querySelector('.' + EXCLUDE_TELECOM_BUTTON_CLASS)) continue;
      const sloanBtn = sec.container.querySelector('.' + STUDENT_LOAN_BUTTON_CLASS);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rric-button ' + EXCLUDE_TELECOM_BUTTON_CLASS;
      btn.textContent = 'Exclude SelfReport';
      btn.title = 'Mark every TELECOM SELFREPORTED liability as Excluded with reason "Installment debt less than 10 payments".';
      const scopedTable = sec.table;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        excludeTelecomSelfReportedAll(btn, scopedTable);
      });
      // Wrap Calc Student Loans + Exclude SelfReport in a single flex
      // group so the parent's flex spacing doesn't push them apart.
      if (sloanBtn) {
        let group = sloanBtn.parentElement;
        const isOurGroup = group && group.classList && group.classList.contains('rric-button-group');
        if (!isOurGroup) {
          group = document.createElement('div');
          group.className = 'rric-button-group';
          group.style.cssText = 'display:inline-flex;gap:8px;align-items:center;';
          sloanBtn.parentNode.insertBefore(group, sloanBtn);
          group.appendChild(sloanBtn);
        }
        group.appendChild(btn);
      } else {
        sec.container.insertBefore(btn, sec.addBtn);
      }
      console.log('[Exclude SelfReport] button injected into section', sec.container);
    }
  }

  // React/styled-components controlled checkbox: setting .checked +
  // dispatching change doesn't always commit because the React state is
  // the source of truth. The reliable path is to fire a real click on
  // the linked <label> (the browser handles the toggle natively, which
  // React picks up through its onChange synthetic). Falls back to the
  // input itself.
  function setReactCheckbox(input, wantChecked) {
    if (!input) return false;
    if (!!input.checked === !!wantChecked) return true;
    const label = input.id ? document.querySelector('label[for="' + CSS.escape(input.id) + '"]') : null;
    const target = label || input;
    console.log('[Exclude SelfReport]   clicking checkbox via', label ? '<label>' : '<input>', target);
    try { target.click(); }
    catch (_) { simulateClick(target); }
    return !!input.checked === !!wantChecked;
  }

  // React-controlled <select>. Mirrors setReactInputValue: use the
  // native value setter on the prototype, then fire input + change so
  // React's onChange runs.
  function setReactSelectValue(select, value) {
    if (!select) return false;
    if (String(select.value) === String(value)) {
      console.log('[Exclude SelfReport]   reason already set to', value);
      return true;
    }
    const proto = Object.getPrototypeOf(select);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    try {
      if (desc && desc.set) desc.set.call(select, value);
      else select.value = value;
    } catch (e) {
      console.warn('[Exclude SelfReport]   native select setter failed:', e);
      select.value = value;
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));
    const ok = String(select.value) === String(value);
    console.log('[Exclude SelfReport]   set reason →', value, ok ? '(ok)' : '(value did not stick: got "' + select.value + '")');
    return ok;
  }

  // Find the "Edit liability" panel that opened beneath the expanded
  // row. The row's nextElementSibling is the expansion <tr> with a
  // single td[colspan] containing the form.
  function findEditPanelFor(summaryRow) {
    const next = summaryRow && summaryRow.nextElementSibling;
    if (!next) return null;
    const panel = next.querySelector('td[colspan]');
    return panel || next;
  }

  async function waitForElement(root, selector, maxMs) {
    const step = 50;
    const max = maxMs || 1500;
    for (let elapsed = 0; elapsed < max; elapsed += step) {
      const el = root.querySelector(selector);
      if (el) return el;
      await waitMs(step);
    }
    return null;
  }

  async function excludeOneRow(row, index, total) {
    const tag = '[Exclude SelfReport][' + (index + 1) + '/' + total + ']';
    console.group(tag + ' processing row: payee="' + row.payee + '" balance=' + row.balance + ' payment=' + row.payment);
    const startedExpanded = isLiabilityRowExpanded(row.tr);
    console.log(tag, 'row started expanded?', startedExpanded);
    if (!startedExpanded) {
      const ok = await toggleLiabilityRow(row.tr, true);
      console.log(tag, 'expand attempt:', ok ? 'ok' : 'failed');
      if (!ok) { console.groupEnd(); return { ok: false, reason: 'failed to expand' }; }
    }
    const panel = findEditPanelFor(row.tr);
    if (!panel) { console.warn(tag, 'edit panel not found'); console.groupEnd(); return { ok: false, reason: 'panel not found' }; }
    console.log(tag, 'panel located');

    const checkbox = await waitForElement(panel, 'input[name="exclude"][type="checkbox"]');
    if (!checkbox) { console.warn(tag, 'Exclude checkbox not found'); console.groupEnd(); return { ok: false, reason: 'no checkbox' }; }
    console.log(tag, 'checkbox found, currently checked?', checkbox.checked);
    if (!checkbox.checked) {
      const checkedOk = setReactCheckbox(checkbox, true);
      console.log(tag, 'checked Exclude →', checkedOk);
      // Give React a tick to re-render so the Reason field appears.
      await waitMs(150);
    } else {
      console.log(tag, 'Exclude already on — leaving as-is');
    }

    const select = await waitForElement(panel, 'select[name="reason"]');
    if (!select) { console.warn(tag, 'Reason select not found after enabling Exclude'); console.groupEnd(); return { ok: false, reason: 'no select' }; }
    const optionMatch = Array.from(select.options).some(function (o) { return o.value === EXCLUDE_TELECOM_REASON_VALUE; });
    if (!optionMatch) {
      console.warn(tag, 'expected reason option "' + EXCLUDE_TELECOM_REASON_VALUE + '" not in <select>. Options:',
        Array.from(select.options).map(function (o) { return o.value + ':' + o.textContent; }));
      console.groupEnd();
      return { ok: false, reason: 'reason option missing' };
    }
    const setOk = setReactSelectValue(select, EXCLUDE_TELECOM_REASON_VALUE);
    if (!setOk) { console.groupEnd(); return { ok: false, reason: 'select value did not stick' }; }

    // Save. Prefer a Save button INSIDE this panel (avoids accidentally
    // hitting the top-level "Save loan file" button if one is present).
    const saveInPanel = panel.querySelector('button[type="submit"], button[data-cy*="save" i], button');
    let saveCandidates = Array.from(panel.querySelectorAll('button'));
    saveCandidates = saveCandidates.filter(function (b) {
      const t = (b.textContent || '').trim();
      return /^save$/i.test(t) && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    });
    const saveBtn = saveCandidates[0] || null;
    if (!saveBtn) {
      console.warn(tag, 'Save button not found inside panel. Candidates examined:', panel.querySelectorAll('button').length);
      console.groupEnd();
      return { ok: false, reason: 'no save button' };
    }
    console.log(tag, 'clicking panel Save', saveBtn);
    try { saveBtn.click(); } catch (_) { simulateClick(saveBtn); }
    // Wait until the row collapses (which Gmail's LOP does after save).
    const collapsed = await clickAndWaitFor(saveBtn, function () { return !isLiabilityRowExpanded(row.tr); }, 3000);
    console.log(tag, collapsed ? 'row collapsed after save — done' : 'row did not collapse within 3s (may still have saved)');
    console.groupEnd();
    return { ok: true };
  }

  async function excludeTelecomSelfReportedAll(button, scopeTable) {
    const origText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Working…'; }
    console.group('[Exclude SelfReport] run started');
    try {
      const allRows = findLiabilityRows(scopeTable);
      console.log('[Exclude SelfReport] total liability rows on page:', allRows.length);
      const matches = allRows.filter(function (r) {
        return (r.payee || '').toUpperCase().indexOf(EXCLUDE_TELECOM_PAYEE_MATCH) !== -1;
      });
      console.log('[Exclude SelfReport] matching "' + EXCLUDE_TELECOM_PAYEE_MATCH + '" payee:', matches.length,
        matches.map(function (m) { return m.payee + ' / ' + m.accountNo; }));
      if (!matches.length) {
        alert('No "TELECOM SELFREPORTED" liabilities found on this page.');
        return;
      }
      let okCount = 0;
      let failCount = 0;
      // Re-query between iterations because the DOM rerenders after save.
      for (let i = 0; i < matches.length; i++) {
        // Resolve the current row by accountNo first (stable identifier),
        // then by payee+balance as a fallback for rows without an
        // account number.
        const target = matches[i];
        const fresh = findLiabilityRows(scopeTable);
        const m = fresh.find(function (r) {
          if (target.accountNo && r.accountNo === target.accountNo) return true;
          return r.payee === target.payee && r.balance === target.balance && r.paymentText === target.paymentText;
        });
        if (!m) {
          console.warn('[Exclude SelfReport][' + (i + 1) + '/' + matches.length + '] row vanished from DOM; skipping');
          failCount++;
          continue;
        }
        const result = await excludeOneRow(m, i, matches.length);
        if (result.ok) okCount++; else failCount++;
        // Settle between rows so React finishes the rerender.
        await waitMs(250);
      }
      console.log('[Exclude SelfReport] done. ok=' + okCount + ' failed=' + failCount);
      track('exclude_telecom_selfreport', { matched: matches.length, ok: okCount, failed: failCount });
      if (failCount === 0) {
        alert('Excluded ' + okCount + ' TELECOM SELFREPORTED liabilit' + (okCount === 1 ? 'y' : 'ies') + '.');
      } else {
        alert('Excluded ' + okCount + ' of ' + matches.length + '. ' + failCount + ' failed — see console for details.');
      }
    } catch (e) {
      console.error('[Exclude SelfReport] run failed:', e);
      alert('Exclude SelfReport hit an error: ' + (e && e.message || e));
    } finally {
      console.groupEnd();
      if (button) { button.disabled = false; button.textContent = origText; }
    }
  }

  function textOf(el) { return el ? (el.textContent || '').trim() : ''; }

  function findLiabilityRows(scopeTable) {
    const rows = [];
    const tables = scopeTable
      ? [scopeTable]
      : document.querySelectorAll('table[aria-label="Table for liabilities"]');
    for (const table of tables) {
      const headers = table.querySelectorAll('thead th');
      const cols = {};
      headers.forEach(function (th, i) {
        const t = normalizeText(th.textContent);
        if (t === 'borrower(s)' || t === 'borrowers') cols.borrower = i;
        else if (t === 'account type') cols.accountType = i;
        else if (t === 'company/payee' || t === 'company / payee') cols.payee = i;
        else if (t === 'account no') cols.accountNo = i;
        else if (t === 'unpaid balance') cols.balance = i;
        else if (t === 'mo payment' || t === 'monthly payment') cols.payment = i;
      });
      for (const tr of table.querySelectorAll('tbody > tr')) {
        if (tr.children.length < 6) continue;
        const firstCell = tr.children[0];
        if (!firstCell || !firstCell.querySelector('svg')) continue;
        rows.push({
          tr: tr,
          borrower: textOf(tr.children[cols.borrower]),
          accountType: textOf(tr.children[cols.accountType]),
          payee: textOf(tr.children[cols.payee]),
          accountNo: textOf(tr.children[cols.accountNo]),
          balance: parseMoney(textOf(tr.children[cols.balance])),
          paymentText: textOf(tr.children[cols.payment]),
          payment: parseMoney(textOf(tr.children[cols.payment]))
        });
      }
    }
    return rows;
  }

  function isStudentLoanByName(payee) {
    const upper = (payee || '').toUpperCase();
    return STUDENT_LOAN_KEYWORDS.some(function (k) { return upper.indexOf(k) !== -1; });
  }

  function getLoanId() {
    const fromUrl = (location.pathname || '').match(/(ZG\d{8,})/i);
    if (fromUrl) return fromUrl[1].toUpperCase();
    const fromHash = (location.hash || '').match(/(ZG\d{8,})/i);
    if (fromHash) return fromHash[1].toUpperCase();
    const bodyText = document.body && document.body.innerText || '';
    const fromBody = bodyText.match(/#?(ZG\d{8,})/i);
    if (fromBody) return fromBody[1].toUpperCase();
    return 'unknown-' + (location.pathname || '').replace(/[^a-z0-9]/gi, '-').slice(-40);
  }

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getOurPayments(loanId) {
    if (!hasChromeStorage()) return Promise.resolve({});
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['rric_ourPayments'], function (data) {
          const all = (data && data.rric_ourPayments) || {};
          resolve(all[loanId] || {});
        });
      } catch (_) { resolve({}); }
    });
  }

  function setOurPayment(loanId, accountKey, info) {
    if (!hasChromeStorage()) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['rric_ourPayments'], function (data) {
          const all = (data && data.rric_ourPayments) || {};
          if (!all[loanId]) all[loanId] = {};
          all[loanId][accountKey] = info;
          chrome.storage.local.set({ rric_ourPayments: all }, function () { resolve(); });
        });
      } catch (_) { resolve(); }
    });
  }

  function liabilityKey(lib) {
    if (lib.accountNo) return lib.accountNo.trim();
    return 'payee:' + (lib.payee || '').trim() + '|bal:' + (lib.balance || 0);
  }

  function isLiabilityRowExpanded(summaryRow) {
    const next = summaryRow.nextElementSibling;
    return !!(next && next.querySelector('td[colspan]'));
  }

  async function toggleLiabilityRow(summaryRow, wantExpanded) {
    const predicate = wantExpanded
      ? function () { return isLiabilityRowExpanded(summaryRow); }
      : function () { return !isLiabilityRowExpanded(summaryRow); };
    if (predicate()) return true;
    const firstCell = summaryRow.children[0];
    const svg = firstCell ? firstCell.querySelector('svg') : null;
    const targets = [svg, firstCell, summaryRow].filter(Boolean);
    for (const target of targets) {
      if (await clickAndWaitFor(target, predicate)) return true;
    }
    return false;
  }

  function showStudentLoanPicker(scopeTable) {
    const existing = document.getElementById(STUDENT_LOAN_PICKER_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = STUDENT_LOAN_PICKER_ID;
    overlay.className = 'rric-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    const panel = document.createElement('div');
    panel.className = 'rric-panel rric-modal';
    const fontFamily = getPageFontFamily();
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = 'Calculate student loan payments';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { overlay.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';

    const intro = document.createElement('p');
    intro.className = 'rric-intro';
    intro.textContent = 'Choose the loan program. We will fill the monthly payment on student-loan liabilities that have no payment listed, then save and collapse each row.';
    body.appendChild(intro);

    for (const calc of STUDENT_LOAN_CALCS) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rric-choice-button';
      const lbl = document.createElement('strong');
      lbl.textContent = calc.label;
      const desc = document.createElement('span');
      desc.textContent = calc.desc;
      choice.appendChild(lbl);
      choice.appendChild(desc);
      choice.addEventListener('click', function () {
        overlay.remove();
        processStudentLoans(calc, scopeTable).catch(function (e) {
          console.error('[Residual Income Calc] student loan error', e);
          alert('Student loan calc error: ' + e.message);
        });
      });
      body.appendChild(choice);
    }

    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  async function processStudentLoans(calc, scopeTable) {
    const liabilityRows = findLiabilityRows(scopeTable);
    const loanId = getLoanId();
    const ourPayments = await getOurPayments(loanId);
    const updated = [];
    const skipped = [];
    let detected = 0;

    for (const lib of liabilityRows) {
      if (!isStudentLoanByName(lib.payee)) continue;
      detected++;

      const key = liabilityKey(lib);
      const ours = ourPayments[key];

      if (lib.payment > 0 && !ours) {
        skipped.push({ lib: lib, reason: 'Payment already set (' + lib.paymentText + ') — entered manually, not overwritten' });
        continue;
      }
      if (!lib.balance || lib.balance <= 0) {
        skipped.push({ lib: lib, reason: 'No unpaid balance' });
        continue;
      }

      const expanded = await toggleLiabilityRow(lib.tr, true);
      if (!expanded) {
        skipped.push({ lib: lib, reason: 'Could not expand row' });
        continue;
      }

      const editForm = lib.tr.nextElementSibling;
      if (!editForm) {
        skipped.push({ lib: lib, reason: 'Edit form not found after expanding' });
        continue;
      }

      const accountTypeSelect = editForm.querySelector('select[name="type"]');
      const typeValue = accountTypeSelect ? accountTypeSelect.value : '';
      const confirmedStudent = typeValue === 'StudentLoan' || isStudentLoanByName(lib.payee);
      if (!confirmedStudent) {
        skipped.push({ lib: lib, reason: 'Account type not StudentLoan' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const payoff = editForm.querySelector('input[name="payoff"]');
      if (payoff && payoff.checked) {
        skipped.push({ lib: lib, reason: 'Payoff flag is set' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }
      const exclude = editForm.querySelector('input[name="exclude"]');
      if (exclude && exclude.checked) {
        skipped.push({ lib: lib, reason: 'Exclude flag is set' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const paymentInput = editForm.querySelector('input[name="monthlyPayment"]');
      if (!paymentInput) {
        skipped.push({ lib: lib, reason: 'Monthly payment input not found' });
        await toggleLiabilityRow(lib.tr, false);
        continue;
      }

      const computed = Math.round(lib.balance * calc.rate * 100) / 100;
      try { paymentInput.focus(); } catch (_) {}
      setReactInputValue(paymentInput, computed.toFixed(2));
      await waitMs(150);
      try { paymentInput.blur(); } catch (_) {}
      await waitMs(150);

      const saveBtn = editForm.querySelector('button[data-cy="save-liability-button"]');
      if (!saveBtn) {
        skipped.push({ lib: lib, reason: 'Save button not found' });
        continue;
      }
      if (typeof saveBtn.click === 'function') {
        saveBtn.click();
      } else {
        simulateClick(saveBtn);
      }

      let saved = false;
      for (let i = 0; i < 200; i++) {
        await waitMs(50);
        if (!isLiabilityRowExpanded(lib.tr)) { saved = true; break; }
      }
      if (saved) {
        await setOurPayment(loanId, key, {
          calc: calc.id,
          payment: computed,
          balance: lib.balance,
          ts: Date.now()
        });
        updated.push({ lib: lib, payment: computed, recalculated: !!ours, previousCalc: ours ? ours.calc : null });
      } else {
        skipped.push({
          lib: lib,
          reason: 'Save did not complete within 10s. Value entered ' + fmt(computed) +
                  '; row left expanded for manual review.'
        });
      }
    }

    showStudentLoanSummary({ calc: calc, detected: detected, updated: updated, skipped: skipped, loanId: loanId });
  }

  function showStudentLoanSummary(results) {
    const existing = document.getElementById(STUDENT_LOAN_PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = STUDENT_LOAN_PANEL_ID;
    panel.className = 'rric-panel';
    const fontFamily = getPageFontFamily();
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = results.calc.label + ' student loans: ' + results.updated.length + ' updated, ' + results.skipped.length + ' skipped';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rric-panel-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', function () { panel.remove(); });
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'rric-panel-body';

    function addLine(label, value, opts) {
      opts = opts || {};
      const row = document.createElement('div');
      row.className = 'rric-row' + (opts.divider ? ' rric-divider' : '') + (opts.muted ? ' rric-muted' : '');
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    }
    function addSubhead(text) {
      const h = document.createElement('div');
      h.className = 'rric-subhead';
      h.textContent = text;
      body.appendChild(h);
    }

    addLine('Formula', results.calc.label + ' (' + results.calc.desc + ')');
    addLine('Student loans detected', String(results.detected));
    addLine('Updated', String(results.updated.length));
    addLine('Skipped', String(results.skipped.length));

    if (results.updated.length > 0) {
      addSubhead('Updated');
      for (const u of results.updated) {
        const who = u.lib.borrower ? ' — ' + u.lib.borrower : '';
        let tag = '';
        if (u.recalculated) {
          tag = u.previousCalc && u.previousCalc !== results.calc.id
            ? ' (recalculated, was ' + u.previousCalc + ')'
            : ' (recalculated)';
        }
        addLine(u.lib.payee + who + tag, fmt(u.payment));
      }
    }
    if (results.skipped.length > 0) {
      addSubhead('Skipped');
      for (const s of results.skipped) {
        const who = s.lib.borrower ? ' — ' + s.lib.borrower : '';
        addLine(s.lib.payee + who, s.reason, { muted: true });
      }
    }
    if (results.detected === 0) {
      addSubhead('No student loans found');
      const note = document.createElement('p');
      note.className = 'rric-intro';
      note.textContent = 'No liability rows had a Company/Payee that matched a known student-loan servicer. If a row should have been included, tell us the servicer name so it can be added.';
      body.appendChild(note);
    }

    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { ensureButtonState(); } catch (e) { console.error('[Residual Income Calc] observer error', e); }
      try { ensureStudentLoanButton(); } catch (e) { console.error('[Residual Income Calc] sloan observer error', e); }
      try { ensureExcludeTelecomButton(); } catch (e) { console.error('[Exclude SelfReport] observer error', e); }
      try { ensureCollectionsBadge(); } catch (e) { console.error('[Collections Badge] observer error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  schedule();
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
