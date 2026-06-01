const TRAILING_URL_CHARS_PATTERN = /[),.!?;:'"<>}\]]+$/;

export function normalizeExternalHttpUrl(value: string): string {
  let url = value.trim();
  const trailingTextIndex = url.search(/\s/);
  if (trailingTextIndex !== -1) {
    url = url.slice(0, trailingTextIndex);
  }
  return url.replace(TRAILING_URL_CHARS_PATTERN, '');
}
