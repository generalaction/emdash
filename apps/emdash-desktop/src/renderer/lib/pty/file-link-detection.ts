import type { ILink } from '@xterm/xterm';

// Paths containing at least one directory separator. Any extension length is
// allowed because the surrounding `/` segments already make these unambiguous.
const DIR_PATH_PATTERN = '(~/|/|\\.{1,2}/)?(?:[\\w\\-.@]+/)+[\\w\\-.@]+\\.[a-zA-Z][a-zA-Z0-9]{0,9}';
// Bare filenames with no directory (e.g. `notes.md`). The extension must be at
// least two characters so common prose abbreviations ("e.g", "i.e", "U.S", "a.m")
// that only have a single trailing letter are not mistaken for files. This
// deliberately excludes single-char source extensions (`.c`, `.h`, `.m`, `.s`):
// those files are still linkable when written with a directory (`src/main.c`).
const BARE_FILE_PATTERN = '[\\w\\-.]+\\.[a-zA-Z][a-zA-Z0-9]{1,9}(?!/)';
// Lookbehind on `:` keeps URLs (`https://...`) with WebLinksAddon.
const FILE_PATH_PATTERN = `(?<![\\w\\-./@:])(?:${DIR_PATH_PATTERN}|${BARE_FILE_PATTERN})\\b`;
const URL_PROTOCOL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
// A bare `name.ext` is ambiguous: `notes.md` is a file, `paris.fr` a domain.
// Allowlisting known file extensions is more robust than blocklisting TLDs (many
// ccTLDs like `.rs`/`.sh` are also real source extensions). Paths with a `/` skip
// this gate, so uncommon extensions stay linkable when written as a path.
const BARE_FILE_EXTENSIONS = new Set([
  // Source code
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'py',
  'pyi',
  'pyw',
  'ipynb',
  'rb',
  'erb',
  'rake',
  'gemspec',
  'go',
  'rs',
  'swift',
  'dart',
  'jl',
  'zig',
  'nim',
  'asm',
  'java',
  'kt',
  'kts',
  'scala',
  'groovy',
  'clj',
  'cljs',
  'cljc',
  'cpp',
  'cxx',
  'cc',
  'hpp',
  'hxx',
  'hh',
  'cs',
  'php',
  'lua',
  'pl',
  'pm',
  'hs',
  'ml',
  'mli',
  'ex',
  'exs',
  'erl',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'sql',
  'prisma',
  'vue',
  'svelte',
  'astro',
  'sol',
  'proto',
  'graphql',
  'gql',
  // Config & data
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'properties',
  'csv',
  'tsv',
  'lock',
  'gradle',
  'plist',
  'tf',
  'tfvars',
  'hcl',
  'nix',
  'cmake',
  'mk',
  'bzl',
  // Markup, style & web
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'xml',
  'xsl',
  'xslt',
  'svg',
  // Docs
  'md',
  'mdx',
  'markdown',
  'txt',
  'rst',
  'adoc',
  'tex',
  'bib',
  'rtf',
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  // Assets
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'ico',
  'tiff',
  'tif',
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'mov',
  'avi',
  'mkv',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  // Misc
  'log',
  'diff',
  'patch',
  'snap',
  'map',
  'db',
  'sqlite',
  'sqlite3',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'bin',
  'dat',
]);
const MAX_WRAPPED_LINE_LENGTH = 4096;

export type BufferLineLike = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
};

export type BufferLike = {
  getLine(index: number): BufferLineLike | undefined;
};

export type FileLinkMatch = {
  range: ILink['range'];
  text: string;
  isExternal: boolean;
};

type LogicalLine = {
  startBufferIndex: number;
  lineTexts: string[];
  lineStartColumns: number[];
  text: string;
};

export function findFileLinks(buffer: BufferLike, bufferLineNumber: number): FileLinkMatch[] {
  const logicalLine = getWrappedLogicalLine(buffer, bufferLineNumber - 1);
  // Every file reference has an extension dot; bail cheaply when there's none.
  if (!logicalLine || !logicalLine.text || logicalLine.text.indexOf('.') === -1) {
    return [];
  }

  const links: FileLinkMatch[] = [];
  // Fresh regex per call — module-level /g state isn't safe across reentrancy.
  const regex = new RegExp(FILE_PATH_PATTERN, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logicalLine.text)) !== null) {
    const matched = match[0];
    const startOffset = match.index;
    if (isEmbeddedInUrl(logicalLine.text, startOffset) || isUnsupportedBareFile(matched)) continue;
    const endOffset = startOffset + matched.length;
    const range = mapOffsetRangeToBufferRange(logicalLine, startOffset, endOffset);
    if (!range) continue;

    const visibleRanges = mapOffsetRangeToVisibleBufferRanges(logicalLine, startOffset, endOffset);
    const linkRanges = shouldUseVisibleRanges(visibleRanges) ? visibleRanges : [range];
    for (const linkRange of linkRanges) {
      if (!rangeContainsBufferLine(linkRange, bufferLineNumber)) continue;
      links.push({
        range: linkRange,
        text: matched,
        isExternal: matched.startsWith('~/') || matched.startsWith('/'),
      });
    }
  }
  return links;
}

function isEmbeddedInUrl(text: string, startCol: number): boolean {
  const prefix = text.slice(0, startCol);
  const tokenStart = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'), -1) + 1;
  return URL_PROTOCOL_PATTERN.test(prefix.slice(tokenStart));
}

function isUnsupportedBareFile(text: string): boolean {
  if (text.includes('/')) return false;
  const extension = text.slice(text.lastIndexOf('.') + 1).toLowerCase();
  return !BARE_FILE_EXTENSIONS.has(extension);
}

function getWrappedLogicalLine(buffer: BufferLike, bufferIndex: number): LogicalLine | null {
  const line = buffer.getLine(bufferIndex);
  if (!line) return null;

  let startBufferIndex = bufferIndex;
  while (startBufferIndex > 0 && buffer.getLine(startBufferIndex)?.isWrapped) {
    startBufferIndex -= 1;
  }

  const lineTexts: string[] = [];
  const lineStartColumns: number[] = [];
  let currentIndex = startBufferIndex;
  let totalLength = 0;
  while (true) {
    const currentLine = buffer.getLine(currentIndex);
    if (!currentLine) break;

    const text = currentLine.translateToString(true);
    lineTexts.push(text);
    lineStartColumns.push(0);
    totalLength += text.length;
    if (totalLength > MAX_WRAPPED_LINE_LENGTH) return null;

    const nextLine = buffer.getLine(currentIndex + 1);
    if (!nextLine?.isWrapped) break;
    currentIndex += 1;
  }

  return expandHardLineBreakPathContinuations(buffer, {
    startBufferIndex,
    lineTexts,
    lineStartColumns,
    text: lineTexts.join(''),
  });
}

function expandHardLineBreakPathContinuations(
  buffer: BufferLike,
  logicalLine: LogicalLine
): LogicalLine {
  let expanded = logicalLine;
  const firstLine = expanded.lineTexts[0];
  const previousBufferLine = buffer.getLine(expanded.startBufferIndex - 1);
  const previousLine = previousBufferLine?.isWrapped
    ? undefined
    : previousBufferLine?.translateToString(true);
  if (
    firstLine !== undefined &&
    previousLine !== undefined &&
    endsWithPathContinuation(previousLine) &&
    startsWithPathContinuation(firstLine)
  ) {
    expanded = {
      startBufferIndex: expanded.startBufferIndex - 1,
      lineTexts: [
        previousLine,
        trimPathContinuationStart(firstLine),
        ...expanded.lineTexts.slice(1),
      ],
      lineStartColumns: [
        0,
        countLeadingWhitespace(firstLine),
        ...expanded.lineStartColumns.slice(1),
      ],
      text: '',
    };
    expanded.text = expanded.lineTexts.join('');
  }

  const lastLineIndex = expanded.startBufferIndex + expanded.lineTexts.length - 1;
  const nextLine = buffer.getLine(lastLineIndex + 1)?.translateToString(true);
  if (
    nextLine !== undefined &&
    endsWithPathContinuation(expanded.text) &&
    startsWithPathContinuation(nextLine)
  ) {
    const trimmedNextLine = trimPathContinuationStart(nextLine);
    expanded = {
      startBufferIndex: expanded.startBufferIndex,
      lineTexts: [...expanded.lineTexts, trimmedNextLine],
      lineStartColumns: [...expanded.lineStartColumns, countLeadingWhitespace(nextLine)],
      text: expanded.text + trimmedNextLine,
    };
  }

  return expanded.text.length > MAX_WRAPPED_LINE_LENGTH ? logicalLine : expanded;
}

function endsWithPathContinuation(text: string): boolean {
  const fragment = trailingToken(text);
  return fragment.includes('/') && !isEmbeddedInUrl(text, text.length - fragment.length);
}

function startsWithPathContinuation(text: string): boolean {
  const trimmed = trimPathContinuationStart(text);
  return /^[\w.\-@]+(?:\/|[\w.\-@]*\.[a-zA-Z][a-zA-Z0-9]{0,9}\b)/.test(trimmed);
}

function trimPathContinuationStart(text: string): string {
  return text.slice(countLeadingWhitespace(text));
}

function countLeadingWhitespace(text: string): number {
  return text.length - text.trimStart().length;
}

function trailingToken(text: string): string {
  const match = /[^\s([{"'`<]+$/.exec(text);
  return match?.[0] ?? '';
}

function mapOffsetRangeToBufferRange(
  logicalLine: LogicalLine,
  startOffset: number,
  endOffset: number
): ILink['range'] | null {
  const start = mapOffsetToBufferPosition(logicalLine, startOffset);
  const end = mapOffsetToBufferPosition(logicalLine, endOffset - 1);
  if (!start || !end) return null;
  return { start, end };
}

function mapOffsetRangeToVisibleBufferRanges(
  logicalLine: LogicalLine,
  startOffset: number,
  endOffset: number
): ILink['range'][] {
  const ranges: ILink['range'][] = [];
  let lineStartOffset = 0;
  for (let lineIndex = 0; lineIndex < logicalLine.lineTexts.length; lineIndex += 1) {
    const lineLength = logicalLine.lineTexts[lineIndex]?.length ?? 0;
    const lineEndOffset = lineStartOffset + lineLength;
    const segmentStartOffset = Math.max(startOffset, lineStartOffset);
    const segmentEndOffset = Math.min(endOffset, lineEndOffset);
    if (segmentStartOffset < segmentEndOffset) {
      const xOffset = logicalLine.lineStartColumns[lineIndex] ?? 0;
      const y = logicalLine.startBufferIndex + lineIndex + 1;
      ranges.push({
        start: {
          x: xOffset + segmentStartOffset - lineStartOffset + 1,
          y,
        },
        end: {
          x: xOffset + segmentEndOffset - lineStartOffset,
          y,
        },
      });
    }
    lineStartOffset = lineEndOffset;
  }
  return ranges;
}

function shouldUseVisibleRanges(ranges: ILink['range'][]): boolean {
  return ranges.some((range, index) => index > 0 && range.start.x > 1);
}

function rangeContainsBufferLine(range: ILink['range'], bufferLineNumber: number): boolean {
  return range.start.y <= bufferLineNumber && range.end.y >= bufferLineNumber;
}

function mapOffsetToBufferPosition(
  logicalLine: LogicalLine,
  offset: number
): ILink['range']['start'] | null {
  let remaining = offset;
  for (let lineIndex = 0; lineIndex < logicalLine.lineTexts.length; lineIndex += 1) {
    const lineLength = logicalLine.lineTexts[lineIndex]?.length ?? 0;
    if (remaining < lineLength) {
      return {
        x: (logicalLine.lineStartColumns[lineIndex] ?? 0) + remaining + 1,
        y: logicalLine.startBufferIndex + lineIndex + 1,
      };
    }
    remaining -= lineLength;
  }
  return null;
}
