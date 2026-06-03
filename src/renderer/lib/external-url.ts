const TRAILING_URL_CHARS_PATTERN = /[,.!?;:'"<>}\]]+$/;

function hasExtraClosingParen(value: string): boolean {
  let balance = 0;

  for (const char of value) {
    if (char === '(') {
      balance += 1;
    } else if (char === ')') {
      balance -= 1;
    }
  }

  return balance < 0;
}

export function normalizeExternalHttpUrl(value: string): string {
  let url = value.trim();
  const trailingTextIndex = url.search(/\s/);
  if (trailingTextIndex !== -1) {
    url = url.slice(0, trailingTextIndex);
  }
  url = url.replace(TRAILING_URL_CHARS_PATTERN, '');

  while (url.endsWith(')') && hasExtraClosingParen(url)) {
    url = url.slice(0, -1);
  }

  return url;
}
