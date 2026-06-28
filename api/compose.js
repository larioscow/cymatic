// Compose proxy: prompt -> a visual SCENE-GRAPH via an adaptive multi-step "thinking" chain.
// Gemma's native reasoning is off-by-default, so we ORCHESTRATE explicit reasoning turns whose final
// step emits the determined JSON. Variety comes from the model genuinely RE-INTERPRETING each brief
// (no recipe few-shots, commit-first interpretation, high temperature) — not from an injected seed.
//   STEP 1 (always): interpret + decide diffType (new|refine|recolor) + mathFormula + approach.
//   STEP 2 (when not a pure recolor): emit the scene-graph (or a custom GLSL field for a real formula).
// Adaptive cost: recolor = 1 call (delta only), refine/new = 2 calls. The client validate()/clamp +
// the engine compile/brightness probe are the always-renderable backstop.

const PROVIDERS = {
  cerebras: {
    url: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    key: process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_MODEL || 'gemma-4-31b',
  },
  compare: {
    url: process.env.COMPARE_BASE_URL || 'https://api.openai.com/v1',
    key: process.env.COMPARE_API_KEY,
    model: process.env.COMPARE_MODEL || 'gpt-4o-mini',
  },
};

// ---- STEP 1: interpret the brief + decide how to match it ------------------------------------
const step1Sys = (spec) => `You are an AI VJ interpreting a brief for a live music visualizer. A prompt is a FEELING or a SCENE, not a parts list — there is NO single correct visual, and a great VJ builds it differently every set. Reason like a designer from intent to fields; never recall a fixed recipe, never reach for the obvious tutorial look.

Building blocks you can later use:
${spec}

You also have a CUSTOM-FIELD escape hatch: if the prompt has a real mathematical / physical model (waves, ripples, gravitational lensing / black hole, orbits, fractals, interference, fluid, pendulum), you may WRITE the field math yourself instead of a primitive — a realistic simulation.

Think, then return ONLY this JSON (no prose):
{"interpretation":"<1-2 sentences: the specific, non-obvious reading you COMMIT to>",
 "diffType":"new"|"refine"|"recolor",
 "mathFormula": true|false,
 "approach":"<concrete: which fields/ops/palette you'll use, OR the formula to simulate>",
 "deltaPalette":["#dark","..","#bright"],"deltaPaletteAmount":<0..1>,"deltaPost":{}}

Decide diffType by comparing the NEW prompt to the CURRENT scene:
- "recolor" = same scene, only colour/mood/post changed (current "matrix" -> "matrix red", or just "red"). Fill deltaPalette (2-4 hex dark->bright) + deltaPaletteAmount (+ deltaPost if a post-fx changes). The structure is KEPT — do NOT redesign.
- "refine" = same scene PLUS an added feature (current "ascii matrix" -> "ascii matrix flowing"). Structure kept, feature added.
- "new" = a genuinely different scene, OR there is no current scene.
mathFormula=true only when a real equation would look more convincing than stacked primitives.
Grammar to reason FROM (derive your own combinations): polar makes any field radial (rings/tunnels/arms); masks carve negative space or isolate a subject; chained ops compound; paletteAmount high=one unified mood, low + distinct layer colours=independent hue regions; one confident focal field with depth beats four competing ones.
Taste (decisive — most briefs fail HERE, not on parts; richer is NOT better, right is better): match COMPLEXITY to the brief, never maximise it — "soft/minimal/single/calm/dreamy/gentle/glowing" = ONE confident field, NO hard-edged primitives (particles/lightning) unless the words ask for grit/texture/rain/storm; only "busy/chaotic/dense/storm" earns extra layers. PALETTE carries the mood more than geometry does: "glow/soft/dreamy/ethereal/bright/neon" needs a WIDE luminance range — a tinted (not near-black) dark stop AND a near-WHITE highlight stop; that brightness spread IS the glow and the sense of volume. Four equally-saturated mid-tones read as flat mud. Dark/noir stays low-key on purpose.`;

const step1User = (prompt, lastPrompt, lastGraph) =>
  `NEW prompt: "${prompt}"\nCURRENT prompt: ${lastPrompt ? `"${lastPrompt}"` : '(none — nothing on screen yet)'}\nCURRENT scene-graph: ${lastGraph ? JSON.stringify(lastGraph) : '(none)'}`;

// Appended to step-1 when a REFERENCE IMAGE is attached (Gemma is multimodal). The palette is already
// extracted from the pixels client-side, so the model only needs to decide STRUCTURE + MOTION.
const imageNote = (palette) =>
  `\n\nA REFERENCE IMAGE is attached. Read its colours, texture, composition, mood and implied motion, then design a LIVING audio-reactive visual INSPIRED by it — not a literal copy. Pick the primitive(s)/ops/motion whose texture and structure best match what you see (waves->ripple/drift/perspective, neon city->moire/particles/lightning, foliage->voronoi/clouds, smoke/nebula->clouds, cells/cracks->voronoi). The palette is already extracted from the image${Array.isArray(palette) && palette.length ? ` (${palette.join(', ')})` : ''}; focus on STRUCTURE and MOTION, and choose layer colours/blends that suit it. Make it BOLD and FULL-FRAME — a high-contrast living field that fills the screen and POPS; do NOT reduce a calm/hazy/foggy reference to a thin, dim sketch or leave large dead/empty areas (no heavy over-masking). Translate the photo's mood into an energetic, vivid visual. Do NOT set the "hue" post-fx (it rainbow-cycles the colours and destroys the image's palette) — keep the image's actual colours.`;

// ---- STEP 2: emit the determined scene-graph --------------------------------------------------
const step2Sys = (spec) => `You are an AI VJ emitting the FINAL scene-graph for a live music visualizer. Compose from these building blocks:
${spec}

Reply with ONLY a JSON object (no prose, no markdown):
{"background":"#rrggbb","layers":[{"prim":<a primitive name above>,"params":{<that primitive's params, in range>},"color":"#rrggbb","colorB":"#rrggbb (OPTIONAL 2nd colour → per-layer gradient: low coverage→color, high→colorB)","opacity":<0..1>,"blend":"over"|"add"|"screen"|"max"|"multiply","ops":[{"op":<an operator above>,"a":<num>,"b":<num if it takes one>,"audio":{"src":<audio source>,"amount":<-1..1>} (OPTIONAL — makes this op pulse with the music)}],"audio":[{"param":<a param of this primitive, OR "opacity">,"src":"bass"|"mid"|"treble"|"level"|"beat"|"centroid"|"flux"|"energy","amount":<-1..1>}]}],"post":{"bloom":0..1,"grayscale":0..1,"pixelate":0..1,"dots":0..1,"scanlines":0..1,"ascii":0..1,"hue":0..1,"chroma":0..1,"radialBlur":0..1},"palette":["#dark","..","#bright"],"paletteAmount":<0..1>,"exposure":<0.3..2.0>}

A layer's "prim" MUST be one of the PRIMITIVES; operators go ONLY inside that layer's "ops" array.
REACTIVITY IS REQUIRED — this is a MUSIC visualizer: include at least 2 audio routes (on params, "opacity", and/or ops via op.audio) so the visual VISIBLY pulses with the track. A static-looking result is a failure. Reactivity comes from audio ROUTES, NOT from extra layers — ONE layer with 2 routes is fully reactive, so never add a layer just to "make it move". Route audio to a layer param, to "opacity", or to an OP's amount (op.audio) — e.g. beat→swirl, bass→lens, treble→a frequency param, energy→opacity. Audio sources: bass/mid/treble/level/beat (beat is a decaying pulse), centroid (brightness), flux (attack/onset), energy (sustained loudness). colorB + a low paletteAmount = independent hue regions. radialBlur = outward zoom streak (speed/hyperspace).
CUSTOM FIELD: for a layer whose look has a real mathematical model, instead of {"prim","params"} emit {"glsl":"<GLSL that RETURNS a float coverage 0..1 from the centered vec2 uv; may read u_time,u_bass,u_mid,u_treble,u_level,u_beat; MUST be visible at silence (no audio); no #, no 'void main', no texture()>"} — write the ACTUAL math (waves: sums of sin over uv + u_time; lensing: bend uv by ~1/r and carve a dark core with a smoothstep; ripples: sin(length(uv)*k - u_time)). ops/blend/color still wrap it.
1-4 layers, back-to-front: ONE layer per element the prompt NAMES — a single-subject or pure-atmosphere prompt ("soft pastel clouds", "a glowing orb", "ascii rain") = exactly ONE layer; only multi-element ("rain AND lightning AND clouds") or "busy/dense/chaotic" earns 3-4. Do NOT pad a calm scene with extra clouds/orbs/particles — a hard-edged layer (particles/lightning) dropped over a soft field just dirties it; add those ONLY when the prompt wants texture/grit/rain/storm. ALWAYS include "palette" dark->bright (it IS the colour scheme): for glow/soft/dreamy/bright let the brightest stop approach WHITE (e.g. #ffe0ff, NOT a saturated mid like #ff80ff) and the darkest be a tinted dark (e.g. #1a0828, not #000) — the luminance SPREAD across the stops makes the depth and the glow; four equally-saturated mids = flat mud. paletteAmount high=unified mood, low + distinct layer colours=independent hues. Be bold but realize the interpretation faithfully — richer is NOT better, right is better.
EXPOSURE (master brightness, 0.3-2.0, 1=neutral): default to a BRIGHT, punchy 1.7-2.0 so the visual pops — ONLY drop lower (0.5-1.1) when the prompt implies darkness/dimness (noir, shadow, night, void, murky, faint, candlelit, underground). EXPOSURE x BLOOM both ADD light — never set both high or it blows out to a white shining mass: at exposure 1.7-2.0 keep bloom LOW (<=0.3); reserve strong bloom (0.5+) for lower exposure (<=1.2).
POST-FX (lean into these — they define the look, use them OFTEN): set ONE or usually TWO post-fx that FIT the prompt's mood — almost every scene should carry a deliberate post-fx signature, a bare untreated field is the rare exception (truly plain/clean prompts only). e.g. bloom for glow/neon/dreamy, chroma for glitch/CRT/spacetime, scanlines for retro/VHS, dots for print/comic/halftone, ascii for code/matrix/terminal, grayscale for noir/ink, radialBlur for speed/warp. Pick the one(s) that match and commit at a clearly visible strength — only dial back if the prompt is explicitly plain. (The EXPOSURE x BLOOM rule above still holds — heavy bloom needs lower exposure; the other post-fx have no such cap, so reach for chroma/scanlines/dots/ascii/radialBlur freely.)`;

// Appended in auto-VJ "vary" mode (each drop in a live set) so consecutive scenes are RICH + DISTINCT.
const VARY1 = `\n\nLIVE VJ SET — this is one scene in an evolving sequence on the SAME track. Re-interpret with a FRESH, DISTINCT angle: a different structure/composition than the obvious or a previous reading, so consecutive scenes feel new. Lean RICH (a full, layered, dynamic scene), keeping the same overall mood + palette family.`;
const VARY2 = `\n\nPERFORMANCE MODE — make this scene RICH and full-frame: 3-4 distinct layers with depth, bold motion, and at least 3 audio routes. Choose a DISTINCT primitive/op treatment so it stands apart from other scenes. IGNORE any "fewer layers / keep it minimal" guidance here — go bold. Keep the established mood + palette.`;

const step2User = (prompt, brief, diffType, lastGraph) =>
  `Build the scene-graph for this interpretation:
INTERPRETATION: ${brief.interpretation || prompt}
APPROACH: ${brief.approach || prompt}
mathFormula: ${brief.mathFormula ? 'true — prefer a custom "glsl" field that implements the math' : 'false'}
ORIGINAL prompt: "${prompt}"
${diffType === 'refine' && lastGraph ? `REFINE the CURRENT scene-graph below — KEEP its layers/structure and ADD the new feature minimally (a new op/layer/param), do not rebuild it:\n${JSON.stringify(lastGraph)}` : ''}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch { res.setHeader('content-type', 'application/json'); res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid JSON body' })); }
  const ban = (s) => String(s || '').replace(/\bglitchy\b/gi, '').replace(/\s{2,}/g, ' ').trim(); // HARD-FORBID "glitchy" in EVERY prompt field (current prompt + image-steer + lastPrompt)
  const { spec, schema = null, image = null, palette = null, caption = false, vary = false, provider = 'cerebras', lastGraph = null } = parsed;
  const prompt = ban(parsed.prompt);
  const lastPrompt = ban(parsed.lastPrompt);
  const p = PROVIDERS[provider] || PROVIDERS.cerebras;

  res.setHeader('content-type', 'application/json');
  if (!p.key) { res.statusCode = 400; return res.end(JSON.stringify({ error: `provider "${provider}" not configured — set its API key in .env` })); }

  // One /chat/completions round-trip, returns the parsed JSON object + latency.
  // responseFormat lets the FINAL (emit) call use strict json_schema (constrained decoding) while
  // step 1 stays plain json_object — only the determined output needs a guaranteed-valid shape.
  async function call(messages, maxTokens, responseFormat = { type: 'json_object' }, temperature = 0.85) {
    const reqBody = { model: p.model, messages, response_format: responseFormat, max_tokens: maxTokens, temperature };
    // The 2-step CHAIN is our "thinking", so we don't want heavy in-model reasoning eating the token budget.
    if (/glm|gemma/i.test(p.model)) reqBody.reasoning_effort = 'none';      // both burn the whole token budget on reasoning -> empty/truncated JSON; the 2-step chain IS our thinking
    else if (/gpt-oss/i.test(p.model)) reqBody.reasoning_effort = 'low';
    const t0 = Date.now();
    const up = await fetch(`${p.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
      body: JSON.stringify(reqBody),
    });
    const ms = Date.now() - t0;
    if (!up.ok) { const detail = await up.text().catch(() => ''); const e = new Error(`${provider} ${up.status}`); e.detail = detail.slice(0, 400); throw e; }
    const data = await up.json();
    let obj = {};
    try { obj = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { /* leave {} — caller degrades gracefully */ }
    const ct = data.usage?.completion_tokens || 0;            // tokens generated
    const ctime = data.time_info?.completion_time || 0;       // Cerebras-reported generation time (s)
    return { obj, ms, ct, ctime };
  }
  const tps = (calls) => { const t = calls.reduce((a, c) => a + c.ct, 0), s = calls.reduce((a, c) => a + c.ctime, 0); return s > 0 ? Math.round(t / s) : 0; };

  try {
    // CAPTION mode: read the mp3 cover art (multimodal) and write a SHORT text prompt to pre-fill the
    // box before Enter — the style is then generated NATURALLY through the normal text->graph path.
    if (caption && image) {
      const sys = 'You are an AI VJ. Look at this album cover and write ONE short, vivid music-visualizer prompt inspired by it — 4 to 9 words capturing its colours, texture and motion/mood (e.g. "molten gold ink swirling on black"). A plain phrase, no quotes, no preamble. Reply ONLY as {"prompt":"..."}.';
      const cc = await call([{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'text', text: 'Write a visualizer prompt from this cover art.' }, { type: 'image_url', image_url: { url: image } }] }], 120);
      return res.end(JSON.stringify({ prompt: String(cc.obj?.prompt || '').slice(0, 120), ms: cc.ms, model: p.model }));
    }

    // STEP 1 — interpret + decide (the custom thinking). With a REFERENCE IMAGE, Gemma reads it
    // (multimodal) so the brief is driven by what it sees; the palette is already extracted client-side.
    const s1text = step1User(prompt, lastPrompt, lastGraph) + (image ? imageNote(palette) : '') + (vary ? VARY1 : '');
    const s1content = image ? [{ type: 'text', text: s1text }, { type: 'image_url', image_url: { url: image } }] : s1text;
    const s1 = await call([{ role: 'system', content: step1Sys(spec) }, { role: 'user', content: s1content }], 700, { type: 'json_object' }, vary ? 0.95 : 0.85);
    const brief = s1.obj || {};
    const diffType = image ? 'new' : (['new', 'refine', 'recolor'].includes(brief.diffType) ? brief.diffType : 'new'); // an image always builds a fresh theme

    // RECOLOR — skip step 2; return the colour delta for the client to ease in place (no rebuild).
    if (diffType === 'recolor' && lastGraph && Array.isArray(brief.deltaPalette) && brief.deltaPalette.length >= 2) {
      return res.end(JSON.stringify({
        brief, recolor: { palette: brief.deltaPalette, paletteAmount: brief.deltaPaletteAmount, post: brief.deltaPost || {} },
        ms: s1.ms, tps: tps([s1]), tokens: s1.ct, model: p.model, provider, steps: 1,
      }));
    }

    // STEP 2 — emit the determined scene-graph (or a custom GLSL field). Strict json_schema when the
    // client supplied one: constrained decoding makes an invalid/garbage graph impossible to emit.
    const s2fmt = schema ? { type: 'json_schema', json_schema: schema } : { type: 'json_object' };
    const s2user = step2User(prompt, brief, diffType, lastGraph) + (vary ? VARY2 : '');
    const s2 = await call([{ role: 'system', content: step2Sys(spec) }, { role: 'user', content: s2user }], 1300, s2fmt, vary ? 0.9 : 0.85);
    return res.end(JSON.stringify({ brief, graph: s2.obj, ms: s1.ms + s2.ms, tps: tps([s1, s2]), tokens: s1.ct + s2.ct, model: p.model, provider, steps: 2 }));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: e.message || String(e), detail: e.detail }));
  }
}
