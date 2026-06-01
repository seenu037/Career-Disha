// CareerDisha LLM-call composer.
//
// Two responsibilities:
//   1. buildSlimPrompt(formData, matches) — produce a small system + user prompt
//      that asks the LLM only for narrative-style content. Match scores, salary
//      bands, supply/demand, portals, scholarships, entry routes etc. are all
//      computed deterministically here, NOT requested from the model.
//   2. mergeLLMResponse(llm, formData, matches) — fold the LLM's narrative
//      output back together with the deterministic data into the exact JSON
//      shape that renderAll() in index.html expects, so the rendering
//      code is unchanged.
//
// Net effect: the LLM no longer generates 5 careers from scratch with full
// schemas (~3000-4000 output tokens). It writes ~1500 tokens of narrative
// for pre-selected careers — roughly 2-3× more requests on the same free tier.

(function () {
  'use strict';

  if (!window.CAREER_DATA) {
    console.error('[CareerDisha] composer.js loaded before data.js — fix script order');
    return;
  }

  // ── Domain labels (shown above career card title) ──────────────────────
  var DOMAIN_LABEL = {
    'software-engineer': 'Engineering & IT',
    'data-scientist': 'Engineering & IT',
    'cybersecurity-analyst': 'Engineering & IT',
    'mechanical-engineer': 'Engineering',
    'civil-engineer': 'Engineering',
    'electronics-engineer': 'Engineering',
    'aerospace-engineer': 'Engineering',
    'architect': 'Architecture & Design',
    'doctor-mbbs': 'Medicine & Healthcare',
    'dentist-bds': 'Medicine & Healthcare',
    'pharmacist': 'Medicine & Healthcare',
    'veterinarian': 'Medicine & Agriculture',
    'physiotherapist': 'Medicine & Healthcare',
    'nurse': 'Medicine & Healthcare',
    'chartered-accountant': 'Finance & Commerce',
    'investment-banker': 'Finance & Commerce',
    'financial-analyst': 'Finance & Commerce',
    'company-secretary': 'Finance & Commerce',
    'business-analyst': 'Business & Strategy',
    'lawyer': 'Law',
    'civil-servant': 'Government & Civil Services',
    'journalist': 'Media & Journalism',
    'psychologist': 'Healthcare & Counseling',
    'teacher': 'Education',
    'graphic-designer': 'Design & Creative',
    'digital-marketer': 'Marketing & Business',
    'fashion-designer': 'Design & Creative',
    'hotel-management': 'Hospitality',
    'defence-officer': 'Defence',
    'agricultural-scientist': 'Agriculture & Research',
    'ai-ml-engineer': 'Engineering & IT', 'cloud-engineer': 'Engineering & IT', 'blockchain-developer': 'Engineering & IT',
    'robotics-engineer': 'Engineering & Robotics', 'electrical-engineer': 'Engineering', 'biomedical-engineer': 'Engineering & Healthcare',
    'environmental-scientist': 'Environment & Research', 'urban-planner': 'Planning & Architecture',
    'game-developer': 'Design & Technology', 'ux-designer': 'Design & Technology', 'animator-vfx': 'Design & Creative',
    'interior-designer': 'Design & Creative', 'photographer': 'Design & Creative', 'content-creator': 'Media & Creative',
    'dietitian': 'Healthcare & Nutrition', 'public-health-specialist': 'Healthcare & Public Policy', 'forensic-scientist': 'Science & Law Enforcement',
    'entrepreneur': 'Business & Strategy', 'supply-chain-manager': 'Business & Operations', 'hr-manager': 'Business & People',
    'ecommerce-manager': 'Marketing & Business', 'real-estate-manager': 'Business & Real Estate', 'insurance-professional': 'Finance & Commerce',
    'event-manager': 'Hospitality & Events', 'ir-specialist': 'Government & Diplomacy', 'nonprofit-manager': 'Social Impact',
    'translator': 'Languages & Media', 'pr-specialist': 'Media & Communications', 'pilot': 'Aviation'
  };

  // ── Degree templates (used in entry_route) ─────────────────────────────
  var DEGREE_FOR = {
    'software-engineer': 'B.Tech CSE',
    'data-scientist': 'B.Tech + MS Data Science',
    'cybersecurity-analyst': 'B.Tech CSE / Cyber',
    'mechanical-engineer': 'B.Tech Mechanical',
    'civil-engineer': 'B.Tech Civil',
    'electronics-engineer': 'B.Tech ECE',
    'aerospace-engineer': 'B.Tech Aerospace',
    'architect': 'B.Arch (5 yrs)',
    'doctor-mbbs': 'MBBS (5.5 yrs)',
    'dentist-bds': 'BDS (5 yrs)',
    'pharmacist': 'B.Pharm',
    'veterinarian': 'B.V.Sc.',
    'physiotherapist': 'BPT',
    'nurse': 'B.Sc Nursing',
    'chartered-accountant': 'CA (Foundation → Inter → Final)',
    'investment-banker': 'B.Com / BBA → MBA Finance',
    'financial-analyst': 'B.Com → MBA / CFA',
    'company-secretary': 'CS (Foundation → Executive → Professional)',
    'business-analyst': 'B.Tech / BBA → MBA',
    'lawyer': 'BA LLB / LLB (5 yrs)',
    'civil-servant': 'Any Bachelor\'s → UPSC CSE',
    'journalist': 'BA Journalism / Mass Comm',
    'psychologist': 'BA/B.Sc Psychology → MA Psychology',
    'teacher': 'Bachelor\'s + B.Ed',
    'graphic-designer': 'B.Des / BFA',
    'digital-marketer': 'BBA / B.Com + Certifications',
    'fashion-designer': 'B.Des Fashion',
    'hotel-management': 'BHM (4 yrs)',
    'defence-officer': 'NDA / Direct Entry → Service Academy',
    'agricultural-scientist': 'B.Sc Agriculture',
    'ai-ml-engineer': 'B.Tech CSE / AI-ML', 'cloud-engineer': 'B.Tech CSE + Cloud certs', 'blockchain-developer': 'B.Tech CSE + Blockchain',
    'robotics-engineer': 'B.Tech Robotics / Mechatronics', 'electrical-engineer': 'B.Tech Electrical', 'biomedical-engineer': 'B.Tech Biomedical',
    'environmental-scientist': 'B.Sc/M.Sc Environmental Science', 'urban-planner': 'B.Plan / B.Arch → M.Plan',
    'game-developer': 'B.Des / B.Tech (Game Dev)', 'ux-designer': 'B.Des (UX/UI)', 'animator-vfx': 'B.Des / B.Sc Animation',
    'interior-designer': 'B.Des Interior Design', 'photographer': 'B.A / Diploma Photography', 'content-creator': 'B.A Media / Mass Comm',
    'dietitian': 'B.Sc Nutrition & Dietetics', 'public-health-specialist': "Bachelor's → MPH", 'forensic-scientist': 'B.Sc → M.Sc Forensic Science',
    'entrepreneur': "Any degree → MBA (optional)", 'supply-chain-manager': 'BBA/B.Tech → MBA Operations', 'hr-manager': 'BBA → MBA HR',
    'ecommerce-manager': 'BBA/B.Com → MBA', 'real-estate-manager': 'BBA → MBA / RICS', 'insurance-professional': 'B.Com → Actuarial (IAI)',
    'event-manager': 'BBA Event Mgmt / B.Des', 'ir-specialist': 'BA → MA International Relations', 'nonprofit-manager': "Any degree → MA Social Work",
    'translator': 'BA → MA Languages', 'pr-specialist': 'BA Mass Comm / PR', 'pilot': 'Commercial Pilot License (DGCA)'
  };

  var DURATION_YEARS = {
    'doctor-mbbs': 5.5, 'dentist-bds': 5,
    'lawyer': 5, 'architect': 5,
    'chartered-accountant': 4, 'company-secretary': 3,
    'civil-servant': 4, 'defence-officer': 3,
    'environmental-scientist': 3, 'animator-vfx': 3, 'photographer': 3, 'content-creator': 3,
    'dietitian': 3, 'public-health-specialist': 5, 'forensic-scientist': 5,
    'entrepreneur': 3, 'supply-chain-manager': 5, 'hr-manager': 5, 'ecommerce-manager': 5,
    'real-estate-manager': 5, 'event-manager': 3, 'ir-specialist': 5, 'nonprofit-manager': 5,
    'translator': 5, 'pr-specialist': 3, 'pilot': 1.5
  };

  // ── Formatting helpers ─────────────────────────────────────────────────
  function formatSalary(inr) {
    if (!inr) return 'N/A';
    var lakhs = inr / 100000;
    if (lakhs >= 100) return '₹' + (lakhs / 100).toFixed(1) + ' Cr PA';
    return '₹' + lakhs.toFixed(1) + ' LPA';
  }

  function budgetTierLabel(t) {
    if (t === 'low')  return 'Low (Under ₹3L)';
    if (t === 'mid')  return 'Medium (₹3-7L)';
    if (t === 'high') return 'High (₹7-15L)';
    return 'Medium';
  }

  function estimatedCost(c) {
    if (c.budget_tier === 'low')  return '₹0-3 Lakh (govt route + fees)';
    if (c.budget_tier === 'mid')  return '₹3-7 Lakh total';
    if (c.budget_tier === 'high') return '₹7-15 Lakh (private) / ₹3-5L (govt with merit)';
    return '₹3-7 Lakh';
  }

  function durationYears(c) { return DURATION_YEARS[c.id] || 4; }

  // Indicative cost split (RANGES, not single numbers) into Tuition / Boarding & Lodging /
  // Books & Misc. Each component is a low–high band reflecting the govt-seat → private-college
  // spread, scaled by program duration and the student's STATE living-cost level.
  //
  // BASIS — IMPORTANT: these are hand-set indicative bands, NOT live per-college fees. There is no
  // authoritative fee API; real tuition varies ~10x between a govt seat and a private college and
  // changes yearly. Treat as a planning estimate; for exact figures see AICTE / state fee-committee
  // / NIRF institute disclosures. The budget table labels these as indicative.
  var HIGH_COST_STATES = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Gujarat'];

  // Per-CAREER total-program tuition range (₹ Lakh), govt-seat → private. Keyed by career so each
  // path reflects its ACTUAL degree (an MBBS is not a B.Sc Nursing) instead of borrowing the NIRF
  // category's flagship-course fee. Indicative figures from typical govt/private course fees;
  // refresh periodically. Careers absent here fall back to the budget_tier band.
  var COURSE_FEE = {
    // Engineering / IT — B.Tech (state-govt → IIT/private)
    'software-engineer': [1, 16], 'data-scientist': [1, 16], 'cybersecurity-analyst': [1, 16],
    'mechanical-engineer': [1, 14], 'civil-engineer': [1, 14], 'electronics-engineer': [1, 16],
    'aerospace-engineer': [2, 14],
    'architect': [2, 12],
    // Medical cluster — distinct courses
    'doctor-mbbs': [0.5, 95], 'dentist-bds': [1, 35], 'pharmacist': [1, 10],
    'veterinarian': [0.5, 6], 'physiotherapist': [1, 12], 'nurse': [0.3, 9],
    // Commerce / management
    'chartered-accountant': [0.3, 3], 'company-secretary': [0.2, 2],
    'investment-banker': [2, 28], 'financial-analyst': [2, 20], 'business-analyst': [2, 24],
    'digital-marketer': [1, 10],
    // Law / civic / social
    'lawyer': [0.5, 16], 'civil-servant': [0.3, 5], 'journalist': [0.5, 8],
    'psychologist': [0.5, 8], 'teacher': [0.5, 5],
    // Design / hospitality / defence / agri
    'graphic-designer': [2, 16], 'fashion-designer': [3, 18], 'hotel-management': [2, 12],
    'defence-officer': [0.1, 1], 'agricultural-scientist': [0.5, 5],
    'ai-ml-engineer': [1, 18], 'cloud-engineer': [1, 16], 'blockchain-developer': [2, 16], 'robotics-engineer': [1, 14],
    'electrical-engineer': [1, 14], 'biomedical-engineer': [2, 14], 'environmental-scientist': [0.5, 6], 'urban-planner': [2, 12],
    'game-developer': [2, 16], 'ux-designer': [3, 15], 'animator-vfx': [2, 12], 'interior-designer': [3, 15],
    'photographer': [1, 8], 'content-creator': [1, 6],
    'dietitian': [1, 8], 'public-health-specialist': [2, 15], 'forensic-scientist': [1, 8],
    'entrepreneur': [0.5, 25], 'supply-chain-manager': [2, 24], 'hr-manager': [2, 22], 'ecommerce-manager': [2, 20],
    'real-estate-manager': [2, 18], 'insurance-professional': [0.5, 10], 'event-manager': [2, 12],
    'ir-specialist': [1, 12], 'nonprofit-manager': [0.5, 8], 'translator': [0.5, 6], 'pr-specialist': [2, 12],
    'pilot': [25, 60]
  };

  // A link to a page that ACTUALLY LISTS the fee (not a regulator homepage). Resolved by
  // course + state. Where no fee-listing page is verifiable, returns null and renders no link
  // (the per-college fees shown in the college lists remain the concrete reference).
  // Course-level fee pages (single-body courses that publish their own fee):
  var COURSE_FEE_PAGE = {
    'chartered-accountant': { label: 'ICAI — scheme & fees', url: 'https://www.icai.org/post/scheme-of-education-and-training' },
    'company-secretary': { label: 'ICSI — student services & fees', url: 'https://www.icsi.edu/student/' }
  };
  // State Fee Regulating Authority pages that publish APPROVED per-college fees (verified).
  var STATE_FEE_PAGE = {
    'Maharashtra': { label: 'Maharashtra FRA — approved fees', url: 'https://mahafra.org/feesInformation' },
    'Karnataka': { label: 'Karnataka KEA — fee structure', url: 'https://cetonline.karnataka.gov.in/kea/' },
    'Andhra Pradesh': { label: 'AP AFRC — fee orders', url: 'https://afrc.ap.gov.in/' }
  };
  var MCC_FEE_REF = { label: 'MCC — MBBS/BDS fee & seat matrix', url: 'https://mcc.nic.in/' };
  // Courses whose fees are set by state FRAs (private professional colleges).
  var STATE_REGULATED = {
    'software-engineer': 1, 'data-scientist': 1, 'cybersecurity-analyst': 1, 'mechanical-engineer': 1,
    'civil-engineer': 1, 'electronics-engineer': 1, 'aerospace-engineer': 1, 'architect': 1,
    'doctor-mbbs': 1, 'dentist-bds': 1, 'nurse': 1, 'physiotherapist': 1, 'veterinarian': 1, 'pharmacist': 1,
    'investment-banker': 1, 'financial-analyst': 1, 'business-analyst': 1, 'digital-marketer': 1,
    'ai-ml-engineer': 1, 'cloud-engineer': 1, 'blockchain-developer': 1, 'robotics-engineer': 1,
    'electrical-engineer': 1, 'biomedical-engineer': 1, 'urban-planner': 1,
    'dietitian': 1, 'public-health-specialist': 1, 'forensic-scientist': 1,
    'supply-chain-manager': 1, 'hr-manager': 1, 'ecommerce-manager': 1, 'real-estate-manager': 1,
    'insurance-professional': 1, 'event-manager': 1
  };
  var MEDICAL_COUNSELLING = { 'doctor-mbbs': 1, 'dentist-bds': 1 };
  function feeRef(c, formData) {
    if (COURSE_FEE_PAGE[c.id]) return COURSE_FEE_PAGE[c.id];
    if (STATE_REGULATED[c.id]) {
      var sp = STATE_FEE_PAGE[formData && formData.state];
      if (sp) return sp;
      if (MEDICAL_COUNSELLING[c.id]) return MCC_FEE_REF;
    }
    return null; // no verifiable fee-listing page → rely on per-college fees in the college lists
  }

  function costBreakdown(c, formData) {
    var yrs = durationYears(c);
    var tier = c.budget_tier || 'mid';
    var livingHigh = HIGH_COST_STATES.indexOf(formData && formData.state) !== -1;
    var hYr = livingHigh ? [90000, 150000] : [60000, 100000];   // hostel + mess /yr
    var bYr = [10000, 25000];                                    // books / exam / misc /yr
    // Tuition is per-COURSE for this career (govt→private), not the NIRF category's flagship fee.
    var cf = COURSE_FEE[c.id];
    var tu, tuition_source;
    if (cf) {
      tu = [cf[0] * 100000, cf[1] * 100000];
      tuition_source = 'typical ' + (DEGREE_FOR[c.id] || 'course') + ' fee · govt→private (indicative)';
    } else {
      tu = tier === 'low' ? [10000, 200000] : tier === 'high' ? [300000, 6000000] : [50000, 800000];
      tuition_source = 'indicative band';
    }
    var hostel = [hYr[0] * yrs, hYr[1] * yrs];
    var books = [bYr[0] * yrs, bYr[1] * yrs];
    var total = [tu[0] + hostel[0] + books[0], tu[1] + hostel[1] + books[1]];
    var L = function (n) { return (n / 100000).toFixed(1); };
    var R = function (a) { return '₹' + L(a[0]) + '–' + L(a[1]) + 'L'; };
    return {
      tuition: R(tu),
      tuition_source: tuition_source,
      tuition_ref: feeRef(c, formData),
      boarding_lodging: R(hostel) + ' (₹' + L(hYr[0]) + '–' + L(hYr[1]) + 'L/yr × ' + yrs + ' yrs)',
      books_misc: R(books),
      total_est: R(total),
      total_min_l: Math.round(total[0] / 100000 * 10) / 10,  // ₹ Lakh, govt-route low end
      total_max_l: Math.round(total[1] / 100000 * 10) / 10,  // ₹ Lakh, private high end
      living_tier: livingHigh ? 'metro / high cost-of-living' : 'standard cost-of-living',
      note: tier === 'high'
        ? 'low end = govt/merit seat · high end = private college'
        : 'low end = govt seat · high end = private'
    };
  }

  // Truthful salary provenance for a card footnote: real only when Adzuna actually
  // produced the number (recorded in _market_meta by scripts/refresh-market-data.js).
  function salarySource(c) {
    var m = c._market_meta;
    if (m && m.salary_source && m.salary_source.indexOf('Adzuna') === 0) {
      return m.salary_source + (m.refreshed_at ? ', ' + m.refreshed_at : '');
    }
    return 'estimate';
  }

  // Career → NIRF ranking category (data/nirf-colleges.json). Careers absent here
  // (graphic/fashion design, hotel mgmt, defence) have no official NIRF category and fall
  // back to LLM-suggested colleges.
  var CAREER_NIRF_CATEGORY = {
    'software-engineer': 'Engineering', 'data-scientist': 'Engineering', 'cybersecurity-analyst': 'Engineering',
    'mechanical-engineer': 'Engineering', 'civil-engineer': 'Engineering', 'electronics-engineer': 'Engineering',
    'aerospace-engineer': 'Engineering',
    'architect': 'Architecture',
    'doctor-mbbs': 'Medical', 'physiotherapist': 'Medical', 'nurse': 'Medical',
    'dentist-bds': 'Dental',
    'pharmacist': 'Pharmacy',
    'veterinarian': 'Agriculture', 'agricultural-scientist': 'Agriculture',
    'chartered-accountant': 'Management', 'company-secretary': 'Management', 'investment-banker': 'Management',
    'financial-analyst': 'Management', 'business-analyst': 'Management', 'digital-marketer': 'Management',
    'lawyer': 'Law',
    'civil-servant': 'University', 'teacher': 'University', 'psychologist': 'University', 'journalist': 'University',
    'ai-ml-engineer': 'Engineering', 'cloud-engineer': 'Engineering', 'blockchain-developer': 'Engineering',
    'robotics-engineer': 'Engineering', 'electrical-engineer': 'Engineering', 'biomedical-engineer': 'Engineering',
    'environmental-scientist': 'Engineering', 'urban-planner': 'Architecture',
    'dietitian': 'Medical', 'public-health-specialist': 'Medical', 'forensic-scientist': 'Medical',
    'entrepreneur': 'Management', 'supply-chain-manager': 'Management', 'hr-manager': 'Management',
    'ecommerce-manager': 'Management', 'real-estate-manager': 'Management', 'insurance-professional': 'Management',
    'event-manager': 'Management',
    'ir-specialist': 'University', 'nonprofit-manager': 'University', 'translator': 'University', 'pr-specialist': 'University'
    // no NIRF category (→ LLM colleges): game-developer, ux-designer, animator-vfx, interior-designer, photographer, content-creator, pilot
  };

  // Display string for a college's curated total-program tuition (data/nirf-colleges.json).
  function feeStr(col) {
    if (!col.fee_total) return null;
    var f = function (n) { return (Math.round(n * 10) / 10) + ''; };
    return '₹' + f(col.fee_total[0]) + '–' + f(col.fee_total[1]) + 'L' + (col.fee_year ? ' (' + col.fee_year + ')' : '');
  }
  function mapCollege(col, cat, yr) {
    return {
      name: col.name, nirf_rank: String(col.nirf_rank), nirf_year: yr, type: cat,
      city: col.city, state: col.state, url: col.url || null,
      fee: feeStr(col), fee_total: col.fee_total || null, fee_year: col.fee_year || null
    };
  }

  // Real NIRF colleges (year from CAREER_DATA.nirfYear) for a career's category, preferring
  // the student's home state.
  // Returns null when the career has no NIRF category (caller falls back to LLM colleges).
  function nirfCollegesFor(career, formData) {
    var cat = CAREER_NIRF_CATEGORY[career.id];
    if (!cat) return null;
    var list = (window.CAREER_DATA.nirfColleges && window.CAREER_DATA.nirfColleges[cat]) || [];
    if (!list.length) return null;
    // National top 5 by rank. Home-state colleges are surfaced separately by
    // nirfCollegesInState(), so this list stays purely national to avoid duplication.
    var sorted = list.slice().sort(function (a, b) { return (a.nirf_rank || 999) - (b.nirf_rank || 999); });
    var yr = String(window.CAREER_DATA.nirfYear || '2025');
    return sorted.slice(0, 5).map(function (col) { return mapCollege(col, cat, yr); });
  }

  // NIRF colleges (up to 5) for a career's category that are physically located in the
  // student's home state, sorted by rank. Returns null when there's no home state, no NIRF
  // category, or no in-state college in our dataset (the national top-N is intentionally
  // small, so many state+field combinations legitimately have none).
  function nirfCollegesInState(career, formData) {
    var st = formData && formData.state;
    if (!st) return null;
    var cat = CAREER_NIRF_CATEGORY[career.id];
    if (!cat) return null;
    var list = (window.CAREER_DATA.nirfColleges && window.CAREER_DATA.nirfColleges[cat]) || [];
    var inState = list.filter(function (c) { return c.state === st; })
      .sort(function (a, b) { return (a.nirf_rank || 999) - (b.nirf_rank || 999); })
      .slice(0, 5);
    if (!inState.length) return null;
    var yr = String(window.CAREER_DATA.nirfYear || '2025');
    return {
      state: st,
      colleges: inState.map(function (col) { return mapCollege(col, cat, yr); })
    };
  }

  function buildEntryRoute(career, formData) {
    var stream = (formData.stream && formData.stream !== 'Not specified')
                   ? formData.stream
                   : (career.streams[0] || 'Science');
    var primary = (career.exams && career.exams[0])
                    ? career.exams[0].toUpperCase().replace(/-/g, ' ')
                    : 'Entrance Exam';
    var degree = DEGREE_FOR[career.id] || 'Bachelor\'s Degree';
    return stream + ' → ' + primary + ' → ' + degree + ' → Placement / Practice';
  }

  // ── Supply/demand & jobs market — derived from career.growth + density ─
  function supplyDemand(c) {
    var demandMap = { high: 'Very High', medium: 'High', low: 'Medium' };
    var trendMap  = { high: 'Rising Fast', medium: 'Stable Rising', low: 'Stable' };
    var compMap   = { high: 'High (specialized)', medium: 'Medium', low: 'Lower' };
    var d = c.job_density || {};
    var avg = ((d.metro || 0) + (d.tier2 || 0) + (d.rural || 0)) / 3;
    return {
      demand_level: demandMap[c.growth] || 'Medium',
      supply_level: 'Medium',
      competition_index: compMap[c.growth] || 'Medium',
      ap_ts_job_market_score: Math.round(avg * 100),
      growth_trend: trendMap[c.growth] || 'Stable',
      data_source: 'CareerDisha estimate (growth heuristic)'
    };
  }

  // Real live-listing count from Adzuna (set by scripts/refresh-market-data.js).
  // No fabricated vacancy/applicant totals — Adzuna has no applicant data, and the
  // raw count is shown as-is rather than re-derived from the job_density heuristic.
  function jobsMarket(c) {
    var al = c.adzuna_listings;
    if (al && typeof al.count === 'number') {
      return {
        live_openings: al.count.toLocaleString('en-IN'),
        coverage_note: al.coverage === 'low' ? 'limited Adzuna coverage' : '',
        data_source: 'Adzuna IN' + (al.fetched_at ? ', ' + al.fetched_at : '')
      };
    }
    return { live_openings: null, coverage_note: 'no live-listing data', data_source: 'estimate' };
  }

  // ── Deterministic fallback: decision tree (used when LLM omits it) ─────
  function defaultDecisionTree(career, formData) {
    var route  = (career.exams && career.exams[0])
                   ? career.exams[0].toUpperCase().replace(/-/g, ' ')
                   : 'Entrance Exam';
    var degree = DEGREE_FOR[career.id] || "Bachelor's degree";
    var classNow = formData.level || 'Current education';
    return {
      current_node:    classNow + (formData.stream ? ' (' + formData.stream + ')' : ''),
      next_step:       'Prepare for ' + route + ' + complete current syllabus',
      branch_yes:      'Top-tier college admit (govt seat / IIT / NIT / AIIMS based on rank)',
      branch_no:       'Tier-1 private college / state quota seat / drop-year prep',
      milestone_3yr:   degree + ' Year 3 + first internship',
      milestone_final: career.name.en + ' role / practice'
    };
  }

  // ── Deterministic fallback: domain market chart data ───────────────────
  // Aggregates the top-5 careers by domain and computes demand/supply scores
  // from career.growth + job_density. Always non-empty if matches has any item.
  function defaultMarketData(matches) {
    var byDomain = {};
    matches.slice(0, 5).forEach(function (m) {
      var d = DOMAIN_LABEL[m.career.id] || 'Other';
      if (!byDomain[d]) byDomain[d] = [];
      byDomain[d].push(m.career);
    });
    var growthScore = { high: 88, medium: 72, low: 55 };
    return Object.keys(byDomain).map(function (d) {
      var careers = byDomain[d];
      var avgDemand = Math.round(careers.reduce(function (s, c) {
        return s + (growthScore[c.growth] || 65);
      }, 0) / careers.length);
      var avgMetro = careers.reduce(function (s, c) {
        return s + ((c.job_density && c.job_density.metro) || 0.5);
      }, 0) / careers.length;
      var supply = Math.round(40 + avgMetro * 35);
      var avgEntry = careers.reduce(function (s, c) {
        return s + ((c.salary_inr && c.salary_inr.entry) || 400000);
      }, 0) / careers.length;
      var hasHighGrowth = careers.some(function (c) { return c.growth === 'high'; });
      var avgVacancies  = Math.round(avgMetro * 30000);
      var gap = avgDemand - supply;
      return {
        domain:                  d,
        ap_ts_demand_score:      avgDemand,
        ap_ts_supply_score:      supply,
        opportunity_gap:         gap > 25 ? 'Very High' : gap > 10 ? 'High' : 'Medium',
        annual_jobs_created_ap_ts: avgVacancies.toLocaleString('en-IN') + '+',
        avg_salary_entry:        '₹' + (avgEntry / 100000).toFixed(1) + ' LPA',
        trend:                   hasHighGrowth ? 'Rising' : 'Stable',
        source:                  'CareerDisha career dataset'
      };
    });
  }

  // ── Deterministic fallback: student summary (used when LLM omits it) ───
  function defaultStudentSummary(formData, top1) {
    var parts = [];
    if (formData.level) parts.push(formData.level + ' student');
    else parts.push('Student');
    if (formData.state)  parts.push('from ' + formData.state);
    if (formData.stream && formData.stream !== 'Not specified') parts.push('in ' + formData.stream + ' stream');
    var s = parts.join(' ');
    if (formData.topInterest) s += ' with primary interest in ' + formData.topInterest;
    if (formData.topMeritSubject && formData.topMeritScore >= 0) {
      s += '; strongest subject is ' + formData.topMeritSubject + ' at ' + Number(formData.topMeritScore).toFixed(1) + '%';
    }
    if (top1) s += '. Top deterministic match: ' + top1.career.name.en + ' (' + Math.round(top1.score * 100) + '%).';
    return s;
  }

  // ── Deterministic fallback: counselor note ─────────────────────────────
  function defaultCounselorNote(top1, formData) {
    if (!top1) return 'Stay focused, keep your options open, and aim for a path where your interests and strengths reinforce each other.';
    var careerName = top1.career.name.en;
    var matchPct   = Math.round(top1.score * 100);
    var primaryInt = (formData.topInterest || 'your stated interest').toLowerCase();
    var lines = [];
    lines.push('Your top match — <strong>' + careerName + '</strong> at ' + matchPct + '% — aligns with your ' + primaryInt + ' interest and the strengths you marked.');
    if (formData.topMeritScore >= 80) {
      lines.push('Your <strong>' + formData.topMeritSubject + '</strong> score (' + Number(formData.topMeritScore).toFixed(0) + '%) is a real asset — protect it through final exams; it opens scholarship and merit-seat doors.');
    } else if (formData.topMeritScore >= 0 && formData.topMeritScore < 60) {
      lines.push('Your current marks have room to grow — focus the next 3-6 months on consistent practice in <strong>' + (formData.topMeritSubject || 'your weakest subject') + '</strong>.');
    }
    lines.push('Spend the next 6-12 months on the entrance exam shown in your decision tree, and build at least one practical project or shadowing experience in <strong>' + careerName + '</strong>.');
    if (formData.scholarship && formData.scholarship !== 'None' && formData.scholarship !== 'Not sure' && formData.scholarship !== 'Not specified') {
      lines.push('Your category (' + formData.scholarship + ') unlocks specific scholarships — check the colleges card for institutions that prioritize your category.');
    }
    if (formData.family === 'First-generation graduate') {
      lines.push('Being first-generation is a strength, not a barrier — every senior who walked this path started exactly where you are.');
    }
    return lines.join(' ');
  }

  // Central job portals — always shown. Grouped for the UI (General vs Central Govt).
  var CENTRAL_PORTALS = [
    { name: 'Naukri',   url: 'https://naukri.com',        group: 'General' },
    { name: 'LinkedIn', url: 'https://linkedin.com/jobs', group: 'General' },
    { name: 'NCS',      url: 'https://ncs.gov.in',        group: 'Central Govt' },
    { name: 'UPSC',     url: 'https://upsc.gov.in',       group: 'Central Govt' },
    { name: 'SSC',      url: 'https://ssc.nic.in',        group: 'Central Govt' }
  ];

  // State govt job / PSC portals, keyed by the app's state names. Short labels by design.
  var STATE_JOB_PORTALS = {
    'Andhra Pradesh': [{ name: 'APPSC', url: 'https://psc.ap.gov.in', group: 'State Govt' }],
    'Telangana':      [{ name: 'TSPSC', url: 'https://www.tspsc.gov.in', group: 'State Govt' }],
    'Karnataka':      [{ name: 'KPSC', url: 'https://kpsc.kar.nic.in', group: 'State Govt' }],
    'Maharashtra':    [{ name: 'MPSC', url: 'https://mpsc.gov.in', group: 'State Govt' },
                       { name: 'Maha Rojgar', url: 'https://rojgar.mahaswayam.gov.in', group: 'State Govt' }],
    'Tamil Nadu':     [{ name: 'TNPSC', url: 'https://www.tnpsc.gov.in', group: 'State Govt' },
                       { name: 'TN Velai', url: 'https://tnvelaivaaippu.gov.in', group: 'State Govt' }],
    'Kerala':         [{ name: 'Kerala PSC', url: 'https://www.keralapsc.gov.in', group: 'State Govt' }],
    'Gujarat':        [{ name: 'GPSC', url: 'https://gpsc.gujarat.gov.in', group: 'State Govt' }],
    'West Bengal':    [{ name: 'WBPSC', url: 'https://wbpsc.gov.in', group: 'State Govt' }],
    'Rajasthan':      [{ name: 'RPSC', url: 'https://rpsc.rajasthan.gov.in', group: 'State Govt' }],
    'Uttar Pradesh':  [{ name: 'UPPSC', url: 'https://uppsc.up.nic.in', group: 'State Govt' },
                       { name: 'Sewayojan', url: 'https://sewayojan.up.nic.in', group: 'State Govt' }],
    'Madhya Pradesh': [{ name: 'MPPSC', url: 'https://mppsc.mp.gov.in', group: 'State Govt' }],
    'Bihar':          [{ name: 'BPSC', url: 'https://www.bpsc.bih.nic.in', group: 'State Govt' }],
    'Punjab':         [{ name: 'PPSC', url: 'https://ppsc.gov.in', group: 'State Govt' }],
    'Haryana':        [{ name: 'HPSC', url: 'https://hpsc.gov.in', group: 'State Govt' },
                       { name: 'HSSC', url: 'https://hssc.gov.in', group: 'State Govt' }],
    'Odisha':         [{ name: 'OPSC', url: 'https://www.opsc.gov.in', group: 'State Govt' }],
    'Assam':          [{ name: 'APSC', url: 'https://apsc.nic.in', group: 'State Govt' }],
    'Delhi':          [{ name: 'DSSSB', url: 'https://dsssb.delhi.gov.in', group: 'State Govt' }]
  };

  function jobPortals(formData) {
    var st = formData && formData.state;
    return CENTRAL_PORTALS.concat(STATE_JOB_PORTALS[st] || []);
  }

  // ── Government job targets (real roles routed to official recruiting bodies) ───────────
  // Specific vacancies/exam dates aren't live — each row links to the official portal.
  var CENTRAL_GOVT_JOBS = [
    { role: 'All govt / PSU vacancies (aggregator)', body: 'National Career Service', exam: 'NCS portal', url: 'https://www.ncs.gov.in' },
    { role: 'IAS / IPS / IFS (Civil Services)', body: 'UPSC', exam: 'UPSC CSE', url: 'https://upsc.gov.in' },
    { role: 'Indian Forest Service', body: 'UPSC', exam: 'UPSC IFoS', url: 'https://upsc.gov.in' },
    { role: 'Inspector / Auditor / Assistant', body: 'SSC', exam: 'SSC CGL', url: 'https://ssc.gov.in' },
    { role: 'Clerk / DEO / MTS', body: 'SSC', exam: 'SSC CHSL / MTS', url: 'https://ssc.gov.in' },
    { role: 'Railways (NTPC / Group D / JE / ALP)', body: 'RRB', exam: 'RRB exams', url: 'https://www.rrbcdg.gov.in' },
    { role: 'Bank PO / Clerk / SO', body: 'IBPS / SBI', exam: 'IBPS / SBI', url: 'https://www.ibps.in' },
    { role: 'RBI Grade B / Assistant', body: 'Reserve Bank of India', exam: 'RBI exams', url: 'https://opportunities.rbi.org.in' },
    { role: 'Agricultural Scientist (ARS)', body: 'ICAR / ASRB', exam: 'ICAR ARS-NET', url: 'https://www.asrb.org.in' },
    { role: 'Defence Officer (NDA / CDS)', body: 'UPSC', exam: 'NDA / CDS', url: 'https://upsc.gov.in' },
    { role: 'Army (Agniveer / Officer)', body: 'Indian Army', exam: 'Agnipath / NDA', url: 'https://joinindianarmy.nic.in' },
    { role: 'Navy (Agniveer / Officer)', body: 'Indian Navy', exam: 'Agnipath / INET', url: 'https://www.joinindiannavy.gov.in' },
    { role: 'Air Force (Agniveer / AFCAT)', body: 'Indian Air Force', exam: 'Agnipath / AFCAT', url: 'https://careerindianairforce.cdac.in' },
    { role: 'Scientist / Engineer (Space)', body: 'ISRO', exam: 'ICRB', url: 'https://www.isro.gov.in/Careers.html' },
    { role: 'Scientist (Defence R&D)', body: 'DRDO / RAC', exam: 'GATE / RAC', url: 'https://rac.gov.in' },
    { role: 'PSU Engineer (NTPC/ONGC/BHEL/SAIL)', body: 'PSUs via GATE score', exam: 'GATE', url: 'https://www.ncs.gov.in' },
    { role: 'Postal Assistant / GDS / MTS', body: 'India Post', exam: 'GDS / Postal', url: 'https://www.indiapostgdsonline.gov.in' },
    { role: 'Ordnance Factory / Defence civilian', body: 'Dept. of Defence Production', exam: 'OFB / DDP', url: 'https://ddpdoo.gov.in' }
  ];
  // State Public Service Commission per state (verified portals; state roles route through these).
  var STATE_PSC = {
    'Andhra Pradesh': { psc: 'APPSC', url: 'https://psc.ap.gov.in' },
    'Telangana': { psc: 'TSPSC', url: 'https://www.tspsc.gov.in' },
    'Karnataka': { psc: 'KPSC', url: 'https://kpsc.kar.nic.in' },
    'Maharashtra': { psc: 'MPSC', url: 'https://mpsc.gov.in' },
    'Tamil Nadu': { psc: 'TNPSC', url: 'https://www.tnpsc.gov.in' },
    'Kerala': { psc: 'Kerala PSC', url: 'https://www.keralapsc.gov.in' },
    'Gujarat': { psc: 'GPSC', url: 'https://gpsc.gujarat.gov.in' },
    'West Bengal': { psc: 'WBPSC', url: 'https://wbpsc.gov.in' },
    'Rajasthan': { psc: 'RPSC', url: 'https://rpsc.rajasthan.gov.in' },
    'Uttar Pradesh': { psc: 'UPPSC', url: 'https://uppsc.up.nic.in' },
    'Madhya Pradesh': { psc: 'MPPSC', url: 'https://mppsc.mp.gov.in' },
    'Bihar': { psc: 'BPSC', url: 'https://www.bpsc.bih.nic.in' },
    'Punjab': { psc: 'PPSC', url: 'https://ppsc.gov.in' },
    'Haryana': { psc: 'HPSC', url: 'https://hpsc.gov.in' },
    'Odisha': { psc: 'OPSC', url: 'https://www.opsc.gov.in' },
    'Assam': { psc: 'APSC', url: 'https://apsc.nic.in' },
    'Delhi': { psc: 'DSSSB / UPSC', url: 'https://dsssb.delhi.gov.in' }
  };
  // Additional official state recruitment portals beyond the PSC (police boards, staff-selection /
  // subordinate-service boards, state employment / apply portals). Best-effort official links —
  // exact vacancies & current domains vary by year, so always confirm on the linked portal.
  var STATE_GOVT_EXTRA = {
    'Andhra Pradesh': [
      { role: 'Police SI / Constable', body: 'AP SLPRB', url: 'https://slprb.ap.gov.in' },
      { role: 'Village / Ward Secretariat', body: 'AP Grama-Ward Sachivalayam', url: 'https://gramawardsachivalayam.ap.gov.in' }
    ],
    'Telangana': [
      { role: 'Police SI / Constable', body: 'TSLPRB', url: 'https://www.tslprb.in' }
    ],
    'Karnataka': [
      { role: 'Police recruitment', body: 'Karnataka State Police', url: 'https://ksp.karnataka.gov.in' },
      { role: 'Entrance / seat allotment', body: 'KEA', url: 'https://cetonline.karnataka.gov.in/kea' }
    ],
    'Maharashtra': [
      { role: 'Subordinate exams', body: 'Maharashtra Pariksha (Maha-IT)', url: 'https://mahapariksha.gov.in' },
      { role: 'Employment / apply portal', body: 'Maha Rojgar (Mahaswayam)', url: 'https://rojgar.mahaswayam.gov.in' }
    ],
    'Tamil Nadu': [
      { role: 'Police SI / Constable', body: 'TNUSRB', url: 'https://www.tnusrb.tn.gov.in' },
      { role: 'Teacher recruitment', body: 'TN TRB', url: 'https://trb.tn.gov.in' },
      { role: 'Employment portal', body: 'TN Velai Vaaippu', url: 'https://www.tnvelaivaaippu.gov.in' }
    ],
    'Kerala': [
      { role: 'Employment / apply portal', body: 'Kerala Employment Dept', url: 'https://www.employment.kerala.gov.in' }
    ],
    'Gujarat': [
      { role: 'Govt jobs apply portal', body: 'OJAS', url: 'https://ojas.gujarat.gov.in' },
      { role: 'Subordinate posts', body: 'GSSSB', url: 'https://gsssb.gujarat.gov.in' }
    ],
    'West Bengal': [
      { role: 'Staff selection (Group C / D)', body: 'WBSSC', url: 'https://www.wbssc.gov.in' },
      { role: 'Police recruitment', body: 'WB Police PRB', url: 'https://prb.wb.gov.in' }
    ],
    'Rajasthan': [
      { role: 'Subordinate posts', body: 'RSMSSB (RSSB)', url: 'https://rsmssb.rajasthan.gov.in' },
      { role: 'Single sign-on (apply)', body: 'SSO Rajasthan', url: 'https://sso.rajasthan.gov.in' }
    ],
    'Uttar Pradesh': [
      { role: 'Subordinate posts', body: 'UPSSSC', url: 'https://upsssc.gov.in' },
      { role: 'Police recruitment', body: 'UP PRPB', url: 'https://uppbpb.gov.in' },
      { role: 'Employment portal', body: 'UP Sewayojan', url: 'https://sewayojan.up.nic.in' }
    ],
    'Madhya Pradesh': [
      { role: 'Selection board (Vyapam)', body: 'MP ESB', url: 'https://esb.mp.gov.in' },
      { role: 'Apply portal', body: 'MP Online', url: 'https://www.mponline.gov.in' }
    ],
    'Bihar': [
      { role: 'Staff selection (10+2 / inter)', body: 'BSSC', url: 'https://bssc.bihar.gov.in' },
      { role: 'Police recruitment', body: 'CSBC', url: 'https://csbc.bih.nic.in' }
    ],
    'Punjab': [
      { role: 'Subordinate posts', body: 'PSSSB', url: 'https://sssb.punjab.gov.in' }
    ],
    'Haryana': [
      { role: 'Staff selection (Group C / D)', body: 'HSSC', url: 'https://hssc.gov.in' }
    ],
    'Odisha': [
      { role: 'Staff selection', body: 'OSSC', url: 'https://www.ossc.gov.in' },
      { role: 'Subordinate posts', body: 'OSSSC', url: 'https://www.osssc.gov.in' }
    ],
    'Assam': [
      { role: 'Police recruitment', body: 'SLPRB Assam', url: 'https://slprbassam.gov.in' }
    ],
    'Delhi': [
      { role: 'Staff selection', body: 'DSSSB', url: 'https://dsssb.delhi.gov.in' }
    ]
  };
  function govtJobTargets(formData) {
    var st = formData && formData.state;
    var p = STATE_PSC[st];
    var state = [];
    if (p) {
      state = [
        { role: 'Group 1 (Dy. Collector / DSP / Tahsildar-level)', body: p.psc, url: p.url },
        { role: 'Group 2 / 3 / 4 (executive & subordinate posts)', body: p.psc, url: p.url },
        { role: 'Government Teacher (TET / DSC / TRB)', body: st + ' School Education Dept', url: p.url },
        { role: 'Agriculture Extension Officer', body: p.psc + ' / State Agriculture Dept', url: p.url },
        { role: 'Panchayat Secretary / Revenue (VRO / VAO)', body: p.psc, url: p.url }
      ].concat(STATE_GOVT_EXTRA[st] || []);
    }
    return { stateName: st || '', central: CENTRAL_GOVT_JOBS, state: state };
  }

  // Scholarship scheme → { url: deep link to the SPECIFIC scheme/guideline page, amount: the
  // published indicative benefit }. Amounts are indicative figures from the official scheme
  // guidelines (they vary by income / course group / hostel-vs-day-scholar / year) — the link
  // goes to the authoritative page for the current exact amount. Verified against official
  // sources on 2026-05-30; re-check before production as schemes are revised yearly.
  var SCHOLARSHIP_INFO = {
    'SC Post-Matric Scholarship':
      { url: 'https://socialjustice.gov.in/schemes/25', amount: 'Full tuition + ₹550–1200/mo (indicative)' },
    'ST Post-Matric Scholarship':
      { url: 'https://tribal.nic.in/', amount: 'Full tuition + maintenance (indicative)' },
    'OBC / BC Welfare Scheme':
      { url: 'https://scholarships.gov.in/public/schemeGuidelines/POST_MATRIC_OBC_GUIDELINES.pdf', amount: 'Full tuition + ₹190–425/mo (indicative)' },
    'EWS Reservation + PM Vidyalakshmi':
      { url: 'https://www.vidyalakshmi.co.in/Students/', amount: 'Education loan + interest subsidy (income < ₹4.5L)' },
    'Minority Scholarship (Maulana Azad)':
      { url: 'https://www.minorityaffairs.gov.in/show_content.php?lang=1&level=1&ls_id=415&lid=283', amount: 'Post-matric minority benefit (indicative)' },
    'PM Vidyalakshmi Education Loan':
      { url: 'https://www.vidyalakshmi.co.in/Students/', amount: 'Need-based education loan' },
    'AP Fee Reimbursement (RTF + MTF)':
      { url: 'https://jnanabhumi.ap.gov.in/', amount: 'Tuition reimbursement (RTF) + maintenance (MTF)' },
    'TS Fee Reimbursement (ePASS)':
      { url: 'https://telanganaepass.cgg.gov.in/', amount: 'Full fee reimbursement + maintenance' },
    'Karnataka Fee Concession':
      { url: 'https://ssp.postmatric.karnataka.gov.in/', amount: 'Category-based fee concession' },
    'MAHADBT Scholarship':
      { url: 'https://mahadbt.maharashtra.gov.in/SchemeData/SchemeData?str=E9DDFA703C38E51AC54E5F6E794BD5C1', amount: 'Tuition+exam fee + ₹190–425/mo' },
    'TN First Graduate Scholarship':
      { url: 'https://www.tn.gov.in/scheme/search?query=first+graduate', amount: 'Full tuition fee waiver (indicative)' },
    'Kerala State Merit Scholarship':
      { url: 'http://www.dcescholarship.kerala.gov.in/', amount: 'Category/merit-based (indicative)' }
  };

  function scholarshipOptionsFor(formData, c) {
    var schl = (formData.scholarship || '').toLowerCase();
    var out = [];
    if (schl.indexOf('sc')  !== -1)  out.push('SC Post-Matric Scholarship');
    if (schl.indexOf('st')  !== -1)  out.push('ST Post-Matric Scholarship');
    if (schl.indexOf('obc') !== -1 || schl.indexOf('bc') !== -1) out.push('OBC / BC Welfare Scheme');
    if (schl.indexOf('ews') !== -1)  out.push('EWS Reservation + PM Vidyalakshmi');
    if (schl.indexOf('minority') !== -1) out.push('Minority Scholarship (Maulana Azad)');
    if (out.length === 0) out.push('PM Vidyalakshmi Education Loan');
    var s = formData.state;
    if (s === 'Andhra Pradesh') out.push('AP Fee Reimbursement (RTF + MTF)');
    else if (s === 'Telangana') out.push('TS Fee Reimbursement (ePASS)');
    else if (s === 'Karnataka') out.push('Karnataka Fee Concession');
    else if (s === 'Maharashtra') out.push('MAHADBT Scholarship');
    else if (s === 'Tamil Nadu')  out.push('TN First Graduate Scholarship');
    else if (s === 'Kerala')      out.push('Kerala State Merit Scholarship');
    return out.slice(0, 3).map(function (n) {
      var info = SCHOLARSHIP_INFO[n] || {};
      return { name: n, url: info.url || null, amount: info.amount || null };
    });
  }

  // ── Slim prompt builder ────────────────────────────────────────────────
  function buildSlimPrompt(formData, matches) {
    var top = matches.slice(0, 5);
    var lang = formData.language || 'Hindi';

    var pathNote = formData.pathChoice === 'merit'
      ? 'Student chose to follow ACADEMIC MERIT (top subject: ' + (formData.topMeritSubject || '—') + ').'
      : formData.pathChoice === 'interest'
      ? 'Student chose to follow PASSION/INTEREST (top interest: ' + (formData.topInterest || '—') + ').'
      : 'Student\'s merit and interest are aligned. Provide holistic narrative.';

    var sys = 'You are CareerDisha, a career counselor for Indian students. ' +
              'Match scores, salaries, supply/demand, entry routes, scholarship lists, job portals, the decision ' +
              'tree, the English counselor note, the English student summary, and the job-market chart are ALL ' +
              'computed deterministically by the host app — DO NOT generate them. ' +
              'Your job: write per-career narratives, NIRF-ranked colleges, entrance exam URLs, risk/upside factors, ' +
              'scholarship and warning callouts, the regional-language summary and counselor note (in the student\'s ' +
              'script), and 8 sample job listings. Respond ONLY with valid JSON. No markdown, no commentary.';

    var careersList = top.map(function (m, i) {
      var c = m.career;
      return (i + 1) + '. ' + c.name.en + '  [career_id: "' + c.id + '"]\n' +
             '   match_score: ' + Math.round(m.score * 100) + '%' +
             ' | salary entry/mid: ' + formatSalary(c.salary_inr.entry) + ' / ' + formatSalary(c.salary_inr.mid) +
             ' | growth: ' + c.growth + '\n' +
             '   streams: ' + (c.streams.length ? c.streams.join(', ') : 'any') + '\n' +
             '   key exams: ' + (c.exams.slice(0, 4).join(', ') || '—') +
             (m.blockers && m.blockers.length ? '\n   blockers: ' + m.blockers.join(', ') : '');
    }).join('\n');

    var schema = '{\n' +
      '  "student_summary_local": "2-3 sentence profile in ' + lang + ' script (NOT English)",\n' +
      '  "narratives":     { "<career_id>": "1-2 sentence personalized why-this-fits-you", ... 5 entries },\n' +
      '  "colleges":       { "<career_id>": [ {"name":"IIT Hyderabad","nirf_rank":"7","nirf_year":"2025","type":"IIT","state":"TS"}, ...5 each ] },\n' +
      '  "exams":          { "<career_id>": [ {"exam":"JEE Main","url":"https://jeemain.nta.nic.in","eligibility":"After 12th MPC"}, ...3 each ] },\n' +
      '  "risk_factors":   { "<career_id>": ["risk1","risk2"], ... },\n' +
      '  "upside_factors": { "<career_id>": ["upside1","upside2"], ... },\n' +
      '  "scholarship_alert":   "specific note tailored to this student\'s reservation category and state",\n' +
      '  "warning_flags":       ["any concerns about budget/marks/timeline"],\n' +
      '  "counselor_note_local":"warm motivational note in ' + lang + ' script (NOT English)",\n' +
      '  "job_listings": [ {"job_id":"JD-001","title":"...","company":"...","salary_range":"₹4-7 LPA","experience":"0-2 yrs","location":"Hyderabad","skills":["Python","SQL"],"apply_url":"https://..."}, ...8 entries ]\n' +
      '}';

    var prompt = pathNote + '\n\n' +
      'STUDENT PROFILE:\n' +
      'State: ' + (formData.state  || '—') +
      ' | Class: ' + (formData.level  || '—') +
      ' | Stream: ' + (formData.stream || '—') +
      ' | Board: '  + (formData.board  || '—') + '\n' +
      'Top merit subject: ' + (formData.topMeritSubject || '—') +
        (formData.topMeritScore >= 0 ? ' (' + Number(formData.topMeritScore).toFixed(1) + '%)' : '') + '\n' +
      'Primary interest: ' + (formData.topInterest || '—') + '\n' +
      'All interests:    ' + (formData.interests   || '—') + '\n' +
      'Strengths:        ' + (formData.strengths   || '—') + '\n' +
      'Budget: ' + (formData.budget   || '—') +
      ' | Location: ' + (formData.location || '—') +
      ' | Family: '   + (formData.family   || '—') + '\n' +
      'Scholarship category: ' + (formData.scholarship || '—') + '\n' +
      'Passion: ' + (formData.passion || '—') + '\n\n' +
      'PRE-RANKED CAREERS (rank order is final — write narratives + supporting data, do NOT reshuffle):\n' +
      careersList + '\n\n' +
      'INSTRUCTIONS:\n' +
      '- Use the exact career_id strings shown above as keys in narratives/colleges/exams/risk_factors/upside_factors\n' +
      '- "narratives": one short personalized paragraph per career_id explaining why it fits THIS student (reference their marks, interests, location, family situation)\n' +
      '- "colleges": 5 NIRF-2025-ranked colleges per career; prefer institutions in/near the student\'s state\n' +
      '- "exams": 3 entrance exams per career with official URLs; prefer state exams (e.g. EAMCET for AP/TS, KCET for KA, MHT-CET for MH)\n' +
      '- "risk_factors" / "upside_factors": 2 each per career\n' +
      '- "job_listings": 8 realistic openings (real Indian companies, realistic salary, real apply URLs like naukri.com/career/X or linkedin.com/jobs/X)\n' +
      '- "*_local" fields MUST be in ' + lang + ' script (not English transliteration)\n' +
      '- DO NOT generate student_summary, counselor_note, decision_tree, or domain_market_data — the host app builds those deterministically.\n\n' +
      'Return ONLY this JSON:\n' + schema;

    return { sys: sys, prompt: prompt };
  }

  // ── Merge LLM response with deterministic data ─────────────────────────
  function mergeLLMResponse(llm, formData, matches) {
    llm = llm || {};
    var top = matches.slice(0, 5);

    var top_paths = top.map(function (m, i) {
      var c   = m.career;
      var id  = c.id;
      var nar = (llm.narratives     && llm.narratives[id])     || '';
      var col = (llm.colleges       && llm.colleges[id])       || [];
      var exm = (llm.exams          && llm.exams[id])          || [];
      var rk  = (llm.risk_factors   && llm.risk_factors[id])   || [];
      var up  = (llm.upside_factors && llm.upside_factors[id]) || [];

      var path = {
        rank: i + 1,
        domain: DOMAIN_LABEL[id] || 'Career Path',
        specific_career: c.name.en,
        match_score: Math.round(m.score * 100),
        match_reason: nar,
        entry_route: buildEntryRoute(c, formData),
        duration_years: durationYears(c),
        estimated_cost: estimatedCost(c),
        cost_breakdown: costBreakdown(c, formData),
        starting_salary_range: formatSalary(c.salary_inr.entry),
        '5yr_salary_range':    formatSalary(c.salary_inr.mid),
        salary_source:         salarySource(c),
        job_locations: c.preferred_locations.slice(0, 5),
        budget_tier: budgetTierLabel(c.budget_tier),
        scholarship_options: scholarshipOptionsFor(formData, c),
        supply_demand: supplyDemand(c),
        top_colleges_ranked: nirfCollegesFor(c, formData) || col,
        home_state_colleges: nirfCollegesInState(c, formData),
        entrance_exam_links: exm,
        jobs_market: jobsMarket(c),
        job_portals: jobPortals(formData),
        risk_factors: rk,
        upside_factors: up,
        citations: []
      };
      if (i === 0) {
        path.decision_tree = (llm.decision_tree_top && llm.decision_tree_top.current_node)
          ? llm.decision_tree_top
          : defaultDecisionTree(c, formData);
      }
      return path;
    });

    var market = (llm.domain_market_data && llm.domain_market_data.length)
      ? llm.domain_market_data
      : defaultMarketData(matches);

    var top1 = matches[0];
    return {
      student_summary:       llm.student_summary       || defaultStudentSummary(formData, top1),
      student_summary_local: llm.student_summary_local || '',
      top_paths:             top_paths,
      domain_market_data:    market,
      scholarship_alert:     llm.scholarship_alert     || '',
      warning_flags:         llm.warning_flags         || [],
      counselor_note:        llm.counselor_note        || defaultCounselorNote(top1, formData),
      counselor_note_local:  llm.counselor_note_local  || '',
      job_listings:          llm.job_listings          || [],
      govt_jobs:             govtJobTargets(formData)
    };
  }

  // ── Canonical cache key ────────────────────────────────────────────────
  // Hashes the profile fields that drive LLM output. Excludes free-text
  // (passion) and exact mark numbers (we bucket them) so similar students
  // hit the same cache entry. Returns a 24-hex-char SHA-256 prefix.
  function bucket10(n) {
    if (typeof n !== 'number' || isNaN(n) || n < 0) return -1;
    return Math.round(n / 10) * 10;
  }
  function sortedTrim(csv, n) {
    return (csv || '').split(',').map(function (s) { return s.trim(); })
      .filter(Boolean).slice(0, n).sort();
  }
  async function canonicalCacheKey(formData) {
    var canon = {
      v:           1,                                     // bump if cache invalidation needed
      state:       formData.state       || '',
      level:       formData.level       || '',
      stream:      formData.stream      || '',
      interests:   sortedTrim(formData.interests, 3),
      strengths:   sortedTrim(formData.strengths, 3),
      tenthBkt:    bucket10(parseFloat(formData.tenthAvg)),
      interBkt:    bucket10(parseFloat(formData.interAvg)),
      topMerit:    formData.topMeritSubject || '',
      topMeritBkt: bucket10(formData.topMeritScore),
      topInterest: formData.topInterest || '',
      pathChoice:  formData.pathChoice  || '',
      budget:      formData.budget      || '',
      location:    formData.location    || '',
      family:      formData.family      || '',
      scholarship: formData.scholarship || ''
    };
    var json = JSON.stringify(canon);
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      var buf = new TextEncoder().encode(json);
      var hash = await crypto.subtle.digest('SHA-256', buf);
      var hex = Array.from(new Uint8Array(hash))
        .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 24);
    }
    // Fallback: simple djb2 hash if SubtleCrypto unavailable. Less collision-resistant
    // but stable; only used in dev environments without crypto.subtle.
    var h = 5381;
    for (var i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
    return ('00000000' + (h >>> 0).toString(16)).slice(-12);
  }

  window.CareerComposer = {
    buildSlimPrompt:    buildSlimPrompt,
    mergeLLMResponse:   mergeLLMResponse,
    canonicalCacheKey:  canonicalCacheKey
  };

  console.log('[CareerDisha] composer.js loaded');
})();
