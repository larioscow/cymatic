# PRISM — the AI VJ that codes its own visuals to your music

Drop any track, type a vibe, and a multi-agent Gemma-4-31b-on-Cerebras pipeline **writes live GLSL** that morphs a full-screen world in lockstep with the music. Keep re-prompting to reshape the visuals in near-real-time. Built for the Cerebras × Google DeepMind Gemma 4 hackathon (Track 1).

## Why it works
- **Gemma is text-out only** → "visual creation" = it writes *code that renders*, which is its #1 strength (structured code gen) at Cerebras speed.
- **Reactivity is the framework's job, not the model's.** Audio features (bass/mid/treble/level/beat) are computed client-side every frame (`src/audio.ts`) and exposed as GLSL uniforms. Gemma never analyzes the song — it just writes a `vec3 render(vec2 uv)` that consumes those uniforms, slotted into a fixed, guaranteed-compiling harness (`src/harness.ts`). Trial-compile gates every shader; bad GLSL never reaches the screen.
- **Speed is the visible hero:** the live prompt → multi-agent codegen feed → sub-second morph is impossible at 3–8s GPU latency.

## Run
```bash
npm install
npm run dev      # open the printed localhost URL, click "♪ track", load a song, type a vibe
```
Try prompts: `dark neon tunnel pulsing on the bass` · `warp fractal melt` · `soft plasma`.

## Architecture
| File | Role |
|------|------|
| `src/audio.ts` | Native Web Audio → live `{bass,mid,treble,level,beat}` uniforms |
| `src/gl.ts` | WebGL2 renderer, dual-FBO **crossfade morph** between shaders |
| `src/harness.ts` | Fixed shader wrapper + baseline reactivity (the never-breaks part) |
| `src/shaders.ts` | Hand-crafted baseline `render()` skeletons = AI-free safety floor + fallback pool |
| `src/gemma.ts` | `MockGemma` (active) / `CerebrasGemma` (real SSE) — same interface |
| `api/generate.js` | Cerebras streaming proxy (model `gemma-4-31b`, OpenAI-compatible) |

## Going live (Sunday)
1. `cp .env.example .env` and set `CEREBRAS_API_KEY`.
2. In `src/main.ts`, swap `new MockGemma()` → `new CerebrasGemma()`.
3. Serve `api/generate.js` (Vercel `vercel dev`, or any Node host) so `/api/generate` resolves.

That's the only change — everything else already runs on the mock.
