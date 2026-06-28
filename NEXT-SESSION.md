# Handoff — make GENERATED visuals as complex & beautiful as the DEFAULT themes

---
## ⚡ v2 STATUS (current — read this first; §1–§9 below are the original pre-v2 plan, now mostly DONE)

**Goal reframed & ACHIEVED:** a toolkit rich enough that the model generates ARBITRARY complex visuals from a text prompt ("black hole", "rain+clouds+lightning", "ascii rainbow", "synthwave", "aurora", "mandala") by ASSEMBLING tools — not bespoke themes. Verified hand-authored AND end-to-end through the model (`window.compose`, gpt-oss-120b stand-in).

**v2 scene-graph** (`SceneGraph` in `src/compose/codegen.ts`; `validate()` clamps any model output to this):
```jsonc
{ "background":"#hex",
  "layers":[ { "prim":<primitive>, "params":{...}, "color":"#hex",
              "blend":"over|add|screen|max|multiply",
              "ops":[ {"op":<operator>, "a":<num>, "b":<num>} ],   // chained in order; uv-ops bend the sample point, mask-ops fade coverage
              "audio":[ {"param":<prim param>, "src":"bass|mid|treble|level|beat", "amount":-1..1} ] } ],   // 1-4 layers, back-to-front
  "post":{ "bloom","grayscale","pixelate","dots","scanlines","ascii","hue" },   // each 0..1
  "palette":["#dark",...,"#bright"], "paletteAmount":0..1 }   // paletteAmount low + distinct layer colors = independent hue regions
```

**Catalogue** (single source of truth = the `PRIMS` + `OPS` registries in `src/compose/library.ts`; `buildSpec()` + codegen are GENERIC over them, so adding a tool = registry entry + GLSL only):
- **Primitives (8):** clouds (FBM bed), rain, lightning, voronoi (cells/net), cymatic, drift, obra, moire, sumi. *(The 6 ugly originals rain/flow/plasma/blobs/grid/stars were deleted; rain/lightning/clouds/voronoi are new high-quality builds; cymatic/drift/obra/moire/sumi were HARVESTED from the default themes.)*
- **Operators (11):** uv → polar, swirl, lens, zoom, scroll, warp, kaleido, mirror, perspective ; masks → radialMask, linearMask.
- **Post-fx (7):** bloom, grayscale, pixelate, dots, scanlines, ascii, hue. (+ `paletteAmount`, `multiply` blend.)
- Recipes that work: black hole = clouds+[polar,scroll,radialMask]+[lens]; storm = clouds+rain+lightning(beat→glow); ascii rainbow = clouds+[scroll]+ascii+hue; synthwave = moire+[perspective,linearMask] floor + masked sky, paletteAmount~0.3; mandala = voronoi+[kaleido]. (3 golden examples are in `api/compose.js` as few-shot anchors.)

**Remaining backlog** (audit-ranked, not yet built): real `chroma` RGB-aberration + `radialBlur`/`zoomBlur` (BOTH need neighbor-sampling — StyleEffect's `mainImage` only has `inputColor`; use the pmndrs `inputBuffer` sampler or a dedicated pass — verify via context7); particle-system primitive (hyperspace/embers); ripple, anisotropic-scale ops; audio attack/decay envelopes. Deep limits punted: true depth/occlusion (raymarch track) + dark/subtractive structure.

**Test loop:** `window.composeGraph(graph)` injects hand-authored graphs (no API); `window.compose("prompt")` runs the full model path. Dev server `npm run dev` → localhost:5173; screenshot via Playwright (re-navigate if a file-chooser modal sticks; a Vite HMR ws-reconnect error in console is harmless). **Editing `api/compose.js` or `.env` needs a dev-server RESTART** (vite caches the dynamic import) — same restart swaps `CEREBRAS_MODEL=gemma-4-31b` (client auto-detects "gemma" and speeds its throttle).

---

> You are a fresh session with none of the prior context. This doc is self-contained.
> Goal: the AI-**composed** visuals should match the 6 hand-built **default themes** in quality,
> complexity, and beauty. Right now generated visuals look flat, low-fidelity, and repetitive next
> to the defaults. Two scopes (the user's framing):
> **A. primitives / predefined code** &nbsp; **B. model output** (what Gemma emits + controls).
> A core deliverable: **decide what Gemma's output looks like, what it controls, how/when to give it
> granular control, and how to exploit its speed.**

---

## 0. How to run + iterate (do this first)

- Dev server is (or should be) running: `cd /Users/larioscow/Dev/gemma-hackaton && npm run dev` → http://localhost:5173
- **`.env`** holds `CEREBRAS_API_KEY` (present) and `CEREBRAS_MODEL=gpt-oss-120b` (the stand-in; `gemma-4-31b` is the real target — see §7). **Vite reads `.env` only at boot — restart the server after changing it.**
- Press **D** in the app for the dev panel (theme select, provider select, **Post FX sliders**, look/theme knobs, palette pickers).
- Set provider (dev panel) to **`compose (gen)`**, then type a prompt → the generative pipeline runs.
- **No-API testing (use this constantly):** in the browser console, `window.composeGraph(graph)` injects a hand-authored scene-graph directly (bypasses the model) → `engine.crossfadeTo`. This is how you A/B primitive/codegen quality without burning the rate limit. `window.compose("prompt")` runs the full model→render path.
- **Rate limit:** gpt-oss free tier = **5 requests/min** (the client already throttles + auto-adapts pace by model). So prefer `window.composeGraph` injection while developing.
- **Verify visually with screenshots** (Playwright MCP). A `drawImage` brightness read of the WebGL canvas returns 0 (no `preserveDrawingBuffer`) — don't trust it; screenshot instead. Three logs shader-compile errors to console (capture `console.error`).

---

## 1. Architecture map

- **Three.js 0.185 (WebGL2-only) + pmndrs/postprocessing 6.39.** Content shaders are **GLSL ES 3.0** (migrated this session — `#version 300 es` via `glslVersion: THREE.GLSL3`, `in`, `out vec4 fragColor`). **ES 3.0 means you now have variable-length loops, integer/bitwise math, `texelFetch` — use them for ray-marching, lightning, FBM, etc.**
- **`src/harness.ts`** — `buildContent(inner)` wraps a `vec3 render(vec2 uv)` into the fragment. Available uniforms: `u_time`, `u_res`, `u_bass/u_mid/u_treble/u_level/u_beat`, `u_k[8]` (live knobs, `KNOB_COUNT=8` — **bump if richer primitives need more params**), `u_paper/u_ink/u_accent`. `uv` is aspect-corrected, centered at origin.
- **`src/engine/engine.ts`** — renders content → HDR target → post-stack (`StyleEffect`: duotone/grade/grain/vignette + **palette grade** + grayscale/pixelate/dots/scanlines + highlight soft-clip) + a separate **`BloomEffect`** pass. Buffer **crossfade** between two content slots. The 60fps loop + audio reactivity are **independent of the LLM** (the "two clocks" principle: engine runs every frame; the LLM only sets creative direction at shot-change cadence).
- **`src/themes/`** — the **6 default themes** (`contour, driftlines, obra, moire, cymatic, sumi`). Each is a single, coherent, hand-tuned `render()` GLSL string + `controls` + `palette` + `grade`. **These are the QUALITY BAR.** Read them — they're rich because of domain-warped multi-octave noise, tuned spatial frequencies, careful contrast, and being ONE designed field (not stacked layers).
- **`src/compose/library.ts`** — the **6 primitives** (`rain, flow, plasma, blobs, grid, stars`), each `float prim_NAME(vec2 uv, <float params>) -> coverage 0..1`. Plus `MODIFIERS` (none/mirror/kaleido/warp), `BLENDS` (over/add/screen/max), `AUDIO_SRC`. `buildSpec()` = the catalogue text sent to the model. **These primitives are the weak link — too simple/literal, hence flat & repetitive.**
- **`src/compose/codegen.ts`** — `validate(graph)` (clamp backstop: invalid model output → valid graph → valid GLSL, never broken), `codegenStack(graph)` (concatenates the library + a generated `render()` that composes the layers), `makeComposeTheme(graph)` (wraps as a drop-in `Theme`, `mode:'color'`), `resample4` (palette → 4 stops).
- **`api/compose.js`** — prompt → scene-graph via Cerebras (`json_object`, `reasoning_effort:'low'` for gpt-oss). **`api/direct.js`** — the older "tune a preset theme" structured director (parallel path; not the focus).
- **`src/main.ts`** — provider select (`mock/cerebras/compare/compose`), rate-limit-aware throttle (auto-adapts `PACE_STANDIN 12500ms` / `PACE_GEMMA 200ms` from the model name in the response), `composeVisual()` pipeline, `window.compose` / `window.composeGraph` hooks, the `#dirstat` status line.
- **`src/ui/panel.ts`** — dev panel builder (added Post FX sliders + `engine.setFx/getFx`).

---

## 2. What Gemma emits TODAY (the current scene-graph)

```json
{
  "background": "#rrggbb",
  "colorMode": "color",
  "layers": [                                    // ≤ 4, back-to-front
    { "prim": "rain|flow|plasma|blobs|grid|stars",
      "params": { /* that primitive's params, clamped to range */ },
      "color": "#rrggbb",
      "blend": "over|add|screen|max",
      "modifier": "none|mirror|kaleido|warp",
      "modParam": 2-12,
      "audio": [ { "param": "<a param>", "src": "bass|mid|treble|level|beat", "amount": -1..1 } ] }
  ],
  "post":    { "bloom":0..1, "grayscale":0..1, "pixelate":0..1, "dots":0..1, "scanlines":0..1 },
  "palette": ["#dark", "...", "#bright"]          // 2-4 stops, remapped over composed luminance
}
```

`codegenStack` turns this into one ES-3.0 `render()`; the engine eases palette/fx in. gpt-oss emits this reliably in ~400ms (gemma will be faster + more tasteful).

---

## 3. What's ALREADY solved this session (don't redo)

- **Color is handled.** A model-chosen **palette grade** (2-4 hex stops remapped over luminance, generalizing the defaults' duotone) + a **highlight soft-clip / tonemap** (color-mode only) turned flat-gray comps into cohesive, art-directed images (e.g. "void foggy rain" went from gray garbage → a beautiful deep-blue atmosphere; gpt-oss emits a perfect lava ramp `#0a0000→#7a0d00→#ff5a00→#ffe070`). **The remaining gap is FORM/STRUCTURE — the primitives themselves and how they compose — not color.**
- **Post-FX layer** (bloom/grayscale/pixelate/dots/scanlines) works + is Gemma-controllable + has live dev sliders.
- **ES 1.0 → ES 3.0** content migration done (variable loops etc. now available).
- **UI always-visible** fix done (opaque-enough panels). Don't touch UI.
- Defaults are **unaffected** by all compose machinery (fx/gradeMap default off; tonemap gated on color mode).

---

## 4. THE DIAGNOSIS (why generated < default)

Even a hand-authored *optimal* graph looks flat next to the defaults. Root causes:
1. **Primitives are simple coverage functions** (regular rain = a halftone pattern; soft round dots; flat plasma). The defaults are rich because each is a single coherent field with **domain warping + multi-octave/FBM noise + tuned frequencies + ridged/contrast detail**. The primitives have none of that depth.
2. **Composition = additive stacks of flat coverage** → repetitive and muddy, never a cohesive *designed* field.
3. **Variety is low** — 6 literal primitives × blends reads same-y.

---

## 5. Scope A — primitives / predefined code (direction)

**Highest-leverage move: harvest the 6 DEFAULT themes AS primitives.** The default `render()` shaders ARE default-quality by definition. Refactor each into a composable field `prim_contour/prim_cymatic/prim_moire/prim_sumi/prim_obra/prim_drift(uv, <its own params>) -> float|vec3` and expose **the default's own controls as the primitive's params** (contour: density/flow/field/lineWidth; cymatic: complexity/grain/settle; moire: gridFreq/rotate/lineWidth/weave; etc.). Result: generated visuals can BE the default fields, recolored/warped/composed by Gemma → instant default-level quality + combinatorial variety. (Watch: defaults return luminance for duotone; adapt to a field value the color path can use. `KNOB_COUNT` likely needs raising.)

**Then add NEW high-fidelity primitives that ES 3.0 unlocks** (the things no current primitive can do): `lightning/bolt` (variable-iteration), `sdf_raymarch` (tunnels / 3D metaballs / caustics), `voronoi/cells`, `fire/embers`, `fluid-ish` (single-pass curl-noise advection). Each authored to default fidelity (FBM, domain warp, ridges), with rich params.

**And add domain operators** Gemma can stack for complexity: warp/fold/kaleido/mirror/repeat — applied to the uv BEFORE the field (they already exist as modifiers; make them richer / chainable). A single optional **ping-pong feedback buffer** would unlock trails/fluids/reaction-diffusion (out of MVP scope, but the biggest single capability jump — note it).

**Authoring loop:** primitives can only be judged on screen. Write a primitive → `window.composeGraph` a graph using it → screenshot → iterate. Consider a small parallel workflow that drafts N candidate primitive shaders (ES-3.0 contract below), then YOU integrate + render + keep the good ones (GLSL quality can't be judged on paper).

---

## 6. Scope B — model output: what Gemma controls, granularity, speed (the core design question)

This is the open design problem the user wants resolved. **Recommended thesis (pressure-test it, e.g. via a design-panel workflow):**

- **Gemma composes high-fidelity fields, not flat coverage.** Its output is a scene-graph of **1-3 rich fields** (harvested defaults + new primitives), each with its **full complexity-param set exposed** (octaves, warp strength, frequency ratios, ridges, the default's own knobs) + a **domain operator** + audio routing + the **palette** (done) + **post** (done) + a global motion/intensity. The complexity params — not "which primitive" — are what create default-level richness, so **expose the field-shaping knobs and let Gemma dial them**.
- **Granular control = the param surface, not raw code.** Keep the model on validated structured JSON (the clamp backstop guarantees valid GLSL). Granularity comes from *more, better params per field* (and per-layer audio routes), not from freeform shaders. **Stretch / long tail:** a compile-guarded freeform-GLSL escape hatch for prompts no field covers (offscreen compile + dual-audio black/NaN probe + repair loop) — secondary, build last.
- **Exploit speed (the Cerebras/Gemma story):** outputs are TINY structured JSON → regenerate the whole graph **per song-section / per phrase** (and on every prompt edit) so the visual *evolves* with the music. Per-frame and per-beat reactivity stays in-shader (free, 60fps); the LLM operates at shot-change cadence, and Gemma's speed makes that cadence feel instant + lets it happen often (un-fakeable on a GPU-latency provider). Consider a **two-tier**: Gemma sets a rich base graph on prompt/section, plus fast small **param-delta** calls per drop/phrase for evolution without restructure.
- **When granular vs not:** full graph on prompt + section boundaries; "more intense / warmer / faster" and dev-slider tweaks are **param-only** updates (same structure → eased uniform morph, no recompile). A "remix" keeps structure, rerolls params.

Deliverable for the user: a concrete spec of the **new scene-graph schema** (richer per-field params + operators + motion), how `codegenStack` composes it, and the section/beat call strategy.

---

## 7. GLSL contract for primitives (ES 3.0)

A primitive is a function concatenated into one shader by `codegenStack`, then wrapped by `buildContent`:
```glsl
// available globals: u_time, u_res(vec2), u_bass,u_mid,u_treble,u_level,u_beat, u_k[8], u_paper,u_ink,u_accent
// uv is aspect-corrected, centered at origin. GLSL ES 3.0 (variable loops, int/bitwise, texelFetch OK).
float prim_NAME(vec2 uv, float p0, float p1, ...) { ... return coverage_0_1; }   // or vec3 for multi-hue
```
Rules learned the hard way: **every primitive must be visible at silence** (audio MODULATES via codegen, never gates — no `*u_level` that blanks it). Params are passed in the SAME order as their spec array. Keep them within declared min/max (validate clamps). Color comes from the palette grade by luminance, so primitives mostly set **structure/brightness** — pick layer colors mainly for brightness unless doing multi-hue.

---

## 8. Constraints / gotchas

- **Model:** `gpt-oss-120b` now (text-only, *reasons* — costs tokens; `reasoning_effort:'low'` set). **`gemma-4-31b`** is the required hackathon model — multimodal, reasoning-off-by-default, **rate-limit-increased private preview during the event** (access window ~Sun 10:30 AM PT, elevated limits if the Org-ID capacity form was submitted). Swap = set `CEREBRAS_MODEL=gemma-4-31b` in `.env` + **restart**. The client auto-switches its throttle pace when it sees `gemma` in the response. Don't wire the `frame`/vision path against gpt-oss (it's text-only).
- **Rate limit (gpt-oss free):** 5 req/min → develop with `window.composeGraph` injection, not the model.
- **Strict structured outputs:** currently `json_object` + clamp backstop. Cerebras supports strict `json_schema` (constrained decoding); upgrade is optional — **keep the server-side clamp regardless** (strict-with-discriminated-unions is the least-tested corner, untested on gemma).
- **Quality bar = the 6 default themes.** Always A/B a generated visual against them.
- **Defaults must stay untouched** (their look is shipped). All new machinery defaults to off for non-compose themes.

---

## 9. Suggested first steps

1. Read `src/themes/cymatic.ts` + `contour.ts` (see what default-quality GLSL looks like) and `src/compose/library.ts` (see how thin the primitives are). A/B in-app: a default theme vs a `window.composeGraph` injection.
2. **Spike Scope A:** harvest ONE default (e.g. `contour` → `prim_contourField`) into the library with its params exposed; inject a graph using it; screenshot; confirm it looks default-grade. That validates the whole "harvest defaults" thesis cheaply.
3. **Design Scope B:** (ultracode is on for the user — a design-panel workflow fits) settle the new scene-graph schema (per-field complexity params + operators + motion + section/beat strategy), then extend `library.ts` / `codegen.ts` / `api/compose.js` / the spec.
4. Then add 2-3 new ES-3.0 primitives (lightning, sdf-raymarch, voronoi) at default fidelity.
5. Add a few **golden few-shot example graphs** to the compose prompt (taste anchors) — cheap, big payoff with gemma.

---

### One-line status
Pipeline (compose → codegen → render), color grade, tonemap, post-FX, ES 3.0, UI visibility = **done & verified**. The remaining quality gap is **primitive fidelity + the model's structural control surface** — exactly scopes A & B above.
