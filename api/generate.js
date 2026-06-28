// Cerebras streaming proxy (Vercel Node function). Wired and correct, but inert until
// CEREBRAS_API_KEY is set + gemma-4-31b access opens (hackathon Sunday). Keeps the key
// server-side and streams plain GLSL deltas to the browser.

const SYSTEM = `You are a GLSL shader coder for a live music visualizer.
Output ONLY a single GLSL ES 3.00 function with EXACTLY this signature and nothing else:
vec3 render(vec2 uv){ ... }
These uniforms are ALREADY declared (do not redeclare): float u_time, u_bass, u_mid, u_treble, u_level, u_beat; vec2 u_res.
uv is aspect-corrected and centered at the origin. Make the visuals react to the audio uniforms.
No comments, no markdown fences, no main(), no extra functions.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  let body = '';
  for await (const chunk of req) body += chunk;
  let parsedBody;
  try { parsedBody = JSON.parse(body || '{}'); } catch { res.statusCode = 400; return res.end('invalid JSON body'); }
  const prompt = String(parsedBody.prompt || '').replace(/\bglitchy\b/gi, '').replace(/\s{2,}/g, ' ').trim(); // HARD-FORBID "glitchy"

  const base = process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1';
  const genBody = {
    model: process.env.CEREBRAS_MODEL || 'gemma-4-31b',
    stream: true,
    max_completion_tokens: 700,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: String(prompt || 'a calm ambient visual') },
    ],
  };
  // gpt-oss (pre-gemma stand-in) reasons by default; cap it so streamed GLSL stays fast.
  // (gemma-4-31b has reasoning off by default — guard is a no-op there.)
  if (/gpt-oss/.test(genBody.model)) genBody.reasoning_effort = 'low';
  const upstream = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
    },
    body: JSON.stringify(genBody),
  });

  if (!upstream.ok || !upstream.body) {
    res.statusCode = 502;
    return res.end(`upstream ${upstream.status}`);
  }

  res.setHeader('content-type', 'text/plain; charset=utf-8');
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') { return res.end(); }
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
        if (delta) res.write(delta);
      } catch { /* ignore keep-alives / partial frames */ }
    }
  }
  res.end();
}
