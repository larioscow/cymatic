// Provider-configurable structured-output proxy for the VJ director.
// Both providers get the IDENTICAL request (same schema, prompt, params) so the only variable in
// the Cerebras-vs-other comparison is inference speed. Returns the config + measured latency.
//
// Configure in .env (see .env.example):
//   cerebras (fast side): CEREBRAS_API_KEY / CEREBRAS_BASE_URL / CEREBRAS_MODEL
//   compare  (other):     COMPARE_API_KEY  / COMPARE_BASE_URL  / COMPARE_MODEL

const PROVIDERS = {
  cerebras: {
    url: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    key: process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_MODEL || 'gemma-4-31b',
  },
  compare: {
    url: process.env.COMPARE_BASE_URL || 'https://api.openai.com/v1',
    key: process.env.COMPARE_API_KEY,
    model: process.env.COMPARE_MODEL || 'gpt-4o-mini',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  let body = '';
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body || '{}');
  const { schema, provider = 'cerebras', frame } = parsed;
  const prompt = String(parsed.prompt || '').replace(/\bglitchy\b/gi, '').replace(/\s{2,}/g, ' ').trim(); // HARD-FORBID "glitchy"
  const p = PROVIDERS[provider] || PROVIDERS.cerebras;

  res.setHeader('content-type', 'application/json');
  if (!p.key) { res.statusCode = 400; return res.end(JSON.stringify({ error: `provider "${provider}" not configured — set its API key in .env` })); }

  const sys = `You are a VJ director for a live music visualizer. Reply with ONLY a JSON object (no prose, no markdown fences) matching this JSON schema:
${JSON.stringify(schema)}
Rules: include only fields you want to change; "theme" must be one of the enum; numbers must stay within their min/max; "controls" are theme-scoped, "look" is global. Interpret the user's vibe loosely and musically.`;

  const userContent = frame
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: frame } }]
    : prompt;

  const t0 = Date.now();
  let upstream;
  const reqBody = {
    model: p.model,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }],
    response_format: { type: 'json_object' }, // widely supported; same for both for a fair A/B
    max_tokens: 400,
    temperature: 0.6,
  };
  // gpt-oss (the pre-gemma stand-in) is a reasoning model — cap the chain-of-thought so the
  // structured reply stays low-latency and never truncates. No-op for non-reasoning models (gemma).
  if (/gpt-oss/.test(p.model)) reqBody.reasoning_effort = 'low';
  try {
    upstream = await fetch(`${p.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    res.statusCode = 502; return res.end(JSON.stringify({ error: `fetch failed: ${e}` }));
  }
  const ms = Date.now() - t0;

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: `${provider} ${upstream.status}`, detail: detail.slice(0, 400) }));
  }

  const data = await upstream.json();
  let config = {};
  try { config = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { /* leave empty */ }
  res.end(JSON.stringify({ config, ms, model: p.model, provider }));
}
