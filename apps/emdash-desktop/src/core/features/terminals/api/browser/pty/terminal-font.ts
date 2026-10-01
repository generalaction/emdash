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
  if (/^(['"])[^,'"]+\1$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

export const splitFontFamilies = (fontFamily: string) => {
  const families: string[] = [];
  let current = '';
  let quote: string | undefined;

  for (const char of fontFamily) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
    } else if (char === quote) {
      quote = undefined;
    }

    if (char === ',' && !quote) {
      families.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  families.push(current.trim());
  return families.filter(Boolean);
};

/** Builds a CSS font-family list: quoted custom families first, then fallbacks. */
export const buildFontFamilyStack = (
  fontFamily: string | undefined,
  fallbacks: readonly string[]
) => {
  const customFontFamily = fontFamily?.trim();
  const families = customFontFamily
    ? [...splitFontFamilies(customFontFamily), ...fallbacks]
    : fallbacks;

  return Array.from(new Set(families.map(quoteFontFamily).filter(Boolean))).join(', ');
};

export const buildTerminalFontFamily = (fontFamily?: string) =>
  buildFontFamilyStack(fontFamily, TERMINAL_FONT_FALLBACKS);
