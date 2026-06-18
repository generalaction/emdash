/**
 * generate/syntax.ts
 *
 * Generates a Shiki/VSCode-format syntax theme from the resolved palette scales.
 *
 * Strategy:
 *   - Each SyntaxRole has a default palette assignment per polarity (from syntax-template.ts).
 *   - The assignment is resolved to a concrete color from the appropriate scale.step.
 *   - Minimum APCA contrast against the code background is enforced.
 *   - Roles are emitted as tokenColors scopes in VSCode theme format.
 *
 * Calibration target: the default light/dark assignments reproduce the visual
 * character of github-light / github-dark, adapted to our palette's hue choices.
 *
 * Explicit VSCode themes (imported JSON) pass through unmodified.
 */

import Color from 'colorjs.io';
import { SYNTAX_TEMPLATE } from '../contract/syntax-template.js';
import { SYNTAX_MIN_APCA } from '../contract/targets.js';
import type { Polarity, Scales, SyntaxRole } from '../contract/roles.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyntaxThemeInput =
  | { generate: true; roleOverrides?: Partial<Record<SyntaxRole, string>> }
  | { vscodeTheme: object }
  | string; // bundled Shiki theme name passthrough

export type GeneratedSyntaxTheme = object; // VSCode theme JSON format

// ── Palette ref resolution ────────────────────────────────────────────────────

/**
 * Resolve a palette ref like "success.11" or "neutral.contrast" to a CSS color.
 */
function resolveRef(ref: string, scales: Scales): string {
  const [scaleName, stepOrContrast] = ref.split('.') as [keyof Scales, string];
  const scale = scales[scaleName];
  if (!scale) throw new Error(`generateSyntax: unknown scale "${scaleName}" in ref "${ref}"`);

  if (stepOrContrast === 'contrast') return scale.contrast;

  const stepNum = parseInt(stepOrContrast, 10);
  if (isNaN(stepNum) || stepNum < 1 || stepNum > 12) {
    throw new Error(`generateSyntax: invalid step "${stepOrContrast}" in ref "${ref}"`);
  }

  return scale.steps[stepNum - 1];
}

/**
 * Resolve a palette ref and, if APCA vs bg is below the minimum, climb up
 * one step (toward higher contrast) until the threshold is met or we run out.
 */
function resolveWithMinContrast(
  ref: string,
  scales: Scales,
  bgColor: Color,
  minLc: number,
  _polarity: Polarity,
): string {
  const [scaleName, stepOrContrast] = ref.split('.') as [keyof Scales, string];
  const scale = scales[scaleName];
  if (!scale) return resolveRef(ref, scales);

  if (stepOrContrast === 'contrast') {
    return scale.contrast;
  }

  let stepNum = parseInt(stepOrContrast, 10);
  if (isNaN(stepNum)) return resolveRef(ref, scales);

  // For light mode, higher contrast = lower step number (toward 12).
  // For dark mode, higher contrast = higher step number (toward 12).
  const contrastDirection = 1; // always move toward step 12 for more contrast

  for (let attempt = 0; attempt < 4; attempt++) {
    const color = scale.steps[Math.min(11, stepNum - 1)];
    try {
      const c = new Color(color);
      const lc = Math.abs(c.contrastAPCA(bgColor) as number);
      if (lc >= minLc) return color;
    } catch {
      return color;
    }
    stepNum = Math.min(12, stepNum + contrastDirection);
  }

  return scale.steps[Math.min(11, stepNum - 1)];
}

// ── CSS color hex conversion ──────────────────────────────────────────────────

function colorToHex(cssColor: string): string {
  try {
    const c = new Color(cssColor);
    const srgb = c.to('srgb');
    const r = Math.round(Math.max(0, Math.min(1, srgb.coords[0])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, srgb.coords[1])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, srgb.coords[2])) * 255);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch {
    return cssColor;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a Shiki/VSCode-format syntax theme from the resolved palette.
 *
 * Returns the theme object ready to pass to shiki's createHighlighterCoreSync.
 */
export function generateSyntaxTheme(
  scales: Scales,
  polarity: Polarity,
  input: SyntaxThemeInput,
): GeneratedSyntaxTheme {
  // Pass through explicit themes unchanged
  if (typeof input === 'string') {
    return { name: input } as GeneratedSyntaxTheme;
  }
  if ('vscodeTheme' in input) {
    return input.vscodeTheme as GeneratedSyntaxTheme;
  }

  const { roleOverrides = {} } = input;

  // Code background = neutral scale step 1 (which is also --background in our template)
  const bgColorStr = scales.neutral.steps[0];
  const bgColor = new Color(bgColorStr);

  // Foreground = neutral step 12
  const fgColorStr = scales.neutral.steps[11];

  const tokenColors: Array<{ scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }> = [];

  for (const [role, entry] of Object.entries(SYNTAX_TEMPLATE) as Array<[SyntaxRole, (typeof SYNTAX_TEMPLATE)[SyntaxRole]]>) {
    // Resolve the palette ref
    const defaultRef = polarity === 'light' ? entry.lightDefault : entry.darkDefault;
    const ref = roleOverrides[role] ?? defaultRef;

    const minLc = SYNTAX_MIN_APCA[role] ?? SYNTAX_MIN_APCA['default'] ?? 45;
    const resolvedColor = resolveWithMinContrast(ref, scales, bgColor, minLc, polarity);
    const hexColor = colorToHex(resolvedColor);

    const settings: { foreground?: string; fontStyle?: string } = { foreground: hexColor };

    // Comments get italic by convention (matching gh-dark style)
    if (role === 'comment') {
      settings.fontStyle = 'italic';
    }

    tokenColors.push({
      scope: entry.scopes,
      settings,
    });
  }

  const themeName = `em-${polarity}`;
  const bgHex = colorToHex(bgColorStr);
  const fgHex = colorToHex(fgColorStr);
  const selectionHex = colorToHex(scales.blue.steps[5]); // blue.6
  const cursorHex = fgHex;

  return {
    name: themeName,
    type: polarity,
    colors: {
      'editor.background': bgHex,
      'editor.foreground': fgHex,
      'editor.selectionBackground': colorToHex(scales.blue.steps[5]) + '40', // with alpha
      'editor.lineHighlightBackground': colorToHex(scales.neutral.steps[1]),
      'editorCursor.foreground': cursorHex,
      'editor.findMatchBackground': selectionHex + '60',
      'editor.findMatchHighlightBackground': selectionHex + '30',
      'editorLineNumber.foreground': colorToHex(scales.neutral.steps[8]),
      'editorLineNumber.activeForeground': colorToHex(scales.neutral.steps[11]),
      'editorIndentGuide.background': colorToHex(scales.neutral.steps[4]),
      'editorBracketMatch.background': colorToHex(scales.blue.steps[3]),
      'editorBracketMatch.border': colorToHex(scales.blue.steps[6]),
      'scrollbarSlider.background': colorToHex(scales.neutral.steps[5]) + '60',
      'scrollbarSlider.hoverBackground': colorToHex(scales.neutral.steps[6]) + '80',
    },
    tokenColors,
    semanticHighlighting: true,
  };
}
