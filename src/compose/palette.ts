// Extract a 4-stop dark->bright palette from a reference image via median-cut.
// Used by the image->theme path: the EXACT colours come from the pixels (fidelity); Gemma decides
// structure. Median-cut on a real photo naturally yields a shadow->highlight ramp (the darkest
// bucket -> floor, the brightest -> ceiling) which is what the palette-grade wants.
type RGB = [number, number, number];

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (c: RGB) => '#' + c.map((v) => clampByte(v).toString(16).padStart(2, '0')).join('');
const luma = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;
// Push colour away from its own grey (luma) by k — re-saturates without shifting hue or luminance
// (luma is the fixed point, so the dark->bright order is preserved). Counters median-cut's averaging.
const boostSat = (c: RGB, k: number): RGB => { const l = luma(c); return c.map((v) => clampByte(l + (v - l) * k)) as unknown as RGB; };
const avg = (px: RGB[]): RGB => {
  const s = px.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]] as RGB, [0, 0, 0] as RGB);
  return [s[0] / px.length, s[1] / px.length, s[2] / px.length];
};

// Recursively split the pixel set along its widest colour axis at the median -> 2^depth buckets.
function medianCut(px: RGB[], depth: number): RGB[] {
  if (depth === 0 || px.length <= 1) return px.length ? [avg(px)] : [];
  const lo: RGB = [255, 255, 255], hi: RGB = [0, 0, 0];
  for (const p of px) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
  const ch = [0, 1, 2].reduce((best, c) => (hi[c] - lo[c] > hi[best] - lo[best] ? c : best), 0);
  px.sort((a, b) => a[ch] - b[ch]);
  const mid = px.length >> 1;
  return [...medianCut(px.slice(0, mid), depth - 1), ...medianCut(px.slice(mid), depth - 1)];
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hexToRgb = (h: string): RGB | null => {
  const s = (h || '').replace('#', '').trim(); if (s.length !== 6) return null;
  const n = parseInt(s, 16); return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Guard a palette so its brightest stop can never be near-black — used on the RECOLOR path (which has
 *  no render probe) so a dark delta palette (e.g. typing "black"/"darker") can't fade the scene to black. */
export function litStops(stops: string[]): string[] {
  const rgb = stops.map(hexToRgb).filter(Boolean) as RGB[];
  if (!rgb.length) return stops;
  let bi = 0; rgb.forEach((c, i) => { if (luma(c) > luma(rgb[bi])) bi = i; });
  const cl = luma(rgb[bi]);
  if (cl < 140) { const f = Math.min(0.85, (140 - cl) / (255 - cl)); rgb[bi] = rgb[bi].map((v) => clampByte(v + (255 - v) * f)) as unknown as RGB; }
  return rgb.map(toHex);
}

/** Pure core (testable without a canvas): pixels -> 4 hex stops, dark->bright, vivid + representative.
 *  Quantise DEEP (16 buckets) so distinct hues survive averaging, then pick a MAXIMALLY-DISTINCT set:
 *  anchor the value range with the darkest+brightest buckets, then farthest-point-add the 2 colours
 *  most different from what's chosen — so a defining but low-saturation region (a hazy sky) still lands,
 *  instead of two redundant tones. Finally re-saturate (averaging dulls) and guard the ceiling. */
export function paletteFromPixels(pixels: RGB[]): string[] {
  if (!pixels.length) return [];
  const buckets = medianCut(pixels.slice(), 4); // up to 16 representative colours
  const byLuma = buckets.slice().sort((a, b) => luma(a) - luma(b));
  const picked: RGB[] = [byLuma[0], byLuma[byLuma.length - 1]];          // anchor the dark->bright value range
  while (picked.length < 4 && picked.length < buckets.length) {
    let best = byLuma[0], bestD = -1;
    for (const b of buckets) { const d = Math.min(...picked.map((p) => dist2(p, b))); if (d > bestD) { bestD = d; best = b; } }
    picked.push(best);
  }
  while (picked.length < 4) picked.push(picked[picked.length - 1] ?? [128, 128, 128]);
  let cols = picked.slice(0, 4).sort((a, b) => luma(a) - luma(b));
  cols = cols.map((c) => boostSat(c, 1.3));                              // averaging dulls colour; nudge it back (luma-preserving)
  // Ceiling guard: push the brightest stop toward white until it clears the engine's brightness probe.
  const cl = luma(cols[3]);
  if (cl < 150) { const f = Math.min(0.85, (150 - cl) / (255 - cl)); cols[3] = cols[3].map((v) => clampByte(v + (255 - v) * f)) as unknown as RGB; }
  return cols.map(toHex);
}

/** Read an image drawn on a canvas and return its 4-stop palette. */
export function extractPalette(canvas: HTMLCanvasElement): string[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;                     // skip transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return paletteFromPixels(pixels);
}
