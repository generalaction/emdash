import { DEFAULT_MONOSPACE_FONT_FAMILIES } from '@renderer/lib/monospace-font';

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

const splitFontFamilies = (fontFamily: string) => {
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

export const buildTerminalFontFamily = (fontFamily?: string) => {
  const customFontFamily = fontFamily?.trim();
  const families = customFontFamily
    ? [...splitFontFamilies(customFontFamily), ...DEFAULT_MONOSPACE_FONT_FAMILIES]
    : DEFAULT_MONOSPACE_FONT_FAMILIES;

  return Array.from(new Set(families.map(quoteFontFamily).filter(Boolean))).join(', ');
};
