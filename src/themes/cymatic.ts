import type { Theme } from './types';

export const cymatic: Theme = {
  id: 'cymatic',
  name: 'Cymatic Sand',
  prompt: 'Cymatic sand tracing standing waves on a black resonating plate, gold nodal lines.',
  ground: 'dark',
  mode: 'duotone',
  content: `
float hash(vec2 p){
  p = fract(p*vec2(127.1,311.7));
  p += dot(p, p+34.5);
  return fract(p.x*p.y*43758.5453);
}

// Standard 2D square plate eigenmode equation
float chladni(vec2 p, float n, float m){
  float PI = 3.14159265;
  return cos(n*PI*p.x)*cos(m*PI*p.y) - cos(m*PI*p.x)*cos(n*PI*p.y);
}

// Evaluate the superposed wave field at a given point
float waveField(vec2 p, float t, float complexity, float bass, float treble){
  // Dynamic eigenmode numbers driven by audio frequencies
  float n1 = 2.0 + complexity * 3.0 + bass * 4.0;
  float m1 = 3.0 + complexity * 4.0 + treble * 3.0;
  float n2 = 5.0 + complexity * 5.0 + treble * 6.0;
  float m2 = 2.0 + complexity * 3.0 + bass * 5.0;
  
  // Slow phase morphing to simulate frequency drift
  float w1 = 0.5 + 0.5 * sin(t);
  float w2 = 0.5 + 0.5 * sin(t * 1.3 + 1.5);
  
  // Superposition of two distinct eigenmodes
  float field = (w1 * chladni(p, n1, m1) + w2 * chladni(p * 1.05, n2, m2)) / (w1 + w2);
  return field;
}

vec3 render(vec2 uv){
  vec2 p = uv * 0.62 + 0.5;

  float complexity = clamp(u_k[0], 0.0, 1.0);
  float grainAmt   = clamp(u_k[1], 0.0, 1.0);
  float settle     = clamp(u_k[2], 0.0, 1.0);

  // Audio driven energy
  float bass = u_bass * 0.8;
  float treble = u_treble * 0.7;
  float beat = u_beat;
  
  // Slow down morphing based on settle slider
  float t = u_time * mix(0.15, 0.03, settle);
  
  // Plate scattering: When a beat hits, scatter the field
  float scatter = beat * 0.4 * (1.0 - settle);
  float field = waveField(p, t, complexity, bass, treble);
  field += (hash(uv * 10.0 + u_time) - 0.5) * scatter;

  // 1. Mathematical Sand Accumulation (Gaussian profile along nodal lines)
  // Sand piles highest exactly on the line (field -> 0) and decays exponentially
  float vibrationEnergy = bass + treble;
  float sharpness = mix(15.0, 5.0, vibrationEnergy) * mix(0.5, 2.0, settle);
  sharpness *= (1.0 - beat * 0.4); // Beat momentarily flattens the dunes
  float sandHeight = exp(-pow(abs(field) * sharpness, 2.0));

  // 2. 3D Normal Mapping for Realistic Lighting
  // Calculate derivatives of the field to simulate the slope of the sand dunes
  float eps = 0.005;
  float fieldX = waveField(p + vec2(eps, 0.0), t, complexity, bass, treble) - field;
  float fieldY = waveField(p + vec2(0.0, eps), t, complexity, bass, treble) - field;
  
  // Construct normal vector pointing up, tilted by the slope of the nodal lines
  vec3 normal = normalize(vec3(-fieldX * sharpness, -fieldY * sharpness, 0.5));
  
  // Directional lighting
  vec3 lightDir = normalize(vec3(-0.6, -0.4, 0.8));
  float diffuse = max(0.0, dot(normal, lightDir));
  // Rim light for edge highlights on the sand grains
  float rim = pow(1.0 - max(0.0, normal.z), 2.0);
  
  // 3. Granular Texture
  // High frequency noise to break up the smoothness into individual grains
  float gcell = 120.0 + grainAmt * 350.0;
  vec2 gId = floor(uv * gcell + floor(u_time * 12.0 * beat) * 0.5);
  float grain = hash(gId);
  
  // Compose final lighting
  float lum = sandHeight * (diffuse * 0.8 + 0.4); // Base lighting
  lum += sandHeight * rim * 0.5;                  // Add rim lighting
  lum *= mix(1.0, 0.6 + grain * 0.8, grainAmt);   // Apply grain texture
  lum += sandHeight * 0.15;                       // Ambient base brightness
  
  // Scattered "jumping" sand during heavy bass/beat impacts
  lum += grain * beat * 0.1 * vibrationEnergy;

  // Vignette to simulate the physical edge of the Chladni plate
  float plateEdge = smoothstep(1.2, 0.4, length(uv));
  lum *= plateEdge;

  return vec3(clamp(lum, 0.0, 1.0));
}
`,
  palette: { paper: '#08080a', ink: '#ece3cf', accent: '#cda86b' },
  controls: [
    { kind: 'slider', key: 'complexity', label: 'Complexity', min: 0, max: 1, default: 0.45, bind: { kind: 'content', slot: 0 }, audio: { src: 'bass', amount: 0.4 } },
    { kind: 'slider', key: 'grainAmount', label: 'Grain', min: 0, max: 1, default: 0.6, bind: { kind: 'content', slot: 1 }, audio: { src: 'treble', amount: 0.3 } },
    { kind: 'slider', key: 'settle', label: 'Settle', min: 0, max: 1, default: 0.5, bind: { kind: 'content', slot: 2 } },
  ],
  grade: { grain: 0.0, contrast: 1.3, vignette: 0.5 },
};