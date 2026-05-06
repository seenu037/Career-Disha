# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

CareerDisha is a single-file HTML career guidance web app for Indian students. A student fills a 3-step form, the app calls the Groq API (Llama 3.3 70B), and renders a career roadmap with match cards, a decision tree, a job market chart, and a job listings table.

## Running / Testing

No build step. Open `career_disha.html` directly in a browser as a local file. The JS detects `window.location.protocol === 'file:'` and calls the Groq API directly with the hardcoded key in `callAPI()`. For deployed use, `netlify/functions/chat.js` proxies the request server-side using `process.env.GROQ_API_KEY`.

`index.html` is an older copy of the app — **`career_disha.html` is the active file** where all development happens.

## Architecture

Everything lives in `career_disha.html`: HTML structure, CSS (embedded `<style>`), and JS (embedded `<script>`). There are no imports, bundlers, or external JS files. Chart.js is loaded from CDN.

### Form Flow

Three steps rendered as cards (`#step1`, `#step2`, `#step3`). Navigation via `gotoStep()`, with two special functions:
- `nextFromStep1()` — skips Step 2 entirely when class is "10th studying or below", visually marking the step circle as "—"
- `backFromStep3()` — the reverse of the above skip

### State-Driven Dynamics

Selecting a state triggers `onStateChange()`, which cascades updates to: board dropdown (`populateBoardDropdown`), branch/stream labels (`populateBranchOptions`), location chips (`rebuildLocChips`), exam categories (`buildExamCategories`), and all bilingual labels (`updateFormLanguage`).

Selecting a class triggers `onClassChange()`, which shows/hides `#branchSection`, `#streamSection`, `#tenthSection`, and `#interSection`.

### Key JS Constants

| Constant | Purpose |
|---|---|
| `STATE_BOARDS` | Maps state → board options for `#f_board` |
| `STATE_STREAMS` | Maps state → `{label, options}` for branch/stream dropdowns |
| `STATE_LANGUAGE` | Maps state → language name (e.g. `'Kerala' → 'Malayalam'`) |
| `LANG_LABELS` | Maps language name → translation object with keys for every bilingual UI element |
| `STREAM_EXAM_MAP` | Maps stream (MPC/BiPC/etc.) → relevant exam category names |
| `INTEREST_EXAM_MAP` | Maps interest chip → relevant exam category names |
| `EXAM_CATEGORIES` | Master list of all exam categories and their exams |

### Chip Selection (`sel` object)

All multi-select chips use a shared `sel` object: `sel.interests`, `sel.strengths`, `sel.scholarships`, `sel.location` (single), `sel.family` (single), `sel.budget` (single). Created by `makeChips()`. The first selected interest gets `class="chip on primary-int"` (green highlight) and drives the merit-vs-interest analysis modal.

### Analysis Flow

`submitForm()` → detects top merit subject vs top interest → shows alignment modal (`#alignModal`) → user picks merit/interest/both → `proceedWithAnalysis()` saves a form snapshot (`window._savedFormSnapshot`), calls `callAPI()`, then `renderAll()`.

For "10th studying or below" students, the modal is skipped entirely — `proceedWithAnalysis('interest')` is called directly with zeroed marks.

### Bilingual Labels

Labels are bilingual: English primary + regional language secondary. The regional text sits in `<span class="tel" data-lkey="KEY">`. When a state is selected, `updateFormLanguage(state)` looks up `STATE_LANGUAGE[state]` → `LANG_LABELS[lang]` and updates every `[data-lkey]` span plus specific elements by ID (card subtitles, loading text, results section titles). `updateFormLanguage` is also called at the start of `renderAll()` so results titles match the selected state.

`populateBranchOptions()` dynamically rebuilds the branch/stream label innerHTML — it reads the current state language rather than using `data-lkey`, because the label text includes the state-specific stream terminology (e.g. "Intermediate Group", "PUC Stream").

### AI Prompt Structure

`callAPI(d)` builds:
- `sys` — system prompt with domain knowledge (cached conceptually)
- `schema` — full JSON schema the model must return
- `prompt` — dynamic student data + mandatory requirements

Sent as a standard OpenAI-compat request: `{ model, max_tokens, messages: [{role:'system', content:sys}, {role:'user', content:prompt+schema}] }`.

Response parsed via `body.choices[0].message.content`.

### Demo Profiles

8 demo profiles loaded via a `<select id="demoSelect">` + `loadDemo()` dispatcher. Each profile function (`_demoArjun`, `_demoPriya`, etc.) sets form values and calls helper functions `_demoChips(key, values)`, `_demoMarks(subjectObj)`, `_demoExam(exam, score)` to populate chips and mark inputs.

## Deployment

Netlify. `netlify/functions/chat.js` is the serverless proxy. Set `GROQ_API_KEY` in Netlify environment variables before deploying (the hardcoded fallback key in the function is for local reference only).
