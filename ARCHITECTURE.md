# CareerDisha — Architecture

Single-file HTML app for Indian student career guidance. Deterministic match engine picks careers; LLM writes narrative + decision tree + counselor note. The split is the cost lever — the LLM no longer has to invent careers from scratch with full schemas.

---

## 1 · Component layout (what files load what)

```mermaid
flowchart TB
  classDef ext fill:#FEF3C7,stroke:#D97706,color:#000
  classDef proj fill:#E8EAF6,stroke:#1A237E,color:#000
  classDef data fill:#D1FAE5,stroke:#059669,color:#000
  classDef remote fill:#EDE9FE,stroke:#7C3AED,color:#000

  Browser["Browser<br/>(opens index.html)"]:::proj

  Browser -->|loads via &lt;script src&gt;| ChartCDN["Chart.js CDN"]:::ext
  Browser -->|loads via &lt;script src&gt;| DataJS["data/data.js<br/>CAREER_DATA<br/>(30 careers + taxonomies)"]:::data
  Browser -->|loads via &lt;script src&gt;| MatcherJS["data/matcher.js<br/>CareerMatcher<br/>(scoreCareer, topCareers)"]:::data
  Browser -->|loads via &lt;script src&gt;| ComposerJS["data/composer.js<br/>CareerComposer<br/>(buildSlimPrompt, mergeLLMResponse)"]:::data

  Browser -->|prod: POST /.netlify/functions/chat| Netlify["netlify/functions/chat.js<br/>(serverless proxy,<br/>injects GROQ_API_KEY)"]:::proj
  Browser -->|local file:// dev: POST direct + BYOK| GroqDirect["Groq API<br/>(direct)"]:::remote
  Netlify -->|POST| GroqAPI["Groq API<br/>llama-3.3-70b-versatile"]:::remote
  GroqDirect -.->|same endpoint| GroqAPI

  subgraph Sources["Canonical source files (not loaded at runtime)"]
    direction LR
    CareersJSON["data/careers.json"]:::data
    InterestJSON["data/taxonomy/interests.json"]:::data
    StrengthJSON["data/taxonomy/strengths.json"]:::data
    SubjectsJSON["data/taxonomy/subjects.json"]:::data
  end
  Sources -.->|hand-mirrored into| DataJS
```

**Why `.js` not `.json` at runtime:** opening `index.html` from `file://` blocks `fetch()` of local JSON. The `.json` files are kept as canonical, human-readable sources; `data/data.js` mirrors them and assigns `window.CAREER_DATA` so the app works from `file://` and from Netlify equally.

---

## 2 · Request flow (one form submission)

```mermaid
sequenceDiagram
  autonumber
  participant U as Student
  participant F as index.html<br/>(form + submit logic)
  participant M as CareerMatcher
  participant Cm as CareerComposer
  participant N as Netlify proxy<br/>(or direct Groq in dev)
  participant L as Groq LLM<br/>llama-3.3-70b
  participant R as renderAll()

  U->>F: Step 1 / 2 / 3 + Submit
  F->>F: collectData() → formData
  F->>F: getTopMeritSubject()<br/>showAlignModal() → user picks merit/interest/both
  F->>F: callAPI(formData) starts
  F->>M: CareerMatcher.run(formData)
  M-->>F: { profile, matches[5..6] }<br/>(deterministic scores)

  F->>Cm: buildSlimPrompt(formData, matches)
  Cm-->>F: { sys, prompt }<br/>(~1100 input tokens)

  F->>N: POST chat completion (slim payload)
  N->>L: forwards with GROQ_API_KEY
  L-->>N: narratives + colleges + decision tree<br/>+ counselor note + market chart + 8 jobs<br/>(~1500 output tokens)
  N-->>F: JSON

  F->>Cm: mergeLLMResponse(llm, formData, matches)
  Cm-->>F: data object<br/>(LLM narrative + deterministic salary/route/portals/...)

  F->>R: renderAll(data, formData)
  R-->>U: Career cards · Decision tree · Market chart · Jobs table
```

---

## 3 · Deterministic / LLM split (the cost lever)

The architectural move that drove this refactor: **decide who computes what.** Anything formulaic comes from `data/data.js`; only narrative-style content goes to the LLM.

```mermaid
flowchart LR
  classDef det fill:#D1FAE5,stroke:#059669,color:#000
  classDef llm fill:#FEF3C7,stroke:#D97706,color:#000
  classDef ui fill:#E8EAF6,stroke:#1A237E,color:#000

  Form[("formData<br/>(state, class, marks,<br/>chips, budget, scholarship)")]:::ui

  subgraph Deterministic["DETERMINISTIC LAYER · 0 API calls"]
    direction TB
    Matcher["CareerMatcher.run<br/>· canonicalize chips/marks<br/>· score 30 careers<br/>· return top 5"]:::det
    DetFields["Per-career deterministic fields:<br/>· match_score · domain · salary range<br/>· entry_route · degree · duration<br/>· estimated_cost · supply/demand<br/>· jobs_market estimates · job_portals<br/>· scholarship_options · job_locations"]:::det
  end

  subgraph LLMLayer["LLM LAYER · 1 API call, ~1500 output tokens"]
    direction TB
    SlimPrompt["buildSlimPrompt:<br/>profile + pre-ranked careers<br/>'do not reshuffle'"]:::llm
    Output["LLM returns:<br/>· narratives × 5<br/>· colleges × 5 (with NIRF)<br/>· entrance_exams × 5 (with URLs)<br/>· decision_tree (top career only)<br/>· risk_factors / upside_factors<br/>· counselor_note (EN + local lang)<br/>· scholarship_alert · warning_flags<br/>· domain_market_data (chart)<br/>· 8 job_listings"]:::llm
  end

  Merge["mergeLLMResponse<br/>(deterministic ∪ LLM)"]:::det
  RenderAll[("renderAll(data)<br/>· cards · tree<br/>· chart · jobs table")]:::ui

  Form --> Matcher
  Matcher --> DetFields
  Matcher --> SlimPrompt
  Form --> SlimPrompt
  SlimPrompt --> Output
  DetFields --> Merge
  Output --> Merge
  Merge --> RenderAll
```

### Token impact

| | Before refactor | After refactor |
|---|---|---|
| System + user prompt input | ~1700 tokens | ~1170 tokens |
| LLM output (max_tokens) | 4000 | 2500 |
| Realistic output | 3000–4000 tokens | 1200–1500 tokens |
| **Per request total** | ~5000–5500 tokens | ~2400–2700 tokens |
| Capacity on same Groq free tier | baseline | **~2× more requests** |

---

## 4 · Form-flow nuances (worth knowing)

```mermaid
stateDiagram-v2
  [*] --> Step1
  Step1 --> Step2: class ≠ '10th studying'
  Step1 --> Step3: class = '10th studying'<br/>(skip Step 2 entirely;<br/>step circle shows '—')
  Step2 --> Step3
  Step3 --> AlignmentModal: submitForm()
  AlignmentModal --> CallAPI: pathChoice<br/>(merit / interest / both)
  CallAPI --> Render: success
  CallAPI --> Error: failure<br/>(alert + stays on form)
  Render --> Step1: startOver()<br/>(restores form snapshot)
```

State-driven dynamics happen on every state change in Step 1: `onStateChange()` cascades into board dropdown · branch labels · location chips · exam categories · bilingual labels (`updateFormLanguage(state)` reads `STATE_LANGUAGE[state]` → `LANG_LABELS[lang]`).

---

## 5 · Where the cost wins live now (and don't yet)

Already shipped in this refactor:
- **Deterministic match scores + career picks** — LLM no longer reasons about which careers to suggest
- **Static-data fields** — salary, growth, supply/demand, portals, scholarships, entry route all generated from `data/data.js`, not the model
- **Slim prompt + slim schema** — input and output cut roughly in half

Not yet shipped (next architectural moves, in order of impact):
1. **Cache by canonical profile hash** — `Netlify Blobs` keyed on a hash of `{state, class, stream, top-3 interests, top-3 strengths, marks bucket, budget, location tier}`. Realistic 60–80 % hit rate after warmup. **Biggest remaining win.**
2. **Multi-provider fallback** — Groq → Gemini 2.0 Flash → Cerebras → Together. 4× capacity on free tiers stacked.
3. **BYOK power-user mode** — let users paste their own Groq key for unlimited self-funded results.
4. **Pre-generate top-N profiles offline** — bake the top ~500 profile combos into static JSON so common students never hit the LLM at all.

---

## 6 · File reference

| Path | Role |
|---|---|
| [index.html](index.html) | The app — HTML, CSS, all form/render JS, `callAPI` orchestration |
| [data/data.js](data/data.js) | Runtime data: 30 careers + 3 taxonomies → `window.CAREER_DATA` |
| [data/matcher.js](data/matcher.js) | Pure-JS scoring engine → `window.CareerMatcher` |
| [data/composer.js](data/composer.js) | LLM prompt builder + response merger → `window.CareerComposer` |
| [data/_test-matcher.js](data/_test-matcher.js) | Node smoke test: matcher across 8 demos + composer shape check |
| [data/careers.json](data/careers.json) | Canonical career dataset (mirrored into data.js) |
| [data/taxonomy/interests.json](data/taxonomy/interests.json) | Chip label → canonical ID map (interests) |
| [data/taxonomy/strengths.json](data/taxonomy/strengths.json) | Chip label → canonical ID map (strengths) |
| [data/taxonomy/subjects.json](data/taxonomy/subjects.json) | Subject label → canonical ID + 10th→12th expand rules |
| [netlify/functions/chat.js](netlify/functions/chat.js) | Serverless proxy that injects `GROQ_API_KEY` and forwards to Groq |
| [netlify.toml](netlify.toml) | Netlify build/redirect config |
