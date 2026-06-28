// The Theme contract + the global/theme-scoped parameter model.
//
// TWO TIERS:
//  - THEME-SCOPED (`controls`, `grade`, `palette`): describe the theme's FORM and identity.
//    They change when you switch themes.
//  - GLOBAL (`GlobalLook`): the show's camera/film-grade + audio/motion feel. Set once, persist
//    across theme switches. Gemma sets these via DirectorConfig.look (separate from controls).

export type AudioSrc = 'bass' | 'mid' | 'treble' | 'level' | 'beat';
export type AudioMod = { src: AudioSrc; amount: number };

// post-stack uniforms the engine drives
export type PostName = 'uDither' | 'uGrain' | 'uVignette' | 'uContrast' | 'uChroma' | 'uExposure';
export type Bind = { kind: 'content'; slot: number } | { kind: 'post'; name: PostName };

type Base = { key: string; label: string; bind: Bind; smoothing?: number };

/** Continuous magnitude. Eases to its target. */
export type SliderControl = Base & { kind: 'slider'; min: number; max: number; default: number; audio?: AudioMod };
/** On/off, stored as an eased 0..1 so it fades, never snaps. */
export type ToggleControl = Base & { kind: 'toggle'; default: boolean; audio?: AudioMod };
/** Discrete modes, stored as an eased float index; the shader blends adjacent options. */
export type ChoiceControl = Base & { kind: 'choice'; options: string[]; default: number };

export type Control = SliderControl | ToggleControl | ChoiceControl;

export type Palette = { paper: string; ink: string; accent?: string };

/** Post-FX "look" layer, 0..1 each (pixelate is 0=off). Default off — existing themes are unaffected. */
export type FX = { bloom: number; grayscale: number; pixelate: number; dots: number; scanlines: number; ascii: number; hue: number; chroma: number; radialBlur: number };
export const DEFAULT_FX: FX = { bloom: 0, grayscale: 0, pixelate: 0, dots: 0, scanlines: 0, ascii: 0, hue: 0, chroma: 0, radialBlur: 0 };
export const FX_NAMES: (keyof FX)[] = ['bloom', 'grayscale', 'pixelate', 'dots', 'scanlines', 'ascii', 'hue', 'chroma', 'radialBlur'];

/** Per-theme film-grade BASELINE (its identity). The global Look multiplies these. */
export type Grade = { grain: number; contrast: number; vignette: number };
export const DEFAULT_GRADE: Grade = { grain: 0, contrast: 1, vignette: 0.3 };

export interface Theme {
  id: string;
  name: string;
  prompt: string;            // signature prompt shown on the landing screen when this theme loads
  ground: 'paper' | 'dark';
  mode: 'duotone' | 'color'; // duotone: render() returns luminance; color: returns final RGB
  content: string;           // GLSL: vec3 render(vec2 uv) using audio uniforms + u_k[] (+ u_paper/u_ink/u_accent in color mode)
  controls: Control[];       // THEME-SCOPED form knobs
  palette: Palette;
  grade?: Grade;             // THEME-SCOPED film baseline (global Look multiplies it)
  fx?: FX;                   // optional post-FX look layer (bloom/grayscale/pixelate/dots/scanlines); off if absent
  gradeMap?: { stops: string[]; amount: number }; // optional palette grade: 4 hex stops remapped over luminance
}

// ---- GLOBAL look: one set, persists across every theme switch ----
export type GlobalLook = {
  exposure: number;   // master brightness (absolute, 1 = neutral)
  contrast: number;   // x theme grade
  grain: number;      // x theme grade (film grain)
  vignette: number;   // x theme grade
  reactivity: number; // global audio gain — how hard everything reacts
  speed: number;      // global motion-rate multiplier
  transition: number; // theme crossfade duration, seconds
};

export const DEFAULT_LOOK: GlobalLook = {
  exposure: 1, contrast: 1, grain: 1, vignette: 1, reactivity: 1, speed: 0.1, transition: 1,
};

export type LookParam = { key: keyof GlobalLook; label: string; min: number; max: number; desc: string };

/** Single source of truth for the global Look knobs — drives the Look panel AND Gemma's schema. */
export const LOOK_PARAMS: LookParam[] = [
  { key: 'exposure', label: 'exposure', min: 0.3, max: 2.0, desc: 'global brightness (1 = neutral)' },
  { key: 'contrast', label: 'contrast', min: 0.5, max: 2.0, desc: "global contrast x each theme's baseline" },
  { key: 'grain', label: 'grain', min: 0.0, max: 2.0, desc: "global film grain x each theme's baseline" },
  { key: 'vignette', label: 'vignette', min: 0.0, max: 2.0, desc: "global vignette x each theme's baseline" },
  { key: 'reactivity', label: 'reactivity', min: 0.0, max: 2.0, desc: 'how hard ALL visuals react to audio' },
  { key: 'speed', label: 'speed', min: 0.1, max: 3.0, desc: 'global motion speed (1 = normal)' },
  { key: 'transition', label: 'transition', min: 0.2, max: 4.0, desc: 'theme crossfade duration, seconds' },
];
