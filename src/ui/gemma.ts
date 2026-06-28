// Gemma inspector — the dev-panel "under the hood" view. Renders, live, what Gemma 4 31B on
// Cerebras actually does per generation: the 2-step reasoning chain, the REAL prompts + raw JSON
// it returns, per-step Cerebras latency / tokens / tok-s, and the multimodal + constrained moments.
// Fed by the `trace` array /api/compose returns when the request sets trace:true (see api/compose.js).

export type TraceStep = {
  phase: string; label: string; model: string;
  ms: number; tokens: number; tps: number;
  constrained: boolean; multimodal: boolean;
  system: string; user: string; raw: unknown;
};
export type GemmaCall = { prompt: string; kind: string; trace: TraceStep[]; totalMs: number; tps: number };

const MAX = 6; // keep the last N generations

const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// A collapsed <details> with a scrollable <pre> body — for a raw prompt or raw JSON.
function pre(summary: string, body: string) {
  const d = document.createElement('details');
  d.className = 'graw';
  d.append(el('summary', undefined, summary), el('pre', undefined, body));
  return d;
}

const fmtJson = (v: unknown) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

export class GemmaInspector {
  readonly el: HTMLElement;
  private calls: GemmaCall[] = [];
  constructor(root: HTMLElement) { this.el = root; this.render(); }

  push(call: GemmaCall) {
    if (!call.trace?.length) return;                 // nothing to show (trace gated off / error)
    this.calls.unshift(call);
    if (this.calls.length > MAX) this.calls.length = MAX;
    this.render();
  }

  private render() {
    this.el.replaceChildren();
    this.el.append(el('div', 'ptitle', 'Gemma 4 31B · Cerebras'));
    if (!this.calls.length) { this.el.append(el('div', 'gempty', 'generate a visual — Gemma’s reasoning appears here')); return; }
    for (const c of this.calls) this.el.append(this.card(c));
  }

  private card(c: GemmaCall) {
    const card = el('div', 'gcall');
    const head = el('div', 'ghead');
    head.append(el('span', 'gbolt', '⚡'), el('span', 'gmodel', c.trace[0]?.model || 'gemma'));
    head.append(el('span', 'gspeed', `${c.totalMs}ms · ${c.tps} tok/s`));
    head.append(el('span', 'gkind', c.kind));
    card.append(head);
    if (c.prompt) card.append(el('div', 'gprompt', `“${c.prompt}”`));
    for (const s of c.trace) card.append(this.step(s));
    return card;
  }

  private step(s: TraceStep) {
    const wrap = el('div', 'gstep');
    const row = el('div', 'gsteprow');
    row.append(el('span', 'glabel', s.label));
    if (s.constrained) row.append(el('span', 'gbadge gbadge-lock', '🔒 constrained'));
    if (s.multimodal) row.append(el('span', 'gbadge gbadge-eye', '👁 multimodal'));
    wrap.append(row);
    wrap.append(el('div', 'gmeta', `${s.ms}ms · ${s.tokens} tok · ${s.tps} tok/s`));

    // interpret step: surface Gemma's reasoning inline — this IS the "thought process"
    const r = s.raw as any;
    if (s.phase === 'interpret' && r) {
      if (r.interpretation) wrap.append(el('div', 'gthought', `“${r.interpretation}”`));
      if (r.approach) wrap.append(el('div', 'gapproach', `approach: ${r.approach}`));
      const bits: string[] = [];
      if (r.diffType) bits.push(`diff: ${r.diffType}`);
      if (typeof r.mathFormula === 'boolean') bits.push(`math: ${r.mathFormula ? 'yes' : 'no'}`);
      if (bits.length) wrap.append(el('div', 'gdecide', bits.join('  ·  ')));
    }

    wrap.append(pre('▸ system prompt', s.system));
    wrap.append(pre('▸ user prompt', s.user));
    wrap.append(pre('▸ raw JSON ← Gemma', fmtJson(s.raw)));
    return wrap;
  }
}
