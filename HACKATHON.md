# Cerebras × Google DeepMind — Gemma 4 24-Hour Hackathon

Build agents, refactor code, or explore codebases at the speed of thought using
**Gemma 4 31B** powered by **Cerebras** ultra-fast inference.

- **Location:** Cerebras Discord — `#gemma-4-hackathon`
- **Timeline:** 24h — Sun **Jun 28, 10:00 AM PT** → Mon **Jun 29, 10:00 AM PT**
- **Kickoff:** 30-min intro + Q&A with the Gemma 4 research team. All levels welcome.

## The core constraint

The project must use **Gemma 4 31B running on Cerebras as a central component**.
A second provider (e.g. Gemini) is allowed *only* for side-by-side speed/latency
comparison — Cerebras stays the primary model.

## Prizes & Tracks

| Track | Name | Prize | What wins |
|-------|------|-------|-----------|
| 1 | Multiverse Agents — Best Multi-Agent + Multimodal | $2K | Agent collaboration · multimodal (text/image/video) · Cerebras speed in action · innovation (incl. physical AI: robotics, IoT, 3D printing, autonomous labs) |
| 2 | People's Choice — Most Social Impressions | $2K | Organic X/Twitter reach · engagement · content quality · authentic community excitement |
| 3 | Enterprise Impact — Best Enterprise Use Case | $1K | Business impact · production readiness · technical excellence · AI differentiation |

You may submit to **multiple tracks** (separate Discord post per submission).

## Submission

Post demo video + project description in the track channel(s), public after kickoff:

- Track 1 → `#g4hackathon-multiverse-agents`
- Track 2 → `#g4hackathon-people-choice` **+ post on X, tag @Cerebras and @googlegemma**
- Track 3 → `#g4hackathon-enterprise-impact`

Resubmit/update as many times as you want until the deadline: **Mon Jun 29, 10:00 AM PDT**.

### Demo video requirements
- **Max 60 seconds**
- Clearly show Cerebras speed improving UX
- Recommended: side-by-side latency comparison vs a GPU-based provider
- Showcase key features, workflow, impact
- Hide personal/sensitive info if recording desktop (notifications, tabs, API keys, emails, creds)

## Model & API

| Item | Value |
|------|-------|
| Model | Gemma 4 31B (only variant hosted; **private preview** throughout event) |
| Model ID | `gemma-4-31b` |
| Endpoint | Standard Cerebras Inference API (OpenAI-compatible Chat Completions). No separate preview endpoint. |
| Auth | Your existing Cerebras API key (once granted preview access) |
| Inputs | Text **+ images** (text-only output) |
| Image format | OpenAI multimodal `image_url` — hosted URLs **and** Base64 data URIs |
| Structured outputs | Supported, incl. `strict: true` JSON schema |
| Tool calling | Supported |
| Reasoning | **Off by default.** Set `reasoning_effort` = `none` (off) / `low` / `medium` / `high` |
| Timing | Response includes usage stats + `time_info`; dedicated endpoints expose Prometheus metrics (TTFT, TPOT, e2e latency, tok/s, queue time, success rate) |

### Docs
- Gemma 4 31B model card (Cerebras-specific details, params, examples)
- Image Inputs guide
- Chat Completions API reference (text, image, streaming, tool-calling)
- Reasoning on Cerebras guide (`reasoning_effort`)

## Rate limits & access

- **Public free tier:** 30 RPM / 1M tokens-day.
- **Hackathon elevated capacity (per participant):** 100 RPM, 100K TPM, subject to platform demand.
- **Context:** raised to **5K MSL / 32K MCL**.
- **To get access:** sign up at Cerebras Cloud → find your **Org ID** → submit it via the
  capacity-increase form by **Sat Jun 27, 7:00 PM PT** (hard deadline, no late requests).
- Preview access starts **Sun Jun 28, 10:30 AM PT**, available through **Mon Jun 29, 10:00 AM PT**.

## Rules

- Pre-existing scaffolding/boilerplate/frameworks are allowed.
- Core project & functionality must be **built during the 24h** and must center on Gemma 4 on Cerebras.
- Team size: any, **2 recommended**. Elevated capacity is allocated **per participant**.

## Live support (Pacific Time)

- Sun Jun 28: **10:30 AM – 12:30 PM PT**
- Mon Jun 29: **9:00 AM – 10:00 AM PT**
- Otherwise monitored intermittently; overnight PDT troubleshooting is limited — test early.
