// Headless test runner for the deterministic match engine.
// Usage:  node data/_test-matcher.js
//
// Loads data.js + matcher.js into a sandboxed `window`, then feeds in form-data
// objects shaped like collectData() in index.html for each of the 8 demo
// profiles. Prints the top 5 matches with score breakdowns.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const sandbox = { window: {}, console: console };
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, 'data.js'),     'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'matcher.js'),  'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'composer.js'), 'utf8'), sandbox);

const M = sandbox.window.CareerMatcher;
const C = sandbox.window.CareerComposer;
if (!M) { console.error('FATAL: matcher did not load');  process.exit(1); }
if (!C) { console.error('FATAL: composer did not load'); process.exit(1); }

// Form-data objects mirror the output of collectData() in index.html line 1337.
// Subject keys carry their original spaces (e.g. 'Social Studies', 'Second Language').
const demos = [
  { name: '1 · Arjun (TS, 10th studying, Tech)',
    form: {
      state: 'Telangana', level: '10th studying', stream: '',
      tenthMarks: {}, interMarks: {},
      interests: 'Technology, Sports',
      strengths: 'Logical thinking, Technical',
      budget: 'Under ₹1 Lakh', location: 'Stay in Telangana only',
      family: 'First-generation graduate'
    }
  },
  { name: '2 · Priya (AP, 10th completed, Medicine)',
    form: {
      state: 'Andhra Pradesh', level: '10th completed', stream: '',
      tenthMarks: { 'English':80, 'Second Language':72, 'Mathematics':78, 'Science':92, 'Social Studies':75 },
      interMarks: {},
      interests: 'Medicine, Agriculture',
      strengths: 'Empathy, Analytical, Research',
      budget: '₹3–7 Lakh', location: 'Open to other states',
      family: 'First-generation graduate'
    }
  },
  { name: '3 · Kiran (TS, Inter MPC, Govt Service)',
    form: {
      state: 'Telangana', level: 'Inter 2nd year', stream: 'MPC',
      tenthMarks: { 'English':72, 'Second Language':65, 'Mathematics':95, 'Science':90, 'Social Studies':68 },
      interMarks: { 'Mathematics':88, 'Physics':82, 'Chemistry':76, 'English':70, 'Second Language':65 },
      interests: 'Government Service, Technology',
      strengths: 'Analytical, Leadership, Communication',
      budget: '₹1–3 Lakh', location: 'Open to other states',
      family: 'Parents in government'
    }
  },
  { name: '4 · Ananya (KA, PUC PCMB, Medicine)',
    form: {
      state: 'Karnataka', level: 'Inter 2nd year', stream: 'Science (PCMB)',
      tenthMarks: { 'English':82, 'Second Language':70, 'Mathematics':78, 'Science':91, 'Social Studies':74 },
      interMarks: { 'Botany':90, 'Zoology':88, 'Physics':82, 'Chemistry':85, 'English':78, 'Second Language':72 },
      interests: 'Medicine, Social Work',
      strengths: 'Empathy, Analytical, Research',
      budget: '₹7–15 Lakh', location: 'Open to other states',
      family: 'Parents in private sector'
    }
  },
  { name: '5 · Suresh (MH, HSC Commerce, CA)',
    form: {
      state: 'Maharashtra', level: 'Inter completed', stream: 'Commerce',
      tenthMarks: { 'English':78, 'Second Language':70, 'Mathematics':72, 'Science':65, 'Social Studies':75 },
      interMarks: { 'Commerce':88, 'Economics':82, 'Business Studies':78, 'English':75, 'Second Language':68 },
      interests: 'Finance, Business',
      strengths: 'Analytical, Logical thinking, Leadership',
      budget: '₹3–7 Lakh', location: 'Open to other states',
      family: 'Business family'
    }
  },
  { name: '6 · Deepa (AP, Degree HEC, Law/IAS)',
    form: {
      state: 'Andhra Pradesh', level: 'Degree 2nd year', stream: 'HEC',
      tenthMarks: { 'English':82, 'Second Language':78, 'Mathematics':58, 'Science':65, 'Social Studies':88 },
      interMarks: { 'History':85, 'Economics':80, 'Civics':78, 'English':82, 'Second Language':75 },
      interests: 'Law, Government Service, Social Work',
      strengths: 'Communication, Leadership, Analytical',
      budget: '₹1–3 Lakh', location: 'Open to abroad',
      family: 'First-generation graduate'
    }
  },
  { name: '7 · Meera (KL, Plus Two Science, Tech)',
    form: {
      state: 'Kerala', level: 'Inter 2nd year', stream: 'Science',
      tenthMarks: { 'English':85, 'Second Language':78, 'Mathematics':90, 'Science':88, 'Social Studies':80 },
      interMarks: { 'Mathematics':88, 'Physics':85, 'Chemistry':82, 'English':80, 'Second Language':76 },
      interests: 'Technology, Digital Marketing',
      strengths: 'Logical thinking, Analytical, Technical',
      budget: '₹3–7 Lakh', location: 'Open to abroad',
      family: 'Parents in private sector'
    }
  },
  { name: '8 · Kavitha (TN, HSC PCMB, Medicine)',
    form: {
      state: 'Tamil Nadu', level: 'Inter 2nd year', stream: 'Science (PCMB)',
      tenthMarks: { 'English':88, 'Second Language':82, 'Mathematics':85, 'Science':93, 'Social Studies':80 },
      interMarks: { 'Botany':92, 'Zoology':90, 'Physics':85, 'Chemistry':88, 'English':82, 'Second Language':78 },
      interests: 'Medicine, Teaching',
      strengths: 'Empathy, Research, Analytical',
      budget: '₹7–15 Lakh', location: 'Open to other states',
      family: 'Parents in government'
    }
  }
];

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

demos.forEach(d => {
  const result = M.run(d.form);
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  ' + d.name);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Profile:');
  console.log('    interests:', result.profile.interests.join(', ') || '(none)');
  console.log('    strengths:', result.profile.strengths.join(', ') || '(none)');
  console.log('    subjects :', JSON.stringify(result.profile.subjects));
  console.log('    stream   :', result.profile.stream || '(none)');
  console.log('    class    :', result.profile.class);
  console.log('  Top matches:');
  if (!result.matches.length) {
    console.log('    (no matches above floor 0.18)');
  } else {
    result.matches.slice(0, 5).forEach((m, i) => {
      const b = m.breakdown;
      console.log(
        '    ' + (i+1) + '. ' + pad(m.career.name.en, 38) +
        '  score=' + m.score.toFixed(3) +
        '  [int=' + b.interest + ' str=' + b.strength + ' sub=' + b.subject +
        ' loc=' + b.location + ' den=' + b.density + ']' +
        (m.blockers.length ? '  ⚠ ' + m.blockers.join(',') : '')
      );
    });
  }
});

console.log('\n');

// ── COMPOSER SMOKE TEST ──────────────────────────────────────────────
// Run buildSlimPrompt + mergeLLMResponse on demo #4 (Ananya, clean PCMB → MBBS)
// and report token-rough sizes plus a key-shape diff vs the renderAll contract.
console.log('══════════════════════════════════════════════════════════════════════');
console.log('  COMPOSER SMOKE TEST · demo #4 Ananya');
console.log('══════════════════════════════════════════════════════════════════════');
const ananya = demos[3];
ananya.form.pathChoice = 'both';
ananya.form.topMeritSubject = 'Botany';
ananya.form.topMeritScore = 90;
ananya.form.topInterest = 'Medicine';
ananya.form.language = 'Kannada';

const matcherOut = M.run(ananya.form);
const built = C.buildSlimPrompt(ananya.form, matcherOut.matches);
console.log('  System prompt:', built.sys.length, 'chars');
console.log('  User prompt :', built.prompt.length, 'chars (~', Math.round(built.prompt.length/4), 'tokens)');

// Mock a minimal LLM response in the slim shape and verify merge output is sane.
const mockLlm = {
  student_summary: 'Strong PCMB student aligned with medicine.',
  student_summary_local: 'ಔಷಧ ಆಸಕ್ತಿಯ ವಿದ್ಯಾರ್ಥಿ',
  narratives: {
    'doctor-mbbs': 'Your 90% Botany + Empathy strength fits MBBS perfectly.',
    'veterinarian': 'Vet medicine combines your medicine interest with Karnataka rural service.',
    'nurse': 'B.Sc Nursing offers fast entry with strong govt-job density.',
    'physiotherapist': 'BPT lets you help patients in Karnataka clinics with shorter training.',
    'dentist-bds': 'BDS is a private-practice path with steady income.'
  },
  colleges: { 'doctor-mbbs': [{ name: 'AIIMS Delhi', nirf_rank: '1', nirf_year: '2024', type: 'AIIMS', state: 'Delhi' }] },
  exams:    { 'doctor-mbbs': [{ exam: 'NEET UG', url: 'https://neet.nta.nic.in', eligibility: 'After 12th PCB' }] },
  decision_tree_top: { current_node: 'PUC PCMB Year 2', next_step: 'NEET UG prep', branch_yes: 'AIIMS', branch_no: 'KCET Medical', milestone_3yr: 'MBBS Year 2', milestone_final: 'MD Pediatrics' },
  scholarship_alert: 'Karnataka State Merit Scholarship + central PMSSS available.',
  warning_flags: [],
  counselor_note: 'You are well-positioned. Lock in NEET prep through 2026.',
  counselor_note_local: 'ನೀವು ಸಿದ್ಧರಾಗಿದ್ದೀರಿ.',
  domain_market_data: [{ domain: 'Medicine', ap_ts_demand_score: 82, ap_ts_supply_score: 45, opportunity_gap: 'Very High', annual_jobs_created_ap_ts: '12,000+', avg_salary_entry: '₹6 LPA', trend: 'Stable Rising', source: 'MoHFW 2024' }],
  job_listings: [{ job_id: 'JD-001', title: 'Junior Resident', company: 'Manipal Hospitals', salary_range: '₹6-9 LPA', experience: '0-1 yrs', location: 'Bengaluru', skills: ['MBBS', 'Patient Care'], apply_url: 'https://naukri.com' }]
};

const merged = C.mergeLLMResponse(mockLlm, ananya.form, matcherOut.matches);
const expectedKeys = ['student_summary','student_summary_local','top_paths','domain_market_data','scholarship_alert','warning_flags','counselor_note','counselor_note_local','job_listings'];
const missing = expectedKeys.filter(k => !(k in merged));
console.log('  Top-level shape keys present:', missing.length === 0 ? 'OK ✓' : 'MISSING ' + missing.join(','));
console.log('  top_paths length:', merged.top_paths.length);
const p1 = merged.top_paths[0];
const pathKeys = ['rank','domain','specific_career','match_score','match_reason','entry_route','duration_years',
                  'estimated_cost','starting_salary_range','5yr_salary_range','job_locations','budget_tier',
                  'scholarship_options','supply_demand','top_colleges_ranked','entrance_exam_links','jobs_market',
                  'job_portals','risk_factors','upside_factors','citations','decision_tree'];
const missingP = pathKeys.filter(k => !(k in p1));
console.log('  top_paths[0] keys:', missingP.length === 0 ? 'OK ✓' : 'MISSING ' + missingP.join(','));
console.log('  Sample card preview:');
console.log('    domain :', p1.domain);
console.log('    title  :', p1.specific_career, '(' + p1.match_score + '% match)');
console.log('    salary :', p1.starting_salary_range, '→', p1['5yr_salary_range']);
console.log('    route  :', p1.entry_route);
console.log('    schol  :', p1.scholarship_options.join(' / '));
console.log('    market :', p1.supply_demand.demand_level + ' demand, ' + p1.supply_demand.growth_trend);
console.log('    jobs   :', p1.jobs_market.total_vacancies_ap_ts_annual + ' vacancies, ' + p1.jobs_market.competition_ratio);
console.log('');
