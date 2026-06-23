export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function resolveCssVarColor(color: string): string {
  const cssVarMatch = color.trim().match(/^var\((--[^),\s]+)(?:,\s*(.+))?\)$/);
  if (!cssVarMatch) return color;

  const value = cssVar(cssVarMatch[1]);
  return value || cssVarMatch[2] || color;
}

/**
 * Converts any CSS color string (hex, hsl, color(display-p3 ...), color-mix, etc.)
 * to a hex string by painting a 1×1 canvas pixel and reading back the sRGB bytes.
 * Out-of-gamut P3 values are clamped to sRGB, which is imperceptible for UI chrome colors.
 * Resolves simple CSS variable references before painting.
 * Returns the original string unchanged if the canvas context is unavailable.
 */
export function cssColorToHex(cssColor: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return cssColor;
  const resolved = resolveCssVarColor(cssColor).trim();
  ctx.fillStyle = '#010203';
  ctx.fillStyle = resolved;
  if (ctx.fillStyle === '#010203' && resolved.toLowerCase() !== '#010203') return cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return a < 255 ? `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}` : `#${hex(r)}${hex(g)}${hex(b)}`;
}
