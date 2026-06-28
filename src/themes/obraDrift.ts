import type { Theme } from './types';

// Obra Drift — bone-on-indigo ordered-dither stipple of slow lit blobs.
// Demonstrates: sliders (radius/drift/grain/contrast/vignette/orbs), a toggle (dither), and a
// choice (motion: orbit | drift | pulse) blended smoothly in the shader.
export const obraDrift: Theme = {
  id: 'obra',
  name: 'Obra Drift',
  prompt: 'Luminous blobs drifting through bone-white stipple on deep indigo.',
  ground: 'paper',
  mode: 'duotone',
  content: `vec3 render(vec2 uv){
  vec2 p = uv;
  float spd = u_k[1];
  float motion = clamp(u_k[2], 0.0, 2.0); // 0 orbit, 1 drift, 2 pulse (eased)
  float orbCount = clamp(floor(u_k[3] + 0.5), 1.0, 8.0); // dynamic orb count
  
  float f = 0.0;
  // Static max loop bound (8) for WebGL1 compatibility, masked by orbCount
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi < orbCount) {
      // Golden angle spacing ensures beautiful distribution for any orb count
      float ang = fi * 2.39996; 
      
      vec2 orbit = vec2(sin(u_time*spd + ang)*0.4, cos(u_time*spd*0.9 + ang*0.7)*0.32);
      vec2 drift = vec2(sin(u_time*spd*0.5 + ang)*0.5, fract(fi*0.618 + u_time*spd*0.08)*0.9 - 0.45);
      vec2 puls  = vec2(cos(ang), sin(ang)) * (0.22 + 0.20*sin(u_time*spd*1.5 + fi));
      
      vec2 c = mix(mix(orbit, drift, clamp(motion, 0.0, 1.0)), puls, clamp(motion - 1.0, 0.0, 1.0));
      float r = u_k[0] + 0.05*sin(u_time*0.7 + fi*1.3);
      vec2 d = p - c;
      f += (r*r) / (dot(d,d) + 0.002);
    }
  }
  float surf = smoothstep(0.9, 1.8, f);
  float core = smoothstep(2.2, 3.6, f);
  float rim  = smoothstep(1.5, 1.9, f) - smoothstep(1.9, 2.6, f);
  float lum = surf*0.55 + core*0.40 + rim*0.60 + 0.04;
  lum *= 0.70 + 0.50*u_level;
  return vec3(clamp(lum, 0.0, 1.0));
}`,
  palette: { paper: '#ECE6D6', ink: '#1A1C24' },
  controls: [
    { kind: 'slider', key: 'blobRadius', label: 'blob radius', min: 0.08, max: 0.30, default: 0.16, bind: { kind: 'content', slot: 0 }, audio: { src: 'bass', amount: 0.06 } },
    { kind: 'slider', key: 'drift', label: 'drift speed', min: 0.0, max: 1.0, default: 0.30, bind: { kind: 'content', slot: 1 } },
    { kind: 'choice', key: 'motion', label: 'motion', options: ['orbit', 'drift', 'pulse'], default: 0, bind: { kind: 'content', slot: 2 } },
    { kind: 'slider', key: 'orbs', label: 'orbs', min: 1, max: 8, default: 3, bind: { kind: 'content', slot: 3 } },
    { kind: 'toggle', key: 'dither', label: 'dither', default: true, bind: { kind: 'post', name: 'uDither' } },
  ],
  grade: { grain: 0.05, contrast: 1.4, vignette: 0.5 },
};