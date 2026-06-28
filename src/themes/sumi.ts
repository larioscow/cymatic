import type { Theme } from './types';

// Sumi Breath — black ink wash breathing on light paper. Reworked: corrected the duotone
// mapping (paper bright, ink dark — was inverted), soft wet-into-dry brush lobes, paper-fiber
// granulation, ink visible at rest with bass swelling saturation.
export const sumi: Theme = {
  id: 'sumi',
  name: 'Sumi Breath',
  prompt: 'Sumi ink breathing in wet brush strokes, bleeding slow across rice paper.',
  ground: 'paper',
  mode: 'duotone',
  content: `float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec3 render(vec2 uv){
  vec2 p = uv;
  float t = u_time * (0.04 + u_k[2]*0.18);
  float ink = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t*0.7 + fi*2.1)*0.32, cos(t*0.6 + fi*1.6)*0.26);
    vec2 wp = p - c;
    wp += 0.14 * vec2(sin(p.y*3.0 + t + fi), cos(p.x*3.0 - t));
    wp.x *= 1.7;                              // elongate into vertical brush strokes
    float r = length(wp);
    float size = 0.05 + u_k[1]*0.24;          // smaller -> distinct strokes + negative space
    ink += smoothstep(size, size*0.1, r);    // soft wet-into-dry lobe
  }
  ink = clamp(ink, 0.0, 1.0);
  ink *= clamp(u_k[0] * (0.55 + 0.6*u_bass), 0.0, 1.0);   // wetness, bass swells
  ink += u_beat * 0.18 * smoothstep(0.5, 0.0, length(p)); // beat lands a stroke
  ink = clamp(ink, 0.0, 1.0);
  float fiber = h21(floor(p*240.0)) * 0.10 * ink;          // granulation within the ink
  return vec3(clamp(ink*0.95 + fiber, 0.0, 1.0));          // mark HIGH -> ink: dark ink on light paper
}`,
  palette: { paper: '#F3EAD8', ink: '#14110D', accent: '#C0392B' },
  controls: [
    { kind: 'slider', key: 'wetness', label: 'wetness', min: 0, max: 1, default: 0.7, bind: { kind: 'content', slot: 0 }, audio: { src: 'bass', amount: 0.2 } },
    { kind: 'slider', key: 'brushSize', label: 'brush size', min: 0, max: 1, default: 0.5, bind: { kind: 'content', slot: 1 } },
    { kind: 'slider', key: 'drift', label: 'drift', min: 0, max: 1, default: 0.3, bind: { kind: 'content', slot: 2 } },
  ],
  grade: { grain: 0.04, contrast: 1.1, vignette: 0.3 },
};
