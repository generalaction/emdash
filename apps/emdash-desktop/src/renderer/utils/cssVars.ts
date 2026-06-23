export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function parseCssVarReference(color: string): { name: string; fallback?: string } | null {
  const trimmed = color.trim();
  if (!trimmed.startsWith('var(') || !trimmed.endsWith(')')) return null;

  const contents = trimmed.slice(4, -1).trim();
  const separatorIndex = contents.indexOf(',');
  const name = (separatorIndex === -1 ? contents : contents.slice(0, separatorIndex)).trim();
  if (!/^--[^\s,]+$/.test(name)) return null;

  const fallback = separatorIndex === -1 ? undefined : contents.slice(separatorIndex + 1).trim();
  return { name, fallback };
}

function resolveCssVarColor(color: string, seen = new Set<string>()): string {
  const cssVarReference = parseCssVarReference(color);
  if (!cssVarReference) return color;
  if (seen.has(cssVarReference.name)) return cssVarReference.fallback ?? color;

  seen.add(cssVarReference.name);
  const value = cssVar(cssVarReference.name);
  return resolveCssVarColor(value || cssVarReference.fallback || color, seen);
}

function isValidCSSColor(color: string): boolean {
  return typeof CSS === 'undefined' || CSS.supports('color', color);
}

/**
 * Converts any CSS color string (hex, hsl, color(display-p3 ...), color-mix, etc.)
 * to a hex string by painting a 1×1 canvas pixel and reading back the sRGB bytes.
 * Out-of-gamut P3 values are clamped to sRGB, which is imperceptible for UI chrome colors.
 * Resolves chained CSS variable references before painting.
 * Returns the original string unchanged if the color is invalid or the canvas context is unavailable.
 */
export function cssColorToHex(cssColor: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return cssColor;
  const resolved = resolveCssVarColor(cssColor).trim();
  if (!isValidCSSColor(resolved)) return cssColor;
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return a < 255 ? `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}` : `#${hex(r)}${hex(g)}${hex(b)}`;
}
