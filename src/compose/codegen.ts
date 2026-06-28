// Scene-graph -> GLSL. validate() is the clamp backstop (a model can never produce invalid GLSL —
// only a valid, in-range graph survives). codegenStack() concatenates the primitive library + a
// generated render() that composes the layers. makeComposeTheme() wraps it as a drop-in Theme so
// the UNCHANGED engine.crossfadeTo() dissolves the new composition in.

import type { Theme, FX } from '../themes/types';
import { DEFAULT_FX, FX_NAMES } from '../themes/types';
import { PRIMS, OPS, BLENDS, AUDIO_SRC, LIBRARY_GLSL } from './library';

export type AudioRoute = { param: string; src: string; amount: number };
export type Op = { op: string; a: number; b: number; audio?: { src: string; amount: number } };
export type Layer = { prim: string; params: Record<string, number>; color: string; colorB?: string; blend: string; ops: Op[]; audio: AudioRoute[]; glsl?: string; opacity: number };
export type SceneGraph = { background: string; colorMode: string; layers: Layer[]; post: FX; palette: string[]; paletteAmount: number; exposure: number };

const PRIM_MAP: Record<string, typeof PRIMS[number]> = Object.fromEntries(PRIMS.map((p) => [p.name, p]));
const OP_MAP: Record<string, typeof OPS[number]> = Object.fromEntries(OPS.map((o) => [o.name, o]));
const num = (v: unknown, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
// Tolerant: accept "#rrggbb" OR "rrggbb" (models sometimes drop the #) -> normalized "#rrggbb" or null.
const normHex = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const m = s.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(m) ? '#' + m.toLowerCase() : null;
};
const oneOf = (list: readonly string[], v: unknown, dflt: string) => (typeof v === 'string' && list.includes(v) ? v : dflt);

const argOf = (o: any, p: { key: string; min: number; max: number; def: number } | undefined, generic: string) =>
  p ? clamp(num(o?.[p.key] ?? o?.[generic], p.def), p.min, p.max) : 0;

/** Validate a layer's operator stack — accepts the new ops[] or a legacy single `modifier`. */
function parseOps(l: any): Op[] {
  let raw: any[] = Array.isArray(l?.ops) ? l.ops : [];
  if (!raw.length && typeof l?.modifier === 'string' && l.modifier !== 'none') {
    raw = [{ op: l.modifier, a: l.modifier === 'kaleido' ? num(l?.modParam, 6) : 1 }];
  }
  const ops: Op[] = [];
  for (const o of raw.slice(0, 6)) {
    const spec = OP_MAP[o?.op];
    if (!spec) continue;
    const oa = o?.audio;
    const audio = oa && (AUDIO_SRC as readonly string[]).includes(oa.src)
      ? { src: oa.src as string, amount: clamp(num(oa.amount, 0.5), -1, 1) } : undefined;
    ops.push({ op: spec.name, a: argOf(o, spec.a, 'a'), b: argOf(o, spec.b, 'b'), ...(audio ? { audio } : {}) });
  }
  return ops;
}

/** Parse a layer's audio routes — to a primitive param (ok(param)) or the special 'opacity' target. */
function parseAudio(l: any, ok: (param: string) => boolean): AudioRoute[] {
  return (Array.isArray(l?.audio) ? l.audio : [])
    .filter((a: any) => (a?.param === 'opacity' || ok(a?.param)) && (AUDIO_SRC as readonly string[]).includes(a?.src))
    .map((a: any) => ({ param: a.param, src: a.src, amount: clamp(num(a.amount, 0.3), -1, 1) }))
    .slice(0, 4);
}

/** Best-effort sanitize a model-written GLSL field body. Returns the body or null if it looks unsafe.
 *  The body is the inside of `float prim_custom_i(vec2 uv){ ... }` and must `return` a coverage 0..1.
 *  This is the ONE path that bypasses validate()'s "always compiles" guarantee, so it stays paranoid;
 *  the engine compile+brightness probe is the real backstop. */
function sanitizeGlsl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 8 || s.length > 1400) return null;
  if (!/\breturn\b/.test(s)) return null;                                  // must produce a value
  if (/#|\bvoid\s+main\b|gl_FragColor|fragColor|texture\s*\(|\bdiscard\b|\bwhile\b/.test(s)) return null; // no preprocessor/entrypoint/sampling/unbounded loops
  if (/for\s*\([^)]*<\s*\d{3,}/.test(s)) return null;                      // reject for-loop bounds >= 100 (GPU hang)
  const balanced = (open: string, close: string) => { let n = 0; for (const c of s) { if (c === open) n++; else if (c === close && --n < 0) return false; } return n === 0; };
  if (!balanced('{', '}') || !balanced('(', ')')) return null;
  return s;
}

/** Coerce any model output into a valid, in-range SceneGraph. Invalid layers are dropped. */
export function validate(g: any): SceneGraph {
  const background = normHex(g?.background) ?? '#000000';
  const layers: Layer[] = [];
  for (const l of (Array.isArray(g?.layers) ? g.layers : []).slice(0, 4)) {
    const glsl = sanitizeGlsl(l?.glsl);                    // a layer is EITHER a named primitive OR a custom field body
    const spec = PRIM_MAP[l?.prim];
    if (!glsl && !spec) continue;                          // neither valid -> drop the layer
    const cb = normHex(l?.colorB);
    const common = {
      color: normHex(l?.color) ?? '#ffffff',
      blend: oneOf(BLENDS, l?.blend, 'over'),
      ops: parseOps(l),
      opacity: clamp(num(l?.opacity, 1), 0, 1),
      ...(cb ? { colorB: cb } : {}),                              // optional 2nd tint stop -> per-layer gradient
    };
    if (glsl) {
      // Custom field: the body reads uniforms directly; only 'opacity' audio routing applies.
      layers.push({ prim: 'custom', params: {}, glsl, audio: parseAudio(l, () => false), ...common });
      continue;
    }
    const params: Record<string, number> = {};
    for (const p of spec!.params) params[p.key] = clamp(num(l?.params?.[p.key], p.def), p.min, p.max);
    layers.push({ prim: spec!.name, params, audio: parseAudio(l, (k) => spec!.params.some((p) => p.key === k)), ...common });
  }
  if (!layers.length) layers.push({ prim: 'drift', params: { density: 0.55, flow: 0.4, field: 1, lineWidth: 0.2 }, color: '#ffffff', blend: 'over', ops: [], audio: [], opacity: 1 });
  const post: FX = { ...DEFAULT_FX };
  for (const k of FX_NAMES) post[k] = clamp(num(g?.post?.[k], 0), 0, 1);
  const palette = (Array.isArray(g?.palette) ? g.palette : []).map(normHex).filter((h: string | null): h is string => h !== null).slice(0, 4);
  const paletteAmount = clamp(num(g?.paletteAmount, 0.85), 0, 1);
  const exposure = clamp(num(g?.exposure, 1.8), 0.3, 2);   // global brightness — model-chosen (default bright)
  // exposure x bloom guard: both amplify light, so a bright scene with heavy bloom blows out to a white
  // mass. Cap the STEADY bloom inversely to exposure (transitions spike fxCur, not this, so they still flash).
  post.bloom = Math.min(post.bloom, clamp(2 - exposure, 0.15, 0.8));
  return { background, colorMode: 'color', layers, post, palette, paletteAmount, exposure };
}

const hexToVec3 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `vec3(${(((n >> 16) & 255) / 255).toFixed(3)}, ${(((n >> 8) & 255) / 255).toFixed(3)}, ${((n & 255) / 255).toFixed(3)})`;
};
const paramExprs = (l: Layer) => PRIM_MAP[l.prim].params.map((p) => {
  const a = l.audio.find((x) => x.param === p.key);
  const base = l.params[p.key].toFixed(3);
  if (!a) return base;
  // Scale the audio swing to the param's RANGE (so a small-range param like blobRadius doesn't explode)
  // and clamp to its bounds (reactivity can never drive it past the intended min/max).
  const swing = (a.amount * (p.max - p.min) * 0.35).toFixed(4);
  return `clamp(${base} + ${swing}*u_${a.src}, ${p.min.toFixed(3)}, ${p.max.toFixed(3)})`;
}).join(', ');
const blendExpr = (blend: string, color: string) =>
  blend === 'add' ? `col + ${color}*c` : blend === 'screen' ? `1.0-(1.0-col)*(1.0-${color}*c)` : blend === 'max' ? `max(col, ${color}*c)` : blend === 'multiply' ? `col * mix(vec3(1.0), ${color}, c)` : `mix(col, ${color}, c)`;

/** Chain a layer's uv-ops (in order) + collect its coverage masks (read from the original uv). */
function opChain(l: Layer): { p: string; mask: string } {
  let p = 'uv';
  const masks: string[] = [];
  for (const o of l.ops) {
    const spec = OP_MAP[o.op];
    if (!spec) continue;
    let aExpr = o.a.toFixed(3);                              // audio-driven distortion, swing scaled to the op's range + clamped
    if (o.audio && spec.a) {
      const swing = (o.audio.amount * (spec.a.max - spec.a.min) * 0.35).toFixed(4);
      aExpr = `clamp(${o.a.toFixed(3)} + ${swing}*u_${o.audio.src}, ${spec.a.min.toFixed(3)}, ${spec.a.max.toFixed(3)})`;
    }
    const args = spec.args === 0 ? '' : spec.args === 1 ? `, ${aExpr}` : `, ${aExpr}, ${o.b.toFixed(3)}`;
    if (spec.kind === 'uv') p = `op_${spec.name}(${p}${args})`;
    else masks.push(`mask_${spec.name}(uv${args})`);
  }
  return { p, mask: masks.join(' * ') };
}

/** Compose the validated graph into a full ES 3.0 content shader (library + any custom field fns + render()). */
export function codegenStack(g: SceneGraph): string {
  let helpers = '';
  // Baseline audio pump baked into EVERY composed shader (compose-only; defaults untouched) so a
  // generated visual ALWAYS reacts even if the model adds no routes — the "two clocks": reactivity
  // is free in-shader at 60fps. Neutral at silence (all terms 0). Model audio routes add detail on top.
  let body = `vec3 render(vec2 uv){\n  uv *= 1.0 - 0.04*u_bass;                 // bass breathing (camera pumps inward on hits)\n  vec3 col = ${hexToVec3(g.background)};\n`;
  g.layers.forEach((l, i) => {
    const { p, mask } = opChain(l);
    const m = mask ? ` * (${mask})` : '';
    const oa = l.audio.find((x) => x.param === 'opacity');
    const opac = oa ? `clamp(${l.opacity.toFixed(3)} + ${oa.amount.toFixed(3)}*u_${oa.src}, 0.0, 1.0)` : l.opacity.toFixed(3);
    const opM = (l.opacity < 0.999 || oa) ? ` * (${opac})` : '';
    let call: string;
    if (l.glsl) {                                  // model-written field: wrap the body in a prim-compatible fn
      helpers += `float prim_custom_${i}(vec2 uv){\n${l.glsl}\n}\n`;
      call = `prim_custom_${i}(p)`;
    } else {
      call = `prim_${l.prim}(p, ${paramExprs(l)})`;
    }
    const colorExpr = l.colorB ? `mix(${hexToVec3(l.color)}, ${hexToVec3(l.colorB)}, c)` : hexToVec3(l.color); // per-layer 2-stop gradient
    body += `  { vec2 p = ${p}; float c = clamp(${call}${m}, 0.0, 1.0)${opM}; col = ${blendExpr(l.blend, colorExpr)}; }\n`;
  });
  body += `  col *= 1.0 + 0.4*u_beat + 0.18*u_level;   // beat flash + loudness pump (gentle so it doesn't blow out)\n  return clamp(col, 0.0, 1.0);\n}`;
  return `${LIBRARY_GLSL}\n${helpers}${body}`;
}

const hexToRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const rgbToHex = (c: number[]) => '#' + c.map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
/** Resample 2-4 ordered hex stops into exactly 4 evenly-spaced stops for the gradient grade. */
export function resample4(stops: string[]): string[] {
  const cols = stops.map(hexToRgb);
  const at = (t: number) => { const x = t * (cols.length - 1); const i = Math.min(Math.floor(x), cols.length - 2); const f = x - i; const a = cols[i], b = cols[i + 1]; return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); };
  return [at(0), at(1 / 3), at(2 / 3), at(1)];
}

let genN = 0;
/** A drop-in Theme for the generated composition (color mode bypasses the duotone post-stack). */
export function makeComposeTheme(g: SceneGraph): Theme {
  const n = parseInt(g.background.slice(1), 16);
  const lum = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  genN += 1;
  return {
    id: `gen-${genN}`,
    name: 'Composed',
    prompt: '',
    ground: lum < 0.4 ? 'dark' : 'paper',
    mode: 'color',
    content: codegenStack(g),
    controls: [],
    palette: { paper: g.background, ink: '#ffffff' },
    grade: { grain: 0, contrast: 1.05, vignette: 0.25 },
    fx: g.post,
    gradeMap: g.palette.length >= 2 ? { stops: resample4(g.palette), amount: g.paletteAmount } : undefined,
  };
}
