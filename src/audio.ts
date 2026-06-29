import { guess } from 'web-audio-beat-detector';

// Audio via an <audio> element (gives play/pause/seek/time/duration for the transport UI) routed
// through an AnalyserNode for the live FFT features the shaders react to. BPM is computed offline
// from the decoded buffer once on load and seeds the global `speed`.

export type AudioFeatures = {
  bass: number; mid: number; treble: number; level: number; beat: number;
  centroid: number; flux: number; energy: number;
};
export const SILENT: AudioFeatures = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0, centroid: 0, flux: 0, energy: 0 };

// In-place iterative radix-2 FFT (complex). Used offline to build per-frame spectral features.
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Offline section/drop detection (Foote novelty), computed once from the decoded buffer so the whole
// scene-change timeline is known UP FRONT — painted on the seek bar and used to land scenes ON the drops.
// Method: per-frame log-band spectral features -> self-similarity (cosine) -> correlate a Gaussian
// checkerboard kernel along the diagonal -> novelty peaks = section boundaries (verse/chorus/drop).
function analyzeSections(buf: AudioBuffer): number[] {
  const ch = buf.getChannelData(0), sr = buf.sampleRate;
  const FR = 0.5, hop = Math.floor(sr * FR), N = 2048, BANDS = 24;
  const M = Math.floor((ch.length - N) / hop);
  if (M < 24) return [];
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.floor((N / 2) * (b / BANDS) ** 2)); // quadratic -> finer in the bass
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  const feats: Float64Array[] = [];
  for (let f = 0; f < M; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) { re[i] = ch[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const v = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) { let s = 0; const hi = Math.max(edges[b] + 1, edges[b + 1]); for (let k = edges[b]; k < hi; k++) s += re[k] * re[k] + im[k] * im[k]; v[b] = Math.log1p(s); }
    feats.push(v);                                               // raw log-band energies (keep dynamics — don't normalize away loudness)
  }
  for (let b = 0; b < BANDS; b++) {                              // z-score each band across the track so ENERGY changes (drops/breakdowns) register, not just timbre
    let m = 0; for (let f = 0; f < M; f++) m += feats[f][b]; m /= M;
    let sd = 0; for (let f = 0; f < M; f++) sd += (feats[f][b] - m) ** 2; sd = Math.sqrt(sd / M) || 1;
    for (let f = 0; f < M; f++) feats[f][b] = (feats[f][b] - m) / sd;
  }
  // similarity from Euclidean distance (Gaussian) — captures both timbre AND energy change
  const sim = (i: number, j: number) => { if (i < 0 || j < 0 || i >= M || j >= M) return 0; const a = feats[i], b = feats[j]; let d = 0; for (let k = 0; k < BANDS; k++) { const e = a[k] - b[k]; d += e * e; } return Math.exp(-d / (2 * BANDS)); };
  const L = Math.min(16, Math.floor(M / 4));                      // half-kernel ~8s -> section-level transitions
  const sig = L * 0.5;
  const nov = new Float64Array(M);
  for (let c = 0; c < M; c++) {
    let acc = 0;
    for (let a = -L; a < L; a++) for (let b = -L; b < L; b++) { const sign = ((a < 0) === (b < 0)) ? 1 : -1; acc += sign * Math.exp(-(a * a + b * b) / (2 * sig * sig)) * sim(c + a, c + b); }
    nov[c] = acc;
  }
  let mn = Infinity, mx = -Infinity; for (const x of nov) { if (x < mn) mn = x; if (x > mx) mx = x; }
  const range = mx - mn || 1; const nc = Array.from(nov, (x) => (x - mn) / range);
  const mean = nc.reduce((a, b) => a + b, 0) / nc.length;
  const std = Math.sqrt(nc.reduce((a, b) => a + (b - mean) ** 2, 0) / nc.length);
  const minGap = Math.round(8 / FR), floor = mean + 0.15 * std;   // local-max peak-picking + a modest floor
  const out: number[] = [];
  for (let i = L; i < M - L; i++) {
    if (nc[i] < floor) continue;
    let isPeak = true;
    for (let k = Math.max(L, i - minGap); k <= Math.min(M - L - 1, i + minGap); k++) { if (nc[k] > nc[i]) { isPeak = false; break; } }
    if (isPeak) out.push(+(i * FR).toFixed(2));
  }
  return out;
}

export class AudioEngine {
  private ctx = new AudioContext();
  private el = new Audio();
  private analyser: AnalyserNode;
  private freq: Uint8Array<ArrayBuffer>;
  private src: MediaElementAudioSourceNode | null = null;
  private bassAvg = 0;
  private beatEnv = 0;
  private levelAvg = 0;
  private sectionsArr: number[] = [];   // section/drop times (s), computed offline on load

  bpm = 0;
  beatOffset = 0;

  constructor() {
    this.el.loop = false;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Load a file: wire it for playback + analysis, then detect BPM offline. */
  async load(file: File) {
    this.el.src = URL.createObjectURL(file);
    if (!this.src) {
      this.src = this.ctx.createMediaElementSource(this.el); // once per element
      this.src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    await this.ctx.resume();

    // BPM + section timeline run after, on the decoded buffer (doesn't block playback)
    this.bpm = 0;
    this.beatOffset = 0;
    this.sectionsArr = [];
    try {
      const data = await file.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(data);
      this.sectionsArr = analyzeSections(buf);                 // the whole drop/section timeline, known up front
      const { bpm, offset } = await guess(buf);
      this.bpm = bpm;
      this.beatOffset = offset;
    } catch {
      // no detectable beat / undecodable — leave bpm 0 + no sections
    }
  }

  async play() { await this.ctx.resume(); return this.el.play(); }
  pause() { this.el.pause(); }
  toggle() { if (this.el.paused) this.play(); else this.pause(); }
  setLoop(v: boolean) { this.el.loop = v; }
  get looping() { return this.el.loop; }
  seekFrac(frac: number) { if (this.el.duration) this.el.currentTime = Math.max(0, Math.min(1, frac)) * this.el.duration; }
  onEnded(cb: () => void) { this.el.addEventListener('ended', cb); }
  get playing() { return !this.el.paused; }
  get time() { return this.el.currentTime || 0; }
  get duration() { return this.el.duration || 0; }
  get loaded() { return !!this.el.src; }
  /** Section/drop times (s) for the whole track, detected offline on load — the scene-change timeline. */
  get sections() { return this.sectionsArr; }

  features(): AudioFeatures {
    this.analyser.getByteFrequencyData(this.freq);
    const n = this.freq.length;
    const band = (lo: number, hi: number) => {
      let sum = 0, count = 0;
      for (let i = Math.floor(lo * n); i < Math.floor(hi * n); i++) { sum += this.freq[i]; count++; }
      return count ? sum / count / 255 : 0;
    };
    const bass = band(0, 0.08);
    const mid = band(0.08, 0.35);
    const treble = band(0.35, 1);
    const level = (bass + mid + treble) / 3;

    const flux = Math.max(0, bass - this.bassAvg);
    this.bassAvg = this.bassAvg * 0.9 + bass * 0.1;
    if (flux > 0.06) this.beatEnv = 1;
    this.beatEnv *= 0.88;
    this.levelAvg = this.levelAvg * 0.95 + level * 0.05;          // sustained energy (slow EMA)

    // spectral centroid (brightness): normalized weighted-mean bin position 0..1
    let wsum = 0, msum = 0;
    for (let i = 0; i < n; i++) { wsum += i * this.freq[i]; msum += this.freq[i]; }
    const centroid = msum > 0 ? (wsum / msum) / n : 0;

    return { bass, mid, treble, level, beat: this.beatEnv, centroid, flux: Math.min(1, flux * 4), energy: this.levelAvg };
  }
}
