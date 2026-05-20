const TERMINAL_FONT_FALLBACKS = ['Menlo', 'Monaco', 'Consolas', 'monospace'];

const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

const quoteFontFamily = (fontFamily: string) => {
  const trimmed = fontFamily.trim();
  if (!trimmed) return '';
  if (CSS_GENERIC_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  if (/^(['"]).*\1$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

export const buildTerminalFontFamily = (fontFamily?: string) => {
  const customFontFamily = fontFamily?.trim();
  const families = customFontFamily
    ? [customFontFamily, ...TERMINAL_FONT_FALLBACKS]
    : TERMINAL_FONT_FALLBACKS;

  return Array.from(new Set(families.map(quoteFontFamily).filter(Boolean))).join(', ');
};
