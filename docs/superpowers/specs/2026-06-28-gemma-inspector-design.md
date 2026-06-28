# Gemma Inspector — dev-panel "under the hood" view

**Goal (hackathon centerpiece):** make visible everything Gemma 4 31B on Cerebras
does to turn a prompt into a visual — the live reasoning chain, the raw prompts +
JSON, Cerebras speed (tok/s), and the multimodal / constrained-decoding moments.

## Decisions (from brainstorm)
- **Purpose:** live Gemma thought-process + tokens/sec.
- **Emphasis:** all four — reasoning chain, raw prompts+JSON, Cerebras speed, multimodal+constraints.
- **Placement:** extend the press-D dev panel (a `GEMMA` section above the knobs).
- **Live = per-generation** (full trace lands the instant each generation completes, ~450ms;
  streams in as you type / per auto-VJ drop). Token-by-token SSE streaming is an explicit
  out-of-scope follow-up.
- **Scope:** the compose path only (the rich reasoning path). Legacy `direct.js` is single-call → out.

## Data flow (3 isolated units)
```
api/compose.js → trace[]  →  response.trace  →  GemmaInspector.push()  →  #gemma DOM
 (server)        per call     (gated: trace:true)  (client store, live)    (panel section)
```

### Server — `api/compose.js`
- Build a `trace` array; push one entry per Gemma `call()`:
  `{ phase, label, model, ms, tokens, tps, constrained, multimodal, system, user, raw }`
  - `phase`/`label`: `caption` ("read cover art"), `interpret` ("① interpret + decide"),
    `emit` ("② emit scene-graph"), `recolor` ("recolor delta").
  - `tps = ctime>0 ? round(tokens/ctime) : 0` (per-step, Cerebras-reported time).
  - `constrained`: step 2 used json_schema. `multimodal`: an image/cover was attached.
  - `user`: for multimodal calls store the text + a `[image attached]` note (NOT the base64).
  - `system`: the full system prompt (incl. spec) — showing the real prompt is the point.
- Include `trace` in the response **only when the request body has `trace:true`**
  (keeps public/Vercel responses lean — respects the publish-live concern).

### Client store + UI — `src/ui/gemma.ts` (new)
- `class GemmaInspector { el: HTMLElement; push(call): void; }`
  - `call = { prompt, kind, trace, totalMs, tps }`.
  - Prepends the latest generation, keeps the last 6, re-renders into its own `el`
    independently of `buildPanel` (knob rebuilds must not wipe it).
- Render per generation:
  - Header: `⚡ <model> · <totalMs>ms · <tps> tok/s · <kind>`.
  - Per step: row `<label> <ms>ms · <tokens> tok` + badges (`🔒 constrained`, `👁 multimodal`),
    and a collapsed `<details>` with `interpretation`/`approach` (interpret step) and
    `▸ system` / `▸ user` / `▸ raw JSON` in scrollable `<pre>`.

### Wiring — `src/main.ts`
- After each compose / image / caption response, call `gemma.push({...})` with `j.trace`.
- Send `trace: true` in the `/api/compose` request bodies.
- `panel.ts` is untouched.

### Markup/CSS — `index.html`
- Add `<div id="gemma"></div>` between the director row and `#panel`.
- Widen `#dev` ~232→340px; raw prompt/JSON in collapsed `<details><pre>` (scrollable, capped height).

## Verification
- `tsc --noEmit` + `vite build` clean.
- Playwright against the running dev server: inject/generate a scene, confirm the GEMMA section
  shows the 2-step trace with timings, tok/s, badges, and expandable prompts/JSON; screenshot.

## Out of scope (v1)
- Token-by-token SSE streaming of step 1 before step 2.
- Instrumenting `direct.js` / `generate.js`.
