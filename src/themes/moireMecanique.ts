import type { Theme } from './types';

// Moiré Mécanique — two line-gratings beating into living op-art interference.
// Demonstrates: sliders (freq/rotate/lineWidth/contrast), a choice (weave: square | diagonal
// | radial) blended in-shader, and a toggle (beat chroma).
export const moireMecanique: Theme = {
  id: 'moire',
  name: 'Moiré Mécanique',
  prompt: 'Two line grids beating into restless moiré, op-art interference in oxblood and bone.',
  ground: 'dark',
  mode: 'duotone',
  content: `vec3 render(vec2 uv){
  float a = u_time * u_k[1];
  float weave = clamp(u_k[3], 0.0, 2.0); // 0 square, 1 diagonal, 2 radial (eased)
  vec2 p = uv * 1.2;
  float g1 = sin(p.y*u_k[0] + 7.0*sin(p.x*2.5 + u_time*0.5) + u_bass*5.0);
  float ang = mix(0.0, 0.7853, clamp(weave, 0.0, 1.0)); // square -> diagonal
  float ca = cos(a + ang), sa = sin(a + ang);
  vec2 q = mat2(ca, -sa, sa, ca) * p;
  float gCart = sin(q.y*(u_k[0]*1.07) + u_treble*9.0);
  float gRad  = sin(length(p)*u_k[0]*0.6 - u_time);
  float g2 = mix(gCart, gRad, clamp(weave - 1.0, 0.0, 1.0)); // diagonal -> radial
  float m = g1 * g2;
  float line = smoothstep(0.0, u_k[2], abs(m));
  return vec3(line);
}`,
  palette: { paper: '#EDE6D6', ink: '#161310', accent: '#5C1A1A' },
  controls: [
    { kind: 'slider', key: 'gridFreq', label: 'grid frequency', min: 20, max: 80, default: 36, bind: { kind: 'content', slot: 0 }, audio: { src: 'bass', amount: 6 } },
    { kind: 'slider', key: 'rotate', label: 'rotate speed', min: 0.0, max: 0.6, default: 0.15, bind: { kind: 'content', slot: 1 } },
    { kind: 'slider', key: 'lineWidth', label: 'line width', min: 0.02, max: 0.20, default: 0.13, bind: { kind: 'content', slot: 2 } },
    { kind: 'choice', key: 'weave', label: 'weave', options: ['square', 'diagonal', 'radial'], default: 0, bind: { kind: 'content', slot: 3 } },
    { kind: 'toggle', key: 'beatChroma', label: 'beat chroma', default: true, bind: { kind: 'post', name: 'uChroma' } },
  ],
  grade: { grain: 0.0, contrast: 1.7, vignette: 0.4 },
};
