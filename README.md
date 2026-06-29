# Cymatic

An AI VJ. Load a track, type what you want to see, and Gemma 4 31B on Cerebras turns the prompt into a live, audio-reactive WebGL visual. Keep typing to reshape it. Built for the Cerebras x Google DeepMind Gemma 4 hackathon, where the rule is that Gemma 4 31B on Cerebras has to be the central component.

This README is mostly about that last part: exactly how Gemma is wired in, and why the design leans on it the way it does.

## What Gemma actually does

Gemma is text in, text out. It does not render anything and it never listens to the audio. Its job is to read a prompt (and sometimes an image) and write a small JSON document that describes a scene. The browser turns that JSON into a GLSL shader and runs it.

So the model is doing structured generation, which is what it is good at, and the rendering and the music reactivity are handled by code around it.

The whole exchange lives in `api/compose.js`, a proxy that holds the Cerebras key server-side and calls the OpenAI-compatible Chat Completions endpoint with model `gemma-4-31b`.

## The two-step chain

A single prompt becomes a visual through two Gemma calls. Gemma's own reasoning is left off (`reasoning_effort: 'none'`), because the two steps are the reasoning. Turning on in-model reasoning made it spend the token budget thinking and return truncated JSON.

Step 1, interpret and decide. The system prompt frames Gemma as a VJ and hands it the catalogue of building blocks it is allowed to use (see "the building blocks" below). It replies with plain JSON:

```json
{
  "interpretation": "a collapsing star, light bent around a dark core",
  "diffType": "new",
  "mathFormula": true,
  "approach": "radial field through a lens op, dark core carved with a radialMask",
  "deltaPalette": [], "deltaPaletteAmount": 0, "deltaPost": {}
}
```

`diffType` is the routing decision. `new` means a fresh scene. `refine` means keep the current scene and add one thing. `recolor` means the structure is fine and only the color or mood changed. A recolor stops here: step 1 already returned the color delta, the client eases it in without recompiling, and the second call is skipped. That path costs one request instead of two.

Step 2, emit the scene. For `new` and `refine`, a second call asks Gemma for the actual scene graph. This call uses a strict JSON schema (`response_format: { type: 'json_schema' }`), so the output is constrained at decode time to match the schema built from the primitive registry. Gemma cannot emit a structurally invalid graph. It can pick wrong, but it cannot return something the renderer fails to parse.

A scene graph looks like this:

```json
{
  "background": "#05010a",
  "layers": [
    {
      "prim": "clouds",
      "params": { "scale": 4, "octaves": 5, "warp": 0.8 },
      "color": "#3a0d6b", "colorB": "#ff7ad9",
      "blend": "screen", "opacity": 1,
      "ops": [{ "op": "swirl", "a": 2.5, "audio": { "src": "bass", "amount": 0.6 } }],
      "audio": [{ "param": "warp", "src": "level", "amount": 0.4 }]
    }
  ],
  "post": { "bloom": 0.3, "chroma": 0.15 },
  "palette": ["#05010a", "#3a0d6b", "#ff7ad9", "#ffe0ff"],
  "paletteAmount": 0.85,
  "exposure": 1.8
}
```

Each layer names one primitive, its parameters, a blend mode, a chain of operators that bend the field (polar, swirl, lens, radialMask, and so on), and a set of audio routes. Post-fx, palette, and exposure apply to the whole frame.

## The building blocks

Gemma does not write arbitrary code in the normal path. It composes from a fixed library defined in `src/compose/library.ts`:

- Primitives are the field generators: clouds, particles, lightning, voronoi, cymatic, drift, obra, moire, sumi. Each is a GLSL function that returns a coverage value from 0 to 1.
- Operators transform the coordinate or mask the result: polar, swirl, lens, zoom, scroll, warp, kaleido, mirror, radialMask, perspective, linearMask, rotate, ripple, skew.
- Post-fx are the screen-space passes: bloom, grayscale, pixelate, dots, scanlines, ascii, hue, chroma, radialBlur.

`library.ts` produces two things from this registry. `buildSpec()` writes the catalogue as text for the system prompt, so Gemma knows what exists and how each parameter behaves. `buildSchema()` writes the strict JSON schema for step 2, so the constrained decode only permits real primitive names, real operators, and parameters in range.

`src/compose/codegen.ts` does the reverse. It validates and clamps the graph (every number forced into its range, missing fields defaulted), then concatenates the GLSL for exactly the primitives and operators the graph uses into one `render()` function. Gemma chooses the parts; codegen assembles the shader.

## The custom GLSL escape hatch

Some prompts describe a real physical model rather than a texture. Waves, ripples, gravitational lensing, orbits, interference. For those, step 2 may return a layer that is raw GLSL instead of a primitive reference:

```json
{ "glsl": "float r = length(uv); return sin(r*18.0 - u_time*2.0)*0.5 + 0.5;" }
```

The body must return a coverage value from the centered `uv` and may read `u_time` and the audio uniforms. It is filtered (no preprocessor directives, no `main`, no texture sampling, no unbounded loops) and dropped into the same harness as the primitives. This is how Gemma can simulate something the fixed library does not contain.

## Multimodal input

Gemma 4 is multimodal, and the project uses that in two places.

Album art. When you load an mp3 with embedded cover art, the art is sent to Gemma, which writes a short text prompt describing it (`caption: true` in the request). That prompt seeds the first visual, so dropping a track is enough to get something on screen.

Reference image. Drag an image onto the window, or attach one, and Gemma reads it and designs a living visual inspired by its texture, composition, and implied motion. The exact palette is extracted from the pixels in the browser and treated as authoritative, so Gemma decides structure and motion while the colors come straight from the image.

Images are sent as Base64 data URIs in the OpenAI multimodal `image_url` shape.

## Why the screen never breaks

The model is allowed to be wrong, so there are guards after it. The graph passes through `validate()` in codegen, which clamps every value and fills defaults. The assembled shader is then trial-compiled and checked for brightness by `engine.testContent` in `src/engine/engine.ts` before it is shown. A shader that fails to compile, or comes out near-black or blown-out, is rejected and the current visual stays up. Constrained decoding keeps the structure valid. The compile and brightness probe keep the result watchable.

## Reactivity is the framework's job

The music never goes through Gemma. `src/audio.ts` runs the Web Audio analyser every frame and produces eight features: bass, mid, treble, level, beat, centroid, flux, and energy. These are GLSL uniforms. Gemma's contribution to reactivity is the audio routes it writes into the graph, for example bass driving a swirl or level driving cloud warp. The visual reacts even if Gemma adds no routes, because the engine always advances time and beat. The model decides how the scene moves with the music; the engine measures the music.

## Speed and caching

Cerebras runs the two-step chain in roughly half a second end to end, generating north of a thousand tokens per second. That latency is the point. Live typing reshapes the visual fast enough to feel direct, and an auto mode regenerates the scene on each detected drop in the track.

The system prompt carries the full building-block catalogue and is identical on every call. Cerebras caches that prefix automatically, and under the hackathon limits cached tokens do not count against the per-minute token budget, so the repeated catalogue is close to free after the first request. Live typing is paced to roughly one call every 1.5 seconds so requests do not pile up.

## Seeing it run

Press D for the dev panel. The Gemma section shows the last few generations live: the interpretation and approach from step 1, the per-step latency, token count, and tokens per second from Cerebras, badges for constrained decoding and image input, and the real system prompt, user prompt, and raw JSON for each step. It is the fastest way to see exactly what the model received and returned.

## Files that matter for the Gemma path

| File | Role |
|------|------|
| `api/compose.js` | Server proxy. Runs the two-step chain, handles caption and image and recolor, holds the Cerebras key, returns the trace |
| `src/compose/library.ts` | Primitive and operator registry. Builds the prompt catalogue and the strict output schema |
| `src/compose/codegen.ts` | Validates and clamps the graph, assembles the GLSL `render()` |
| `src/compose/palette.ts` | Extracts the palette from a reference image |
| `src/engine/engine.ts` | WebGL renderer, crossfade between scenes, compile and brightness probe |
| `src/audio.ts` | Web Audio features and offline section and BPM detection |
| `src/main.ts` | Wires prompt input, audio, compose calls, and the engine together |
| `src/ui/gemma.ts` | The dev-panel inspector for the live trace |

## Run

```bash
npm install
cp .env.example .env      # set CEREBRAS_API_KEY (and CEREBRAS_MODEL=gemma-4-31b)
npm run dev               # open the printed localhost URL, load a track, type a prompt
```

`npm run dev` serves both the front end and the `/api/compose` proxy through a small Vite plugin, so a Cerebras key is all you need locally.

Prompts to try: `dark neon tunnel pulsing on the bass`, `soft pastel clouds drifting`, `black hole bending light around a dark core`.
