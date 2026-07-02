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
  const ZHL_TIP = 'Built by Justin Case. Karma appreciated 💛';
  const PANEL_ID = 'rric-panel';
  const STUDENT_LOAN_BUTTON_ID = 'rric-sloan-button';
  const STUDENT_LOAN_BUTTON_CLASS = 'rric-sloan-button-cls';
  const STUDENT_LOAN_PICKER_ID = 'rric-sloan-picker';
  const STUDENT_LOAN_PANEL_ID = 'rric-sloan-summary';
  const EXCLUDE_TELECOM_BUTTON_ID = 'rric-exclude-telecom-button';
  const EXCLUDE_TELECOM_BUTTON_CLASS = 'rric-exclude-telecom-button-cls';
  const COLLECTIONS_5PCT_BUTTON_ID = 'rric-collections-5pct-button';
  const COLLECTIONS_5PCT_BUTTON_CLASS = 'rric-collections-5pct-button-cls';
  const COLLECTIONS_5PCT_PANEL_ID = 'rric-collections-5pct-summary';
  // VA Entitlement Calculator
  const ENTITLEMENT_BUTTON_CLASS = 'rric-entitlement-button-cls';
  const ENTITLEMENT_PANEL_ID = 'rric-entitlement-panel';
  // 2026 conforming loan limits (VA adopts FHFA). Each limit is a
  // [1-unit, 2-unit, 3-unit, 4-unit] tuple.
  const VA_BASELINE_LIMITS = [832750, 1066250, 1288800, 1602750];
  const FHFA_LOOKUP_URL = 'https://www.fhfa.gov/data/conforming-loan-limit';

  // Shared 2026 high-cost limit tuples (many counties share a value).
  const _T_CEIL  = [1249125, 1599375, 1933200, 2402625]; // ceiling (150%)
  const _T_NYC   = [1209750, 1548975, 1872225, 2326875];
  const _T_MAUI  = [1299500, 1663600, 2010950, 2499100];

  // All 2026 counties above the baseline, from FHFA (ZHL-provided).
  // label = "ST — County"; lim = [1,2,3,4]-unit. Alaska + a couple of
  // all-same states are collapsed to one entry for a usable dropdown.
  const VA_HIGH_COST_COUNTIES = [
    { label: 'UT — Grand County', lim: [839500, 1074700, 1299100, 1614450] },
    { label: 'CT — Naugatuck Valley Planning Region', lim: [851000, 1089450, 1316900, 1636550] },
    { label: 'CO — Denver metro (Adams, Arapahoe, Broomfield, Clear Creek, Denver, Douglas, Elbert, Gilpin, Jefferson, Park)', lim: [862500, 1104150, 1334700, 1658700] },
    { label: 'CO — Boulder County', lim: [879750, 1126250, 1361350, 1691850] },
    { label: 'CO — Grand County', lim: [883200, 1130650, 1366700, 1698500] },
    { label: 'CA — Sonoma County', lim: [897000, 1148350, 1388050, 1725050] },
    { label: 'CA — Santa Barbara County', lim: [941850, 1205750, 1457450, 1811300] },
    { label: 'MA/NH — Boston metro (Essex, Middlesex, Norfolk, Plymouth, Suffolk, Rockingham NH, Strafford NH)', lim: [962550, 1232250, 1489500, 1851100] },
    { label: 'CT — Greater Bridgeport / Western Connecticut Planning Region', lim: [977500, 1251400, 1512650, 1879850] },
    { label: 'FL — Monroe County (Key West)', lim: [990150, 1267600, 1532200, 1904150] },
    { label: 'CA — Monterey County', lim: [994750, 1273450, 1539350, 1913000] },
    { label: 'CO — San Miguel County', lim: [994750, 1273450, 1539350, 1913000] },
    { label: 'UT — Wayne County', lim: [997050, 1276400, 1542900, 1917450] },
    { label: 'CA — San Luis Obispo County', lim: [1000500, 1280850, 1548250, 1924100] },
    { label: 'CA — Napa County', lim: [1017750, 1302900, 1574900, 1957250] },
    { label: 'TN — Nashville metro (Cannon, Cheatham, Davidson, Dickson, Hickman, Macon, Maury, Robertson, Rutherford, Smith, Sumner, Trousdale, Williamson, Wilson)', lim: [1029250, 1317650, 1592700, 1979350] },
    { label: 'CA — Ventura County', lim: [1035000, 1325000, 1601600, 1990450] },
    { label: 'WA — Seattle metro (King, Pierce, Snohomish)', lim: [1063750, 1361800, 1646100, 2045700] },
    { label: 'CO — Moffat County', lim: [1089050, 1394200, 1685250, 2094350] },
    { label: 'CO — Routt County', lim: [1089050, 1394200, 1685250, 2094350] },
    { label: 'CO — Lake County', lim: [1092500, 1398600, 1690600, 2101000] },
    { label: 'CO — Summit County', lim: [1092500, 1398600, 1690600, 2101000] },
    { label: 'CA — San Diego County', lim: [1104000, 1413350, 1708400, 2123100] },
    { label: 'UT — Summit County', lim: [1150000, 1472250, 1779600, 2211600] },
    { label: 'UT — Wasatch County', lim: [1150000, 1472250, 1779600, 2211600] },
    { label: 'CO — Garfield County', lim: _T_NYC },
    { label: 'CO — Pitkin County (Aspen)', lim: _T_NYC },
    { label: 'MD — Calvert County', lim: _T_NYC },
    { label: 'NJ — North Jersey / NYC metro (Bergen, Essex, Hudson, Hunterdon, Middlesex, Monmouth, Morris, Ocean, Passaic, Somerset, Sussex, Union)', lim: _T_NYC },
    { label: 'NY — NYC metro (Bronx, Kings, Nassau, New York, Putnam, Queens, Richmond, Rockland, Suffolk, Westchester)', lim: _T_NYC },
    { label: 'PA — Pike County', lim: _T_NYC },
    { label: 'VA — Madison County', lim: _T_NYC },
    { label: 'AK — All boroughs / census areas', lim: _T_CEIL },
    { label: 'CA — SF Bay Area (Alameda, Contra Costa, Marin, San Francisco, San Mateo)', lim: _T_CEIL },
    { label: 'CA — Los Angeles County', lim: _T_CEIL },
    { label: 'CA — Orange County', lim: _T_CEIL },
    { label: 'CA — San Benito County', lim: _T_CEIL },
    { label: 'CA — Santa Clara County', lim: _T_CEIL },
    { label: 'CA — Santa Cruz County', lim: _T_CEIL },
    { label: 'CO — Eagle County (Vail)', lim: _T_CEIL },
    { label: 'DC — District of Columbia', lim: _T_CEIL },
    { label: 'HI — Hawaii, Honolulu, Kauai Counties', lim: _T_CEIL },
    { label: 'ID — Teton County', lim: _T_CEIL },
    { label: 'MD — DC metro (Charles, Frederick, Montgomery, Prince George’s)', lim: _T_CEIL },
    { label: 'MA — Dukes & Nantucket Counties', lim: _T_CEIL },
    { label: 'VA — DC metro (Arlington, Clarke, Culpeper, Fairfax, Fauquier, Loudoun, Prince William, Rappahannock, Spotsylvania, Stafford, Warren + Alexandria/Fairfax/Falls Church/Fredericksburg/Manassas/Manassas Park cities)', lim: _T_CEIL },
    { label: 'WV — Jefferson County', lim: _T_CEIL },
    { label: 'WY — Teton County (Jackson)', lim: _T_CEIL },
    { label: 'GU — Guam', lim: _T_CEIL },
    { label: 'VI — U.S. Virgin Islands (St. Croix, St. John, St. Thomas)', lim: _T_CEIL },
    { label: 'HI — Maui & Kalawao Counties', lim: _T_MAUI }
  ];

  // Best-effort ZIP-prefix → high-cost county index, ONLY for metros
  // whose ZIP3 maps cleanly to a single county/limit. Used to
  // pre-select the dropdown; the LO confirms and can pick any county.
  // ZIP3s that straddle counties with different limits are omitted on
  // purpose (they default to baseline, and the dropdown handles them).
  const VA_ZIP3_HINT = (function () {
    const idx = function (label) { return VA_HIGH_COST_COUNTIES.findIndex(function (c) { return c.label === label; }); };
    const LA = idx('CA — Los Angeles County');
    const OC = idx('CA — Orange County');
    const SD = idx('CA — San Diego County');
    const SCLARA = idx('CA — Santa Clara County');
    const NYC = idx('NY — NYC metro (Bronx, Kings, Nassau, New York, Putnam, Queens, Richmond, Rockland, Suffolk, Westchester)');
    const map = {};
    // LA County
    ['900','901','902','903','904','905','906','907','908','910','911','912','913','914','915','916','917','918'].forEach(function (z) { map[z] = LA; });
    // Orange County
    ['926','927','928'].forEach(function (z) { map[z] = OC; });
    // San Diego County
    ['919','920','921'].forEach(function (z) { map[z] = SD; });
    // Santa Clara (San Jose)
    ['950','951'].forEach(function (z) { map[z] = SCLARA; });
    // NYC core (Manhattan/Bronx/Brooklyn/Queens/SI/Westchester/LI)
    ['100','101','102','103','104','105','106','107','108','110','111','112','113','114','115','116','117','118','119'].forEach(function (z) { map[z] = NYC; });
    return map;
  })();
  const COLLECTIONS_BADGE_CLASS = 'rric-collections-badge-cls';
  const FHA_COLLECTION_CAP = 2000;
  const DISPUTED_BADGE_CLASS = 'rric-disputed-badge-cls';
  const FHA_DISPUTED_CAP = 1000;

  // Independent toggle for the FHA cumulative-balance badges. Lives
  // under va-calc.js because it shares the section infrastructure,
  // but operates as its own feature with its own setup-page switch.
  // Hydrated from chrome.storage.local on load and kept fresh via
  // onChanged so flipping the toggle takes effect on the next scan
  // tick without a tab reload.
  let fhaBadgesEnabled = true;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['feature_fhaBadges'], function (data) {
        if (data && data.feature_fhaBadges === false) fhaBadgesEnabled = false;
      });
      if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          if (changes.feature_fhaBadges) {
            fhaBadgesEnabled = changes.feature_fhaBadges.newValue !== false;
          }
        });
      }
    } catch (_) {}
  }

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

  // Heuristic for the FHA cumulative-balance rule. Only true
  // COLLECTION accounts count toward the $2k cap. Charge-offs are
  // explicitly excluded from the DTI ratio per the FHA matrix and
  // per user direction do not count toward this total either. The
  // "Unknown" account type catches collection-agency rows that LOP
  // can't categorize as Revolving / Installment / Mortgage.
  function isCollectionAccount(accountType) {
    const at = (accountType || '').toUpperCase().trim();
    if (!at) return false;
    if (at === 'UNKNOWN') return true;
    if (/COLLECTION/.test(at)) return true;
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

  // (computeCollectionsFromReact removed in v1.14.1 — its single
  // caller refreshReactCacheIfDue now calls callMainWorldProbe
  // directly so we can log timing / failure mode per attempt.)

  // Per the FHA rule the badge enforces ($2,000 cumulative-balance
  // cap), only true COLLECTION accounts count. Charge-offs (whether
  // expressed as a type, an accountStatus, or text in remarks like
  // "CHARGE OFF" / "REPOSSESSION") are explicitly excluded from the
  // DTI ratio per the rule, and per user clarification do not count
  // toward this total either. Late-payment accounts and judgments
  // share the same section header in the FHA matrix but the $2k
  // cumulative-balance language applies specifically to collections.
  //
  // "Unknown" is treated as a collection because LOP's data shows
  // every collection-agency row (I.C. SYSTEM, MIDLAND CREDIT, etc.)
  // categorized as Unknown — they don't fit Revolving / Installment
  // / Mortgage and have no first-party creditor.
  function isChargeOff(attrs) {
    if (!attrs) return false;
    const type = String(attrs.type || '').toUpperCase();
    const status = String(attrs.accountStatus || '').toUpperCase();
    // Highest adverse rating is the user-visible "Charge Off" pill
    // on the LOP liability card. LOP's API field name isn't confirmed
    // so we check the likely camelCase variants.
    const rating = String(
      attrs.highestAdverseRating ||
      attrs.highestAdverse ||
      attrs.adverseRating ||
      attrs.worstRating ||
      attrs.worstStatus ||
      ''
    ).toUpperCase();
    const remarks = String(attrs.remarks || '').toUpperCase();
    return /CHARGE\s*OFF|CHARGEOFF/.test(type) ||
           /CHARGE\s*OFF|CHARGEOFF/.test(status) ||
           /CHARGE\s*OFF|CHARGEOFF/.test(rating) ||
           /CHARGE\s*OFF|CHARGED\s*OFF|REPOSSESSION|REPO/.test(remarks);
  }

  function classifyLiabilityFromReact(item) {
    const attrs = (item && item.attributes) || {};
    const type = String(attrs.type || '').toUpperCase().trim();
    const isColl = isCollection(attrs);
    // Pure charge-offs / repossessions are excluded from the
    // collections bucket per user clarification. BUT a charge-off that
    // was also submitted to / placed in collection IS a collection
    // account and counts (the remarks say so), so only exclude
    // charge-offs that aren't also collections.
    if (isChargeOff(attrs) && !isColl) return [];
    if (isColl) {
      if (type === 'COLLECTION') return ['type:Collection'];
      if (type === 'UNKNOWN') return ['unknown→collection'];
      return ['remarks→collection'];
    }
    return [];
  }

  // A collection account: LOP type Collection/Unknown, OR the credit
  // bureau stamped a "submitted/placed/assigned to collection" phrase
  // in the remarks (common on original-creditor tradelines that were
  // charged off and sent to a collection agency).
  function isCollection(attrs) {
    if (!attrs) return false;
    const type = String(attrs.type || '').toUpperCase().trim();
    if (type === 'COLLECTION' || type === 'UNKNOWN') return true;
    const remarks = String(attrs.remarks || '').toUpperCase();
    return /SUBMITTED\s+TO\s+COLLECTION|PLACED\s+(?:FOR|IN|WITH)\s+COLLECTION|ASSIGNED\s+TO\s+COLLECTION|COLLECTION\s+ACCOUNT|\bIN\s+COLLECTION\b/.test(remarks);
  }

  function computeCollectionsFromItems(items) {
    const result = { total: 0, counted: [], excludedMedical: [] };
    for (const item of items) {
      const attrs = (item && item.attributes) || {};
      const reasons = classifyLiabilityFromReact(item);
      if (!reasons.length) continue;
      const balance = Number(attrs.unpaidBalance) || 0;
      const payee = String(attrs.creditor || '');
      const row = {
        payee: payee,
        accountType: attrs.type || '',
        balance: balance
      };
      if (isMedicalPayee(payee)) {
        result.excludedMedical.push({ row: row, reasons: reasons });
      } else {
        result.total += balance;
        result.counted.push({ row: row, reasons: reasons });
      }
    }
    return result;
  }

  // FHA $1,000 disputed derogatory cap. Per the rule:
  //   "If the borrower(s) has $1000 or more collectively in Disputed
  //    Derogatory Credit Accounts [collections, charge offs or
  //    accounts with late payments (30 days or more) in the last 24
  //    months], the mortgage must be downgraded to a Refer and
  //    manually underwritten."
  //
  // Exclusions:
  //   - Disputed Medical Accounts
  //   - Disputed derogatory credit from documented identity theft,
  //     credit card theft, or unauthorized usage
  //   - Disputed derogatory accounts of NB Spouse (not flagged in
  //     LOP — we have no signal for this and skip the rule)
  //   - Disputed accounts with zero balance
  //   - Disputed accounts with late payments aged 24 months or
  //     greater
  //   - Disputed accounts that are current and paid as agreed
  //
  // LOP's exact field name for "disputed" isn't confirmed yet — we
  // try a list of likely candidates and log the full attributes
  // whenever we see one set so the user can confirm or paste back.
  function isDisputed(attrs) {
    if (!attrs) return false;
    // Boolean-typed flags.
    if (attrs.disputed === true) return 'disputed';
    if (attrs.isDisputed === true) return 'isDisputed';
    if (attrs.inDispute === true) return 'inDispute';
    if (attrs.disputeFlag === true) return 'disputeFlag';
    // String-typed flags.
    const sFields = ['disputeStatus', 'disputeFlag', 'tradelineDispute', 'creditDispute'];
    for (const f of sFields) {
      const v = attrs[f];
      if (typeof v === 'string' && /^(disputed|yes|true|y)$/i.test(v.trim())) return f + '=' + v;
    }
    // Apollo-style enum value, e.g. "ConsumerDisputesThisAccount" /
    // "InDispute" — the FHFA / Fannie/Freddie credit feed sometimes
    // surfaces dispute as a code on a sibling field.
    const codeFields = ['disputeCode', 'disputeIndicator', 'fcraDisputeFlag', 'consumerDisputeIndicator'];
    for (const f of codeFields) {
      const v = attrs[f];
      if (v && v !== 'NotDisputed' && v !== 'None' && v !== 'N') return f + '=' + v;
    }
    // Remarks text. In practice this is the only signal LOP exposes —
    // none of the structured fields above get populated. The credit
    // bureaus stamp phrases like "ACCT IN DISPUTE", "ACCOUNT IN
    // DISPUTE", "CONSUMER DISPUTES THIS ACCOUNT", or just "DISPUTED"
    // into the Remarks string when the borrower has filed an FCRA
    // dispute on the tradeline.
    const remarks = String(attrs.remarks || '');
    if (/\b(ACCT|ACCOUNT)\s+IN\s+DISPUTE\b/i.test(remarks)) return 'remarks=ACCT IN DISPUTE';
    if (/\bCONSUMER\s+DISPUTES?\s+THIS\s+ACCOUNT\b/i.test(remarks)) return 'remarks=CONSUMER DISPUTES';
    if (/\bIN\s+DISPUTE\b/i.test(remarks)) return 'remarks=IN DISPUTE';
    if (/\bDISPUTED\b/i.test(remarks)) return 'remarks=DISPUTED';
    return false;
  }

  function classifyDisputedFromReact(item) {
    const attrs = (item && item.attributes) || {};
    const disputedReason = isDisputed(attrs);
    if (!disputedReason) return [];
    const isColl = isCollection(attrs);
    // Pure charge-offs are excluded from the disputed bucket per user
    // clarification — UNLESS the account is also a collection (e.g.
    // charged off AND submitted to collection), in which case it's a
    // disputed collection and counts.
    if (isChargeOff(attrs) && !isColl) return [];
    // Derogatory check: collection OR 30+day late in last 24mo.
    const derog = [];
    if (isColl) derog.push('collection');
    const lateCount =
      (Number(attrs.thirtyDaysLateCount) || 0) +
      (Number(attrs.sixtyDaysLateCount) || 0) +
      (Number(attrs.ninetyDaysLateCount) || 0);
    const lastDelinqRaw = attrs.lastDelinquencyDate || attrs.lastDelinquencyOn || null;
    if (lateCount > 0 && lastDelinqRaw) {
      const lastDelinq = new Date(lastDelinqRaw);
      if (!isNaN(lastDelinq.getTime())) {
        const ageMs = Date.now() - lastDelinq.getTime();
        const TWENTY_FOUR_MO_MS = 1000 * 60 * 60 * 24 * 365.25 * 2;
        if (ageMs <= TWENTY_FOUR_MO_MS) derog.push('late ' + lateCount + 'x in 24mo');
        // Note: late pays aged >24mo are explicitly EXCLUDED per
        // the FHA rule, so we don't add them as a reason.
      }
    }
    if (!derog.length) return []; // disputed but not derogatory → exempt
    // Zero balance exclusion.
    if ((Number(attrs.unpaidBalance) || 0) <= 0) return [];
    return [disputedReason].concat(derog);
  }

  function computeDisputedFromItems(items) {
    const result = { total: 0, counted: [], excludedMedical: [] };
    // Side-effect: log any item that has ANY disputed-ish field set
    // so the user can confirm we matched the right field name (or
    // tell us if we missed one). One log per page reload, since the
    // sample-data probe doesn't surface this otherwise.
    if (!window.__zhlDisputedFieldProbeDone) {
      window.__zhlDisputedFieldProbeDone = true;
      for (const item of items) {
        const attrs = (item && item.attributes) || {};
        const disputed = isDisputed(attrs);
        if (disputed) {
          console.log('[Disputed Probe] found disputed-flagged liability:', attrs.creditor, '— field match:', disputed);
          console.log('  full attributes:', attrs);
        }
      }
    }
    for (const item of items) {
      const attrs = (item && item.attributes) || {};
      const reasons = classifyDisputedFromReact(item);
      if (!reasons.length) continue;
      const balance = Number(attrs.unpaidBalance) || 0;
      const payee = String(attrs.creditor || '');
      const row = { payee: payee, accountType: attrs.type || '', balance: balance };
      if (isMedicalPayee(payee)) {
        result.excludedMedical.push({ row: row, reasons: reasons });
      } else {
        result.total += balance;
        result.counted.push({ row: row, reasons: reasons });
      }
    }
    return result;
  }

  // Match React-read tables to the on-page liabilities sections.
  // The bridge returns one entry per visible liabilities table in
  // DOM order. findLiabilitiesHeaders() also walks the DOM in order,
  // so the indexes line up.
  let lastReactReadAt = 0;
  let cachedReactTables = null;
  let reactReadInFlight = null;
  let reactReadDiagCount = 0;
  async function refreshReactCacheIfDue() {
    const now = Date.now();
    // Throttle to once per second AND prevent concurrent in-flight
    // probes — otherwise a hanging postMessage piles up promises on
    // every observer tick.
    if (cachedReactTables && now - lastReactReadAt < 1000) return cachedReactTables;
    if (reactReadInFlight) return cachedReactTables;
    reactReadInFlight = (async function () {
      try {
        const probeStart = Date.now();
        const result = await callMainWorldProbe({ mode: 'readLiabilities' }, 5000);
        const elapsed = Date.now() - probeStart;
        if (!result) {
          if (reactReadDiagCount++ < 3) {
            console.warn('[Total Collections] React probe returned null after ' + elapsed +
              'ms — bridge may not be installed or postMessage timed out. ' +
              'Check that you see "[ZHL LOP bridge] installed in MAIN world" in the console on page load.');
          }
        } else if (result.error) {
          if (reactReadDiagCount++ < 3) {
            console.warn('[Total Collections] React probe returned an error (elapsed=' + elapsed + 'ms): ' + result.error);
          }
        } else if (!result.tables || !result.tables.length) {
          if (reactReadDiagCount++ < 3) {
            console.warn('[Total Collections] React probe returned empty tables array (elapsed=' + elapsed + 'ms). result:', result);
          }
        } else {
          // Did each table actually find a liabilities array?
          const failed = result.tables.filter(function (t) { return !t.read || !t.read.found; });
          if (failed.length && reactReadDiagCount++ < 3) {
            console.warn('[Total Collections] React probe returned ' + result.tables.length +
              ' table(s) but ' + failed.length + ' had no entityNamePlural=liabilities fiber match. First failure reason:',
              failed[0].read && failed[0].read.reason, 'full result:', result);
          }
          cachedReactTables = result.tables;
          lastReactReadAt = Date.now();
          if (reactReadDiagCount < 3) {
            // One success log so we know live mode kicked in.
            console.log('[Total Collections] React read OK in ' + elapsed +
              'ms — ' + result.tables.length + ' table(s), ' +
              result.tables.reduce(function (s, t) { return s + (t.read && t.read.items ? t.read.items.length : 0); }, 0) +
              ' total liability item(s).');
            reactReadDiagCount = 3; // suppress further per-call success logs
          }
        }
      } catch (e) {
        if (reactReadDiagCount++ < 3) {
          console.warn('[Total Collections] React probe threw:', e);
        }
      } finally {
        reactReadInFlight = null;
      }
    })();
    return cachedReactTables;
  }

  function ensureDisputedBadge() {
    const sections = findLiabilitiesHeaders();
    for (const sec of sections) {
      let badge = sec.container.querySelector('.' + DISPUTED_BADGE_CLASS);
      if (!fhaBadgesEnabled) {
        if (badge) badge.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.className = DISPUTED_BADGE_CLASS;
        badge.style.cssText =
          'display:inline-flex;align-items:center;gap:6px;' +
          'padding:4px 10px;border-radius:14px;' +
          'font:600 12px/1.3 Arial,sans-serif;cursor:pointer;' +
          'border:1px solid transparent;user-select:none;';
        badge.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          // Same as the collections badge — force a fresh React read.
          cachedReactTables = null;
          lastReactReadAt = 0;
          updateDisputedBadge(sec, badge);
        });
        // Insert into the shared Liabilities-group wrapper, after the
        // collections badge if present, otherwise before any action
        // buttons. Keeps order [Collections][Disputed][buttons…].
        const group = getOrCreateLiabilitiesGroup(sec);
        const collBadge = group.querySelector(':scope > .' + COLLECTIONS_BADGE_CLASS);
        if (collBadge && collBadge.nextSibling) {
          group.insertBefore(badge, collBadge.nextSibling);
        } else if (collBadge) {
          group.appendChild(badge);
        } else {
          const firstBtn = group.querySelector(':scope > .rric-button');
          if (firstBtn) group.insertBefore(badge, firstBtn);
          else group.appendChild(badge);
        }
      }
      updateDisputedBadge(sec, badge);
    }
  }

  function updateDisputedBadge(sec, badge) {
    refreshReactCacheIfDue();
    if (cachedReactTables) {
      const allSections = findLiabilitiesHeaders();
      const idx = allSections.findIndex(function (s) { return s.table === sec.table; });
      const tableData = idx >= 0 ? cachedReactTables[idx] : null;
      if (tableData && tableData.read && tableData.read.found && Array.isArray(tableData.read.items)) {
        const result = computeDisputedFromItems(tableData.read.items);
        paintDisputedBadge(badge, result, 'react');
        return;
      }
    }
    paintDisputedBadge(badge, { total: 0, counted: [], excludedMedical: [] }, 'fast');
  }

  function paintDisputedBadge(badge, result, mode) {
    const overCap = result.total >= FHA_DISPUTED_CAP;
    const icon = overCap ? '✕' : '✓';
    const color = overCap ? '#b91c1c' : '#16a34a';
    const bg = overCap ? '#fee2e2' : '#dcfce7';
    badge.style.background = bg;
    badge.style.color = color;
    badge.style.borderColor = color;
    const medicalNote = result.excludedMedical.length
      ? ' · ' + result.excludedMedical.length + ' medical excluded'
      : '';
    const modeNote = mode === 'react' ? ' · live ✓' : ' · loading…';
    badge.textContent = icon + ' Total Disputed: $' +
      result.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      medicalNote + modeNote;
    const lines = ['FHA disputed-derogatory cap: $' + FHA_DISPUTED_CAP.toLocaleString() + ' — over the cap downgrades to Refer / manual UW.'];
    if (mode === 'fast') lines.push('(Loading — waiting for LOP\'s React state to hydrate.)');
    if (result.counted.length) {
      lines.push('');
      lines.push('Counted (' + result.counted.length + '):');
      for (const c of result.counted) {
        const r = c.row || c;
        const why = c.reasons ? ' [' + c.reasons.join(', ') + ']' : '';
        lines.push('  • ' + r.payee + ' [' + r.accountType + ']' + why + ' — $' + (r.balance || 0).toLocaleString());
      }
    } else {
      lines.push('');
      lines.push('No disputed-derogatory accounts found.');
    }
    if (result.excludedMedical.length) {
      lines.push('');
      lines.push('Excluded as medical (' + result.excludedMedical.length + '):');
      for (const c of result.excludedMedical) {
        const r = c.row || c;
        lines.push('  • ' + r.payee + ' [' + r.accountType + '] — $' + (r.balance || 0).toLocaleString());
      }
    }
    badge.title = lines.join('\n') + '\n\n' + ZHL_TIP;
  }

  // Single flex wrapper shared by every ZHL control we add to the
  // Liabilities header — both badges (Total Collections, Total
  // Disputed) and both buttons (Calc Student Loans, Exclude
  // SelfReport). Putting all four in one inline-flex child keeps
  // them grouped together visually instead of getting flex-pushed
  // to opposite ends of the section's space-between layout. Sits
  // right after the "Liabilities" h5 heading; LOP's own
  // "+ Add liability" button stays on the far right.
  function getOrCreateLiabilitiesGroup(sec) {
    let group = sec.container.querySelector(':scope > .rric-button-group');
    if (group) return group;
    group = document.createElement('div');
    group.className = 'rric-button-group';
    group.style.cssText = 'display:inline-flex;gap:8px;align-items:center;margin-left:12px;';
    const heading = sec.container.querySelector('h5');
    if (heading && heading.nextSibling) sec.container.insertBefore(group, heading.nextSibling);
    else if (sec.addBtn) sec.container.insertBefore(group, sec.addBtn);
    else sec.container.appendChild(group);
    return group;
  }

  function ensureCollectionsBadge() {
    const sections = findLiabilitiesHeaders();
    for (const sec of sections) {
      let badge = sec.container.querySelector('.' + COLLECTIONS_BADGE_CLASS);
      if (!fhaBadgesEnabled) {
        if (badge) badge.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.className = COLLECTIONS_BADGE_CLASS;
        badge.style.cssText =
          'display:inline-flex;align-items:center;gap:6px;' +
          'padding:4px 10px;border-radius:14px;' +
          'font:600 12px/1.3 Arial,sans-serif;cursor:pointer;' +
          'border:1px solid transparent;user-select:none;';
        badge.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            // Shift-click: probe the React fiber tree above the
            // liabilities table and dump the discovered data to the
            // console. Used for debugging if LOP changes structure.
            probeReactFiber(sec.table);
            return;
          }
          // Regular click: invalidate the cached React snapshot and
          // force a fresh read on the next observer tick. Useful if
          // the data feels stale right after editing a row.
          cachedReactTables = null;
          lastReactReadAt = 0;
          updateCollectionsBadge(sec, badge);
        });
        // Insert the badge into the shared Liabilities-group wrapper,
        // before any action buttons (status-then-actions order).
        const group = getOrCreateLiabilitiesGroup(sec);
        const firstBtn = group.querySelector(':scope > .rric-button');
        if (firstBtn) group.insertBefore(badge, firstBtn);
        else group.appendChild(badge);
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
      console.log('fiber chain (' + info.fiberChain.length + ' levels):');
      console.log('  ' + info.fiberChain.join(' → '));
      if (info.read) {
        if (info.read.found) {
          console.log('%cliabilities array located via entityNamePlural marker',
            'color:#16a34a;font-weight:bold;',
            '— depth=' + info.read.depth + ' fiber=' + info.read.fiberName + ' count=' + info.read.count);
          console.log('sample[0] (paste this back so I can map field names):');
          console.log(JSON.stringify(info.read.items[0], null, 2));
        } else {
          console.warn('liabilities array NOT located:', info.read.reason);
        }
      }
      if (info.hits.length) {
        console.log('found ' + info.hits.length + ' liability-shaped array(s):');
        for (const h of info.hits) {
          console.log('  ' + h.path + ' (' + h.count + ' items)');
          console.log('    sample[0]:', h.sample);
        }
        console.log('Top hit sample (paste this block back to me):');
        console.log(JSON.stringify(info.hits[0].sample, null, 2));
      } else {
        if (info.apolloProbe) {
          console.log('Apollo / React Query client found:', info.apolloProbe);
          if (info.apolloProbe.kind === 'apollo') {
            if (info.apolloProbe.liabilityArrayMatches && info.apolloProbe.liabilityArrayMatches.length) {
              console.log('Liability arrays in Apollo cache:');
              for (const m of info.apolloProbe.liabilityArrayMatches) {
                console.log('  cacheKey="' + m.cacheKey + '" field="' + m.fieldKey + '" (' + m.count + ' items)');
                console.log('    sample[0]:', m.sample);
              }
              console.log('Top hit (paste this back):');
              console.log(JSON.stringify(info.apolloProbe.liabilityArrayMatches[0].sample, null, 2));
            } else {
              console.warn('Apollo client reachable but no liability-shaped array in its cache.');
              console.log('  Cache keys (' + info.apolloProbe.cacheKeys + ' total):', info.apolloProbe.sampleCacheKeys);
              console.log('  Liability-ish keys:', info.apolloProbe.liabilityishKeys);
            }
          }
        }
        console.warn('No liability-shaped array found by heuristic in the fiber tree. Dumping each named fiber\'s shape inline (no need to expand anything):');
        if (info.fiberShapes && info.fiberShapes.length) {
          for (const s of info.fiberShapes) {
            console.log('depth=' + s.depth + ' ' + s.name,
              s.propsShape ? '\n  props: ' + JSON.stringify(s.propsShape) : '',
              s.stateShape ? '\n  state: ' + JSON.stringify(s.stateShape) : '',
              s.hooks ? '\n  hooks: ' + JSON.stringify(s.hooks) : ''
            );
          }
          console.log('Look for any field suggesting liabilities or any array with ' + info.rowCount + ' items.');
        }
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
    // Priority of data sources:
    //   1. React fiber read (instant, accurate — sees attributes.type
    //      / status / remarks without expanding rows). This is the
    //      normal path.
    //   2. Fast summary-only heuristic fallback (used only when the
    //      MAIN-world bridge hasn't responded yet, e.g. very first
    //      paint after a hard reload).
    // We fire the React refresh fire-and-forget; whatever the
    // cachedReactTables already holds gets rendered now, and when
    // the refresh resolves a later observer tick uses the new data.
    refreshReactCacheIfDue();
    if (cachedReactTables) {
      const allSections = findLiabilitiesHeaders();
      const idx = allSections.findIndex(function (s) { return s.table === sec.table; });
      const tableData = idx >= 0 ? cachedReactTables[idx] : null;
      if (tableData && tableData.read && tableData.read.found && Array.isArray(tableData.read.items)) {
        const result = computeCollectionsFromItems(tableData.read.items);
        paintBadge(badge, result, 'react');
        return;
      }
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
    const modeNote = mode === 'react' ? ' · live ✓' : ' · loading…';
    badge.textContent = icon + ' Total Collections: $' +
      result.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      medicalNote + modeNote;
    const lines = ['FHA cumulative-balance cap: $' + FHA_COLLECTION_CAP.toLocaleString()];
    if (mode === 'fast') {
      lines.push('(Loading — waiting for LOP\'s React state to hydrate. The number will refresh momentarily.)');
    } else if (mode === 'react') {
      lines.push('(Reading every liability\'s full attributes directly from LOP\'s React state. Updates automatically.)');
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
    badge.title = lines.join('\n') + '\n\n' + ZHL_TIP;
  }

  // Note: the v1.12.x row-expanding deepScanCollections / runDeepScan
  // implementations were removed in v1.13.2. The MAIN-world React
  // fiber read (readLiabilitiesArray in lop-state-bridge.js +
  // computeCollectionsFromReact above) supersedes them — same
  // accuracy, no UI disruption. Helpers like findEditPanelFor and
  // toggleLiabilityRow are kept because other features
  // (Exclude SelfReport, Calc Student Loans) still use them.

  // When a borrower-pair tab's Run Residual Income Calc button is
  // clicked, we set this to that borrower's section root. findLabel /
  // findFieldByLabel use it as the default scope, so getVeteranType /
  // getMaritalStatus / etc. read from the right form. Stays set until
  // a different section's button overrides it. findEmploymentSummaryRows
  // also uses it directly.
  let activeFormScope = null;
  // Payee patterns that get auto-excluded. Both TELECOM and UTILITY
  // self-reported trade lines fit the same rule: they're consumer-reported
  // installment accounts that don't belong in the DTI calc and get
  // excluded with reason "Installment debt less than 10 payments". Add
  // any future SELFREPORTED variants to this regex.
  const EXCLUDE_SELFREPORT_PAYEE_RX = /\b(TELECOM|UTILITY)\s+SELFREPORTED\b/i;
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
    'FIRSTMARK', 'CONDUENT', 'ACS EDUCATION', 'ASCENT',
    // Default-collection agencies that show up as the creditor on
    // defaulted federal student loans after they're transferred from
    // the original servicer. "CENTRAL RESEARCH" matches both
    // "CENTRAL RESEARCH INC" and "CENTRAL RESEARCH INC/D".
    'CENTRAL RESEARCH'
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

  // Count borrowers on the loan by counting visible marital-status
  // selects (one per borrower, reliably present on every borrower
  // tab). Falls back to 1 if none found.
  function getBorrowerCount() {
    let n = 0;
    document.querySelectorAll('select[name="maritalStatus"]').forEach(function (sel) {
      if (sel.offsetParent !== null) n++;
    });
    return Math.max(1, n);
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

  // String value from a right-rail "Label  value" row (getPanelNumber's
  // text-returning sibling — needed for ZIP, which can have a leading 0).
  function getPanelText(label) {
    const target = normalizeText(label);
    const els = document.querySelectorAll('div, span, td, th, p, dt, dd, li, label');
    for (const el of els) {
      if (normalizeText(el.textContent) !== target) continue;
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib && sib.textContent.trim()) return sib.textContent.replace(/\s+/g, ' ').trim();
      if (el.parentElement) {
        const leftover = (el.parentElement.textContent || '').replace(el.textContent || '', '').replace(/\s+/g, ' ').trim();
        if (leftover) return leftover;
      }
    }
    return null;
  }

  function getZipCode() {
    // There can be more than one "Zip code" label on the page (the
    // Addresses form has one whose value lives in an <input>, so its
    // textContent has no digits). Iterate EVERY "Zip code" label and
    // return the first one that has a real 5-digit value — that's the
    // right-rail Loan Details row: <span>Zip code</span><p>27055</p>.
    const labels = document.querySelectorAll('span, div, td, th, p, dt, dd, li, label');
    for (const el of labels) {
      const t = normalizeText(el.textContent);
      if (t !== 'zip code' && t !== 'zip' && t !== 'zip code:' && t !== 'zip:') continue;
      // Sibling value (<span> label → <p> value in the same row).
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib) {
        const m = /\b(\d{5})(?:-\d{4})?\b/.exec(sib.textContent || '');
        if (m) return m[1];
      }
      // Otherwise scan the row/container.
      let node = el.parentElement;
      for (let i = 0; i < 3 && node; i++) {
        const m = /\b(\d{5})(?:-\d{4})?\b/.exec(node.textContent || '');
        if (m) return m[1];
        node = node.parentElement;
      }
    }
    return null;
  }

  // Best-effort high-cost county INDEX from the ZIP (for dropdown
  // pre-select). -1 = no confident match → baseline.
  function highCostIndexForZip(zip) {
    if (!zip) return -1;
    const hit = VA_ZIP3_HINT[zip.slice(0, 3)];
    return (typeof hit === 'number' && hit >= 0) ? hit : -1;
  }

  // Subject-property unit count (1–4); defaults to 1.
  function getUnitCount() {
    const labels = ['Number of units', 'Units', '# of units', 'Number of Units'];
    for (const l of labels) {
      const raw = getPanelText(l);
      const n = raw ? parseInt((raw.match(/\d+/) || [])[0], 10) : NaN;
      if (n >= 1 && n <= 4) return n;
    }
    return 1;
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

  // Purchase price (a.k.a. sales price / contract price). The VA
  // down-payment and no-down-max calcs are based on the PURCHASE PRICE
  // (technically the lesser of purchase price and appraised value),
  // NOT the loan amount — the financed VA funding fee sits on top of
  // the loan and must not inflate the required down payment.
  function getPurchasePrice() {
    return getPanelNumber('Purchase price')
      || getPanelNumber('Sales price')
      || getPanelNumber('Sale price')
      || getPanelNumber('Purchase Price')
      || getPanelNumber('Contract price')
      || getPanelNumber('Appraised value')
      || 0;
  }

  function readPageInputs() {
    const grossIncome = getGrossMonthlyIncome();
    const nonTaxableIncome = detectNonTaxableIncome();
    const monthlyDebts = getMonthlyDebts();
    const piti = getProposedPITI();
    const married = /^(married|separated)$/.test(getMaritalStatus());
    // Household head count: every borrower on the loan counts as a
    // household member. If the primary is married but their spouse
    // ISN'T on the loan, add the spouse separately. With multiple
    // borrowers we assume any "Married" status refers to one of the
    // other borrowers (most common case), so we don't double-count —
    // take the max of borrower count vs. solo-married (1+1).
    const borrowerCount = getBorrowerCount();
    const householdAdults = Math.max(borrowerCount, 1 + (married ? 1 : 0));
    const familySize = householdAdults + getDependentCount();
    const state = getPropertyState();
    const region = regionFor(state);
    const loanAmount = getLoanAmount();
    const dti = getDTI();
    return {
      grossIncome,
      nonTaxableIncome,
      monthlyDebts,
      piti,
      // Sq footage of the subject property — the user edits this and
      // we derive the maintenance/utilities dollar amount from it
      // (sqft × MAINT_PER_SQFT). Used to be a dollar input that
      // required the user to do the math themselves.
      maintSqft: DEFAULT_SQFT,
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
    // Maintenance/utilities derives from sqft × $0.14. Older versions
    // stored it as a dollar amount the user typed directly; the input
    // is now sqft and we do the math.
    const sqft = (typeof state.maintSqft === 'number') ? state.maintSqft
               : (typeof state.maintenance === 'number' && state.maintenance > 0
                  ? Math.round(state.maintenance / MAINT_PER_SQFT)
                  : DEFAULT_SQFT);
    const maintenance = sqft * MAINT_PER_SQFT;
    const childcare = state.childcare || 0;
    const totalDeductions = fedTax + fica + stateTax + monthlyDebts + piti + maintenance + childcare;
    // LOP's "VA total deductions" field is what DU reads back from
    // the URLA — and DU treats it as the NON-housing, NON-debt
    // portion of deductions only (it subtracts PITI and monthly
    // debts separately from the URLA). If we put the full sum here,
    // DU double-counts PITI and debts and reports a residual income
    // ~$3,400 lower than reality. So we split the field into:
    //   totalDeductions: the full sum (gross − this = our residual)
    //   urlaDeductions:  just taxes + maintenance + childcare (what
    //                    LOP's "VA total deductions" field should
    //                    contain so DU's residual matches LPA's)
    const urlaDeductions = fedTax + fica + stateTax + maintenance + childcare;
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
      urlaDeductions: Math.round(urlaDeductions * 100) / 100,
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
    // Use urlaDeductions (taxes + maintenance + childcare only) for
    // LOP's "VA total deductions" field, NOT result.totalDeductions
    // which includes PITI + monthly debts. DU and other AUS readers
    // pull this field from the URLA and subtract housing + debts
    // SEPARATELY — so writing the full sum here causes DU to
    // double-count PITI + debts and report a residual ~$3.4k lower
    // than LPA / the actual VA formula. See diagnosis vs DU's
    // "Residual Income Actual: $-2499.32" report — that number is
    // exactly `gross − full-totalDeductions − PITI − debts`, which
    // is what DU does when we hand it the full sum.
    if (deductionsField && result.urlaDeductions != null) {
      setReactInputValue(deductionsField, result.urlaDeductions.toFixed(2));
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

    // Time-saved slot — populated asynchronously once the background
    // returns the updated user + global totals. ~8 min per residual calc
    // (manual income / debts / PITI / family-size / VA table lookups).
    const timeSavedSlot = document.createElement('div');
    timeSavedSlot.id = 'rric-time-saved';
    timeSavedSlot.style.padding = '0 14px 14px';
    panel.appendChild(timeSavedSlot);
    if (window.__zhlTimeSaved) {
      const mins = 8;
      window.__zhlTimeSaved.record('va-calc-residual', mins).then(function (r) {
        timeSavedSlot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }

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

    // Numeric input variant of addEditableRow: no "$" prefix, "sq ft"
    // suffix instead. Used for the Maintenance & utilities row so the
    // user enters square footage directly and the calc derives the
    // dollar amount (was: user typed dollars and had to do the math).
    function addSqftRow(label, value, computedSuffix, onChange) {
      const row = document.createElement('div');
      row.className = 'rric-row rric-editable';
      const lbl = document.createElement('div');
      lbl.className = 'rric-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'rric-value';
      const wrap = document.createElement('span');
      wrap.className = 'rric-input-wrap';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'rric-input';
      input.value = String(Math.max(0, Math.round(value || 0)));
      input.addEventListener('input', function () {
        const n = parseInt(String(input.value).replace(/[^0-9]/g, ''), 10);
        onChange(isFinite(n) ? n : 0);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); rerun.click(); }
      });
      const unit = document.createElement('span');
      unit.className = 'rric-input-suffix';
      unit.textContent = 'sq ft';
      unit.style.cssText = 'margin-left:6px;color:#6b7280;font-size:12px;';
      wrap.appendChild(input);
      wrap.appendChild(unit);
      val.appendChild(wrap);
      if (computedSuffix) {
        const sfx = document.createElement('div');
        sfx.className = 'rric-suffix';
        sfx.textContent = computedSuffix;
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
      // Maintenance & utilities: user enters square footage; the calc
      // multiplies by $0.14/sqft. Showing the computed dollar amount
      // beneath the input so they can sanity-check the math.
      const sqftValue = (typeof state.maintSqft === 'number') ? state.maintSqft : DEFAULT_SQFT;
      const maintDollars = sqftValue * MAINT_PER_SQFT;
      addSqftRow(
        '− Maintenance & utilities',
        sqftValue,
        '= ' + fmt(maintDollars) + '  (sq ft × $0.14)',
        function (v) { state.maintSqft = v; }
      );
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

  // ---- VA Entitlement Calculator ----------------------------------------
  function showEntitlementPanel() {
    const existing = document.getElementById(ENTITLEMENT_PANEL_ID);
    if (existing) existing.remove();
    const fontFamily = getPageFontFamily();

    const zip = getZipCode();
    const units = getUnitCount();
    const hintIdx = highCostIndexForZip(zip);
    // Prefill the purchase-price input from the page's purchase/sales
    // price, falling back to the loan amount only if no purchase price
    // is visible (the LO can correct it either way).
    const pagePurchase = getPurchasePrice() || getLoanAmount() || 0;

    // state. `purchase` is the PURCHASE PRICE (not the loan amount) —
    // the VA down-payment and no-down-max math is based on purchase
    // price, so the financed funding fee doesn't inflate the down.
    const st = {
      zip: zip || '',
      units: units,
      limitOverride: null,         // null = auto from ZIP/units; number = manual
      used: 0,
      purchase: pagePurchase
    };

    // Auto county loan limit from the ZIP (high-cost table) + unit count,
    // else the 2026 baseline.
    function autoLimit() {
      const idx = highCostIndexForZip(st.zip);
      const tuple = idx >= 0 ? VA_HIGH_COST_COUNTIES[idx].lim : VA_BASELINE_LIMITS;
      const i = Math.min(Math.max(st.units, 1), 4) - 1;
      return tuple[i];
    }
    function effLimit() {
      return (st.limitOverride != null && isFinite(st.limitOverride) && st.limitOverride > 0)
        ? st.limitOverride : autoLimit();
    }

    const panel = document.createElement('div');
    panel.id = ENTITLEMENT_PANEL_ID;
    panel.className = 'rric-panel';
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = 'VA Entitlement Calculator';
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

    const out = document.createElement('div');

    function money(n) {
      if (n == null || !isFinite(n)) return '—';
      const neg = n < 0;
      return (neg ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
    }

    function labeledRow(labelText) {
      const row = document.createElement('div');
      row.className = 'rric-row';
      const l = document.createElement('div');
      l.className = 'rric-label';
      l.textContent = labelText;
      const v = document.createElement('div');
      v.className = 'rric-value';
      row.appendChild(l);
      row.appendChild(v);
      body.appendChild(row);
      return v;
    }

    // Property ZIP (editable — auto-fills the county loan limit)
    const zipVal = labeledRow('Property ZIP');
    const zipInput = document.createElement('input');
    zipInput.type = 'text';
    zipInput.value = st.zip;
    zipInput.placeholder = '5-digit ZIP';
    zipInput.style.cssText = 'font:inherit;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;width:120px;';
    zipInput.addEventListener('input', function () {
      const m = /(\d{5})/.exec(zipInput.value || '');
      st.zip = m ? m[1] : (zipInput.value || '').trim();
      st.limitOverride = null; // re-derive the limit from the new ZIP
      render();
    });
    zipVal.appendChild(zipInput);

    // Units
    const unitsVal = labeledRow('Units');
    const unitsSel = document.createElement('select');
    unitsSel.style.cssText = 'font:inherit;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;';
    [1, 2, 3, 4].forEach(function (u) {
      const o = document.createElement('option');
      o.value = String(u);
      o.textContent = u + (u === 1 ? ' unit' : ' units');
      unitsSel.appendChild(o);
    });
    unitsSel.value = String(st.units);
    unitsSel.addEventListener('change', function () {
      st.units = parseInt(unitsSel.value, 10);
      st.limitOverride = null;
      render();
    });
    unitsVal.appendChild(unitsSel);

    // Editable resolved limit
    const limitVal = labeledRow('County loan limit ($)');
    const limitInput = document.createElement('input');
    limitInput.type = 'text';
    limitInput.style.cssText = 'font:inherit;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;width:140px;text-align:right;';
    limitInput.addEventListener('input', function () {
      const n = parseMoney(limitInput.value);
      st.limitOverride = isFinite(n) ? n : null;
      renderOutputs();
    });
    limitVal.appendChild(limitInput);

    // Entitlement used — persisted PER LOP FILE so the LO doesn't have
    // to retype it every time they reopen the calculator on the same
    // loan. Keyed on the LOP file UUID in the URL.
    const entFileKey = getEntitlementFileKey();
    const usedVal = labeledRow('Entitlement used by veteran ($)');
    const usedInput = document.createElement('input');
    usedInput.type = 'text';
    usedInput.value = '0';
    usedInput.style.cssText = 'font:inherit;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;width:140px;text-align:right;';
    usedInput.addEventListener('input', function () {
      const n = parseMoney(usedInput.value);
      st.used = isFinite(n) && n > 0 ? n : 0;
      setStoredEntitlementUsed(entFileKey, st.used); // persist per file
      renderOutputs();
    });
    usedVal.appendChild(usedInput);

    // Hydrate the saved "used" value for this file (async). Done after
    // the input is in the DOM; updates state + field + outputs if a
    // value was previously saved.
    getStoredEntitlementUsed(entFileKey).then(function (saved) {
      if (saved != null && isFinite(saved) && saved > 0) {
        st.used = saved;
        usedInput.value = String(Math.round(saved));
        renderOutputs();
      }
    });

    // Purchase price (the down-payment basis — NOT the loan amount).
    const targetVal = labeledRow('Purchase price ($) — optional');
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.value = st.purchase ? String(Math.round(st.purchase)) : '';
    targetInput.style.cssText = 'font:inherit;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;width:140px;text-align:right;';
    targetInput.addEventListener('input', function () {
      const n = parseMoney(targetInput.value);
      st.purchase = isFinite(n) && n > 0 ? n : 0;
      renderOutputs();
    });
    targetVal.appendChild(targetInput);

    body.appendChild(out);

    function renderOutputs() {
      const limit = effLimit();
      const used = st.used;
      const fullEntitlement = used <= 0;
      const availableGuaranty = Math.max(0.25 * limit - used, 0);
      // Max PURCHASE PRICE that still qualifies for $0 down: 4 ×
      // available guaranty (guaranty + down must equal 25% of the
      // purchase price; with $0 down the guaranty alone must cover 25%,
      // so purchase = available / 0.25 = available × 4).
      const maxNoDown = availableGuaranty * 4;
      const purchase = st.purchase;
      // VA down payment is based on the PURCHASE PRICE, not the loan
      // amount: down = max(25% × purchase − available guaranty, 0).
      const downForTarget = (purchase > 0) ? Math.max(0.25 * purchase - availableGuaranty, 0) : null;

      const lines = [];
      lines.push('<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #e5e7eb;"><span>Available guaranty (25% × limit − used)</span><strong>' +
        (fullEntitlement ? 'Full entitlement' : money(availableGuaranty)) + '</strong></div>');

      if (fullEntitlement) {
        lines.push('<div style="margin-top:8px;padding:12px 14px;border-radius:8px;background:#dcfce7;border:1px solid #16a34a;color:#14532d;">' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">No VA county limit — $0 down at any loan amount</div>' +
          '<div style="font-size:12.5px;">Full entitlement (nothing used). Post-2020, there is no VA loan limit and no down payment is required at any loan amount, subject to lender / investor maximums and the borrower qualifying.</div></div>');
      } else {
        lines.push('<div style="margin-top:8px;padding:12px 14px;border-radius:8px;background:#f0f6ff;border:1px solid #006aff;color:#0b3a6b;">' +
          '<div style="font-weight:700;font-size:14px;">Max purchase price with $0 down: ' + money(maxNoDown) + '</div>' +
          '<div style="font-size:12px;margin-top:4px;">= 4 × available guaranty (' + money(availableGuaranty) + '). Reduced entitlement is capped by the county limit (' + money(limit) + ').</div></div>');
      }

      if (purchase > 0) {
        // Base loan = purchase − down. The financed VA funding fee is
        // added on TOP of this and doesn't affect the down payment.
        const baseLoan = purchase - (downForTarget || 0);
        lines.push('<div style="margin-top:8px;padding:12px 14px;border-radius:8px;background:' +
          (downForTarget > 0 ? '#fef3c7;border:1px solid #d97706;color:#78350f' : '#dcfce7;border:1px solid #16a34a;color:#14532d') + ';">' +
          '<div style="font-weight:700;font-size:14px;">Down payment on a ' + money(purchase) + ' purchase: ' + money(downForTarget) + '</div>' +
          '<div style="font-size:12px;margin-top:4px;">' +
          (fullEntitlement
            ? '$0 down (full entitlement, subject to lender / investor max).'
            : (downForTarget > 0
              ? 'Required = 25% × purchase price − available guaranty. This purchase exceeds the $0-down max of ' + money(maxNoDown) + '. Base VA loan ≈ ' + money(baseLoan) + ' (before the financed funding fee).'
              : 'Within the $0-down max of ' + money(maxNoDown) + ' — no down payment required.')) +
          '</div></div>');
      }
      out.innerHTML = lines.join('');
    }

    // Footer: ZIP context + FHFA lookup
    const footer = document.createElement('div');
    footer.className = 'rric-panel-footer';
    const note = document.createElement('div');
    note.className = 'rric-panel-note';
    footer.appendChild(note);
    panel.appendChild(footer);

    function updateNote() {
      const zipOk = /^\d{5}$/.test(st.zip || '');
      const matched = highCostIndexForZip(st.zip) >= 0;
      let lead;
      if (!zipOk) {
        lead = 'Enter the property ZIP above, or type the county loan limit directly.';
      } else if (matched) {
        lead = 'ZIP <strong>' + st.zip + '</strong> matched a high-cost county — limit auto-filled.';
      } else {
        lead = 'ZIP <strong>' + st.zip + '</strong> isn\'t in the high-cost table — defaulted to baseline. If it\'s high-cost, edit the county loan limit above.';
      }
      note.innerHTML = lead +
        ' <a href="' + FHFA_LOOKUP_URL + '" target="_blank" rel="noopener" style="color:#0b5cab;font-weight:600;">FHFA county limit lookup</a>';
    }

    function render() {
      unitsSel.value = String(st.units);
      limitInput.value = String(Math.round(effLimit()));
      updateNote();
      renderOutputs();
    }

    // Time-saved slot
    const tsSlot = document.createElement('div');
    tsSlot.style.cssText = 'padding:0 18px 14px;';
    panel.appendChild(tsSlot);
    if (window.__zhlTimeSaved) {
      const mins = 5;
      window.__zhlTimeSaved.record('va-entitlement-calc', mins).then(function (r) {
        tsSlot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }

    document.body.appendChild(panel);
    render();
    track('va_entitlement_open', { highCost: hintIdx >= 0, units: units });
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
      //
      // Pair-on-one-tab layouts (primary + co-borrower rendered
      // side-by-side) require an extra constraint: the ancestor must
      // contain THIS borrower's veteranType only, not both — otherwise
      // both borrowers' walks land on the same outer container and
      // the de-dup below drops the co-borrower's section. So we
      // accept the FIRST ancestor that has an Employment table AND
      // exactly one veteranType select. If no such ancestor exists
      // (some legacy layouts), fall back to the wider one.
      let formScope = milSection;
      let fallbackScope = null;
      let walker = milSection;
      while (walker && walker !== document.body) {
        const hasEmployment = !!walker.querySelector('table[aria-label="Table for employments"]');
        if (hasEmployment) {
          if (!fallbackScope) fallbackScope = walker;
          const vtCount = walker.querySelectorAll('select[name="veteranType"]').length;
          if (vtCount === 1) {
            formScope = walker;
            break;
          }
        }
        walker = walker.parentElement;
      }
      if (formScope === milSection && fallbackScope) formScope = fallbackScope;
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
      btn.title = ZHL_TIP;
      const scope = sec.scope;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        activeFormScope = scope;
        runCalculator();
      });
      sec.anchor.appendChild(btn);

      // Sibling button: VA Entitlement Calculator.
      if (!sec.anchor.querySelector('.' + ENTITLEMENT_BUTTON_CLASS)) {
        const entBtn = document.createElement('button');
        entBtn.type = 'button';
        entBtn.className = 'rric-button ' + ENTITLEMENT_BUTTON_CLASS;
        entBtn.textContent = 'VA Entitlement Calc';
        entBtn.title = 'Max purchase with $0 down for the veteran\'s remaining entitlement, and the down payment required above that.\n\n' + ZHL_TIP;
        entBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          activeFormScope = scope;
          showEntitlementPanel();
        });
        sec.anchor.appendChild(entBtn);
      }
    }
  }

  // Always-on residual-income status indicator that sits next to the
  // borrower's "Surviving spouse" checkbox on the main form. Same
  // pass / caution / fail logic as the residual income panel — but
  // visible without opening the panel, and live-updates as the LO
  // changes income / debts / scenario. One badge per qualifying
  // borrower (each military section gets its own).
  const INLINE_INDICATOR_ATTR = 'data-zhl-residual-inline';

  function ensureInlineResidualIndicator() {
    // Sweep orphans first (their owner scope has been removed from
    // the DOM by LOP's tab-switch / re-render).
    document.querySelectorAll('[' + INLINE_INDICATOR_ATTR + ']').forEach(function (el) {
      const owner = el.__zhlOwnerScope;
      if (!owner || !document.body.contains(owner)) el.remove();
    });

    const sections = findMilitarySections();
    if (!sections.length) return;

    for (const sec of sections) {
      const vt = sec.vtSelect;
      const veteranTypeText = (vt.options[vt.selectedIndex] && vt.options[vt.selectedIndex].text) || '';
      const shouldShow = TRIGGER_VETERAN_TYPES.some(function (t) {
        return normalizeText(veteranTypeText) === normalizeText(t);
      });
      if (!shouldShow) {
        sec.scope.querySelectorAll('[' + INLINE_INDICATOR_ATTR + ']').forEach(function (n) { n.remove(); });
        continue;
      }
      const cb = sec.scope.querySelector('input[name="survivingSpouse"]');
      if (!cb || cb.offsetParent === null) continue;
      // Find the StyledLabeledControl wrapper and use its parent as the
      // insert host — that puts the badge inline with the checkbox in
      // its surrounding Flex row.
      let labeled = cb.parentElement;
      while (labeled && labeled !== document.body) {
        if (labeled.matches && labeled.matches('[class*="StyledLabeledControl"]')) break;
        labeled = labeled.parentElement;
      }
      const host = (labeled && labeled.parentElement) || cb.parentElement;
      if (!host) continue;

      // Compute residual income from THIS borrower's form scope. The
      // helper readers all use activeFormScope, so we swap it in for
      // the duration of the read and restore afterward.
      const savedActiveScope = activeFormScope;
      let result, state;
      try {
        activeFormScope = sec.scope;
        state = readPageInputs();
        result = calculate(state);
      } catch (_) {
        activeFormScope = savedActiveScope;
        continue;
      }
      activeFormScope = savedActiveScope;

      if (!isFinite(result.residualIncome) || result.requirement == null) {
        const existing = host.querySelector('[' + INLINE_INDICATOR_ATTR + ']');
        if (existing) existing.remove();
        continue;
      }

      const usesUplift = !!(result.dtiOver41 && result.requirement120 != null);
      const effective = usesUplift ? result.requirement120 : result.requirement;
      const delta = result.residualIncome - effective;
      // delta < 0:        fail (red)
      // 0 ≤ delta ≤ 200:  caution (yellow) — passing but close enough
      //                    that a tax / debt swing could flip them
      // delta > 200:      pass (green)
      const status = delta < 0 ? 'fail' : (delta <= 200 ? 'caution' : 'pass');
      const colors = status === 'pass'
        ? { bg: '#dcfce7', border: '#16a34a', text: '#14532d', dot: '#16a34a' }
        : status === 'fail'
          ? { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', dot: '#dc2626' }
          : { bg: '#fef3c7', border: '#d97706', text: '#78350f', dot: '#d97706' };
      const iconChar = status === 'pass' ? '✓' : (status === 'fail' ? '✗' : '!');
      const verb = status === 'pass' ? 'Meets' : (status === 'fail' ? 'Below' : 'Close to');
      const ruleLabel = usesUplift ? 'VA 120% requirement' : 'VA requirement';
      const deltaStr = (delta >= 0 ? '+' : '−') + '$' +
        Math.abs(delta).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      let badge = host.querySelector('[' + INLINE_INDICATOR_ATTR + ']');
      if (!badge) {
        badge = document.createElement('div');
        badge.setAttribute(INLINE_INDICATOR_ATTR, '1');
        badge.__zhlOwnerScope = sec.scope;
        host.appendChild(badge);
      }
      badge.style.cssText =
        'display:inline-flex;align-items:center;gap:8px;' +
        'margin-left:16px;padding:5px 14px 5px 6px;border-radius:999px;' +
        'font:600 12px Arial,Helvetica,sans-serif;letter-spacing:.02em;' +
        'vertical-align:middle;cursor:default;white-space:nowrap;' +
        'background:' + colors.bg + ';border:1px solid ' + colors.border + ';' +
        'color:' + colors.text + ';';
      badge.innerHTML = '';
      const iconEl = document.createElement('span');
      iconEl.textContent = iconChar;
      iconEl.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;' +
        'width:18px;height:18px;border-radius:50%;flex:0 0 auto;' +
        'background:' + colors.dot + ';color:#fff;font-size:11px;font-weight:700;';
      const labelEl = document.createElement('span');
      labelEl.textContent = verb + ' ' + ruleLabel + ' (' + deltaStr + ')';
      badge.appendChild(iconEl);
      badge.appendChild(labelEl);
      badge.title =
        'Residual income: ' + fmt(result.residualIncome) + '\n' +
        (usesUplift
          ? 'VA 120% requirement (DTI ' + (state.dti != null ? state.dti.toFixed(2) + '% > 41%' : 'over 41%') + '): ' + fmt(effective)
          : 'VA table requirement' + (state.dti != null ? ' (DTI ' + state.dti.toFixed(2) + '% ≤ 41%)' : '') + ': ' + fmt(effective)) +
        '\nDelta: ' + deltaStr +
        '\n\nLive from the page — recomputes as you edit income / debts / scenario. Open Run Residual Income Calc for the full breakdown.\n\n' +
        ZHL_TIP;
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
      btn.title = ZHL_TIP;
      const scopedTable = sec.table;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showStudentLoanPicker(scopedTable);
      });
      const group = getOrCreateLiabilitiesGroup(sec);
      group.appendChild(btn);
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rric-button ' + EXCLUDE_TELECOM_BUTTON_CLASS;
      btn.textContent = 'Exclude SelfReport';
      btn.title = 'Mark every TELECOM SELFREPORTED and UTILITY SELFREPORTED liability as Excluded with reason "Installment debt less than 10 payments".\n\n' + ZHL_TIP;
      const scopedTable = sec.table;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        excludeTelecomSelfReportedAll(btn, scopedTable);
      });
      const group = getOrCreateLiabilitiesGroup(sec);
      group.appendChild(btn);
    }
  }

  // "5% Collections" — FHA 4000.1 lets lenders satisfy the cumulative-
  // collections rule (when non-medical collection balances total
  // >= $2,000) by including 5% of each collection's unpaid balance as
  // a monthly debt in DTI, instead of paying off or excluding the
  // accounts. This button automates that: expand each collection row,
  // set monthly payment to balance × 0.05, save, repeat.
  function ensureCollections5pctButton() {
    const sections = findLiabilitiesHeaders();
    if (!sections.length) return;
    for (const sec of sections) {
      if (sec.container.querySelector('.' + COLLECTIONS_5PCT_BUTTON_CLASS)) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rric-button ' + COLLECTIONS_5PCT_BUTTON_CLASS;
      btn.textContent = '5% Collections';
      btn.title = 'Set each non-medical collection account\'s monthly payment to 5% of its unpaid balance. Use when the FHA cumulative collections balance exceeds $' + FHA_COLLECTION_CAP.toLocaleString() + ' and you\'re applying the 5%-of-balance DTI rule per FHA 4000.1.\n\nSkips medical collections (excluded from FHA DTI) and rows where a payment is already set manually.\n\n' + ZHL_TIP;
      const scopedTable = sec.table;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        addFivePctToCollections(btn, scopedTable);
      });
      const group = getOrCreateLiabilitiesGroup(sec);
      group.appendChild(btn);
    }
  }

  async function addFivePctToCollections(button, scopeTable) {
    const RATE = 0.05;
    const origText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Working…'; }
    console.group('[5% Collections] run started');
    try {
      const liabilityRows = findLiabilityRows(scopeTable);
      const loanId = getLoanId();
      const ourPayments = await getOurPayments(loanId);
      const updated = [];
      const skipped = [];
      let detected = 0;

      // Build a remarks-aware collection set from the React probe (same
      // determination the Total Collections badge uses), so accounts
      // that are collections ONLY by remarks — e.g. a charge-off whose
      // remarks say "SUBMITTED TO COLLECTION" (Verizon) — get the 5%
      // payment too, not just type=Collection/Unknown rows. Matched to
      // DOM rows by payee + balance.
      const collKey = function (payee, bal) {
        return normalizeText(payee) + '|' + Math.round(Number(bal) || 0);
      };
      const reactCollKeys = new Set();
      try {
        await refreshReactCacheIfDue();
        if (reactReadInFlight) { try { await reactReadInFlight; } catch (_) {} }
        const tables = cachedReactTables || [];
        for (const tbl of tables) {
          const items = (tbl && tbl.read && tbl.read.items) || [];
          for (const item of items) {
            if (!classifyLiabilityFromReact(item).length) continue;
            const attrs = (item && item.attributes) || {};
            const payee = String(attrs.creditor || '');
            const bal = Number(attrs.unpaidBalance) || 0;
            if (bal <= 0 || isMedicalPayee(payee)) continue;
            reactCollKeys.add(collKey(payee, bal));
          }
        }
      } catch (_) {}

      for (const lib of liabilityRows) {
        const isColl = isCollectionAccount(lib.accountType) ||
          reactCollKeys.has(collKey(lib.payee, lib.balance));
        if (!isColl) continue;
        detected++;

        if (isMedicalPayee(lib.payee)) {
          skipped.push({ lib: lib, reason: 'Medical collection — excluded from FHA DTI' });
          continue;
        }
        if (!lib.balance || lib.balance <= 0) {
          skipped.push({ lib: lib, reason: 'No unpaid balance' });
          continue;
        }

        const computed = Math.round(lib.balance * RATE * 100) / 100;
        const key = liabilityKey(lib);
        const ours = ourPayments[key];

        // If a non-zero payment is already there and we didn't set it,
        // and it doesn't match the 5% figure, leave it alone — could
        // be a verified per-agreement payment the LO entered manually.
        if (lib.payment > 0 && !ours && Math.abs(lib.payment - computed) > 0.5) {
          skipped.push({
            lib: lib,
            reason: 'Payment already set (' + lib.paymentText + ') — entered manually, not overwritten'
          });
          continue;
        }
        if (lib.payment > 0 && Math.abs(lib.payment - computed) <= 0.5) {
          skipped.push({ lib: lib, reason: 'Already at 5% (' + lib.paymentText + ')' });
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
        const excludeFlag = editForm.querySelector('input[name="exclude"]');
        if (excludeFlag && excludeFlag.checked) {
          skipped.push({ lib: lib, reason: 'Exclude flag is set' });
          await toggleLiabilityRow(lib.tr, false);
          continue;
        }
        const payoff = editForm.querySelector('input[name="payoff"]');
        if (payoff && payoff.checked) {
          skipped.push({ lib: lib, reason: 'Payoff flag is set' });
          await toggleLiabilityRow(lib.tr, false);
          continue;
        }
        const paymentInput = editForm.querySelector('input[name="monthlyPayment"]');
        if (!paymentInput) {
          skipped.push({ lib: lib, reason: 'Monthly payment input not found' });
          await toggleLiabilityRow(lib.tr, false);
          continue;
        }

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
        if (typeof saveBtn.click === 'function') saveBtn.click();
        else simulateClick(saveBtn);

        let saved = false;
        for (let i = 0; i < 200; i++) {
          await waitMs(50);
          if (!isLiabilityRowExpanded(lib.tr)) { saved = true; break; }
        }
        if (saved) {
          await setOurPayment(loanId, key, {
            calc: 'collections-5pct',
            payment: computed,
            balance: lib.balance,
            ts: Date.now()
          });
          updated.push({ lib: lib, payment: computed, previousPayment: lib.payment });
          // Settle between rows so React finishes the rerender.
          await waitMs(250);
        } else {
          skipped.push({
            lib: lib,
            reason: 'Save did not complete within 10s. Value entered ' + fmt(computed) +
                    '; row left expanded for manual review.'
          });
        }
      }

      console.log('[5% Collections] done. detected=' + detected + ' updated=' + updated.length + ' skipped=' + skipped.length);
      try { track('collections_5pct', { detected: detected, updated: updated.length, skipped: skipped.length }); } catch (_) {}
      showCollections5pctSummary({ detected: detected, updated: updated, skipped: skipped, loanId: loanId });
    } catch (e) {
      console.error('[5% Collections] run failed:', e);
      alert('5% Collections hit an error: ' + (e && e.message || e));
    } finally {
      console.groupEnd();
      if (button) { button.disabled = false; button.textContent = origText; }
    }
  }

  function showCollections5pctSummary(results) {
    const existing = document.getElementById(COLLECTIONS_5PCT_PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = COLLECTIONS_5PCT_PANEL_ID;
    panel.className = 'rric-panel';
    const fontFamily = getPageFontFamily();
    if (fontFamily) panel.style.fontFamily = fontFamily;

    const header = document.createElement('div');
    header.className = 'rric-panel-header';
    const title = document.createElement('div');
    title.className = 'rric-panel-title';
    title.textContent = '5% Collections: ' + results.updated.length + ' updated, ' + results.skipped.length + ' skipped';
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

    addLine('Formula', '5% × unpaid balance (FHA 4000.1)');
    addLine('Collections detected', String(results.detected));
    addLine('Updated', String(results.updated.length));
    addLine('Skipped', String(results.skipped.length));

    if (results.updated.length > 0) {
      addSubhead('Updated');
      for (const u of results.updated) {
        const who = u.lib.borrower ? ' — ' + u.lib.borrower : '';
        addLine(u.lib.payee + who, fmt(u.payment));
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
      addSubhead('No collections found');
      const note = document.createElement('p');
      note.className = 'rric-intro';
      note.textContent = 'No liability rows had Account type "Collection" or "Unknown" (collection-agency rows). If a row should have been included, expand it and check the Account type dropdown.';
      body.appendChild(note);
    }

    // Time saved: ~2 min vs hand-expanding each collection, calculating
    // 5% of balance, and typing the payment. Only credit when at least
    // one row actually got updated.
    if (results && results.updated && results.updated.length > 0 && window.__zhlTimeSaved) {
      const slot = document.createElement('div');
      slot.style.padding = '0 14px 14px';
      panel.appendChild(slot);
      const mins = 2;
      window.__zhlTimeSaved.record('va-calc-collections-5pct', mins).then(function (r) {
        slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }

    panel.appendChild(body);
    document.body.appendChild(panel);
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
        return EXCLUDE_SELFREPORT_PAYEE_RX.test(r.payee || '');
      });
      console.log('[Exclude SelfReport] matching TELECOM/UTILITY SELFREPORTED payee:', matches.length,
        matches.map(function (m) { return m.payee + ' / ' + m.accountNo; }));
      if (!matches.length) {
        alert('No "TELECOM SELFREPORTED" or "UTILITY SELFREPORTED" liabilities found on this page.');
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
        alert('Excluded ' + okCount + ' self-reported liabilit' + (okCount === 1 ? 'y' : 'ies') + ' (TELECOM / UTILITY).');
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

  // Per-LOP-file key for persisting the VA Entitlement Calculator's
  // "Entitlement used by veteran" amount. The LOP file URL is
  //   …/loan-officer-portal/<uuid>/pricing-and-scenarios/…
  // so the UUID right after loan-officer-portal/ uniquely identifies
  // the file. Fall back to the ZG-loan-id helper, then a path slug,
  // so the value still persists (just less precisely) on URLs without
  // the UUID segment.
  function getEntitlementFileKey() {
    const m = (location.pathname || '').match(/loan-officer-portal\/([0-9a-f-]{8,})/i);
    if (m) return m[1].toLowerCase();
    try {
      const lid = getLoanId();
      if (lid && lid.indexOf('unknown-') !== 0) return lid;
    } catch (_) {}
    return 'path-' + (location.pathname || '').replace(/[^a-z0-9]/gi, '-').slice(-40);
  }

  const ENTITLEMENT_USED_STORE = 'rric_vaEntitlementUsed';

  function getStoredEntitlementUsed(fileKey) {
    if (!hasChromeStorage()) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([ENTITLEMENT_USED_STORE], function (data) {
          const all = (data && data[ENTITLEMENT_USED_STORE]) || {};
          const rec = all[fileKey];
          resolve(rec && isFinite(rec.used) ? rec.used : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  function setStoredEntitlementUsed(fileKey, used) {
    if (!hasChromeStorage()) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([ENTITLEMENT_USED_STORE], function (data) {
          const all = (data && data[ENTITLEMENT_USED_STORE]) || {};
          // Prune entries older than 180 days so the store can't grow
          // unbounded across every VA file the LO ever touches.
          const now = Date.now();
          Object.keys(all).forEach(function (k) {
            const ts = all[k] && all[k].ts;
            if (ts && (now - ts) > 180 * 24 * 60 * 60 * 1000) delete all[k];
          });
          if (used > 0) {
            all[fileKey] = { used: used, ts: now };
          } else {
            // Clearing the field back to 0 removes the saved value.
            delete all[fileKey];
          }
          chrome.storage.local.set({ [ENTITLEMENT_USED_STORE]: all }, function () { resolve(); });
        });
      } catch (_) { resolve(); }
    });
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

      // LOP's liability edit form enforces "Monthly payment must
      // be greater than or equal to $1" — a small balance × 0.5%
      // can compute to e.g. $0.89, which LOP rejects with a
      // validation error and the row never saves. Clamp to the
      // form's floor so the row commits cleanly.
      const computed = Math.max(1, Math.round(lib.balance * calc.rate * 100) / 100);
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

    // Time saved: ~4 min vs hand-applying FHA/DU/LPA/VA student-loan
    // payment formulas to each row and typing each payment manually.
    // Only credit when at least one row got an updated payment.
    if (results && results.updated && results.updated.length > 0 && window.__zhlTimeSaved) {
      const slot = document.createElement('div');
      slot.style.padding = '0 14px 14px';
      panel.appendChild(slot);
      const mins = 4;
      window.__zhlTimeSaved.record('va-calc-student-loans', mins).then(function (r) {
        slot.innerHTML = window.__zhlTimeSaved.renderHtml(mins, r.userTotal, r.globalTotal);
      });
    }

    document.body.appendChild(panel);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try { ensureButtonState(); } catch (e) { console.error('[Residual Income Calc] observer error', e); }
      try { ensureInlineResidualIndicator(); } catch (e) { console.error('[Residual Income inline] observer error', e); }
      try { ensureStudentLoanButton(); } catch (e) { console.error('[Residual Income Calc] sloan observer error', e); }
      try { ensureExcludeTelecomButton(); } catch (e) { console.error('[Exclude SelfReport] observer error', e); }
      try { ensureCollections5pctButton(); } catch (e) { console.error('[5% Collections] observer error', e); }
      try { ensureCollectionsBadge(); } catch (e) { console.error('[Collections Badge] observer error', e); }
      try { ensureDisputedBadge(); } catch (e) { console.error('[Disputed Badge] observer error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  schedule();

  // Public-ish API for sibling modules in the same isolated world.
  // The FHA Manual UW Analyzer (fha-manual-eligible.js) calls this so
  // it can auto-evaluate the "Residual income — VA tables" compensating
  // factor without making the user click into the VA calc first.
  window.ZHL_VA_CALC_API = window.ZHL_VA_CALC_API || {};
  window.ZHL_VA_CALC_API.computeResidualForPage = function () {
    try {
      const state = readPageInputs();
      if (!state || !state.grossIncome) return null;
      const result = calculate(state);
      if (result.residualIncome == null || result.requirement == null) return null;
      return {
        residualIncome: result.residualIncome,
        requirement: result.requirement,
        // VA bumps the requirement to 120% when back-end DTI > 41%.
        requirementEffective: result.dtiOver41 && result.requirement120 != null
          ? result.requirement120 : result.requirement,
        passes: result.residualIncome >= (result.dtiOver41 && result.requirement120 != null
          ? result.requirement120 : result.requirement),
        familySize: state.familySize,
        region: state.region,
        loanAmount: state.loanAmount,
        dtiOver41: !!result.dtiOver41
      };
    } catch (e) {
      console.warn('[VA Calc API] computeResidualForPage threw', e);
      return null;
    }
  };
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
