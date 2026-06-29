// CONTOUR — the alpha frontend. The claude.ai design shell (prompt screen -> generate chrome,
// warm-paper transport + "steer the visuals" refine) wired to the real WebGL engine (the
// topographic background IS our Driftlines theme) + audio transport + the VJ director.

import { Engine, TRANSITIONS } from './engine/engine';
import { AudioEngine } from './audio';
import { THEMES, THEME_LIST, DEFAULT_THEME, themeDirectorSchema } from './themes';
import { MockDirector, RealDirector, type Director, type DirEvent } from './director';
import { buildPanel } from './ui/panel';
import { GemmaInspector } from './ui/gemma';
import { buildSpec, buildSchema } from './compose/library';
import { extractPalette, litStops } from './compose/palette';
import { readAlbumArt } from './albumArt';
import { validate, makeComposeTheme, resample4, type SceneGraph } from './compose/codegen';
import { inject } from '@vercel/analytics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
inject(); // Vercel Web Analytics — page views on the deployed site (no-op in local dev)
const app = $('app');
const canvas = $<HTMLCanvasElement>('view');
const fileEl = $<HTMLInputElement>('file');
const fileChip = $('fileChip'), fileNameEl = $('fileName');
const promptInput = $<HTMLInputElement>('promptInput');
const genBtn = $<HTMLButtonElement>('genBtn');
const songTitle = $('songTitle');
const playBtn = $('playBtn'), playIcon = $('playIcon');
const loopBtn = $<HTMLButtonElement>('loopBtn'), fsBtn = $<HTMLButtonElement>('fsBtn');
const timeEl = $('time'), totalEl = $('total'), fill = $('fill'), handle = $('handle'), seek = $('seek');
const refineInput = $<HTMLInputElement>('refineInput');
const rerollBtn = $<HTMLButtonElement>('rerollBtn'), autoBtn = $<HTMLButtonElement>('autoBtn'), saveBtn = $<HTMLButtonElement>('saveBtn');
const diceBtn = $<HTMLButtonElement>('diceBtn');
const folderBtn = $<HTMLButtonElement>('folderBtn'), folderWrap = $('folderWrap'), presetPanel = $('presetPanel');
const imgBtn = $<HTMLButtonElement>('imgBtn'), imgFile = $<HTMLInputElement>('imgFile'), dropZone = $('dropZone');
const dev = $('dev'), panelEl = $('panel'), themeSel = $<HTMLSelectElement>('themeSel'), providerSel = $<HTMLSelectElement>('providerSel');
const devlog = $('devlog');
const gemma = new GemmaInspector($('gemma')); // live "Gemma under the hood" trace in the dev panel

// Mirror console.* into the dev panel's log pane (press D) so logs are visible without browser devtools.
const fmtArg = (a: unknown) => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch { return String(a); } };
function pushLog(level: string, args: unknown[]) {
  const d = new Date(), ts = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const line = document.createElement('div');
  line.className = `lg lg-${level}`;
  line.innerHTML = `<span class="t">${ts}</span> `;
  line.append(args.map(fmtArg).join(' '));
  devlog.append(line);
  while (devlog.childElementCount > 200) devlog.firstElementChild?.remove();
  devlog.scrollTop = devlog.scrollHeight;
}
(['log', 'warn', 'error'] as const).forEach((lvl) => {
  const orig = console[lvl].bind(console);
  console[lvl] = (...args: unknown[]) => { orig(...args); pushLog(lvl, args); };
});
$<HTMLButtonElement>('logClear').addEventListener('click', () => devlog.replaceChildren());
const dirstat = $('dirstat');
const hud = $('hud');
let autoVJ = false; // auto-regenerate the visual on song-section boundaries (Gemma-speed payoff)
let stagedCover: Blob | null = null; // embedded mp3 album art, if any — captioned into a prompt before Enter
let seededFromCover = false;         // did the cover art pre-fill the prompt? (-> auto-VJ on Enter)
let promptEdited = false;            // did the user type their own prompt? (the box is prefilled with the landing theme's)
let nextSection = 0;                 // cursor into audio.sections for timeline-driven scene changes
let marksReady = false;              // ticks drawn once the track duration resolves
// Paint the WHOLE precomputed drop/section timeline as ticks on the seek bar — known up front.
function renderMarks() {
  seek.querySelectorAll('.mark').forEach((m) => m.remove());
  if (!audio.duration || !audio.sections.length) return;
  for (const t of audio.sections) { const d = document.createElement('div'); d.className = 'mark'; d.style.left = `${Math.min(100, (t / audio.duration) * 100)}%`; seek.append(d); }
}
const clearMarks = () => { seek.querySelectorAll('.mark').forEach((m) => m.remove()); marksReady = false; };
// Point the timeline cursor at the next upcoming section after the playhead — call on play/seek.
const resyncSections = () => { const i = audio.sections.findIndex((t) => t > audio.time + 0.1); nextSection = i < 0 ? audio.sections.length : i; };

let registry = THEMES;
// Pick a random theme each page load so the landing visual varies; show its signature prompt.
// sumi is audio-reactive only (renders blank with no track), so keep it out of the idle landing pool.
const landingPool = THEME_LIST.filter((t) => t.id !== 'sumi');
const initialTheme = landingPool[Math.floor(Math.random() * landingPool.length)];
const engine = new Engine(canvas, initialTheme);
promptInput.value = initialTheme.prompt;
const audio = new AudioEngine();
let director: Director = new MockDirector();
const SPEC = buildSpec(); // primitive catalogue sent to the model for compose mode
const SCHEMA = buildSchema(); // strict json-schema for the FINAL emit call (constrained decoding → guaranteed-valid graph)

(window as unknown as { prism: Engine; audio: AudioEngine }).prism = engine;
(window as unknown as { audio: AudioEngine }).audio = audio;

const titleFrom = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().toUpperCase() || 'UNTITLED SESSION';
const fmt = (s: number) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${(s % 60 < 10 ? '0' : '')}${s % 60}`; };
// Motion speed tracks the track tempo once playing: 120 BPM ≈ neutral 1.0; undetected beat → normal speed.
const bpmToSpeed = (bpm: number) => (bpm ? bpm / 120 : 1.0);

// ---- director (VJ brain) ----
// Live typing is paced to the active model's rate limit (the server reports the model per call):
// gpt-oss stand-in = free tier 5 req/min -> 12.5s; Gemma 4 (hackathon rate-limit-increased preview)
// -> ~1.5s, just above one generation's latency so calls don't pile up (each is a 2-step ~4k-token
// gen — firing every 0.2s spammed the API, tripped 429s, and thrashed the visual). Fires instantly
// when idle, then coalesces rapid edits to the LATEST text (pendingTimer). Swapping CEREBRAS_MODEL
// in .env auto-switches the pace — no code change needed for the event.
const PACE_STANDIN = 12500, PACE_GEMMA = 1500;
let rateMinMs = PACE_STANDIN;
let ac: AbortController | null = null;
let debounce = 0, fadeTimer = 0, pendingTimer = 0;
let lastFireAt = 0, cooldownUntil = 0, pendingText = '', lastText = '';
let composeAc: AbortController | null = null;             // cancels a superseded in-flight compose call
let lastComposeGraph: SceneGraph | null = null, lastComposePrompt = ''; // state for incremental/diff prompts

function setStatus(msg: string, fade = false) {
  dirstat.textContent = msg;
  dirstat.style.opacity = msg ? '1' : '0';
  clearTimeout(fadeTimer);
  if (fade) fadeTimer = window.setTimeout(() => { dirstat.style.opacity = '0'; }, 1600);
}

function onEvent(e: DirEvent) {
  if (e.type === 'config') {
    const cfg = e.cfg;
    if (cfg.theme && registry[cfg.theme] && cfg.theme !== engine.activeTheme.id) engine.crossfadeTo(registry[cfg.theme]);
    engine.applyDirector(cfg);
    themeSel.value = engine.activeTheme.id;
    if (dev.classList.contains('show')) buildPanel(panelEl, engine);
    setStatus('✓ applied', true);
  } else if (e.type === 'agent') {
    setStatus(e.msg || 'directing…');             // e.g. "cerebras gpt-oss-120b · 589ms"
    if (/gemma/i.test(e.msg)) rateMinMs = PACE_GEMMA;             // event model: elevated limits -> fluid
    else if (/gpt-oss|glm/i.test(e.msg)) rateMinMs = PACE_STANDIN; // free-tier stand-in -> pace to 5/min
  } else if (e.type === 'error') {
    if (/429|rate|too many/i.test(e.msg)) {         // per-minute cap hit — back off, retry the latest text
      cooldownUntil = Date.now() + rateMinMs;
      requestDirect(pendingText || lastText);
    } else {
      setStatus('director error', true);
      console.log('[director] error', e.msg);
    }
  }
}

function runDirector(text: string) {
  ac?.abort();
  ac = new AbortController();
  director.direct(text, { currentTheme: engine.activeTheme.id, schema: themeDirectorSchema(engine.activeTheme) }, onEvent, ac.signal);
}

function fireDirect(text: string) {
  lastFireAt = Date.now();
  pendingText = '';
  lastText = text;
  if (providerSel.value === 'compose') { composeVisual(text); return; } // generate a custom shader, not a preset
  setStatus('directing…');
  runDirector(text);
}

// ---- compose mode: prompt -> adaptive thinking chain -> scene-graph (or recolor delta) -> render ----
// Sends the CURRENT prompt+graph so the model decides new vs refine vs recolor (incremental diffs).
// `fresh` (re-roll) forces a brand-new interpretation by hiding the current scene.
async function composeVisual(text: string, fresh = false, vary = false) {
  if (!text.trim()) return;
  setStatus('composing…');
  composeAc?.abort();                                       // newer keystroke / re-roll supersedes the in-flight call
  composeAc = new AbortController();
  const timer = setTimeout(() => composeAc?.abort(), 6000); // never stall the UI (allows a 2-step reasoning chain)
  // Treat an erase+retype as a FRESH scene: if the new text isn't a forward/backward extension of the
  // last prompt (live typing builds up char-by-char), a genuinely different prompt must rebuild — not be
  // mis-read as a refine/recolor of the old one. Sending no context forces diffType "new" server-side.
  const a = text.trim().toLowerCase(), b = lastComposePrompt.trim().toLowerCase();
  const continuation = !!b && (a.startsWith(b) || b.startsWith(a));
  const lp = (fresh || !continuation) ? '' : lastComposePrompt;
  const lg = (fresh || !continuation) ? null : lastComposeGraph;
  try {
    const res = await fetch('/api/compose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: text, spec: SPEC, schema: SCHEMA, vary, provider: 'cerebras', lastPrompt: lp, lastGraph: lg, trace: true }),
      signal: composeAc.signal,
    });
    const j = await res.json();
    if (!res.ok || j.error) {
      if (/429|rate|too many/i.test(j.error || '')) { cooldownUntil = Date.now() + rateMinMs; requestDirect(pendingText || lastText); }
      else { setStatus('compose error', true); console.log('[compose] error', j.error, j.detail); }
      return;
    }
    if (/gemma/i.test(j.model)) rateMinMs = PACE_GEMMA;
    lastComposePrompt = text;
    hud.textContent = `${j.model} · ${j.ms}ms · ${j.tps || 0} tok/s${autoVJ ? ' · AUTO' : ''}`; // persistent speed readout
    console.log('[compose]', `"${text}" → ${j.model} ${j.ms}ms ${j.tps || 0}tok/s ${j.recolor ? 'recolor' : (j.steps || 2) + '-step'}`);
    const think = j.brief?.interpretation ? `“${j.brief.interpretation}” · ` : ''; // surface the model's reasoning
    gemma.push({ prompt: text, kind: j.recolor ? 'recolor' : `${j.steps || 2}-step`, trace: j.trace || [], totalMs: j.ms || 0, tps: j.tps || 0 }); // live Gemma trace → dev panel

    // RECOLOR — ease colour/post in place; structure preserved, no recompile (the "just change the colour" path).
    if (j.recolor && Array.isArray(j.recolor.palette) && j.recolor.palette.length >= 2) {
      const cl = (v: number) => Math.max(0, Math.min(1, v));  // recolor skips validate()'s clamp — bound model values here so an out-of-range delta can't blow out the GPU
      const amt = cl(typeof j.recolor.paletteAmount === 'number' ? j.recolor.paletteAmount : 0.85);
      const post: any = {};
      for (const [k, v] of Object.entries(j.recolor.post || {})) if (typeof v === 'number' && Number.isFinite(v)) post[k] = cl(v);
      const stops = litStops(resample4(j.recolor.palette));   // brightness guard: a dark recolor can never go to black
      engine.updateComposeColor(stops, amt, post);
      if (lastComposeGraph) { lastComposeGraph.palette = stops; lastComposeGraph.paletteAmount = amt; Object.assign(lastComposeGraph.post, post); } // keep client graph in sync with the live post-fx
      setStatus(`${think}recolor · ${j.model} · ${j.ms}ms`, true);
      return;
    }

    // NEW / REFINE — validate -> compile/brightness guard -> crossfade (non-destructive on reject).
    const graph = validate(j.graph);
    // Each scene brings its OWN look: post-fx + exposure change with the scene (not locked to the first).
    const theme = makeComposeTheme(graph);
    if (!engine.testContent(theme.content)) { setStatus(`${think}rejected (kept current) · ${j.ms}ms`, true); return; }
    engine.crossfadeTo(theme);
    engine.setLook({ speed: bpmToSpeed(audio.bpm), exposure: graph.exposure }); // model-chosen brightness + own pace
    lastComposeGraph = graph;
    setStatus(`${think}${j.model} · ${j.ms}ms · ${j.steps || 2}-step`, true);
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return; // superseded — expected
    setStatus('compose error', true); console.log('[compose]', e);
  } finally { clearTimeout(timer); }
}
(window as unknown as { compose: (t: string, fresh?: boolean) => void }).compose = composeVisual;
// Validate -> compile/brightness guard -> crossfade a scene-graph into view (shared by the debug
// inject hook AND preset recall). Returns false if the guard rejected it (keeps the live visual).
function applyGraph(g: unknown, opts?: { tr?: string; prompt?: string }): boolean {
  const graph = validate(g);
  const theme = makeComposeTheme(graph);
  if (!engine.testContent(theme.content)) { console.warn('[applyGraph] rejected by compile/brightness guard'); return false; }
  engine.crossfadeTo(theme, opts?.tr ? TRANSITIONS.find((t) => t.name === opts.tr) : undefined);
  engine.setLook({ speed: bpmToSpeed(audio.bpm), exposure: graph.exposure });
  lastComposeGraph = graph; lastComposePrompt = opts?.prompt ?? '';
  return true;
}
// Debug: inject a hand-authored scene-graph directly (bypasses the model) to test primitives+codegen.
(window as unknown as { composeGraph: (g: unknown, tr?: string) => void }).composeGraph = (g, tr) => { applyGraph(g, { tr }); };
(window as unknown as { extractPalette: typeof extractPalette }).extractPalette = extractPalette; // debug: inspect image->palette
(window as unknown as { audioDebug: typeof audio }).audioDebug = audio; // debug: poll section detection / features

// ---- image -> theme: read a reference image, extract its EXACT palette, let Gemma decide structure ----
const MAX_IMG = 512;
async function composeFromImage(file: Blob, steer = '') {
  if (!file.type.startsWith('image/')) { setStatus('not an image file', true); return; }
  setStatus('reading image…');
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { setStatus('could not read image', true); return; }
  const s = Math.min(1, MAX_IMG / Math.max(bmp.width, bmp.height));        // downscale to <=512px
  const cw = Math.max(1, Math.round(bmp.width * s)), ch = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.drawImage(bmp, 0, 0, cw, ch); bmp.close?.();
  const palette = extractPalette(canvas);                                  // EXACT colours from the pixels (authoritative)
  const image = canvas.toDataURL('image/jpeg', 0.7);                       // small payload + few image-tokens
  setStatus('composing from image…');
  try {
    const res = await fetch('/api/compose', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: steer, spec: SPEC, schema: SCHEMA, image, palette, provider: 'cerebras', lastPrompt: '', lastGraph: null, trace: true }),
    });
    const j = await res.json();
    if (!res.ok || j.error) { setStatus('image compose error', true); console.log('[image]', j.error, j.detail); return; }
    if (/gemma/i.test(j.model)) rateMinMs = PACE_GEMMA;
    gemma.push({ prompt: steer || '(image)', kind: 'from image', trace: j.trace || [], totalMs: j.ms || 0, tps: j.tps || 0 });
    if (j.graph?.post) j.graph.post.hue = 0;                              // image themes must KEEP the image's colours — the hue post-fx rainbow-cycles them (warm palette -> green)
    if (j.graph && palette.length) {                                      // hybrid: the extracted palette wins over the model's guess
      j.graph.palette = palette;
      j.graph.paletteAmount = Math.max(0.9, j.graph.paletteAmount || 0);  // keep the IMAGE's colours dominant so a stray screen/add layer can't bleed an off-palette hue through
    }
    const think = j.brief?.interpretation ? `“${j.brief.interpretation}” · ` : '';
    hud.textContent = `${j.model} · ${j.ms}ms · ${j.tps || 0} tok/s`;
    console.log('[image]', `→ ${j.model} ${j.ms}ms ${j.tps || 0}tok/s · palette ${palette.join(' ')}`);
    const rerollPrompt = steer || j.brief?.interpretation || '';            // gives re-roll + auto-VJ a thread to evolve from
    if (applyGraph(j.graph, { prompt: rerollPrompt })) setStatus(`${think}from image · ${j.model} · ${j.ms}ms`, true);
    else setStatus(`${think}rejected (kept current)`, true);
  } catch (e) { setStatus('image compose error', true); console.log('[image]', e); }
}
// Caption the mp3 cover art -> a short text prompt. Pre-fills the box before Enter; the style is then
// generated NATURALLY through the normal text->graph path (no image-palette special-casing).
async function captionCover(blob: Blob): Promise<string> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return ''; }
  const s = Math.min(1, 384 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  try {
    const res = await fetch('/api/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: c.toDataURL('image/jpeg', 0.7), caption: true, provider: 'cerebras', trace: true }) });
    const j = await res.json();
    gemma.push({ prompt: '(cover art → prompt)', kind: 'caption', trace: j.trace || [], totalMs: j.ms || 0, tps: j.trace?.[0]?.tps || 0 });
    return (j.prompt || '').trim();
  } catch { return ''; }
}
imgBtn.addEventListener('click', () => imgFile.click());
imgFile.addEventListener('change', () => { const f = imgFile.files?.[0]; if (f) composeFromImage(f, refineInput.value.trim()); imgFile.value = ''; });
// drag an image anywhere onto the window -> theme from it (depth-counted so the overlay doesn't flicker)
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); if (++dragDepth === 1) dropZone.classList.add('show'); } });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('show'); } });
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; dropZone.classList.remove('show');
  const f = Array.from(e.dataTransfer!.files).find((x) => x.type.startsWith('image/'));
  if (f) composeFromImage(f, refineInput.value.trim());
});

// ---- presets: save generated visuals to localStorage; recall/rename/delete from the folder popover ----
type Preset = { name?: string; prompt: string; graph: unknown };
const PRESETS_KEY = 'contour.presets';
const loadPresets = (): Preset[] => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; } };
const savePresets = (arr: Preset[]) => localStorage.setItem(PRESETS_KEY, JSON.stringify(arr));
const presetName = (p: Preset) => p.name || p.prompt || 'untitled';
const closePresets = () => presetPanel.classList.remove('show');

function savePreset() {
  if (!lastComposeGraph) { setStatus('nothing to save yet — generate a visual first', true); return; }
  const arr = loadPresets();
  arr.push({ prompt: lastComposePrompt, graph: lastComposeGraph });
  savePresets(arr.slice(-12));                                            // keep the last 12
  renderPresets();
  presetPanel.classList.add('show');                                     // pop the folder so the new one is visible
  setStatus('★ saved to presets', true);
}
function loadPreset(i: number) {
  const p = loadPresets()[i];
  if (!p) return;
  if (applyGraph(p.graph, { prompt: p.prompt })) { refineInput.value = p.prompt; autoGrow(refineInput); setStatus(`▶ ${presetName(p)}`, true); }
}
function deletePreset(i: number) { const arr = loadPresets(); arr.splice(i, 1); savePresets(arr); renderPresets(); }
function renamePreset(i: number, name: string) { const arr = loadPresets(); if (arr[i]) { arr[i].name = name.trim() || undefined; savePresets(arr); } renderPresets(); }

function smallBtn(title: string, path: string, onClick: (e: MouseEvent) => void) {
  const b = document.createElement('button'); b.title = title;
  b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${path}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}
function startRename(row: HTMLElement, i: number) {
  const input = document.createElement('input');
  input.className = 'preset-rename'; input.value = presetName(loadPresets()[i]);
  let done = false;
  const commit = () => { if (done) return; done = true; renamePreset(i, input.value); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { done = true; renderPresets(); } });
  input.addEventListener('blur', commit);
  row.replaceChildren(input); input.focus(); input.select();
}
// Folder popover: each row recalls on click; ✎ renames inline; ✕ deletes.
function renderPresets() {
  presetPanel.replaceChildren();
  const presets = loadPresets();
  if (!presets.length) {
    const empty = document.createElement('div');
    empty.className = 'preset-empty'; empty.textContent = 'No presets yet — hit ★ to save the current visual.';
    presetPanel.append(empty); return;
  }
  presets.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'preset-item';
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = presetName(p); nm.title = `Recall: ${presetName(p)}`;
    nm.addEventListener('click', () => { loadPreset(i); closePresets(); });
    const ren = smallBtn('Rename', '<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M13 5l4 4"/>', (e) => { e.stopPropagation(); startRename(row, i); });
    const del = smallBtn('Delete', '<path d="M18 6 6 18M6 6l12 12"/>', (e) => { e.stopPropagation(); deletePreset(i); });
    row.append(nm, ren, del);
    presetPanel.append(row);
  });
}

// compose-mode actions shared by the on-screen buttons AND the keyboard shortcuts
// Curated, high-performing prompts (the vocabulary the model renders well). The dice picks one,
// injects it into the steer box, and fires a fresh generation — an instant "show me something good".
const PROMPTS = [
  'a swirling spiral galaxy with a blinding white core and deep violet arms, heavy bloom and a slow radial blur dragging everything toward the center',
  'a retro synthwave sunset over an endless neon grid racing to the horizon, magenta and cyan, with CRT scanlines and a soft chromatic shimmer',
  'a black hole bending light around a pitch-dark core, an accretion ring of molten orange and gold, heavy bloom with chromatic aberration on the edges',
  'cascading green code rain down a black terminal screen, fast vertical streaks, rendered through an ascii filter with a faint phosphor bloom',
  'deep-sea bioluminescent jellyfish drifting through cold darkness, glowing teal and electric blue tendrils, soft bloom and gentle chromatic edges',
  'a psychedelic kaleidoscope mandala of shifting petals in saturated rainbow hues, slow hue cycling with a luminous bloom',
  'molten lava flowing in slow rivers of deep red and bright orange over cracked black crust, halftone dots and a warm bloom',
  'a warp-speed tunnel of light streaking past in white and electric blue, intense radial blur with chromatic aberration on the streaks',
  'aurora borealis rippling over a dark arctic sky, green and violet curtains of light, soft bloom and a subtle scanline texture',
  'a washed-out VHS recording of a rotating chrome sphere in faded blues, heavy scanlines, chromatic aberration and slight pixelation',
  'noir rain falling over a dark city grid in high-contrast grayscale, with a grainy halftone dot texture',
  'a cosmic nebula of purple, pink and teal gas slowly churning around distant stars, luminous bloom and faint chromatic fringing',
  'op-art moire interference of fine black and white lines beating against each other, hypnotic, with a sharp halftone dot overlay',
  'a glowing plasma orb floating in a dark void, liquid blue and white core, intense bloom with a soft radial blur halo',
  'chunky 8-bit pixel-art fire rising in a dark cave, orange and yellow embers, heavy pixelation with a warm bloom glow',
  'electric voronoi cells pulsing like a neural network, bright cyan borders on deep navy, glowing bloom and a faint chromatic shift',
  'a retro arcade starfield warping into hyperspace in neon pink and blue, radial blur streaks with scanlines and chromatic aberration',
  'rolling volumetric storm clouds lit by distant forked lightning, moody indigo and silver, with a dreamy bloom glow around every flash',
  'a sumi-e ink wash on warm paper, one bold brushstroke bleeding into the fibers, calm and muted, with a subtle grayscale grain',
  'concentric sonar ripples expanding through deep water, dark teal and pale green, soft bloom and a faint scanline shimmer',
];
let lastDice = -1;
function randomPrompt() {
  let i; do { i = Math.floor(Math.random() * PROMPTS.length); } while (PROMPTS.length > 1 && i === lastDice);
  lastDice = i;
  const p = PROMPTS[i];
  refineInput.value = p; autoGrow(refineInput); promptEdited = true;
  composeVisual(p, true); // fresh take on the hand-picked prompt
}
function reroll() { const t = lastComposePrompt || refineInput.value.trim(); if (t) composeVisual(t, true); }
function toggleAuto() { autoVJ = !autoVJ; autoBtn.classList.toggle('on', autoVJ); setStatus(autoVJ ? 'auto-VJ ON' : 'auto-VJ off', true); }
rerollBtn.addEventListener('click', reroll);
diceBtn.addEventListener('click', randomPrompt);
autoBtn.addEventListener('click', toggleAuto);
saveBtn.addEventListener('click', (e) => { e.stopPropagation(); savePreset(); });   // stopProp so the save-opened panel survives the outside-click close
folderBtn.addEventListener('click', (e) => { e.stopPropagation(); presetPanel.classList.toggle('show'); });
document.addEventListener('click', (e) => { if (!folderWrap.contains(e.target as Node)) closePresets(); }); // click-outside closes the folder
renderPresets();

// Throttled entry for live typing — never exceeds the per-minute cap; always lands the latest text.
function requestDirect(text: string) {
  if (!text.trim()) return;
  pendingText = text;
  const minMs = providerSel.value === 'mock' ? 0 : rateMinMs; // mock is local/instant; real providers paced to their limit
  const wait = Math.max(0, Math.max(lastFireAt + minMs, cooldownUntil) - Date.now());
  clearTimeout(pendingTimer);
  if (wait === 0) { fireDirect(text); return; }
  setStatus(`rate-limited · next in ${Math.ceil(wait / 1000)}s`);
  pendingTimer = window.setTimeout(() => { if (pendingText) fireDirect(pendingText); }, wait);
}

// ---- prompt screen ----
$('pickBtn').addEventListener('click', () => fileEl.click());
let hasFile = false;
// genBtn stays enabled — with no track, pressing it (or Enter) shows the "add a track" nudge (see generate()).

$('clearFile').addEventListener('click', () => { hasFile = false; audio.pause(); fileChip.classList.remove('show'); stagedCover = null; seededFromCover = false; });
fileEl.addEventListener('change', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  fileNameEl.textContent = f.name;
  fileChip.classList.add('show');
  songTitle.textContent = titleFrom(f.name);
  hasFile = true;
  clearMarks();   // fresh track -> fresh scene timeline
  stagedCover = await readAlbumArt(f).catch(() => null);   // embedded cover art (mp3 ID3)
  try { await audio.load(f); } catch (e) { console.error('[audio]', e); }
  if (stagedCover) {                                       // cover -> a short prompt, pre-filled BEFORE Enter
    fileNameEl.textContent = `${f.name} · ♪ cover art`;
    setStatus('reading cover art…');
    const cap = await captionCover(stagedCover);
    console.log('[cover]', cap ? `prompt: "${cap}"` : 'no caption');
    if (cap && !promptEdited && providerSel.value === 'compose') {
      promptInput.value = cap; refineInput.value = cap; autoGrow(refineInput); seededFromCover = true; // keep the prompt in BOTH boxes -> stays visible in the player
      composeVisual(cap);                                  // preview the style on the landing screen (natural text->graph). lastComposePrompt = cap, so additions REFINE it (not a new scene)
    }
  }
  if (app.classList.contains('gen')) engine.setLook({ speed: bpmToSpeed(audio.bpm) }); // BPM may resolve after Enter
});

let hintTimer = 0;
// No track yet + Enter/→ → point a bubble at the music icon instead of silently doing nothing.
function showAddTrackBubble() {
  const r = $('pickBtn').getBoundingClientRect();
  const hint = $('addTrackHint');
  hint.style.left = `${r.left + r.width / 2}px`;
  hint.style.top = `${r.top - 10}px`;
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hint.classList.remove('show'), 3800);
}

// advance to the player — ONLY with a track loaded. Plays within the Enter gesture (autoplay-safe).
function generate() {
  if (!hasFile) { showAddTrackBubble(); return; }
  app.classList.add('gen');
  engine.setLook({ speed: bpmToSpeed(audio.bpm) }); // 0.1 idle -> ramp motion to the track's tempo
  audio.play();
  resyncSections();                                  // align the timeline cursor to the playhead
  // The cover art pre-filled the prompt and previewed the style on the landing screen — hand off to
  // auto-VJ so the set keeps evolving from that prompt. A typed prompt takes precedence (no seed).
  if (seededFromCover && providerSel.value === 'compose' && !promptEdited && !autoVJ) toggleAuto();
}
genBtn.addEventListener('click', generate);
promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });

// live text -> visuals (debounced) on BOTH the prompt box and the refine box
function wireLive(input: HTMLInputElement) {
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = window.setTimeout(() => requestDirect(input.value), 250); });
}
wireLive(promptInput);
promptInput.addEventListener('input', () => { promptEdited = true; }); // distinguishes a typed prompt from the prefill
// No on-load director run: the random initial theme is shown directly (with its own palette);
// editing the prompt live-steers from there. (Avoids the director re-deriving theme/palette from the seed prompt.)

// ---- generate chrome ----
$('resetBtn').addEventListener('click', () => { app.classList.remove('gen'); audio.pause(); engine.setLook({ speed: 0.1 }); clearMarks(); }); // back to glacial idle
playBtn.addEventListener('click', () => audio.toggle());
loopBtn.addEventListener('click', () => { const on = !audio.looping; audio.setLoop(on); loopBtn.classList.toggle('on', on); }); // repeat the track at end
fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
document.addEventListener('fullscreenchange', () => fsBtn.classList.toggle('on', !!document.fullscreenElement));
seek.addEventListener('click', (e) => { const r = seek.getBoundingClientRect(); audio.seekFrac((e.clientX - r.left) / r.width); resyncSections(); });

// Sculpt: steer the visuals live as you type (no submit button on the player)
wireLive(refineInput);
// grow the steer box with its text, capped to ~3 rows (CSS max-height) then it scrolls
const autoGrow = (el: HTMLElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 78)}px`; };
refineInput.addEventListener('input', () => autoGrow(refineInput));
autoGrow(refineInput);

// ---- dev panel (press D) ----
for (const t of THEME_LIST) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; themeSel.append(o); }
themeSel.value = engine.activeTheme.id;
themeSel.addEventListener('change', () => { engine.crossfadeTo(registry[themeSel.value]); buildPanel(panelEl, engine); });
providerSel.addEventListener('change', () => { director = providerSel.value === 'mock' ? new MockDirector() : new RealDirector(providerSel.value as 'cerebras' | 'compare'); });
addEventListener('keydown', (e) => {
  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key.toLowerCase() === 'd' && !typing) { dev.classList.toggle('show'); if (dev.classList.contains('show')) buildPanel(panelEl, engine); }
  // keyboard accelerators for the on-screen buttons (compose mode, when not typing)
  if (e.key.toLowerCase() === 'r' && !typing && providerSel.value === 'compose') reroll();         // re-roll
  if (e.key.toLowerCase() === 'a' && !typing && providerSel.value === 'compose') toggleAuto();      // auto-VJ
  if (e.key.toLowerCase() === 's' && !typing && providerSel.value === 'compose') savePreset();      // save preset
});
addEventListener('resize', () => engine.resize());

const PLAY = '<path d="M7 4.5v15l13-7.5z"/>';
const PAUSE = '<rect x="6" y="5" width="4" height="14" rx="1.3"/><rect x="14" y="5" width="4" height="14" rx="1.3"/>';
let lastPlaying = false;

// ---- render + transport loop ----
let last = performance.now();
function loop(now: number) {
  engine.render(audio.features(), now / 1000);
  // auto-VJ: timeline-driven — fire a fresh scene ~1.5s BEFORE each precomputed drop so the new
  // visual crossfades in right ON the drop (re-roll the current prompt for variety in the same style).
  if (autoVJ && providerSel.value === 'compose' && audio.playing && audio.sections.length) {
    const LEAD = 1.5;
    while (nextSection < audio.sections.length && audio.time >= audio.sections[nextSection] - LEAD) {
      composeVisual(lastComposePrompt || refineInput.value || promptInput.value, true, true); // vary: rich + distinct each drop
      nextSection++;
    }
  }
  if (!marksReady && audio.duration && audio.sections.length) { renderMarks(); marksReady = true; } // paint the timeline once duration resolves
  if (audio.loaded && audio.duration) {
    const r = audio.time / audio.duration;
    fill.style.width = `${r * 100}%`;
    handle.style.left = `${r * 100}%`;
    timeEl.textContent = fmt(audio.time);
    totalEl.textContent = fmt(audio.duration);
  }
  if (audio.playing !== lastPlaying) { lastPlaying = audio.playing; playIcon.innerHTML = audio.playing ? PAUSE : PLAY; }
  last = now;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// HMR: hot-swap an edited theme in place (keeps screen + audio + selected theme)
if (import.meta.hot) {
  import.meta.hot.accept('./themes', (mod) => {
    if (!mod) return;
    registry = (mod as unknown as typeof import('./themes')).THEMES;
    engine.hotSwapActive(registry[engine.activeTheme.id] ?? DEFAULT_THEME);
    if (dev.classList.contains('show')) buildPanel(panelEl, engine);
  });
}
