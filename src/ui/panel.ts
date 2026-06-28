// The manual knob panel. Two sections:
//  - LOOK (global): persists across theme switches — exposure/contrast/grain/vignette/reactivity/
//    speed/transition. Writes to engine.setLook (same path as Gemma's DirectorConfig.look).
//  - THEME (scoped): the active theme's form controls + palette. Rebuilt on every theme switch.

import type { Engine } from '../engine/engine';
import { LOOK_PARAMS, FX_NAMES } from '../themes/types';

function sectionTitle(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ptitle';
  el.textContent = text;
  return el;
}

export function buildPanel(container: HTMLElement, engine: Engine) {
  container.replaceChildren();

  // ---- GLOBAL LOOK ----
  container.append(sectionTitle('Look · global'));
  const look = engine.getLook();
  for (const lp of LOOK_PARAMS) {
    const row = document.createElement('label');
    row.className = 'knob';
    row.title = lp.desc;
    const name = document.createElement('span');
    name.textContent = lp.label;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(lp.min); inp.max = String(lp.max); inp.step = String((lp.max - lp.min) / 200);
    inp.value = String(look[lp.key]);
    const val = document.createElement('em');
    val.textContent = look[lp.key].toFixed(2);
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); engine.setLook({ [lp.key]: v }); val.textContent = v.toFixed(2); });
    row.append(name, inp, val);
    container.append(row);
  }

  // ---- POST FX (look layer, 0..1) ----
  container.append(sectionTitle('Post FX'));
  const fx = engine.getFx();
  for (const k of FX_NAMES) {
    const row = document.createElement('label');
    row.className = 'knob';
    const name = document.createElement('span');
    name.textContent = k;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = '0'; inp.max = '1'; inp.step = '0.01';
    inp.value = String(fx[k]);
    const val = document.createElement('em');
    val.textContent = fx[k].toFixed(2);
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); engine.setFx(k, v); val.textContent = v.toFixed(2); });
    row.append(name, inp, val);
    container.append(row);
  }

  // ---- THEME-SCOPED ----
  container.append(sectionTitle(engine.activeTheme.name + ' · theme'));
  for (const c of engine.activeTheme.controls) {
    const row = document.createElement('label');
    row.className = 'knob';
    const name = document.createElement('span');
    name.textContent = c.label;
    row.append(name);

    if (c.kind === 'slider') {
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(c.min); inp.max = String(c.max); inp.step = String((c.max - c.min) / 200);
      inp.value = String(engine.controlTarget(c.key));
      const val = document.createElement('em');
      val.textContent = (+inp.value).toFixed(2);
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); engine.setControl(c.key, v); val.textContent = v.toFixed(2); });
      row.append(inp, val);
    } else if (c.kind === 'toggle') {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = engine.controlTarget(c.key) > 0.5;
      inp.addEventListener('change', () => engine.setToggle(c.key, inp.checked));
      row.append(inp);
    } else {
      const sel = document.createElement('select');
      c.options.forEach((o, i) => { const opt = document.createElement('option'); opt.value = String(i); opt.textContent = o; sel.append(opt); });
      sel.value = String(Math.round(engine.controlTarget(c.key)));
      sel.addEventListener('change', () => engine.setChoice(c.key, parseInt(sel.value, 10)));
      row.append(sel);
    }
    container.append(row);
  }

  for (const name of engine.colorNames()) {
    const row = document.createElement('label');
    row.className = 'knob';
    const label = document.createElement('span');
    label.textContent = name;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = engine.colorHex(name);
    inp.addEventListener('input', () => engine.setColor(name, inp.value));
    row.append(label, inp);
    container.append(row);
  }
}
