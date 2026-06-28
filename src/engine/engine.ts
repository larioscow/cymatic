// PRISM engine: Three.js + pmndrs/postprocessing. Each theme renders its content to an HDR
// target; a shared post-stack (StyleEffect) applies the look. Two control mechanisms keep
// everything smooth:
//   - SMOOTHING (per-frame ease) for all in-theme changes: sliders, toggles (0..1), choices
//     (eased index), post intensities, palette colors.
//   - BUFFER CROSSFADE for the structural theme swap: render outgoing + incoming content to
//     two targets and dissolve, while post/colors ease across. Both themes stay live.
// setControl/setToggle/setChoice/setColor/applyDirector are the single write path shared by
// the manual panel and Gemma.

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import type { AudioFeatures } from '../audio';
import { buildContent, CONTENT_VERT, KNOB_COUNT } from '../harness';
import type { Theme, PostName, AudioMod, GlobalLook, FX } from '../themes/types';
import { DEFAULT_LOOK, DEFAULT_GRADE, LOOK_PARAMS, DEFAULT_FX, FX_NAMES } from '../themes/types';
import { ControlRuntime, defaultValue } from './params';

const POST_NAMES: PostName[] = ['uDither', 'uGrain', 'uVignette', 'uContrast', 'uChroma', 'uExposure'];

// Theme-change transitions: each spikes one or more post-FX to an `initial` value at the swap; the
// engine's per-frame FX easing then decays it to the new theme's value (the `ending`) — a keyframed
// flash-and-settle synced to the crossfade. Picked at random per swap (or pass one to crossfadeTo).
export type Transition = { name: string; spikes: { fx: keyof FX; initial: number }[] };
export const TRANSITIONS: Transition[] = [
  { name: 'cut',     spikes: [] },                                                   // plain dissolve, no flourish
  { name: 'flash',   spikes: [{ fx: 'bloom', initial: 1.4 }] },                      // bright bloom bloom
  { name: 'bleach',  spikes: [{ fx: 'bloom', initial: 2.0 }, { fx: 'grayscale', initial: 0.7 }] }, // white-out
  { name: 'zoom',    spikes: [{ fx: 'radialBlur', initial: 0.95 }] },                // zoom/streak rush
  { name: 'glitch',  spikes: [{ fx: 'chroma', initial: 1.0 }, { fx: 'radialBlur', initial: 0.4 }] }, // RGB-tear cut
  { name: 'pixel',   spikes: [{ fx: 'pixelate', initial: 0.9 }] },                   // pixel-melt
  { name: 'ascii',   spikes: [{ fx: 'ascii', initial: 0.85 }] },                     // glyph dissolve
  { name: 'dots',    spikes: [{ fx: 'dots', initial: 0.9 }] },                       // halftone wipe
  { name: 'scan',    spikes: [{ fx: 'scanlines', initial: 0.9 }] },                  // CRT scanline sweep
];

export type DirectorConfig = {
  theme?: string;
  controls?: Record<string, number | boolean | string>; // theme-scoped
  look?: Partial<GlobalLook>;                            // global (persists across themes)
  audio?: Record<string, AudioMod>;
  palette?: { paper?: string; ink?: string; accent?: string };
};

const STYLE_FRAG = `
uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uAccent;
uniform float uDither; uniform float uGrain; uniform float uVignette; uniform float uContrast; uniform float uChroma;
uniform float uExposure;
uniform float uBeat; uniform float uLevel; uniform float uTime; uniform vec2 uRes;
uniform float uColorMode;
uniform float uSaturation; uniform float uPixelate; uniform float uDots; uniform float uScan;
uniform float uAscii; uniform float uHue;
uniform vec3 uPal0; uniform vec3 uPal1; uniform vec3 uPal2; uniform vec3 uPal3; uniform float uPaletteAmt;
float sfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
// Real ASCII glyphs: 5x5 bitmaps (bit = x + 5*y) chosen by luminance level 0..8 (space . : + x o # @ block).
float asciiGlyph(int gi, ivec2 p){
  if(gi<=0 || p.x<0 || p.x>4 || p.y<0 || p.y>4) return 0.0;
  int g = 33554431;                                  // 8+ : solid block
  if(gi==1) g=4096; else if(gi==2) g=131200; else if(gi==3) g=145536;
  else if(gi==4) g=332096; else if(gi==5) g=469440; else if(gi==6) g=11512810;
  else if(gi==7) g=15267502;
  return float((g >> (p.x + 5*p.y)) & 1);
}
float bayer8(vec2 c){
  const int M[64] = int[64](0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21);
  int x=int(mod(c.x,8.0)); int y=int(mod(c.y,8.0));
  return float(M[x+y*8])/64.0;
}
vec3 paletteMap(float t){
  t = clamp(t, 0.0, 1.0);
  if(t < 0.3333) return mix(uPal0, uPal1, t*3.0);
  if(t < 0.6667) return mix(uPal1, uPal2, (t-0.3333)*3.0);
  return mix(uPal2, uPal3, (t-0.6667)*3.0);
}
void mainUv(inout vec2 uv){
  if(uPixelate > 0.5){ vec2 px = vec2(uPixelate)/uRes; uv = (floor(uv/px)+0.5)*px; }   // chunky pixels
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 frag = uv*uRes;
  // duotone path: remap content luminance to paper<->ink (+ optional dither + beat chroma)
  float lum = dot(inputColor.rgb, vec3(0.299,0.587,0.114));
  lum = clamp((lum-0.5)*uContrast + 0.5, 0.0, 1.0);
  float t = bayer8(frag);
  float v = mix(smoothstep(0.45,0.55,lum), step(t,lum), uDither);
  vec3 ink = mix(uInk, uAccent, clamp(uChroma*uBeat, 0.0, 1.0));
  vec3 duo = mix(uPaper, ink, v);
  // color path: pass content RGB through (contrast only)
  vec3 colr = clamp((inputColor.rgb-0.5)*uContrast + 0.5, 0.0, 1.0);
  vec3 col = mix(duo, colr, uColorMode);
  col *= uExposure;                                   // global brightness
  // soft-clip highlights on color comps (tames additive blowout); duotone themes (uColorMode 0) untouched
  col = mix(col, min(col, 0.85) + max(col-0.85, 0.0)/(1.0+max(col-0.85, 0.0)), uColorMode);
  // palette grade: remap luminance through the model-chosen gradient (the "designed" color look)
  if(uPaletteAmt > 0.001){ col = mix(col, paletteMap(dot(col, vec3(0.299,0.587,0.114))), uPaletteAmt); }
  // hue cycle (off by default): luma-preserving hue rotation, animated over time -> rainbows / drifting color
  if(uHue > 0.001){ float a = uTime*uHue*1.2 + uv.y*uHue*3.5; vec3 k = vec3(0.57735); col = clamp(col*cos(a) + cross(k,col)*sin(a) + k*dot(k,col)*(1.0-cos(a)), 0.0, 1.0); }
  // FX look layer (off by default): grayscale -> halftone dots -> scanlines
  col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, uSaturation);
  if(uDots > 0.001){
    float l2 = dot(col, vec3(0.299,0.587,0.114));
    float rad = 0.5*sqrt(clamp(l2,0.0,1.0));
    float dotm = smoothstep(rad+0.08, rad-0.08, length(fract(frag/6.0)-0.5));
    col = mix(col, col*mix(0.08, 1.0, dotm), uDots);
  }
  col *= 1.0 - uScan*0.55*(0.5+0.5*sin(frag.y*2.4 + uTime*1.5));
  // ascii: quantize into a per-cell dot-matrix glyph whose density tracks luminance (matrix / ascii art)
  if(uAscii > 0.001){
    float cs = 14.0;                                          // cell size (px) -> ~3px per glyph pixel
    vec2 ic = fract(frag/cs);
    float l = clamp(dot(col, vec3(0.299,0.587,0.114))*1.4, 0.0, 1.0);
    int gi = int(floor(l*8.999));                            // luminance -> glyph density (0 blank .. 8 dense)
    float on = asciiGlyph(gi, ivec2(floor(ic*5.0)));         // real character bitmap, lit by the field colour
    col = mix(col, col*on*1.35, uAscii);
  }
  // shared grain + vignette
  float g = fract(sin(dot(frag, vec2(12.9898,78.233)) + uTime)*43758.5453);
  col += (g-0.5)*uGrain;
  col *= 1.0 - uVignette*pow(length(uv-0.5)*1.4, 2.2);
  outputColor = vec4(clamp(col,0.0,1.0), inputColor.a);
}`;

const COMP_VERT = `precision highp float; in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`;
const COMP_FRAG = `precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D texPrev; uniform sampler2D texCur; uniform float uMix;
void main(){ fragColor = mix(texture(texPrev,vUv), texture(texCur,vUv), uMix); }`;

class StyleEffect extends Effect {
  constructor() {
    super('StyleEffect', STYLE_FRAG, {
      uniforms: new Map<string, any>([
        ['uPaper', new THREE.Uniform(new THREE.Color('#000'))],
        ['uInk', new THREE.Uniform(new THREE.Color('#fff'))],
        ['uAccent', new THREE.Uniform(new THREE.Color('#fff'))],
        ['uDither', new THREE.Uniform(0)], ['uGrain', new THREE.Uniform(0)],
        ['uVignette', new THREE.Uniform(0)], ['uContrast', new THREE.Uniform(1)], ['uChroma', new THREE.Uniform(0)],
        ['uExposure', new THREE.Uniform(1)],
        ['uBeat', new THREE.Uniform(0)], ['uLevel', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)], ['uRes', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['uColorMode', new THREE.Uniform(0)],
        ['uSaturation', new THREE.Uniform(1)], ['uPixelate', new THREE.Uniform(0)],
        ['uDots', new THREE.Uniform(0)], ['uScan', new THREE.Uniform(0)],
        ['uAscii', new THREE.Uniform(0)], ['uHue', new THREE.Uniform(0)],
        ['uPal0', new THREE.Uniform(new THREE.Color('#000'))], ['uPal1', new THREE.Uniform(new THREE.Color('#444'))],
        ['uPal2', new THREE.Uniform(new THREE.Color('#aaa'))], ['uPal3', new THREE.Uniform(new THREE.Color('#fff'))],
        ['uPaletteAmt', new THREE.Uniform(0)],
      ]),
    });
  }
}

// Zoom/radial blur — a convolution effect that smears outward from center (hyperspace streaks, speed).
// strength 0 = all taps land on the source = passthrough, so themes are unaffected when off.
const ZOOM_BLUR_FRAG = `uniform float strength;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 dir = uv - 0.5;
  vec4 sum = inputColor;
  for(int i=1;i<=8;i++){ float t=float(i)/8.0; sum += texture(inputBuffer, uv - dir*strength*t); }
  outputColor = sum/9.0;
}`;
class ZoomBlurEffect extends Effect {
  constructor() { super('ZoomBlurEffect', ZOOM_BLUR_FRAG, { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['strength', new THREE.Uniform(0)]]) }); }
}

type Slot = { mat: THREE.RawShaderMaterial; scene: THREE.Scene; rt: THREE.WebGLRenderTarget };
type ColorKey = 'paper' | 'ink' | 'accent';

const smoothstep01 = (x: number) => x * x * (3 - 2 * x);

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private effect: StyleEffect;
  private bloom!: BloomEffect;
  private chroma!: ChromaticAberrationEffect;
  private zoomBlur!: ZoomBlurEffect;
  private fxCur: FX = { ...DEFAULT_FX };
  private fxTarget: FX = { ...DEFAULT_FX };
  private palCur = [new THREE.Color('#000'), new THREE.Color('#444'), new THREE.Color('#aaa'), new THREE.Color('#fff')];
  private palTarget = [new THREE.Color('#000'), new THREE.Color('#444'), new THREE.Color('#aaa'), new THREE.Color('#fff')];
  private palAmtCur = 0;
  private palAmtTarget = 0;
  private cam = new THREE.Camera();
  private geo: THREE.BufferGeometry;
  private compMat: THREE.RawShaderMaterial;
  private compScene: THREE.Scene;

  private cur!: Slot;
  private prev: Slot | null = null;
  private xfade = 1;
  private probeRT: THREE.WebGLRenderTarget | null = null;  // tiny offscreen RT for the compile/brightness guard

  activeTheme!: Theme;
  private controls: ControlRuntime[] = [];
  private postCur: Record<PostName, number> = { uDither: 0, uGrain: 0, uVignette: 0, uContrast: 1, uChroma: 0, uExposure: 1 };
  private colorModeCur = 0;
  private colorCur: Record<ColorKey, THREE.Color> = { paper: new THREE.Color(), ink: new THREE.Color(), accent: new THREE.Color() };
  private override: Partial<Record<ColorKey, string>> = {};

  // GLOBAL look — persists across crossfadeTo (never reset per theme)
  private look: GlobalLook = { ...DEFAULT_LOOK };
  private clock = 0;   // speed-scaled time
  private lastT = -1;

  constructor(canvas: HTMLCanvasElement, initial: Theme) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

    this.compMat = new THREE.RawShaderMaterial({
      vertexShader: COMP_VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
      glslVersion: THREE.GLSL3,
      uniforms: { texPrev: { value: null }, texCur: { value: null }, uMix: { value: 1 } },
    });
    this.compScene = new THREE.Scene();
    const compMesh = new THREE.Mesh(this.geo, this.compMat); compMesh.frustumCulled = false;
    this.compScene.add(compMesh);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.compScene, this.cam));
    this.effect = new StyleEffect();
    this.composer.addPass(new EffectPass(this.cam, this.effect));
    // glow pass (own pass — bloom is a convolution effect). Passthrough at intensity 0 (default off).
    this.bloom = new BloomEffect({ luminanceThreshold: 0.45, luminanceSmoothing: 0.35, intensity: 0, mipmapBlur: true, radius: 0.75 });
    this.composer.addPass(new EffectPass(this.cam, this.bloom));
    // chromatic aberration (own convolution pass — offset 0 = passthrough, default off; radial = stronger at edges)
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.4 });
    this.composer.addPass(new EffectPass(this.cam, this.chroma));
    // zoom/radial blur (own convolution pass — strength 0 = passthrough, default off)
    this.zoomBlur = new ZoomBlurEffect();
    this.composer.addPass(new EffectPass(this.cam, this.zoomBlur));

    this.cur = this.makeSlot(initial);
    this.adopt(initial);
    this.colorCur.paper.set(initial.palette.paper);
    this.colorCur.ink.set(initial.palette.ink);
    this.colorCur.accent.set(initial.palette.accent ?? initial.palette.ink);
    this.resize();
  }

  private makeSlot(theme: Theme): Slot {
    const mat = new THREE.RawShaderMaterial({
      vertexShader: CONTENT_VERT, fragmentShader: buildContent(theme.content), depthTest: false, depthWrite: false,
      glslVersion: THREE.GLSL3,
      uniforms: {
        u_time: { value: 0 }, u_res: { value: new THREE.Vector2(1, 1) },
        u_bass: { value: 0 }, u_mid: { value: 0 }, u_treble: { value: 0 }, u_level: { value: 0 }, u_beat: { value: 0 },
        u_centroid: { value: 0 }, u_flux: { value: 0 }, u_energy: { value: 0 },
        u_k: { value: new Array(KNOB_COUNT).fill(0) },
        u_paper: { value: new THREE.Color() }, u_ink: { value: new THREE.Color() }, u_accent: { value: new THREE.Color() },
      },
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.geo, mat); mesh.frustumCulled = false;
    scene.add(mesh);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType });
    // seed content knob defaults so frame 1 is correct
    for (const c of theme.controls) if (c.bind.kind === 'content') mat.uniforms.u_k.value[c.bind.slot] = defaultValue(c);
    return { mat, scene, rt };
  }

  private adopt(theme: Theme) {
    this.activeTheme = theme;
    this.controls = theme.controls.map((c) => new ControlRuntime(c));
    this.override = {};
    this.fxTarget = { ...(theme.fx ?? DEFAULT_FX) };  // panel can override these live via setFx
    const gm = theme.gradeMap;
    if (gm) { gm.stops.forEach((s, i) => { if (i < 4) this.palTarget[i].set(s); }); this.palAmtTarget = gm.amount; }
    else this.palAmtTarget = 0;  // fade the grade out; keep last colors so the transition is smooth
    this.syncThemeDom();
  }

  /** Publish the active theme's ground (by resolved paper luminance) + palette to the DOM, so the
   *  CSS glass UI can adapt: dark-vibrancy glass + light ink on dark backgrounds. */
  private syncThemeDom() {
    if (typeof document === 'undefined') return;
    const p = new THREE.Color(this.colorHex('paper'));
    const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
    document.body.dataset.ground = (this.activeTheme.ground === 'dark' || lum < 0.4) ? 'dark' : 'paper';
    const s = document.documentElement.style;
    s.setProperty('--ink', this.colorHex('ink'));
    s.setProperty('--paper', this.colorHex('paper'));
    s.setProperty('--accent', this.colorHex('accent'));
  }

  // ---- the single write path (panel + Gemma) ----
  private rt(key: string) { return this.controls.find((r) => r.def.key === key); }
  setControl(key: string, value: number) { this.rt(key)?.set(value); }
  setToggle(key: string, on: boolean) { this.rt(key)?.set(on ? 1 : 0); }
  setChoice(key: string, index: number) { this.rt(key)?.set(index); }
  setColor(name: ColorKey, hex: string) { this.override[name] = hex; this.syncThemeDom(); }

  crossfadeTo(theme: Theme, transition?: Transition) {
    if (theme.id === this.activeTheme.id) return;
    this.prev = this.cur;           // outgoing slot keeps its frozen u_k, stays live via time/audio
    this.cur = this.makeSlot(theme);
    this.adopt(theme);              // sets fxTarget to the new theme's fx (the transition's "ending")
    this.xfade = 0;
    // spike the chosen transition's post-FX now; the per-frame FX easing decays each to fxTarget
    const tr = transition ?? TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)];
    for (const s of tr.spikes) this.fxCur[s.fx] = s.initial;
  }

  /** Compile + brightness guard for a candidate compose shader. Returns false if it won't compile
   *  or renders to a dead (black/flat) image — so a bad model graph (esp. custom GLSL) never reaches
   *  the screen. Caller keeps the live visual on false (non-destructive). */
  testContent(content: string): boolean {
    const frag = buildContent(content);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sh = gl.createShader(gl.FRAGMENT_SHADER);
    if (!sh) return true;                                   // can't probe -> don't block
    gl.shaderSource(sh, '#version 300 es\n' + frag);        // version must be the first line
    gl.compileShader(sh);
    const compiled = gl.getShaderParameter(sh, gl.COMPILE_STATUS) as boolean;
    if (!compiled) { console.warn('[compose] reject — shader compile error:\n' + gl.getShaderInfoLog(sh)); gl.deleteShader(sh); return false; }
    gl.deleteShader(sh);
    try {
      if (!this.probeRT) this.probeRT = new THREE.WebGLRenderTarget(48, 27, { type: THREE.UnsignedByteType }); // 8-bit so readPixels works with Uint8Array
      const mat = new THREE.RawShaderMaterial({
        vertexShader: CONTENT_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3,
        uniforms: {
          u_time: { value: 0 }, u_res: { value: new THREE.Vector2(48, 27) },
          u_bass: { value: 0 }, u_mid: { value: 0 }, u_treble: { value: 0 }, u_level: { value: 0 }, u_beat: { value: 0 },
        u_centroid: { value: 0 }, u_flux: { value: 0 }, u_energy: { value: 0 },
          u_k: { value: new Array(KNOB_COUNT).fill(0) },
          u_paper: { value: new THREE.Color() }, u_ink: { value: new THREE.Color() }, u_accent: { value: new THREE.Color() },
        },
      });
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(this.geo, mat); mesh.frustumCulled = false; scene.add(mesh);
      const buf = new Uint8Array(48 * 27 * 4);
      let alive = 0;
      for (const t of [0.4, 2.6]) {                          // sample two times (visible-at-silence rule)
        mat.uniforms.u_time.value = t;
        this.renderer.setRenderTarget(this.probeRT);
        this.renderer.render(scene, this.cam);
        this.renderer.readRenderTargetPixels(this.probeRT, 0, 0, 48, 27, buf);
        let sum = 0, sum2 = 0; const n = 48 * 27;
        for (let i = 0; i < n; i++) { const l = (buf[i * 4] * 0.299 + buf[i * 4 + 1] * 0.587 + buf[i * 4 + 2] * 0.114) / 255; sum += l; sum2 += l * l; }
        const mean = sum / n; const varc = Math.max(0, sum2 / n - mean * mean);
        alive = Math.max(alive, mean + varc * 6);            // bright OR has spatial structure
      }
      this.renderer.setRenderTarget(null);
      mat.dispose();
      return alive > 0.012;                                  // reject only genuinely dead frames
    } catch (e) { console.warn('[compose] probe error (allowing):', e); this.renderer.setRenderTarget(null); return true; }
  }

  /** Recolor in place: retarget the palette grade + post-FX WITHOUT rebuilding the content shader.
   *  The render loop eases palTarget/palAmtTarget/fxTarget, so the structure stays identical and only
   *  the colour/mood transitions — the "type just a colour" path. `stops4` = 4 resampled hex stops. */
  updateComposeColor(stops4: string[], amount: number, post?: Partial<FX>) {
    stops4.forEach((s, i) => { if (i < 4) this.palTarget[i].set(s); });
    this.palAmtTarget = amount;
    if (post) for (const k of FX_NAMES) if (typeof post[k] === 'number') this.fxTarget[k] = post[k] as number;
    this.activeTheme.gradeMap = { stops: stops4, amount };   // keep theme consistent for a later crossfade
    if (post) this.activeTheme.fx = { ...this.fxTarget };
  }

  /** Hot-swap the active theme's content + controls IN PLACE (no crossfade), preserving current
   *  knob values — used by HMR so editing a theme keeps the running theme + the playing audio. */
  hotSwapActive(theme: Theme) {
    this.cur.mat.fragmentShader = buildContent(theme.content);
    this.cur.mat.needsUpdate = true;
    const prev: Record<string, number> = {};
    for (const r of this.controls) prev[r.def.key] = r.target;
    this.activeTheme = theme;
    this.controls = theme.controls.map((c) => {
      const rt = new ControlRuntime(c);
      if (prev[c.key] !== undefined) rt.set(prev[c.key]); // keep the user's knob tweaks
      return rt;
    });
    this.cur.mat.uniforms.u_k.value.fill(0);
  }

  /** Apply controls/audio/palette. The caller resolves + crossfades the theme first (keeps the
   *  theme registry out of the engine so a theme edit only invalidates main for clean HMR). */
  applyDirector(cfg: DirectorConfig) {
    if (cfg.controls) {
      for (const [k, v] of Object.entries(cfg.controls)) {
        const r = this.rt(k); if (!r) continue;
        if (r.def.kind === 'toggle') r.set(v === true || v === 1 ? 1 : 0);
        else if (r.def.kind === 'choice') r.set(typeof v === 'number' ? v : Math.max(0, r.def.options.indexOf(String(v))));
        else r.set(Number(v));
      }
    }
    if (cfg.audio) for (const [k, m] of Object.entries(cfg.audio)) { const r = this.rt(k); if (r) r.audio = m; }
    if (cfg.palette) { for (const [n, h] of Object.entries(cfg.palette)) if (h) this.override[n as ColorKey] = h; this.syncThemeDom(); }
    if (cfg.look) this.setLook(cfg.look);
  }

  // ---- global look (persists across themes) ----
  setLook(p: Partial<GlobalLook>) {
    for (const lp of LOOK_PARAMS) {
      const v = p[lp.key];
      if (v !== undefined) this.look[lp.key] = Math.max(lp.min, Math.min(lp.max, v));
    }
  }
  getLook(): GlobalLook { return { ...this.look }; }

  // ---- post-FX look layer (manual panel + compose graphs) ----
  setFx(name: keyof FX, value: number) { this.fxTarget[name] = value; }
  getFx(): FX { return { ...this.fxTarget }; }

  // ---- panel reads ----
  controlTarget(key: string): number { return this.rt(key)?.target ?? 0; }
  colorNames(): ColorKey[] { return this.activeTheme.palette.accent ? ['paper', 'ink', 'accent'] : ['paper', 'ink']; }
  colorHex(name: ColorKey): string {
    return this.override[name] ?? (name === 'accent' ? (this.activeTheme.palette.accent ?? this.activeTheme.palette.ink) : this.activeTheme.palette[name]);
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.cur.rt.setSize(size.x, size.y);
    this.prev?.rt.setSize(size.x, size.y);
    this.effect.uniforms.get('uRes')!.value.set(size.x, size.y);
  }

  private shared(slot: Slot, f: AudioFeatures, time: number, size: THREE.Vector2) {
    const u = slot.mat.uniforms;
    u.u_time.value = time; u.u_res.value.set(size.x, size.y);
    u.u_bass.value = f.bass; u.u_mid.value = f.mid; u.u_treble.value = f.treble; u.u_level.value = f.level; u.u_beat.value = f.beat;
    u.u_centroid.value = f.centroid; u.u_flux.value = f.flux; u.u_energy.value = f.energy;
  }

  render(f: AudioFeatures, time: number) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    // global SPEED -> a clock advancing by dt*speed (no jumps when speed changes)
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, time - this.lastT));
    this.lastT = time;
    this.clock += dt * this.look.speed;

    // global REACTIVITY -> scale audio for both content uniforms and control mods
    const R = this.look.reactivity;
    const cl = (x: number) => Math.max(0, Math.min(1.4, x * R)); // cap so the reactivity knob can't over-drive into blow-out
    const fa: AudioFeatures = { bass: cl(f.bass), mid: cl(f.mid), treble: cl(f.treble), level: cl(f.level), beat: cl(f.beat), centroid: cl(f.centroid), flux: cl(f.flux), energy: cl(f.energy) };

    this.shared(this.cur, fa, this.clock, size);
    if (this.prev) this.shared(this.prev, fa, this.clock, size);

    // film grade = theme baseline x global Look; dither/chroma stay theme-scoped (from controls)
    const grade = this.activeTheme.grade ?? DEFAULT_GRADE;
    const postTarget: Record<PostName, number> = {
      uDither: 0,
      uChroma: 0,
      uGrain: grade.grain * this.look.grain,
      uContrast: grade.contrast * this.look.contrast,
      uVignette: Math.min(1, grade.vignette * this.look.vignette),
      uExposure: this.look.exposure,
    };
    for (const r of this.controls) {
      r.step();
      const v = r.value(fa);
      if (r.def.bind.kind === 'content') this.cur.mat.uniforms.u_k.value[r.def.bind.slot] = v;
      else postTarget[r.def.bind.name] = v; // theme-scoped post controls only (dither / chroma)
    }

    // ease post + colors (smooth across in-theme changes AND theme switches)
    const eu = this.effect.uniforms;
    for (const k of POST_NAMES) { this.postCur[k] += (postTarget[k] - this.postCur[k]) * 0.08; eu.get(k)!.value = this.postCur[k]; }
    const tgt = { paper: new THREE.Color(this.colorHex('paper')), ink: new THREE.Color(this.colorHex('ink')), accent: new THREE.Color(this.colorHex('accent')) };
    this.colorCur.paper.lerp(tgt.paper, 0.08); this.colorCur.ink.lerp(tgt.ink, 0.08); this.colorCur.accent.lerp(tgt.accent, 0.08);
    eu.get('uPaper')!.value.copy(this.colorCur.paper);
    eu.get('uInk')!.value.copy(this.colorCur.ink);
    eu.get('uAccent')!.value.copy(this.colorCur.accent);
    eu.get('uTime')!.value = this.clock; eu.get('uBeat')!.value = fa.beat; eu.get('uLevel')!.value = fa.level;

    // ease the FX look layer toward the active theme's fx (off by default) and drive the post-FX
    for (const k of FX_NAMES) this.fxCur[k] += (this.fxTarget[k] - this.fxCur[k]) * 0.08;
    eu.get('uSaturation')!.value = 1 - this.fxCur.grayscale;
    eu.get('uPixelate')!.value = this.fxCur.pixelate > 0.01 ? 2 + this.fxCur.pixelate * 10 : 0; // gentle — max ~12px blocks
    eu.get('uDots')!.value = this.fxCur.dots;
    eu.get('uScan')!.value = this.fxCur.scanlines;
    eu.get('uAscii')!.value = this.fxCur.ascii;
    eu.get('uHue')!.value = this.fxCur.hue;
    this.bloom.intensity = this.fxCur.bloom * 1.5;
    this.chroma.offset.set(this.fxCur.chroma * 0.006, this.fxCur.chroma * 0.003);
    this.zoomBlur.uniforms.get('strength')!.value = this.fxCur.radialBlur * 0.25;
    for (let i = 0; i < 4; i++) this.palCur[i].lerp(this.palTarget[i], 0.08);
    this.palAmtCur += (this.palAmtTarget - this.palAmtCur) * 0.08;
    eu.get('uPal0')!.value.copy(this.palCur[0]); eu.get('uPal1')!.value.copy(this.palCur[1]);
    eu.get('uPal2')!.value.copy(this.palCur[2]); eu.get('uPal3')!.value.copy(this.palCur[3]);
    eu.get('uPaletteAmt')!.value = this.palAmtCur;

    // ease duotone<->color mode + feed palette into content shaders (color-mode themes use it)
    this.colorModeCur += ((this.activeTheme.mode === 'color' ? 1 : 0) - this.colorModeCur) * 0.08;
    eu.get('uColorMode')!.value = this.colorModeCur;
    for (const s of [this.cur, this.prev]) {
      if (!s) continue;
      s.mat.uniforms.u_paper.value.copy(this.colorCur.paper);
      s.mat.uniforms.u_ink.value.copy(this.colorCur.ink);
      s.mat.uniforms.u_accent.value.copy(this.colorCur.accent);
    }

    // render content -> targets, dissolve outgoing into incoming (duration = global transition)
    this.renderer.setRenderTarget(this.cur.rt);
    this.renderer.render(this.cur.scene, this.cam);
    let mix = 1;
    if (this.xfade < 1 && this.prev) {
      this.xfade = Math.min(1, this.xfade + dt / Math.max(0.1, this.look.transition));
      this.renderer.setRenderTarget(this.prev.rt);
      this.renderer.render(this.prev.scene, this.cam);
      mix = smoothstep01(this.xfade);
    }
    this.renderer.setRenderTarget(null);

    this.compMat.uniforms.texPrev.value = (this.prev ?? this.cur).rt.texture;
    this.compMat.uniforms.texCur.value = this.cur.rt.texture;
    this.compMat.uniforms.uMix.value = mix;
    this.composer.render();

    if (this.xfade >= 1 && this.prev) { this.prev.rt.dispose(); this.prev = null; }
  }
}
