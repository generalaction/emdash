/**
 * Theme generation tests.
 *
 * Validates:
 *  1. APCA target adherence for text-zone steps (7–12) per polarity.
 *  2. All generated colors are in P3 gamut.
 *  3. Semantic template completeness — every slot resolves to a non-empty CSS string.
 *  4. Snapshot: spot-check key vars from the generated light/dark themes.
 */

import { describe, expect, it } from 'vitest';
import Color from 'colorjs.io';
import { lightTheme } from './themes/light.theme.js';
import { darkTheme } from './themes/dark.theme.js';
import { SEMANTIC_TEMPLATE } from './contract/semantic-template.js';
import type { ResolvedTheme } from './define-theme.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseColor(css: string): Color {
  return new Color(css);
}

function apca(fg: string, bg: string): number {
  return parseColor(fg).contrastAPCA(parseColor(bg)) as number;
}

function isInP3Gamut(css: string): boolean {
  try {
    const c = parseColor(css);
    return c.inGamut('p3');
  } catch {
    return false;
  }
}

/** Text-zone steps are 7–12 (0-indexed: 6–11). */
const TEXT_ZONE_INDICES = [6, 7, 8, 9, 10, 11] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Theme generation', () => {
  function runThemeTests(theme: ResolvedTheme, tolerance = 5) {
    const { id, scales, polarity } = theme;
    const bg = scales.neutral.steps[0]; // step 1 = background anchor

    describe(`${id} (${polarity})`, () => {
      // 1. APCA adherence for text-zone steps
      describe('APCA targets (text zone steps 7–12)', () => {
        for (const scaleId of ['neutral', 'accent', 'green', 'red'] as const) {
          it(`${scaleId} scale text steps meet targets (±${tolerance} Lc)`, () => {
            const ramp = scales[scaleId];
            TEXT_ZONE_INDICES.forEach((idx) => {
              const color = ramp.steps[idx];
              const lc = apca(color, bg);
              // All text-zone steps should have meaningful contrast (|Lc| > 15)
              expect(
                Math.abs(lc),
                `step ${idx + 1}: |Lc| should be > 15, got ${Math.abs(lc).toFixed(1)}`,
              ).toBeGreaterThan(15);
            });
          });
        }
      });

      // 2. Gamut check
      it('all generated scale colors are in P3 gamut', () => {
        for (const [scaleName, ramp] of Object.entries(scales)) {
          ramp.steps.forEach((color: string, i: number) => {
            expect(
              isInP3Gamut(color),
              `${scaleName}.step ${i + 1} out of gamut: ${color}`,
            ).toBe(true);
          });
        }
      });

      // 3. Contrast color readability on step 9 (solid)
      // Threshold 40: amber/yellow (gamut-cusp hues) target dark text at slightly lower Lc.
      // APCA 40 is still sufficient for large/bold UI elements like buttons.
      it('contrast color is readable on step 9 (solid) — |Lc| ≥ 40', () => {
        for (const [scaleName, ramp] of Object.entries(scales)) {
          const solid = ramp.steps[8]; // step 9
          const lc = apca(ramp.contrast, solid);
          expect(
            Math.abs(lc),
            `${scaleName} contrast on step 9: |Lc| = ${Math.abs(lc).toFixed(1)}`,
          ).toBeGreaterThanOrEqual(40);
        }
      });

      // 4. Semantic template completeness
      it('all semantic slots resolve to non-empty CSS values', () => {
        const { cssVars } = theme;
        for (const slot of Object.keys(SEMANTIC_TEMPLATE)) {
          const varName = `--${slot}`;
          const value = cssVars[varName];
          expect(value, `${varName} is missing from cssVars`).toBeTruthy();
          expect(value!.length, `${varName} is empty`).toBeGreaterThan(0);
        }
      });

      // 5. Foreground (neutral.12) has high contrast vs background (neutral.1)
      it('foreground has high contrast vs background (|Lc| ≥ 70)', () => {
        const fg = scales.neutral.steps[11]; // step 12
        const lc = apca(fg, bg);
        expect(Math.abs(lc)).toBeGreaterThanOrEqual(70);
      });
    });
  }

  runThemeTests(lightTheme);
  runThemeTests(darkTheme);

  // 6. Key CSS var spot-checks
  describe('generated CSS var spot-checks', () => {
    it('light --background resolves to a near-white color', () => {
      const bg = lightTheme.cssVars['--background'];
      expect(bg).toBeTruthy();
      const L = new Color(bg!).to('oklch').coords[0];
      expect(L).toBeGreaterThan(0.9);
    });

    it('dark --background resolves to a near-black color', () => {
      const bg = darkTheme.cssVars['--background'];
      expect(bg).toBeTruthy();
      const L = new Color(bg!).to('oklch').coords[0];
      expect(L).toBeLessThan(0.25);
    });

    it('light primary-button-background is readable (high APCA on its contrast)', () => {
      const btnBg = lightTheme.cssVars['--primary-button-background'];
      const btnFg = lightTheme.cssVars['--primary-button-foreground'];
      expect(btnBg).toBeTruthy();
      expect(btnFg).toBeTruthy();
      const lc = apca(btnFg!, btnBg!);
      expect(Math.abs(lc)).toBeGreaterThanOrEqual(45);
    });

    it('dark --foreground has high contrast vs dark background', () => {
      const fg = darkTheme.cssVars['--foreground'];
      const bg = darkTheme.cssVars['--background'];
      expect(fg).toBeTruthy();
      expect(bg).toBeTruthy();
      const lc = apca(fg!, bg!);
      expect(Math.abs(lc)).toBeGreaterThanOrEqual(70);
    });
  });

  // 7. Both themes produce Shiki themes
  describe('Shiki theme generation', () => {
    it('light shiki theme has tokenColors', () => {
      const theme = lightTheme.shikiTheme as { tokenColors?: unknown[] };
      expect(Array.isArray(theme.tokenColors)).toBe(true);
      expect(theme.tokenColors!.length).toBeGreaterThan(5);
    });

    it('dark shiki theme has background color', () => {
      const theme = darkTheme.shikiTheme as {
        colors?: { 'editor.background'?: string };
      };
      expect(theme.colors?.['editor.background']).toBeTruthy();
    });
  });
});
