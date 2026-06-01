// CareerDisha deterministic match engine.
// Inputs: a form-data object shaped like collectData() produces in index.html.
// Output: window.CareerMatcher.run(formData) → { profile, matches }
//   profile = canonicalized student vector (interest/strength/subject IDs, normalized)
//   matches = top-N careers, each with { career, score, breakdown, displayBlockers }
//
// Pure functions, no side effects, no API calls. Safe to call repeatedly.

(function () {
  'use strict';

  if (!window.CAREER_DATA) {
    console.error('[CareerDisha] matcher.js loaded before data.js — fix script order');
    return;
  }

  var DATA = window.CAREER_DATA;

  // Bucket size for marks: 0..1, rounded to nearest 0.1 for cache-key stability later.
  function bucketMark(pct) {
    if (typeof pct !== 'number' || isNaN(pct)) return 0;
    var v = Math.max(0, Math.min(100, pct)) / 100;
    return Math.round(v * 10) / 10;
  }

  // Canonicalize a chip label to its ID, falling back to a kebab-case slug if unknown.
  function canon(label, dict) {
    if (!label) return null;
    var s = String(label).trim();
    if (dict[s]) return dict[s];
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // Build the student profile vector from a form-data object.
  function buildStudentProfile(form) {
    var interests = (form.interests || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (l) { return DATA.interestLabels[l] || canon(l, DATA.interestLabels); })
      .filter(Boolean);

    var strengths = (form.strengths || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (l) { return DATA.strengthLabels[l] || canon(l, DATA.strengthLabels); })
      .filter(Boolean);

    // Merge tenth + inter marks, canonicalize subject names, fan out 'expand' entries.
    var subjects = {};
    function addMark(subjLabel, mark) {
      var info = DATA.subjectLabels[subjLabel];
      if (!info) return;
      var v = bucketMark(mark);
      // Prefer max if multiple subjects roll into same canonical id.
      subjects[info.id] = Math.max(subjects[info.id] || 0, v);
      if (info.expand) {
        info.expand.forEach(function (xid) {
          subjects[xid] = Math.max(subjects[xid] || 0, v);
        });
      }
    }
    Object.keys(form.tenthMarks || {}).forEach(function (k) { addMark(k, form.tenthMarks[k]); });
    Object.keys(form.interMarks || {}).forEach(function (k) { addMark(k, form.interMarks[k]); });

    return {
      state: form.state || '',
      class: form.level || '',
      stream: form.stream || '',
      interests: interests,
      strengths: strengths,
      subjects: subjects,
      location: form.location || '',
      budget: form.budget || '',
      family: form.family || ''
    };
  }

  // Coverage-of-student similarity: "what fraction of the student's picks does
  // the career cover?" — plus a bonus for matching the student's *primary*
  // (first-selected) interest.
  //
  // Why coverage, not Jaccard: Jaccard penalizes careers that list many
  // interests (e.g. Software Engineer with [tech, digital-marketing, finance])
  // versus narrow ones (Electronics with [tech]) when the student picked
  // [tech, sports]. Both intersect at 1, but Jaccard would give Electronics 0.5
  // and SWE 0.25 — punishing SWE for being broadly applicable. Coverage doesn't.
  function interestCoverage(studentInterests, careerInterests) {
    if (!studentInterests.length || !careerInterests.length) return 0;
    var C = {};
    careerInterests.forEach(function (x) { C[x] = 1; });
    var inter = 0;
    studentInterests.forEach(function (x) { if (C[x]) inter++; });
    var coverage = inter / studentInterests.length;
    var primaryBonus = C[studentInterests[0]] ? 0.15 : 0;
    return Math.min(1, 0.85 * coverage + primaryBonus);
  }

  function strengthCoverage(studentStrengths, careerStrengths) {
    if (!studentStrengths.length || !careerStrengths.length) return 0;
    var C = {};
    careerStrengths.forEach(function (x) { C[x] = 1; });
    var inter = 0;
    studentStrengths.forEach(function (x) { if (C[x]) inter++; });
    return inter / studentStrengths.length;
  }

  // Subjects a pre-10th student can plausibly have a mark in (10th-level + their expansions).
  // Used to keep specialized career subjects (CS, Commerce, Economics, Botany…) out of the
  // denominator for below-10th students, so they aren't penalised for marks they can't have yet.
  var FOUNDATIONAL = {
    math: 1, physics: 1, chemistry: 1, biology: 1, science: 1, english: 1, 'second-language': 1,
    'social-studies': 1, history: 1, civics: 1, 'political-science': 1, geography: 1
  };

  // Weighted dot product on a sparse subject map; weights need not sum to 1.
  // Returns 0..1 if all student marks are 0..1. When `foundationalOnly` is set (below-10th),
  // specialized career subjects are excluded from both numerator and denominator.
  function weightedSubjectDot(studentSubjects, careerWeights, foundationalOnly) {
    var sum = 0, totalW = 0;
    var keys = Object.keys(careerWeights);
    if (!keys.length) return 0.5; // neutral when career has no subject preference
    keys.forEach(function (k) {
      if (foundationalOnly && !FOUNDATIONAL[k]) return; // skip subjects a pre-10th student can't have
      var w = careerWeights[k];
      var s = studentSubjects[k] || 0;
      sum += w * s;
      totalW += w;
    });
    if (!totalW) return 0.5; // career had only specialized subjects → neutral, don't penalise
    return sum / totalW;
  }

  // Tier classifier — same buckets used for cache keys later.
  function locationTier(location) {
    var metros = ['Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Kolkata','Pune','Gurgaon','Gurugram','Noida','Ahmedabad'];
    var l = (location || '').toString();
    if (!l) return 'tier2';
    if (metros.some(function (m) { return l.indexOf(m) !== -1; })) return 'metro';
    if (/village|rural/i.test(l)) return 'rural';
    return 'tier2';
  }

  function budgetRank(budgetLabel) {
    var b = (budgetLabel || '').toString();
    if (b.indexOf('Under ₹1') === 0)        return 0;
    if (b.indexOf('₹1–3') === 0)            return 1;
    if (b.indexOf('₹3–7') === 0)            return 2;
    if (b.indexOf('₹7–15') === 0)           return 3;
    if (b.indexOf('₹15–30') === 0)          return 4;
    if (b.indexOf('Above ₹30') === 0)       return 5;
    return 2;
  }

  function budgetTierFromRank(rank) {
    if (rank <= 1) return 'low';
    if (rank <= 3) return 'mid';
    return 'high';
  }

  // Score a single career against the student profile.
  // Returns { score, breakdown, blockers } — blockers are display-only flags
  // (e.g. "needs to complete 12th first") that don't zero the score.
  function scoreCareer(student, career) {
    var blockers = [];

    // Hard filter: stream gate — only when the career declares streams AND the student has a
    // REAL chosen stream. "Not specified"/"Not yet completed"/empty (e.g. 10th studying or 10th
    // completed students who have no stream yet) must NOT trip the gate, or every stream-declaring
    // career (all engineering/medical/commerce/law) gets zeroed and only streamless careers survive.
    var sStream = student.stream;
    var hasRealStream = sStream && sStream !== 'Not specified' && sStream !== 'Not yet completed';
    if (career.streams && career.streams.length && hasRealStream) {
      if (career.streams.indexOf(sStream) === -1) {
        return { score: 0, breakdown: {}, blockers: ['stream-mismatch'] };
      }
    }

    // Budget feasibility — only penalize when career is genuinely high-cost AND
    // student picked the lowest budget bucket. Mid budget is plenty for most
    // careers (govt seats, scholarships, education loans cover the gap).
    var sBudget = budgetTierFromRank(budgetRank(student.budget));
    var budgetPenalty = 1.0;
    if (career.budget_tier === 'high' && sBudget === 'low') budgetPenalty = 0.65;

    // Display-only: class gating note. Keys mirror the f_level dropdown values
    // in index.html line 397 onwards.
    var classOrder = {
      '10th studying': 0, '10th completed': 1,
      'Inter 1st year': 2, 'Inter 2nd year': 3, 'Inter completed': 4,
      'Degree 1st year': 5, 'Degree 2nd year': 5, 'Degree 3rd year': 5,
      'Degree completed': 6
    };
    var minNeeded = { '12th-passed': 4, 'graduate': 6 };
    var sLvl = classOrder[student.class];
    var cLvl = minNeeded[career.min_class];
    if (typeof sLvl === 'number' && typeof cLvl === 'number' && sLvl < cLvl) {
      blockers.push(career.min_class === 'graduate' ? 'needs-graduation' : 'needs-12th');
    }

    // "10th Studying or Below": interest + aptitude are the meaningful signals at this age, and the
    // student can't have specialized (stream/CS) marks yet — so we lead with interest, score subjects
    // on foundational subjects only, and let the primary interest dominate (see below).
    var belowTenth = student.class === '10th studying';

    var v = career.vector || {};
    var wInterest = interestCoverage(student.interests, v.interests || []);
    // Below-10th: the declared #1 interest dominates — if this career covers it, floor the interest
    // signal high so a complementary 2nd pick can't cap the career matching their primary passion.
    if (belowTenth && student.interests.length && (v.interests || []).indexOf(student.interests[0]) !== -1) {
      wInterest = Math.max(wInterest, 0.8);
    }
    var wStrength = strengthCoverage(student.strengths, v.strengths || []);
    var wSubject  = weightedSubjectDot(student.subjects, v.subjects || {}, belowTenth);

    // Location signals. A student who is "open to other states / abroad" is FLEXIBLE — they can
    // relocate to where the career's jobs are, so they should NOT be penalised like a student
    // locked to a low-opportunity home location.
    var loc = student.location || '';
    var flexible = /open to other states|open to abroad/i.test(loc);
    var prefList = career.preferred_locations || [];
    var allIndia = prefList.length === 0 || prefList.indexOf('All-India') !== -1 || prefList.indexOf('All-India-Posting') !== -1;
    var wLocation = allIndia ? 0.85
                  : flexible ? 0.9
                  : (prefList.some(function (p) { return loc.indexOf(p) !== -1; }) ? 1.0 : 0.45);
    // Flexible students get the career's best (metro) job density, since they can move to it.
    var tier = locationTier(loc);
    var wDensity = flexible
                     ? Math.max((career.job_density && career.job_density.metro) || 0.4, (career.job_density && career.job_density[tier]) || 0)
                     : (career.job_density && typeof career.job_density[tier] === 'number' ? career.job_density[tier] : 0.4);

    // When student has no marks (e.g. "10th studying" path zeroes them),
    // the 0.25 subject term collapses to 0 for every career, forfeiting 25% of
    // the score budget and starving most careers below the 0.18 floor. Shift
    // that weight onto interest (+0.15) and strength (+0.10) so the formula
    // still sums to 1.0 and the threshold stays comparable.
    var hasNoMarks = !student.subjects || Object.keys(student.subjects).length === 0;
    var wI, wS, wSub;
    if (belowTenth && !hasNoMarks) {        // pre-10th WITH foundational marks → interest/aptitude-led
      wI = 0.45; wS = 0.25; wSub = 0.10;
    } else if (hasNoMarks) {                // no marks at all → interests are the only signal
      wI = 0.50; wS = 0.30; wSub = 0.00;
    } else {                                // 10th+/Inter/Degree with marks → standard balance
      wI = 0.35; wS = 0.20; wSub = 0.25;
    }

    var raw = wI  * wInterest
            + wS  * wStrength
            + wSub * wSubject
            + 0.10 * wLocation
            + 0.10 * wDensity;

    var score = raw * budgetPenalty;

    return {
      score: score,
      breakdown: {
        interest: round2(wInterest), strength: round2(wStrength),
        subject: round2(wSubject), location: round2(wLocation),
        density: round2(wDensity), budgetPenalty: round2(budgetPenalty)
      },
      blockers: blockers
    };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  // Rank careers; floor of 0.18 hides truly bad matches but stays generous so that
  // unusual profiles still get something to look at.
  function topCareers(student, n) {
    n = n || 5;
    var scored = DATA.careers.map(function (c) {
      var s = scoreCareer(student, c);
      return { career: c, score: s.score, breakdown: s.breakdown, blockers: s.blockers };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.filter(function (x) { return x.score > 0.18; }).slice(0, n);
  }

  // One-call entry point used by index.html.
  function run(formData) {
    var profile = buildStudentProfile(formData);
    var matches = topCareers(profile, 6);
    return { profile: profile, matches: matches };
  }

  window.CareerMatcher = {
    run: run,
    buildStudentProfile: buildStudentProfile,
    scoreCareer: scoreCareer,
    topCareers: topCareers
  };

  console.log('[CareerDisha] matcher.js loaded');
})();
