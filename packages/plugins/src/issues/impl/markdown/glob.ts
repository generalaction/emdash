/**
 * The tiny glob dialect the markdown provider accepts for locating task files
 * inside a repository. Deliberately smaller than a globbing library: the
 * patterns are repository-relative, POSIX-separated, and only ever matched
 * against paths git or a directory walk already produced.
 *
 * Supported: `*` (one segment, no separator), `**` (any number of segments),
 * `?` (one character inside a segment). Everything else is a literal.
 */

const WILDCARD = /[*?]/u;

export type CompiledGlob = {
  /** The leading literal directory segments, joined with `/` (may be empty). */
  literalPrefix: string;
  /** Anchored matcher for a repository-relative, `/`-separated path. */
  matches(relativePath: string): boolean;
};

export function compileGlob(pattern: string): CompiledGlob {
  const normalized = normalizeGlob(pattern);
  const segments = normalized.split('/');
  const literalSegments: string[] = [];
  for (const segment of segments) {
    if (WILDCARD.test(segment)) break;
    literalSegments.push(segment);
  }
  // A trailing literal segment is the file name, never a directory to walk into.
  if (literalSegments.length === segments.length) literalSegments.pop();

  const regex = new RegExp(`^${globToRegexSource(normalized)}$`, 'u');
  return {
    literalPrefix: literalSegments.join('/'),
    matches: (relativePath) => regex.test(normalizePath(relativePath)),
  };
}

/** Repository-relative, forward-slashed, no leading `./` or `/`. */
export function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^\/+/u, '');
}

function normalizeGlob(pattern: string): string {
  const normalized = normalizePath(pattern.trim());
  if (!normalized) throw new Error('The task file pattern is empty.');
  if (normalized.split('/').includes('..')) {
    throw new Error(`The task file pattern must stay inside the repository: "${pattern}".`);
  }
  return normalized;
}

function globToRegexSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === '*') {
      const isDoubleStar = pattern[index + 1] === '*';
      if (isDoubleStar) {
        index += 1;
        // `**/` consumes its separator so it can also match zero segments.
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegexChar(char);
  }
  return source;
}

function escapeRegexChar(char: string): string {
  return /[\\^$.|+()[\]{}]/u.test(char) ? `\\${char}` : char;
}
