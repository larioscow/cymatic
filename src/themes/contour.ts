import type { Theme } from './types';

// Contour — the idle/starting topographic background. A black-and-white duplicate of Driftlines
// with no audio reactivity, meant to drift glacially (global speed starts at 0.1). When a track
// is loaded the app advances to the live themes.
export const contour: Theme = {
  id: 'contour',
  name: 'Contour',
  prompt: 'Liquid topographic contours, slow morphing currents over warm paper.',
  ground: 'paper',
  mode: 'duotone',
  content: `float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = h21(i), b = h21(i+vec2(1.0,0.0)), c = h21(i+vec2(0.0,1.0)), d = h21(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
vec3 render(vec2 uv){
  float t = u_time * (0.03 + u_k[1]*0.12);            // slow base; global speed (0.1) slows further
  float fieldIdx = clamp(u_k[2], 0.0, 2.0);
  vec2 p = uv * 1.7;
  vec2 w = vec2(vn(p*1.1 + vec2(t,0.0)), vn(p*1.1 + vec2(0.0,t) + 7.3)) - 0.5;
  float warpAmt = mix(0.55, mix(1.3, 2.6, clamp(fieldIdx-1.0,0.0,1.0)), clamp(fieldIdx,0.0,1.0));
  float fld = vn(p*1.05 + w*warpAmt);
  fld += 0.5 * vn(p*2.3 + w*warpAmt*1.4 + 3.0);
  fld += 0.25 * vn(p*4.6 + w*warpAmt*1.8 + 9.0);
  fld /= 1.75;
  float freq = 7.0 + clamp(u_k[0],0.0,1.0)*26.0 + u_treble*4.0;   // subtle audio reactivity
  float ph = fld*freq + t*1.2 + u_bass*1.2;
  float d = abs(fract(ph) - 0.5);
  float lw = max(u_k[3], 0.04) * 0.5;
  float line = smoothstep(lw, lw*0.25, d);
  line *= 0.65 + 0.5*u_level;
  return vec3(clamp(line, 0.0, 1.0));                  // pure luminance -> B&W (or text palette) via duotone
}`,
  palette: { paper: '#E9E7E2', ink: '#1A1A18' }, // black & white (no accent)
  controls: [
    { kind: 'slider', key: 'density', label: 'density', min: 0, max: 1, default: 0.5, bind: { kind: 'content', slot: 0 } },
    { kind: 'slider', key: 'flow', label: 'flow speed', min: 0, max: 1, default: 0.3, bind: { kind: 'content', slot: 1 } },
    { kind: 'choice', key: 'field', label: 'field', options: ['calm', 'swirl', 'turbulent'], default: 0, bind: { kind: 'content', slot: 2 } },
    { kind: 'slider', key: 'lineWidth', label: 'line width', min: 0.04, max: 0.5, default: 0.22, bind: { kind: 'content', slot: 3 } },
  ],
  grade: { grain: 0.0, contrast: 1.2, vignette: 0.25 },
};
