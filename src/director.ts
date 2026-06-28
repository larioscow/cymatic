// The "VJ director" = how a model controls CONTOUR. Given a prompt (+ optional frame + the
// active theme's JSON schema) it returns a DirectorConfig { theme, controls, look, palette }.
// MockDirector runs offline (keyword heuristics). RealDirector hits /api/direct with a provider
// ('cerebras' | 'compare') so you can A/B Cerebras speed vs another provider on the same request.

import type { DirectorConfig } from './engine/engine';

export type DirEvent =
  | { type: 'agent'; name: string; msg: string }
  | { type: 'config'; cfg: DirectorConfig }
  | { type: 'error'; msg: string };

export type DirectorCtx = { currentTheme: string; schema?: object; frame?: string };

export interface Director {
  direct(prompt: string, ctx: DirectorCtx, on: (e: DirEvent) => void, signal?: AbortSignal): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const has = (p: string, re: RegExp) => re.test(p);

export class MockDirector implements Director {
  async direct(prompt: string, _ctx: DirectorCtx, on: (e: DirEvent) => void) {
    const p = prompt.toLowerCase();
    const moire = has(p, /moir|grid|op.?art|weave|kinetic|optical|lattice/);
    const cymatic = has(p, /cymatic|sand|chladni|nodal|plate/);
    const sumi = has(p, /sumi|ink|wash|brush|zen/);
    const obra = has(p, /obra|stipple|blob|dither|metaball/);
    // default is the topographic "contour" theme — the initial prompt stays topographic
    const theme = moire ? 'moire' : cymatic ? 'cymatic' : sumi ? 'sumi' : obra ? 'obra' : 'contour';
    const controls: Record<string, number | boolean | string> = {};
    const palette: DirectorConfig['palette'] = {};
    const look: NonNullable<DirectorConfig['look']> = {};

    if (theme === 'contour') {
      if (has(p, /turbulent|chaos|storm|wild/)) controls.field = 'turbulent';
      else if (has(p, /swirl|vortex|whirl|current/)) controls.field = 'swirl';
      else if (has(p, /calm|smooth|gentle/)) controls.field = 'calm';
      if (has(p, /dense|tight|fine/)) controls.density = 0.85;
      if (has(p, /sparse|open|wide/)) controls.density = 0.25;
    } else if (theme === 'moire') {
      if (has(p, /radial/)) controls.weave = 'radial';
      else if (has(p, /diagonal|diamond/)) controls.weave = 'diagonal';
      if (has(p, /dense|tight/)) controls.gridFreq = 74;
    }

    if (has(p, /dark|night|void|black|midnight/)) { palette.paper = '#07080C'; palette.ink = '#6CC6FF'; }
    else if (has(p, /warm|sun|amber|gold/)) { palette.paper = '#EFE9DC'; palette.ink = '#2B2620'; }
    else if (has(p, /neon|acid|toxic/)) { palette.paper = '#0A0B0E'; palette.ink = '#B6FF3C'; palette.accent = '#FF36C6'; }
    else if (has(p, /red|blood|crimson/)) { palette.accent = '#C2452D'; palette.ink = '#3A1E12'; }

    if (has(p, /grain|gritty|rough/)) look.grain = 1.7;
    if (has(p, /fast|energetic|hype|hard|drop/)) { look.speed = 1.4; look.reactivity = 1.5; }
    if (has(p, /slow|calm|chill|ambient|gentle/)) { look.speed = 0.4; look.reactivity = 0.8; }
    if (has(p, /bright/)) look.exposure = 1.3;
    if (has(p, /dark|moody/)) look.exposure = 0.85;

    on({ type: 'agent', name: 'mock', msg: `→ ${theme}` });
    await sleep(120);
    on({ type: 'config', cfg: { theme, controls, look: Object.keys(look).length ? look : undefined, palette: Object.keys(palette).length ? palette : undefined } });
  }
}

export class RealDirector implements Director {
  constructor(private provider: 'cerebras' | 'compare') {}
  async direct(prompt: string, ctx: DirectorCtx, on: (e: DirEvent) => void, signal?: AbortSignal) {
    try {
      const res = await fetch('/api/direct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, schema: ctx.schema, provider: this.provider, frame: ctx.frame }),
        signal,
      });
      const j = await res.json();
      if (!res.ok || j.error) { on({ type: 'error', msg: j.error || `HTTP ${res.status}` }); return; }
      on({ type: 'agent', name: 'latency', msg: `${j.provider} ${j.model} · ${j.ms}ms` });
      on({ type: 'config', cfg: j.config as DirectorConfig });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return; // newer keystroke won — expected
      on({ type: 'error', msg: String(e) });
    }
  }
}
