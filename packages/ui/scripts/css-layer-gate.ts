function topLevelRuleHeaders(css: string): string[] {
  const headers: string[] = [];
  let cursor = 0;

  while (cursor < css.length) {
    while (cursor < css.length) {
      if (/\s/.test(css[cursor] ?? '')) {
        cursor += 1;
        continue;
      }
      if (css.startsWith('/*', cursor)) {
        const commentEnd = css.indexOf('*/', cursor + 2);
        if (commentEnd === -1) throw new Error('Unterminated CSS comment in aggregate');
        cursor = commentEnd + 2;
        continue;
      }
      break;
    }
    if (cursor >= css.length) break;

    const start = cursor;
    let quote: '"' | "'" | undefined;
    let escaped = false;

    while (cursor < css.length) {
      const character = css[cursor]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === quote) {
          quote = undefined;
        }
        cursor += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        cursor += 1;
        continue;
      }
      if (character === ';') {
        headers.push(css.slice(start, cursor + 1));
        cursor += 1;
        break;
      }
      if (character === '{') {
        headers.push(css.slice(start, cursor).trim());
        let depth = 1;
        cursor += 1;
        while (cursor < css.length && depth > 0) {
          const nestedCharacter = css[cursor]!;
          if (quote) {
            if (escaped) {
              escaped = false;
            } else if (nestedCharacter === '\\') {
              escaped = true;
            } else if (nestedCharacter === quote) {
              quote = undefined;
            }
          } else if (nestedCharacter === '"' || nestedCharacter === "'") {
            quote = nestedCharacter;
          } else if (nestedCharacter === '{') {
            depth += 1;
          } else if (nestedCharacter === '}') {
            depth -= 1;
          }
          cursor += 1;
        }
        break;
      }
      cursor += 1;
    }
  }

  return headers;
}

export function unlayeredRuleHeaders(css: string): string[] {
  const headers = topLevelRuleHeaders(css);
  const prelude = headers.find(
    (header) => header.startsWith('@layer ') && header.endsWith(';') && header.includes(',')
  );
  if (!prelude) throw new Error('Aggregate CSS is missing its canonical layer prelude');

  const canonicalLayers = prelude
    .slice('@layer '.length, -1)
    .split(',')
    .map((layer) => `@layer ${layer.trim()}`);
  const allowedLayerHeaders = new Set([
    prelude,
    ...canonicalLayers,
    ...canonicalLayers.map((header) => `${header};`),
  ]);

  return headers
    .filter(
      (header) =>
        !allowedLayerHeaders.has(header) &&
        header !== '@font-face' &&
        !header.startsWith('@keyframes ') &&
        !header.startsWith('@-webkit-keyframes ')
    )
    .map((header) => (header.length > 160 ? `${header.slice(0, 157)}...` : header));
}
