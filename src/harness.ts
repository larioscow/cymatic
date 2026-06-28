// The fixed content harness. A theme supplies only `vec3 render(vec2 uv)` (forms, reading the
// audio uniforms + the per-theme knob array u_k). Wrapped into a RawShaderMaterial fragment
// (GLSL ES 3.0) rendered to an offscreen HDR target; all look/style lives in the post stack.
//
// u_k[] = live knobs. Sliders, toggles (0..1) and choices (eased index) all land here or in a
// post uniform. Changing one just sets a uniform — no recompile.

export const KNOB_COUNT = 8;

export function buildContent(inner: string): string {
  return `precision highp float;
precision highp int;
uniform float u_time;
uniform vec2  u_res;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_level;
uniform float u_beat;
uniform float u_centroid;
uniform float u_flux;
uniform float u_energy;
uniform float u_k[${KNOB_COUNT}];
uniform vec3  u_paper;
uniform vec3  u_ink;
uniform vec3  u_accent;
out vec4 fragColor;
${inner}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  fragColor = vec4(render(uv), 1.0);
}`;
}

export const CONTENT_VERT = `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Strip markdown fences the model may wrap GLSL in (used on the real Cerebras path). */
export function cleanGLSL(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').trim();
}
