// Theme registry. Add a theme = add its file + one line here. Also derives the JSON-schema for
// Gemma's structured output from a theme's control spec (single source of truth).

import type { Theme, Control } from './types';
import { LOOK_PARAMS } from './types';
import { contour } from './contour';
import { obraDrift } from './obraDrift';
import { moireMecanique } from './moireMecanique';
import { driftlines } from './driftlines';
import { cymatic } from './cymatic';
import { sumi } from './sumi';

// contour = the idle/starting topographic background; the rest are the live song-arc themes.
export const THEME_LIST: Theme[] = [contour, driftlines, obraDrift, moireMecanique, cymatic, sumi];

export const THEMES: Record<string, Theme> = Object.fromEntries(THEME_LIST.map((t) => [t.id, t]));
export const DEFAULT_THEME = contour; // start on the slow B&W topographic background

/** Per-control JSON-schema fragment — fed to Gemma so it can only emit valid, in-range controls. */
function controlSchema(c: Control): object {
  if (c.kind === 'slider') return { type: 'number', minimum: c.min, maximum: c.max, description: c.label };
  if (c.kind === 'toggle') return { type: 'boolean', description: c.label };
  return { type: 'string', enum: c.options, description: c.label };
}

/** The full strict-JSON schema Gemma must conform to when directing this theme. */
export function themeDirectorSchema(theme: Theme): object {
  const controlProps: Record<string, object> = {};
  for (const c of theme.controls) controlProps[c.key] = controlSchema(c);

  const lookProps: Record<string, object> = {};
  for (const lp of LOOK_PARAMS) lookProps[lp.key] = { type: 'number', minimum: lp.min, maximum: lp.max, description: lp.desc };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      theme: { type: 'string', enum: THEME_LIST.map((t) => t.id), description: 'which theme to show' },
      controls: { type: 'object', additionalProperties: false, properties: controlProps, description: "THEME-SCOPED form knobs (reset when the theme changes)" },
      look: { type: 'object', additionalProperties: false, properties: lookProps, description: 'GLOBAL look — persists across theme switches; set rarely (overall grade/feel)' },
      palette: {
        type: 'object', additionalProperties: false,
        properties: { paper: { type: 'string' }, ink: { type: 'string' }, accent: { type: 'string' } },
        description: "this theme's palette override (hex)",
      },
    },
    required: ['theme', 'controls'],
  };
}
