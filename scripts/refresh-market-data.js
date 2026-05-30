#!/usr/bin/env node
// refresh-market-data.js
// Periodic OFFLINE enrichment: pull REAL Indian labour-market data from the Adzuna
// API into data/careers.json, then regenerate data/data.js.
//
// What Adzuna actually provides well (and what we use it for):
//   - adzuna_listings.count  ← live listing COUNT for the role in India (search `count`).
//                              Shown directly as "N live listings (Adzuna IN)" — never
//                              normalized into the matcher's job_density heuristic.
//   - salary_inr             ← salary histogram percentiles, with a search-results-median
//                              fallback. Falls back to hand-authored when Adzuna is too thin.
//
// Deliberately LEFT hand-authored (Adzuna is the wrong / no source):
//   - job_density, growth    ← curated 0..1 heuristics the matcher relies on. Adzuna IN is
//                              tech-listing-skewed, so deriving these from it degrades non-tech
//                              roles. NOT touched here.
//   - budget_tier / estimated_cost, preferred_locations, vector, exams  ← unchanged.
//
// Each career gets a _market_meta block recording true provenance, so the UI never labels an
// estimate as "Adzuna". Any field Adzuna can't fill keeps its hand-authored value.
//
// Usage:
//   node scripts/refresh-market-data.js --dry-run     # show diffs, write nothing
//   node scripts/refresh-market-data.js               # fetch, write careers.json, regen data.js
//   node scripts/refresh-market-data.js --limit 3     # only first 3 careers (save quota)
//   node scripts/refresh-market-data.js --with-salary # also derive salary (OFF by default —
//                                                       Adzuna IN salary data skews junior and
//                                                       proved less accurate than the curated bands)
//
// Credentials (free signup at https://developer.adzuna.com):
//   ADZUNA_APP_ID, ADZUNA_APP_KEY  — via real env vars or a local .env file (see .env.example)

'use strict';

const fs = require('fs');
const path = require('path');
const { build: buildDataJs } = require('./generate-data-js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CAREERS_PATH = path.join(DATA_DIR, 'careers.json');
const COUNTRY = 'in';
const API_BASE = 'https://api.adzuna.com/v1/api/jobs/' + COUNTRY;

// A national listing count below this is flagged low-coverage so the UI can caveat it.
const LOW_COVERAGE_COUNT = 10;
// Minimum salaried listings before trusting the search-median salary fallback.
const SALARY_MIN_LISTINGS = 8;

// --- CLI flags ------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// Salary is OFF by default: Adzuna IN salary data skews junior and proved less reliable than the
// curated entry/mid/senior bands. Pass --with-salary to opt in (best-effort, labeled honestly).
const WITH_SALARY = args.includes('--with-salary');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();
const DELAY_MS = (() => {
  const i = args.indexOf('--delay');
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : 2600; // ~23 calls/min, under Adzuna's 25/min
})();

// --- minimal .env loader (no dependency) ----------------------------------
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) return;
    const key = m[1];
    const val = m[2].replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  });
}

// --- helpers --------------------------------------------------------------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function authQuery() {
  return 'app_id=' + encodeURIComponent(process.env.ADZUNA_APP_ID) +
         '&app_key=' + encodeURIComponent(process.env.ADZUNA_APP_KEY);
}

// Default search term for a career when no explicit `market_query` is set in careers.json.
function queryFor(career) {
  return career.market_query || career.name.en.replace(/\s*\(.*?\)\s*/g, '').trim();
}

function redact(url) {
  return url.replace(/app_key=[^&]+/, 'app_key=***').replace(/app_id=[^&]+/, 'app_id=***');
}

// fetch JSON with retry/backoff on 429 + 5xx.
async function getJson(url, attempt = 1) {
  const MAX = 4;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    if (attempt < MAX) { await sleep(1500 * attempt); return getJson(url, attempt + 1); }
    throw e;
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt < MAX) { await sleep(2000 * attempt); return getJson(url, attempt + 1); }
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' for ' + redact(url) + ' :: ' + txt.slice(0, 200));
  }
  return res.json();
}

// --- Adzuna-backed derivations --------------------------------------------

// Real national listing count for the role in India. count:0 is a truthful answer
// (Adzuna has no IN listings for that term) and is written as-is, flagged low-coverage.
async function deriveListings(career) {
  const url = API_BASE + '/search/1?' + authQuery() +
    '&what=' + encodeURIComponent(queryFor(career)) + '&results_per_page=1';
  const data = await getJson(url);
  const count = (data && typeof data.count === 'number') ? data.count : null;
  return count == null ? null : { count: count, query: queryFor(career) };
}

// salary_inr from the histogram (p25/p50/p85); falls back to the median of salaries on up
// to 50 search results. Returns null when neither path has enough signal (→ keep estimate).
async function deriveSalary(career) {
  const round = (n) => Math.round(n / 10000) * 10000;

  // 1) histogram percentiles
  const histUrl = API_BASE + '/histogram?' + authQuery() + '&what=' + encodeURIComponent(queryFor(career));
  const hd = await getJson(histUrl);
  const hist = hd && hd.histogram;
  if (hist) {
    const buckets = Object.keys(hist)
      .map((k) => ({ salary: Number(k), count: Number(hist[k]) }))
      .filter((b) => isFinite(b.salary) && b.count > 0)
      .sort((a, b) => a.salary - b.salary);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    if (total >= 20 && buckets.length >= 3) {
      const at = (p) => {
        const target = total * p; let cum = 0;
        for (const b of buckets) { cum += b.count; if (cum >= target) return b.salary; }
        return buckets[buckets.length - 1].salary;
      };
      let entry = round(at(0.25)), mid = round(at(0.50)), senior = round(at(0.85));
      mid = Math.max(mid, entry); senior = Math.max(senior, mid);
      if (entry > 0) return { entry, mid, senior, n: total, method: 'histogram' };
    }
  }

  // 2) fallback: median of salaries on search results
  await sleep(DELAY_MS);
  const searchUrl = API_BASE + '/search/1?' + authQuery() +
    '&what=' + encodeURIComponent(queryFor(career)) + '&results_per_page=50';
  const sd = await getJson(searchUrl);
  const results = (sd && sd.results) || [];
  const salaries = [];
  results.forEach((r) => {
    const lo = Number(r.salary_min), hi = Number(r.salary_max);
    if (isFinite(lo) && lo > 0 && isFinite(hi) && hi > 0) salaries.push((lo + hi) / 2);
    else if (isFinite(lo) && lo > 0) salaries.push(lo);
    else if (isFinite(hi) && hi > 0) salaries.push(hi);
  });
  if (salaries.length < SALARY_MIN_LISTINGS) return null;
  salaries.sort((a, b) => a - b);
  const median = salaries[Math.floor(salaries.length / 2)];
  const mid = round(median), entry = round(median * 0.7), senior = round(median * 1.8);
  if (entry <= 0) return null;
  return { entry, mid, senior, n: salaries.length, method: 'search-median' };
}

// --- main -----------------------------------------------------------------
async function main() {
  loadDotEnv();
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) {
    console.error('ERROR: ADZUNA_APP_ID / ADZUNA_APP_KEY not set.');
    console.error('Get a free key at https://developer.adzuna.com and put them in .env (see .env.example).');
    process.exit(1);
  }
  if (typeof fetch !== 'function') {
    console.error('ERROR: global fetch() unavailable. Use Node 18+.');
    process.exit(1);
  }

  const careersDoc = readJson(CAREERS_PATH);
  const todo = careersDoc.careers.slice(0, LIMIT);
  const refreshedAt = new Date().toISOString().slice(0, 10);

  console.log('[refresh] ' + todo.length + ' careers · ' + (DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE') +
    ' · delay ' + DELAY_MS + 'ms · salary ' + (WITH_SALARY ? 'on' : 'off (hand-authored)'));

  const diffs = [];
  for (const c of todo) {
    process.stdout.write('  • ' + c.name.en + ' … ');
    let listings = null, salary = null, err = null;
    try {
      listings = await deriveListings(c); await sleep(DELAY_MS);
      if (WITH_SALARY) { salary = await deriveSalary(c); await sleep(DELAY_MS); }
    } catch (e) { err = e.message; }

    const meta = {
      listings_source: 'estimate',
      salary_source: 'hand-authored (estimate)',
      refreshed_at: refreshedAt
    };
    const changes = [];

    // Real live-listing count (never feeds job_density / matcher).
    if (listings) {
      const rec = {
        count: listings.count,
        coverage: listings.count < LOW_COVERAGE_COUNT ? 'low' : 'ok',
        query: listings.query,
        fetched_at: refreshedAt
      };
      changes.push(['adzuna_listings', JSON.stringify(c.adzuna_listings || null), JSON.stringify(rec)]);
      c.adzuna_listings = rec;
      meta.listings_source = 'Adzuna IN search count';
    }

    // Salary (real when Adzuna had signal; else keep hand-authored).
    if (salary) {
      const next = { entry: salary.entry, mid: salary.mid, senior: salary.senior };
      changes.push(['salary_inr', JSON.stringify(c.salary_inr), JSON.stringify(next)]);
      c.salary_inr = next;
      meta.salary_source = 'Adzuna IN ' + salary.method + ' (n=' + salary.n + ')';
    }

    c._market_meta = meta;
    if (changes.length || err) diffs.push({ name: c.name.en, changes, err });
    console.log(err ? ('ERR (' + err + ')') : 'ok');
  }

  console.log('\n── Changes ──────────────────────────────────────────────');
  if (!diffs.length) console.log('  (none)');
  diffs.forEach((d) => {
    console.log('  ' + d.name + (d.err ? '   [partial: ' + d.err + ']' : ''));
    d.changes.forEach(([field, oldv, newv]) => console.log('      ' + field + ': ' + oldv + '  →  ' + newv));
  });

  if (DRY_RUN) { console.log('\n[refresh] dry-run — nothing written.'); return; }

  fs.writeFileSync(CAREERS_PATH, JSON.stringify(careersDoc, null, 2) + '\n', 'utf8');
  console.log('\n[refresh] wrote ' + path.relative(process.cwd(), CAREERS_PATH));
  fs.writeFileSync(path.join(DATA_DIR, 'data.js'), buildDataJs(), 'utf8');
  console.log('[refresh] regenerated data/data.js');
}

main().catch((e) => { console.error(e); process.exit(1); });
