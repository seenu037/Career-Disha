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
    'agricultural-scientist': 'Agriculture & Research'
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
    'agricultural-scientist': 'B.Sc Agriculture'
  };

  var DURATION_YEARS = {
    'doctor-mbbs': 5.5, 'dentist-bds': 5,
    'lawyer': 5, 'architect': 5,
    'chartered-accountant': 4, 'company-secretary': 3,
    'civil-servant': 4, 'defence-officer': 3
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
      data_source: 'NASSCOM / AICTE 2024 (estimates)'
    };
  }

  function jobsMarket(c) {
    var d = c.job_density || {};
    var base = Math.round(((d.metro || 0.5) + (d.tier2 || 0.4)) * 25000);
    var multiplier = c.growth === 'high' ? 7 : c.growth === 'medium' ? 5 : 3;
    var applicants = base * multiplier;
    return {
      total_vacancies_ap_ts_annual: base.toLocaleString('en-IN') + '+',
      estimated_applicants: applicants.toLocaleString('en-IN'),
      competition_ratio: '1 job per ' + multiplier + ' applicants',
      data_source: 'NASSCOM / AICTE / industry estimates 2024'
    };
  }

  var GENERIC_PORTALS = [
    { name: 'Naukri.com',     url: 'https://naukri.com',         focus: 'General — all sectors' },
    { name: 'LinkedIn Jobs',  url: 'https://linkedin.com/jobs',  focus: 'Professional network' },
    { name: 'NCS Portal',     url: 'https://ncs.gov.in',         focus: 'Govt / PSU openings' }
  ];

  function jobPortals() { return GENERIC_PORTALS; }

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
    if (s === 'Andhra Pradesh') out.push('AP Fee Reimbursement (Jagananna Vidya Deevena)');
    else if (s === 'Telangana') out.push('TS Fee Reimbursement / Vidya Deevena');
    else if (s === 'Karnataka') out.push('Karnataka Fee Concession');
    else if (s === 'Maharashtra') out.push('MAHADBT Scholarship');
    else if (s === 'Tamil Nadu')  out.push('TN First Graduate Scholarship');
    else if (s === 'Kerala')      out.push('Kerala State Merit Scholarship');
    return out.slice(0, 3);
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
              'Match scores, salaries, supply/demand, entry routes, scholarship lists, and job portals are computed ' +
              'deterministically and supplied to you — DO NOT change them or invent alternatives. ' +
              'Your job: write personalized narratives, the decision tree, supporting colleges/exams, scholarship ' +
              'and warning callouts, the counselor note, a job-market chart dataset, and 8 sample job listings. ' +
              'Respond ONLY with valid JSON. No markdown, no commentary.';

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
      '  "student_summary": "2-3 sentence profile in English",\n' +
      '  "student_summary_local": "Same in ' + lang + ' script (NOT English)",\n' +
      '  "narratives":      { "<career_id>": "1-2 sentence personalized why-this-fits-you", ... 5 entries },\n' +
      '  "colleges":        { "<career_id>": [ {"name":"IIT Hyderabad","nirf_rank":"8","nirf_year":"2024","type":"IIT","state":"TS"}, ...3 each ] },\n' +
      '  "exams":           { "<career_id>": [ {"exam":"JEE Main","url":"https://jeemain.nta.nic.in","eligibility":"After 12th MPC"}, ...3 each ] },\n' +
      '  "risk_factors":    { "<career_id>": ["risk1","risk2"], ... },\n' +
      '  "upside_factors":  { "<career_id>": ["upside1","upside2"], ... },\n' +
      '  "decision_tree_top": {"current_node":"...","next_step":"...","branch_yes":"...","branch_no":"...","milestone_3yr":"...","milestone_final":"..."},\n' +
      '  "scholarship_alert": "specific note tailored to this student\'s reservation category and state",\n' +
      '  "warning_flags": ["any concerns about budget/marks/timeline"],\n' +
      '  "counselor_note": "warm motivational note in English",\n' +
      '  "counselor_note_local": "same in ' + lang + ' script",\n' +
      '  "domain_market_data": [ {"domain":"Engineering & IT","ap_ts_demand_score":88,"ap_ts_supply_score":75,"opportunity_gap":"High","annual_jobs_created_ap_ts":"45,000+","avg_salary_entry":"₹4.5 LPA","trend":"Rising","source":"NASSCOM 2024"}, ...6-7 entries ],\n' +
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
      '- "colleges": 3 NIRF-2024-ranked colleges per career; prefer institutions in/near the student\'s state\n' +
      '- "exams": 3 entrance exams per career with official URLs; prefer state exams (e.g. EAMCET for AP/TS, KCET for KA, MHT-CET for MH)\n' +
      '- "decision_tree_top": ONLY for career #1; concise 6-node flow\n' +
      '- "risk_factors" / "upside_factors": 2 each per career\n' +
      '- "domain_market_data": 6-7 chart entries covering domains relevant to this student\'s top careers\n' +
      '- "job_listings": 8 realistic openings (real Indian companies, realistic salary, real apply URLs like naukri.com/career/X or linkedin.com/jobs/X)\n' +
      '- "*_local" fields MUST be in ' + lang + ' script (not English transliteration)\n\n' +
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
        starting_salary_range: formatSalary(c.salary_inr.entry),
        '5yr_salary_range':    formatSalary(c.salary_inr.mid),
        job_locations: c.preferred_locations.slice(0, 5),
        budget_tier: budgetTierLabel(c.budget_tier),
        scholarship_options: scholarshipOptionsFor(formData, c),
        supply_demand: supplyDemand(c),
        top_colleges_ranked: col,
        entrance_exam_links: exm,
        jobs_market: jobsMarket(c),
        job_portals: jobPortals(),
        risk_factors: rk,
        upside_factors: up,
        citations: []
      };
      if (i === 0 && llm.decision_tree_top) path.decision_tree = llm.decision_tree_top;
      return path;
    });

    return {
      student_summary:       llm.student_summary       || '',
      student_summary_local: llm.student_summary_local || '',
      top_paths:             top_paths,
      domain_market_data:    llm.domain_market_data    || [],
      scholarship_alert:     llm.scholarship_alert     || '',
      warning_flags:         llm.warning_flags         || [],
      counselor_note:        llm.counselor_note        || '',
      counselor_note_local:  llm.counselor_note_local  || '',
      job_listings:          llm.job_listings          || []
    };
  }

  window.CareerComposer = {
    buildSlimPrompt:   buildSlimPrompt,
    mergeLLMResponse:  mergeLLMResponse
  };

  console.log('[CareerDisha] composer.js loaded');
})();
