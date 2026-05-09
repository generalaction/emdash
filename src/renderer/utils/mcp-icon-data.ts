export function coerceRawSvgContent(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'default' in payload &&
    typeof payload.default === 'string'
  ) {
    return payload.default;
  }

  return undefined;
}

export function prepareInlineSvgMarkup(svgContent: string): string {
  return svgContent
    .replace(/\bwidth="[^"]*"/g, '')
    .replace(/\bheight="[^"]*"/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace('<svg ', '<svg fill="currentColor" class="h-full w-full" ');
}
