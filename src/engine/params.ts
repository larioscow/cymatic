// The smoothing runtime: every control (slider / toggle / choice) is one of these. The whole
// "nothing ever snaps" guarantee lives here — target is set instantly, cur eases toward it,
// and audio modulation is added per frame on top.

import type { Control, AudioMod } from '../themes/types';
import type { AudioFeatures } from '../audio';

export function defaultValue(def: Control): number {
  if (def.kind === 'toggle') return def.default ? 1 : 0;
  return def.default; // slider value, or choice index
}

const SMOOTH: Record<Control['kind'], number> = { slider: 0.08, toggle: 0.14, choice: 0.05 };

export class ControlRuntime {
  target: number;
  cur: number;
  audio?: AudioMod;

  constructor(public def: Control) {
    this.target = defaultValue(def);
    this.cur = this.target;
    this.audio = def.kind === 'choice' ? undefined : def.audio;
  }

  set(target: number) { this.target = target; }

  step() {
    const s = this.def.smoothing ?? SMOOTH[this.def.kind];
    this.cur += (this.target - this.cur) * s;
  }

  /** Eased base + automatic audio modulation = the value written to the uniform this frame. */
  value(a: AudioFeatures): number {
    const mod = this.audio ? this.audio.amount * a[this.audio.src] : 0;
    return this.cur + mod;
  }
}
