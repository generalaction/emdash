export const DEFAULT_MONOSPACE_FONT_FAMILIES = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'Liberation Mono',
  'Courier New',
  'monospace',
] as const;

const formatCssFontFamily = (fontFamily: string) =>
  fontFamily.includes(' ') ? `'${fontFamily}'` : fontFamily;

export const DEFAULT_MONOSPACE_FONT_FAMILY =
  DEFAULT_MONOSPACE_FONT_FAMILIES.map(formatCssFontFamily).join(', ');
