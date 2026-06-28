// Visual primitive registry for the COMPOSE pipeline. Gemma composes a scene-graph of these
// primitives; codegen.ts concatenates the needed GLSL into one render(). Contract for each:
//   float prim_NAME(vec2 uv, <float params...>) -> coverage 0..1   (GLSL ES 3.0)
// May read u_time + the audio uniforms (u_bass/u_mid/u_treble/u_level/u_beat). Params are passed
// in the SAME order as the `params` array below. Every primitive MUST be visible at silence (no
// multiply-by-audio gating) — audio only MODULATES via codegen, it never gates.

import { FX_NAMES } from '../themes/types';

export type ParamSpec = { key: string; min: number; max: number; def: number };
export type Primitive = { name: string; params: ParamSpec[]; desc: string };

export const PRIMS: Primitive[] = [
  { name: 'clouds', desc: 'soft multi-octave volumetric FBM — sky / fog / smoke / nebula / gas / storm clouds / energy haze (the workhorse texture bed). scale=detail, octaves=fine detail, warp=swirly distortion',
    params: [{ key: 'scale', min: 1, max: 8, def: 3 }, { key: 'octaves', min: 2, max: 6, def: 5 }, { key: 'warp', min: 0, max: 2, def: 0.6 }] },
  { name: 'particles', desc: 'flexible particle field — rain / snow / sparks / embers / bubbles / shooting stars / dust / matrix / confetti. count=how many, speed=drift rate, angle=travel direction in TURNS (0=up→embers/bubbles, 0.5=down→rain/snow, 0.25/0.75=sideways), streak=0 round dots(snow) → 1 long comet streaks(rain/matrix), size=particle size, flicker=twinkle rate (0=steady, ~1-3 for snow/stars, higher for sparks)',
    params: [{ key: 'count', min: 5, max: 60, def: 26 }, { key: 'speed', min: 0, max: 4, def: 1.6 }, { key: 'angle', min: 0, max: 1, def: 0.5 }, { key: 'streak', min: 0, max: 1, def: 0.7 }, { key: 'size', min: 0.02, max: 0.5, def: 0.08 }, { key: 'flicker', min: 0, max: 8, def: 0 }] },
  { name: 'lightning', desc: 'electric lightning bolts / arcs — jagged FBM-displaced bolts with glow that self-flicker (alive at silence; route beat→glow to sync strikes to the music). branches=bolt count, jitter=jaggedness, glow=brightness/halo',
    params: [{ key: 'branches', min: 1, max: 6, def: 3 }, { key: 'jitter', min: 0.1, max: 1.5, def: 0.6 }, { key: 'glow', min: 0.2, max: 2, def: 1 }] },
  { name: 'voronoi', desc: 'cellular Worley noise — biological cells / cracked earth / caustic net / honeycomb / stained glass / scales. scale=cell count, jitter=irregularity, mode=0 filled cells → 2 thin bright borders (net/crackle)',
    params: [{ key: 'scale', min: 2, max: 24, def: 8 }, { key: 'jitter', min: 0, max: 1, def: 0.9 }, { key: 'mode', min: 0, max: 2, def: 0 }] },
  { name: 'cymatic', desc: 'cymatic sand on a resonating Chladni plate — sand piles on nodal lines into 3D-lit dunes (resonance / sacred geometry / standing waves / sand). complexity=mode count, grain=granular texture, settle=stillness (low=churning, high=glassy-still)',
    params: [{ key: 'complexity', min: 0, max: 1, def: 0.45 }, { key: 'grain', min: 0, max: 1, def: 0.6 }, { key: 'settle', min: 0, max: 1, def: 0.5 }] },
  { name: 'drift', desc: 'fine ink streamlines / current map — contour lines of a 3-octave domain-warped flow field (currents / wind / topography / marbling). density=line count, flow=drift speed, field=0 calm·1 swirl·2 turbulent, lineWidth=stroke width',
    params: [{ key: 'density', min: 0, max: 1, def: 0.55 }, { key: 'flow', min: 0, max: 1, def: 0.4 }, { key: 'field', min: 0, max: 2, def: 1 }, { key: 'lineWidth', min: 0.04, max: 0.5, def: 0.2 }] },
  { name: 'obra', desc: 'luminous lit metaball orbs with core/rim shading (lava lamp / plasma orbs / cells / drifting lights). blobRadius=size, drift=motion speed, motion=0 orbit·1 drift·2 pulse, orbs=count 1-8',
    params: [{ key: 'blobRadius', min: 0.08, max: 0.3, def: 0.16 }, { key: 'drift', min: 0, max: 1, def: 0.3 }, { key: 'motion', min: 0, max: 2, def: 0 }, { key: 'orbs', min: 1, max: 8, def: 3 }] },
  { name: 'moire', desc: 'two beating line-gratings → living op-art moiré interference (op-art / weave / mesh / interference). gridFreq=density, rotate=rotation speed, lineWidth=line softness, weave=0 square·1 diagonal·2 radial',
    params: [{ key: 'gridFreq', min: 20, max: 80, def: 36 }, { key: 'rotate', min: 0, max: 0.6, def: 0.15 }, { key: 'lineWidth', min: 0.02, max: 0.2, def: 0.13 }, { key: 'weave', min: 0, max: 2, def: 0 }] },
  { name: 'sumi', desc: 'sumi-e ink wash — paper FILLS the field, a few dark brush strokes bleed wet-into-dry with paper-fiber granulation (ink painting / calligraphy / minimal / negative space). wetness=ink amount, brushSize=lobe size, drift=bleed speed. Palette dark→bright = ink→paper; pick a paper-toned bright end',
    params: [{ key: 'wetness', min: 0, max: 1, def: 0.7 }, { key: 'brushSize', min: 0, max: 1, def: 0.5 }, { key: 'drift', min: 0, max: 1, def: 0.3 }] },
];

export const BLENDS = ['over', 'add', 'screen', 'max', 'multiply'] as const;
export const MODIFIERS = ['none', 'mirror', 'kaleido', 'warp'] as const; // legacy single-modifier (mapped to ops)
export const AUDIO_SRC = ['bass', 'mid', 'treble', 'level', 'beat', 'centroid', 'flux', 'energy'] as const;

// OPERATORS — a chainable per-layer stack applied to the field before compositing. 'uv' ops bend the
// coordinate (applied in order to the sample point); 'mask' ops fade the resulting coverage by the
// ORIGINAL screen-space uv. args = how many params (a, then b) are passed to the GLSL op_/mask_ fn.
export type OpSpec = { name: string; kind: 'uv' | 'mask'; args: 0 | 1 | 2; a?: ParamSpec; b?: ParamSpec; desc: string };
export const OPS: OpSpec[] = [
  { name: 'polar', kind: 'uv', args: 0, desc: 'cartesian→polar (x=angle, y=radius): turns a field radial — rings, tunnels, spiral arms, accretion disks' },
  { name: 'swirl', kind: 'uv', args: 1, a: { key: 'amount', min: -6, max: 6, def: 2.5 }, desc: 'rotational vortex, rotation grows with radius (galaxy arms, orbit, smoke curl)' },
  { name: 'lens', kind: 'uv', args: 1, a: { key: 'amount', min: -1, max: 1, def: 0.5 }, desc: 'radial pinch(<0)/bulge(>0): fisheye, gravitational lensing, glass-bulb, CRT curve' },
  { name: 'zoom', kind: 'uv', args: 1, a: { key: 'amount', min: 0.2, max: 5, def: 1 }, desc: 'uniform scale (>1 in, <1 out)' },
  { name: 'scroll', kind: 'uv', args: 2, a: { key: 'dx', min: -1, max: 1, def: 0 }, b: { key: 'dy', min: -1, max: 1, def: 0.2 }, desc: 'pan the field over time (rain fall, cloud drift, grid toward camera, smoke rise)' },
  { name: 'warp', kind: 'uv', args: 1, a: { key: 'amount', min: 0, max: 2, def: 1 }, desc: 'noise domain-warp the plane (organic wobble, heat-haze)' },
  { name: 'kaleido', kind: 'uv', args: 1, a: { key: 'segments', min: 2, max: 12, def: 6 }, desc: 'mirror into N kaleidoscope wedges (mandala, symmetry)' },
  { name: 'mirror', kind: 'uv', args: 0, desc: 'mirror across the vertical axis (bilateral symmetry)' },
  { name: 'radialMask', kind: 'mask', args: 2, a: { key: 'inner', min: 0, max: 1.2, def: 0 }, b: { key: 'outer', min: 0, max: 1.4, def: 1.2 }, desc: 'keep coverage only in radius band [inner,outer]; inner>0 carves a hole (event horizon, ring/donut), small outer = spotlight/planet' },
  { name: 'perspective', kind: 'uv', args: 1, a: { key: 'amount', min: 0.2, max: 4, def: 1.2 }, desc: 'tilt the field into a ground plane receding to a horizon, scrolling toward the viewer (synthwave floor, seabed, ocean surface, inclined disk); pair with linearMask dir>0 to keep it below the horizon' },
  { name: 'linearMask', kind: 'mask', args: 2, a: { key: 'pos', min: -1, max: 1, def: 0 }, b: { key: 'dir', min: -1, max: 1, def: 1 }, desc: 'fade coverage along the vertical axis at line pos; dir>0 keeps BELOW (ground/fire/ocean), dir<0 keeps ABOVE (sky/aurora) — horizons & ground/sky splits' },
  { name: 'rotate', kind: 'uv', args: 1, a: { key: 'speed', min: -2, max: 2, def: 0.3 }, desc: 'continuous rigid spin (speed = turns rate; plain rotation, unlike radius-dependent swirl)' },
  { name: 'ripple', kind: 'uv', args: 2, a: { key: 'freq', min: 2, max: 30, def: 10 }, b: { key: 'amp', min: 0, max: 0.3, def: 0.06 }, desc: 'concentric sinusoidal displacement radiating from center (water, shockwaves, sonar, heat)' },
  { name: 'skew', kind: 'uv', args: 2, a: { key: 'shearX', min: -1, max: 1, def: 0.3 }, b: { key: 'shearY', min: -1, max: 1, def: 0 }, desc: 'affine slant (wind-driven diagonals, italic lean, parallelogram shear)' },
];

const SHARED = `
#define PI 3.14159265
float h11(float x){ return fract(sin(x*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a=h21(i), b=h21(i+vec2(1.0,0.0)), c=h21(i+vec2(0.0,1.0)), d=h21(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
// OPERATORS (uv->uv transforms, chainable) + masks (uv->coverage multiplier).
vec2 op_polar(vec2 uv){ float r = length(uv); return vec2(0.5 - 0.5*uv.x/(r + 1e-6), r); } // SEAMLESS radial: angle from cos(θ)=x/r is C1 everywhere — no value-jump wrap (the raw-atan bug: an always-on seam) AND no abs derivative crease (the |atan| bug: a hard horizon line). Mirrors top/bottom (inherent to any seamless polar) but with NO seam line.
vec2 op_swirl(vec2 uv, float a){ float r=length(uv); float an=a*r; float c=cos(an), s=sin(an); return mat2(c,-s,s,c)*uv; }
vec2 op_lens(vec2 uv, float a){ float r2=dot(uv,uv); return uv*(1.0 + a*r2); }
vec2 op_zoom(vec2 uv, float a){ return uv / max(a, 0.01); }
vec2 op_scroll(vec2 uv, float dx, float dy){ return uv - vec2(dx, dy)*u_time; }
vec2 op_warp(vec2 uv, float a){ return uv + a*0.12*vec2(vnoise(uv*3.0+u_time*0.2)-0.5, vnoise(uv*3.0+7.0-u_time*0.2)-0.5); }
vec2 op_kaleido(vec2 uv, float seg){ float a=atan(uv.y,uv.x); float r=length(uv); float s=2.0*PI/max(seg,2.0); a=abs(mod(a+s*0.5, s)-s*0.5); return vec2(cos(a),sin(a))*r; }
vec2 op_mirror(vec2 uv){ return vec2(abs(uv.x), uv.y); }
float mask_radialMask(vec2 uv, float inner, float outer){ float r=length(uv); return smoothstep(inner-0.06, inner+0.02, r) * smoothstep(outer+0.06, outer-0.02, r); }
vec2 op_perspective(vec2 uv, float a){ float y = -abs(uv.y) - 0.03; float z = 1.0/(-y); return vec2(uv.x*z, z*a - u_time); } // ground plane receding to horizon; the sky MIRRORS the ground (reflection) so it's seamless used alone — old min() clamp pinned the sky to one scanline -> hard horizon seam + stripe smear
float mask_linearMask(vec2 uv, float pos, float dir){ float s = smoothstep(pos+0.2, pos-0.2, uv.y); return dir >= 0.0 ? s : 1.0 - s; }
vec2 op_rotate(vec2 uv, float speed){ float a = speed*u_time; float c=cos(a), s=sin(a); return mat2(c,-s,s,c)*uv; }
vec2 op_ripple(vec2 uv, float freq, float amp){ float r = length(uv)+1e-4; return uv + (uv/r)*sin(r*freq - u_time*2.0)*amp; }
vec2 op_skew(vec2 uv, float a, float b){ return vec2(uv.x + uv.y*a, uv.y + uv.x*b); }
// ---- HELPER LIBRARY for custom GLSL fields (the model may call these in a {glsl} layer body) ----
mat2 rot2(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float remap(float x, float a, float b, float c, float d){ return c + (d-c)*clamp((x-a)/(b-a), 0.0, 1.0); }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p-1.0, 0.0, 1.0), c.y); }
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t + d)); } // IQ cosine palette
float worley(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d=9.0; for(int y=-1;y<=1;y++){ for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=g+vec2(h21(ip+g), h21(ip+g+5.2))-fp; d=min(d, dot(o,o)); } } return sqrt(d); }
float ridged(vec2 p, float oct){ float s=0.0, a=0.5, n=0.0; for(int i=0;i<6;i++){ if(float(i)<oct){ float v=1.0-abs(2.0*vnoise(p)-1.0); s+=a*v*v; n+=a; p=p*2.04+1.1; a*=0.5; } } return s/max(n,1e-3); }
float sdCircle(vec2 p, float r){ return length(p)-r; }
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k, 0.0, 1.0); return mix(b,a,h)-k*h*(1.0-h); }
`;

const PRIM_GLSL = `
// Clouds — multi-octave domain-warped FBM. Workhorse volumetric bed: sky/fog/smoke/nebula/gas.
float fbm(vec2 p, float oct){ float s=0.0, a=0.5, n=0.0; for(int i=0;i<6;i++){ if(float(i)<oct){ s+=a*vnoise(p); n+=a; p=p*2.02+1.3; a*=0.5; } } return s/max(n,1e-3); }
float prim_clouds(vec2 uv, float scale, float octaves, float warp){
  vec2 p = uv*scale;
  vec2 q = vec2(fbm(p + u_time*0.04, 3.0), fbm(p + vec2(5.2,1.3) - u_time*0.03, 3.0));
  float f = fbm(p + warp*q + u_time*0.02, octaves);
  return clamp((f-0.15)*1.4, 0.0, 1.0);
}
// Particles — one flexible field for rain/snow/sparks/embers/bubbles/matrix/dust. A stream per column
// travels along the angle; streak morphs round dots into comet streaks; per-column speed gives depth.
float prim_particles(vec2 uv, float count, float speed, float angle, float streak, float size, float flicker){
  float a = angle * 6.28318;
  vec2 dir = vec2(sin(a), cos(a));                        // a=0 up, a=0.5 down, a=0.25/0.75 sideways
  vec2 q = vec2(dot(uv, vec2(dir.y, -dir.x)), dot(uv, dir)); // x = across travel, y = along travel
  float n = max(count, 2.0);
  float colId = floor(q.x * n);
  float lane = h11(colId*1.7 + 3.0);
  float on = step(0.25, lane);                            // some columns empty (sparsity + variety)
  float spd = speed * (0.6 + 0.8*lane);                   // per-column speed = depth
  float t = u_time*spd + lane*17.0;
  float y = fract(q.y*n*0.5 - t);                         // one particle per column, cycling smoothly
  float fx = fract(q.x*n) - 0.5;
  float w = max(size, 0.02) * (0.6 + 0.6*lane);
  float across = smoothstep(w, 0.0, abs(fx));
  float d = y - 0.5;
  float head = smoothstep(w*1.5, 0.0, abs(d));            // round head (streak 0 = just this)
  float tail = smoothstep(0.45*streak + 0.03, 0.0, max(d, 0.0)); // trailing comet tail (streak 1 = long)
  float fl = mix(1.0, 0.55 + 0.45*sin(u_time*flicker + lane*30.0 + colId), step(0.01, flicker));
  return clamp(across * max(head, tail) * on * (0.45 + 0.6*lane) * fl, 0.0, 1.0);
}
// Lightning — jagged FBM-displaced bolts with 1/d glow. Self-flickers (alive at silence); route
// beat->glow to punch strikes on the beat. branches=parallel bolts, jitter=jaggedness, glow=halo.
float prim_lightning(vec2 uv, float branches, float jitter, float glow){
  float ph = u_time*0.8;
  float flash = 0.15 + 0.85*exp(-fract(ph)*5.0);         // periodic strike envelope (decays each cycle)
  float nb = clamp(floor(branches + 0.5), 1.0, 6.0);
  float v = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) < nb) {
      float seed = float(i)*13.7 + floor(ph)*3.1;        // fresh bolt shape each strike
      float bx = (h11(seed) - 0.5) * 1.3;
      float px = bx + (fbm(vec2(seed, uv.y*2.5 + u_time*0.5), 4.0) - 0.5) * jitter;
      v += glow * 0.02 / (abs(uv.x - px) + 0.008);
    }
  }
  v *= smoothstep(1.1, -1.1, uv.y);                       // brighter at the top, fading down
  return clamp(v * flash, 0.0, 1.0);
}
// Voronoi — Worley noise. F1 = filled cells (bright centers); F2-F1 = thin cell borders (net/crackle).
float prim_voronoi(vec2 uv, float scale, float jitter, float mode){
  vec2 p = uv*scale;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int y=-1;y<=1;y++){ for (int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = g + 0.5 + jitter*(vec2(h21(ip+g), h21(ip+g+19.7)) - 0.5) + 0.15*sin(u_time + 6.2831*vec2(h21(ip+g), h21(ip+g+4.3))) - fp;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }}
  d1 = sqrt(d1); d2 = sqrt(d2);
  float cells = 1.0 - smoothstep(0.15, 1.0, d1);          // bright cell interiors
  float net   = 1.0 - smoothstep(0.0, 0.09, d2 - d1);     // bright thin borders
  return clamp(mix(cells, net, clamp(mode*0.5, 0.0, 1.0)), 0.0, 1.0);
}
// Cymatic sand — harvested from the default 'Cymatic Sand' theme. Chladni plate eigenmodes
// accumulate "sand" on nodal lines (Gaussian profile), normal-mapped into 3D-lit dunes + grain.
float cym_hash(vec2 p){ p = fract(p*vec2(127.1,311.7)); p += dot(p, p+34.5); return fract(p.x*p.y*43758.5453); }
float cym_chladni(vec2 p, float n, float m){ return cos(n*PI*p.x)*cos(m*PI*p.y) - cos(m*PI*p.x)*cos(n*PI*p.y); }
float cym_field(vec2 p, float t, float complexity, float bass, float treble){
  float n1 = 2.0 + complexity*3.0 + bass*4.0;
  float m1 = 3.0 + complexity*4.0 + treble*3.0;
  float n2 = 5.0 + complexity*5.0 + treble*6.0;
  float m2 = 2.0 + complexity*3.0 + bass*5.0;
  float w1 = 0.5 + 0.5*sin(t);
  float w2 = 0.5 + 0.5*sin(t*1.3 + 1.5);
  return (w1*cym_chladni(p, n1, m1) + w2*cym_chladni(p*1.05, n2, m2)) / (w1 + w2);
}
float prim_cymatic(vec2 uv, float complexity, float grain, float settle){
  vec2 q = uv*0.62 + 0.5;
  float bass = u_bass*0.8, treble = u_treble*0.7, beat = u_beat;
  float t = u_time * mix(0.15, 0.03, settle);
  float scatter = beat*0.4*(1.0 - settle);
  float field = cym_field(q, t, complexity, bass, treble);
  field += (cym_hash(uv*10.0 + u_time) - 0.5) * scatter;
  float vibe = bass + treble;
  float sharp = mix(15.0, 5.0, vibe) * mix(0.5, 2.0, settle) * (1.0 - beat*0.4);
  float sand = exp(-pow(abs(field)*sharp, 2.0));
  float eps = 0.005;
  float fx = cym_field(q + vec2(eps,0.0), t, complexity, bass, treble) - field;
  float fy = cym_field(q + vec2(0.0,eps), t, complexity, bass, treble) - field;
  vec3 nrm = normalize(vec3(-fx*sharp, -fy*sharp, 0.5));
  float diff = max(0.0, dot(nrm, normalize(vec3(-0.6,-0.4,0.8))));
  float rim = pow(1.0 - max(0.0, nrm.z), 2.0);
  float gn = cym_hash(floor(uv*(120.0 + grain*350.0) + floor(u_time*12.0*beat)*0.5));
  float lum = sand*(diff*0.8 + 0.4) + sand*rim*0.5;
  lum *= mix(1.0, 0.6 + gn*0.8, grain);
  lum += sand*0.15 + gn*beat*0.1*vibe;
  lum *= smoothstep(1.2, 0.4, length(uv));
  return clamp(lum, 0.0, 1.0);
}
// Drift — harvested from 'Driftlines'. Contour lines of a 3-octave domain-warped noise field.
float prim_drift(vec2 uv, float density, float flow, float field, float lineWidth){
  float t = u_time * (0.05 + flow*0.22);
  float fieldIdx = clamp(field, 0.0, 2.0);
  vec2 p = uv * 1.7;
  vec2 w = vec2(vnoise(p*1.1 + vec2(t,0.0)), vnoise(p*1.1 + vec2(0.0,t) + 7.3)) - 0.5;
  float warpAmt = mix(0.55, mix(1.3, 2.6, clamp(fieldIdx-1.0,0.0,1.0)), clamp(fieldIdx,0.0,1.0));
  float fld = vnoise(p*1.05 + w*warpAmt) + 0.5*vnoise(p*2.3 + w*warpAmt*1.4 + 3.0) + 0.25*vnoise(p*4.6 + w*warpAmt*1.8 + 9.0);
  fld /= 1.75;
  float freq = 7.0 + clamp(density,0.0,1.0)*26.0 + u_treble*5.0;
  float d = abs(fract(fld*freq + t*2.0) - 0.5);
  float lw = max(lineWidth, 0.04) * 0.5;
  return clamp(smoothstep(lw, lw*0.25, d) * (0.6 + 0.5*u_beat), 0.0, 1.0);
}
// Obra — harvested from 'Obra Drift'. Lit metaball orbs (orbit/drift/pulse) with core+rim shading.
float prim_obra(vec2 uv, float blobRadius, float drift, float motion, float orbs){
  vec2 p = uv;
  float spd = drift, mo = clamp(motion, 0.0, 2.0), orbCount = clamp(floor(orbs + 0.5), 1.0, 8.0);
  float f = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi < orbCount) {
      float ang = fi * 2.39996;
      vec2 orbit = vec2(sin(u_time*spd + ang)*0.4, cos(u_time*spd*0.9 + ang*0.7)*0.32);
      vec2 drft  = vec2(sin(u_time*spd*0.5 + ang)*0.5, fract(fi*0.618 + u_time*spd*0.08)*0.9 - 0.45);
      vec2 puls  = vec2(cos(ang), sin(ang)) * (0.22 + 0.20*sin(u_time*spd*1.5 + fi));
      vec2 c = mix(mix(orbit, drft, clamp(mo, 0.0, 1.0)), puls, clamp(mo - 1.0, 0.0, 1.0));
      float r = blobRadius + 0.05*sin(u_time*0.7 + fi*1.3);
      vec2 d = p - c;
      f += (r*r) / (dot(d,d) + 0.002);
    }
  }
  float surf = smoothstep(0.9, 1.8, f), core = smoothstep(2.2, 3.6, f);
  float rim = smoothstep(1.5, 1.9, f) - smoothstep(1.9, 2.6, f);
  float lum = (surf*0.55 + core*0.40 + rim*0.60 + 0.04) * (0.82 + 0.30*u_level);
  return clamp(lum, 0.0, 1.0);
}
// Moiré — harvested from 'Moiré Mécanique'. Two beating gratings (square/diagonal/radial weave).
float prim_moire(vec2 uv, float gridFreq, float rotate, float lineWidth, float weave){
  float a = u_time * rotate, wv = clamp(weave, 0.0, 2.0);
  vec2 p = uv * 1.2;
  float g1 = sin(p.y*gridFreq + 7.0*sin(p.x*2.5 + u_time*0.5) + u_bass*5.0);
  float ang = mix(0.0, 0.7853, clamp(wv, 0.0, 1.0));
  float ca = cos(a + ang), sa = sin(a + ang);
  vec2 q = mat2(ca, -sa, sa, ca) * p;
  float gCart = sin(q.y*(gridFreq*1.07) + u_treble*9.0);
  float gRad  = sin(length(p)*gridFreq*0.6 - u_time);
  float g2 = mix(gCart, gRad, clamp(wv - 1.0, 0.0, 1.0));
  return smoothstep(0.0, lineWidth, abs(g1*g2));
}
// Sumi — harvested from 'Sumi Breath', enriched into bold sumi-e: full paper field with a few
// confident swept brush strokes — tapered curved gestures, dark cores, wet-bleed edges, dry-brush
// streaks, paper granulation. Stroke = distance to a bent segment (capsule), not a round blob.
float sumi_fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<3;i++){ s += a*vnoise(p); p=p*2.03+1.7; a*=0.5; } return s; }
float sumi_seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
float prim_sumi(vec2 uv, float wetness, float brushSize, float drift){
  vec2 p = uv;
  float t = u_time * (0.04 + drift*0.18);
  vec2 pw = p + 0.05*vec2(sumi_fbm(p*2.3 + t) - 0.5, sumi_fbm(p*2.3 + 7.0 - t) - 0.5); // wet edge bleed
  float w = 0.04 + brushSize*0.10;                               // base half-width of a stroke
  float ink = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i), seed = fi*1.7;
    vec2 ctr = vec2(sin(seed*2.1)*0.45, cos(seed*1.7)*0.40) + 0.06*vec2(sin(t+fi), cos(t*0.8+fi));
    float ga = seed*1.3 + 0.3*sin(t*0.5 + fi);
    vec2 dir = vec2(cos(ga), sin(ga)), nrm = vec2(-dir.y, dir.x);
    float len = 0.26 + 0.18*h11(fi + 1.0);
    vec2 a = ctr - dir*len, b = ctr + dir*len;
    vec2 mid = ctr + nrm*0.12*sin(t*0.7 + fi*2.0);               // curved belly of the stroke
    vec2 ba = b - a;
    float hpos = clamp(dot(pw - a, ba)/dot(ba, ba), 0.0, 1.0);
    float d = min(sumi_seg(pw, a, mid), sumi_seg(pw, mid, b));
    float taper = w * (0.3 + 0.7*sin(hpos*3.14159));             // thin at both ends
    float bristle = 0.6 + 0.4*sin(hpos*34.0 + vnoise(pw*6.0)*7.0); // dry-brush streaks along the stroke
    ink += smoothstep(taper, taper*0.1, d) * mix(0.7, 1.0, bristle) + smoothstep(taper*0.5, 0.0, d)*0.55;
  }
  ink += u_beat * 0.2 * smoothstep(0.45, 0.0, length(p));        // beat lands a stroke
  ink *= clamp(wetness * (1.3 + 0.5*u_bass), 0.0, 1.4);         // ink strength; bass swells
  ink += (sumi_fbm(p*1.4 + 21.0) - 0.5) * 0.06;                  // faint paper tone variation
  ink = clamp(ink, 0.0, 1.0);
  float fiber = h21(floor(p*260.0)) * 0.12 * ink;               // granulation within the ink
  return 1.0 - clamp(ink*0.97 + fiber, 0.0, 1.0);              // paper bright; ink strokes recess to the dark stop
}
`;

/** All helpers + every primitive (unused ones are stripped by the GLSL compiler). */
export const LIBRARY_GLSL = SHARED + PRIM_GLSL;

/** Human-readable primitive catalogue + post-FX, fed to the model so it knows what it can compose. */
export function buildSpec(): string {
  const prims = PRIMS.map((p) => `- ${p.name}(${p.params.map((x) => `${x.key} ${x.min}..${x.max}`).join(', ')}): ${p.desc}`).join('\n');
  const ops = OPS.map((o) => {
    const args = [o.a, o.b].filter(Boolean).map((x) => `${x!.key} ${x!.min}..${x!.max}`).join(', ');
    return `- ${o.name}(${args}): ${o.desc}`;
  }).join('\n');
  const post = 'POST EFFECTS — optional "post" object, each value 0..1: bloom (neon glow on bright areas), grayscale (desaturate toward b&w), pixelate (chunky retro pixels), dots (halftone print dots), scanlines (CRT lines), ascii (luminance→character glyphs: matrix/terminal/ascii-art), hue (animated rainbow hue-cycle; 0=off, higher=faster), chroma (RGB colour-fringe aberration, stronger toward edges — glass/CRT/glitch/spacetime warp), radialBlur (outward zoom-streak from center — speed / hyperspace / motion).';
  const palette = 'PALETTE — "palette": array of 3-4 hex colors ordered DARKEST to BRIGHTEST. The whole composition is recolored by brightness through this gradient, so this IS the color scheme — pick colors that nail the mood. e.g. lava ["#0a0000","#7a0d00","#ff5a00","#ffe070"]; deep sea ["#01060f","#063a5e","#11b3c9","#d7faff"]; noir ["#000000","#3a3a3a","#9a9a9a","#ffffff"]. PALETTE STRENGTH — optional "paletteAmount" 0..1 (default 0.85): how strongly the palette recolors the scene. Keep high (0.8-1) for one unified mood; LOWER it (0.2-0.5) AND give layers distinct "color"s when you want INDEPENDENT hue regions (green aurora over a warm horizon, blue galaxy arms with a yellow core, multicolor confetti).';
  const helpers = 'CUSTOM-FIELD HELPERS — when you write a {glsl} field you may call these (plus standard GLSL): vnoise(p), fbm(p,oct), ridged(p,oct), worley(p), rot2(angle)→mat2, remap(x,a,b,c,d), hsv2rgb(vec3), cosPalette(t,a,b,c,d), sdCircle(p,r), sdBox(p,b), smin(a,b,k), and PI. Available uniforms: u_time, u_bass, u_mid, u_treble, u_level, u_beat, u_centroid, u_flux, u_energy.';
  return `PRIMITIVES (each layer sets one field's STRUCTURE):\n${prims}\n\nOPERATORS — optional per-layer "ops" array, applied IN ORDER to bend/repeat/mask a field before compositing (chain them, e.g. polar then swirl for a galaxy):\n${ops}\n\n${post}\n\n${palette}\n\n${helpers}`;
}

/** Strict JSON-schema for the scene-graph, generated from THIS registry — sent to the model as
 *  `response_format: json_schema` on the FINAL (emit) call so constrained decoding GUARANTEES a
 *  parseable graph AND the model can only name real prims/ops/params/audio sources (no garbage,
 *  no hallucinated vocabulary). Optional fields are required-nullable per Cerebras strict rules
 *  (additionalProperties:false + everything in `required`); validate() coerces nulls→defaults. */
export function buildSchema() {
  const numN = { type: ['number', 'null'] };
  const src = { type: 'string', enum: [...AUDIO_SRC] };
  const audioObj = { type: 'object', additionalProperties: false, properties: { src, amount: { type: 'number' } }, required: ['src', 'amount'] };
  const opItem = { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: OPS.map((o) => o.name) }, a: numN, b: numN, audio: { anyOf: [{ type: 'null' }, audioObj] } }, required: ['op', 'a', 'b', 'audio'] };
  const route = { type: 'object', additionalProperties: false, properties: { param: { type: 'string' }, src, amount: { type: 'number' } }, required: ['param', 'src', 'amount'] };
  const common: Record<string, unknown> = { color: { type: 'string' }, colorB: { type: ['string', 'null'] }, opacity: { type: 'number' }, blend: { type: 'string', enum: [...BLENDS] }, ops: { type: 'array', items: opItem }, audio: { type: 'array', items: route } };
  const commonReq = ['color', 'colorB', 'opacity', 'blend', 'ops', 'audio'];
  const primVariant = (p: Primitive) => ({ type: 'object', additionalProperties: false, properties: { prim: { type: 'string', enum: [p.name] }, params: { type: 'object', additionalProperties: false, properties: Object.fromEntries(p.params.map((q) => [q.key, { type: 'number' }])), required: p.params.map((q) => q.key) }, ...common }, required: ['prim', 'params', ...commonReq] });
  const glslVariant = { type: 'object', additionalProperties: false, properties: { glsl: { type: 'string' }, ...common }, required: ['glsl', ...commonReq] };
  return {
    name: 'scene_graph', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        background: { type: 'string' },
        layers: { type: 'array', items: { anyOf: [...PRIMS.map(primVariant), glslVariant] } },
        post: { type: 'object', additionalProperties: false, properties: Object.fromEntries(FX_NAMES.map((f) => [f, numN])), required: [...FX_NAMES] },
        palette: { type: 'array', items: { type: 'string' } },
        paletteAmount: { type: 'number' },
        exposure: { type: 'number' },
      },
      required: ['background', 'layers', 'post', 'palette', 'paletteAmount', 'exposure'],
    },
  };
}
