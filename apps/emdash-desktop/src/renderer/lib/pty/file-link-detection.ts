import type { ILink } from '@xterm/xterm';

// Lookbehind on `:` keeps URLs (`https://...`) with findUrlLinks below.
const FILE_PATH_PATTERN =
  '(?<![\\w\\-./@:])(~/|/|\\.{1,2}/)?(?:[\\w\\-.@]+/)+[\\w\\-.@]+\\.[a-zA-Z][a-zA-Z0-9]{0,9}\\b';
const URL_PROTOCOL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
// Same shape as @xterm/addon-web-links: greedy URL body, then one final char that
// excludes trailing punctuation so sentence-ending `.`/`,`/`)` stay out of the link.
const WEB_URL_PATTERN = /https?:\/\/[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/i;
const MAX_WRAPPED_LINE_LENGTH = 4096;

export type BufferLineLike = {
  isWrapped: boolean;
  /** Cell width of the row (xterm IBufferLine.length). A trimmed text of this
   * exact length means the row is filled to its last column. */
  length: number;
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

export type UrlLinkMatch = {
  range: ILink['range'];
  text: string;
};

type LogicalLine = {
  startBufferIndex: number;
  lineTexts: string[];
  lineStartColumns: number[];
  text: string;
};

export function findFileLinks(buffer: BufferLike, bufferLineNumber: number): FileLinkMatch[] {
  const logicalLine = getWrappedLogicalLine(buffer, bufferLineNumber - 1);
  if (!logicalLine || !logicalLine.text || logicalLine.text.indexOf('/') === -1) {
    return [];
  }

  const links: FileLinkMatch[] = [];
  // Fresh regex per call — module-level /g state isn't safe across reentrancy.
  const regex = new RegExp(FILE_PATH_PATTERN, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logicalLine.text)) !== null) {
    const matched = match[0];
    const startOffset = match.index;
    if (isEmbeddedInUrl(logicalLine.text, startOffset)) continue;
    const endOffset = startOffset + matched.length;
    for (const linkRange of mapMatchToLinkRanges(
      logicalLine,
      startOffset,
      endOffset,
      bufferLineNumber
    )) {
      links.push({
        range: linkRange,
        text: matched,
        isExternal: matched.startsWith('~/') || matched.startsWith('/'),
      });
    }
  }
  return links;
}

export function findUrlLinks(buffer: BufferLike, bufferLineNumber: number): UrlLinkMatch[] {
  const logicalLine = getWrappedLogicalLine(buffer, bufferLineNumber - 1);
  if (!logicalLine || logicalLine.text.indexOf('://') === -1) {
    return [];
  }

  const links: UrlLinkMatch[] = [];
  const regex = new RegExp(WEB_URL_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logicalLine.text)) !== null) {
    const matched = match[0];
    if (!hasValidUrlHostPrefix(matched)) continue;
    const startOffset = match.index;
    const endOffset = startOffset + matched.length;
    for (const linkRange of mapMatchToLinkRanges(
      logicalLine,
      startOffset,
      endOffset,
      bufferLineNumber
    )) {
      links.push({ range: linkRange, text: matched });
    }
  }
  return links;
}

function mapMatchToLinkRanges(
  logicalLine: LogicalLine,
  startOffset: number,
  endOffset: number,
  bufferLineNumber: number
): ILink['range'][] {
  const range = mapOffsetRangeToBufferRange(logicalLine, startOffset, endOffset);
  if (!range) return [];

  const visibleRanges = mapOffsetRangeToVisibleBufferRanges(logicalLine, startOffset, endOffset);
  const linkRanges = shouldUseVisibleRanges(visibleRanges) ? visibleRanges : [range];
  return linkRanges.filter((linkRange) => rangeContainsBufferLine(linkRange, bufferLineNumber));
}

// Mirrors @xterm/addon-web-links: the match must parse as a URL whose
// scheme://[auth@]host prefix reproduces the matched text's start.
function hasValidUrlHostPrefix(text: string): boolean {
  try {
    const url = new URL(text);
    const auth =
      url.password && url.username
        ? `${url.username}:${url.password}@`
        : url.username
          ? `${url.username}@`
          : '';
    const prefix = `${url.protocol}//${auth}${url.host}`;
    return text.toLowerCase().startsWith(prefix.toLowerCase());
  } catch {
    return false;
  }
}

function isEmbeddedInUrl(text: string, startCol: number): boolean {
  const prefix = text.slice(0, startCol);
  const tokenStart = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'), -1) + 1;
  return URL_PROTOCOL_PATTERN.test(prefix.slice(tokenStart));
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

  return expandHardLineBreakLinkContinuations(buffer, {
    startBufferIndex,
    lineTexts,
    lineStartColumns,
    text: lineTexts.join(''),
  });
}

function expandHardLineBreakLinkContinuations(
  buffer: BufferLike,
  logicalLine: LogicalLine
): LogicalLine {
  let expanded = logicalLine;

  while (true) {
    const firstLine = expanded.lineTexts[0];
    const previousBufferLine = buffer.getLine(expanded.startBufferIndex - 1);
    if (firstLine === undefined || !previousBufferLine || previousBufferLine.isWrapped) break;
    const previousLine = previousBufferLine.translateToString(true);
    if (
      !isHardBreakLinkContinuation(
        previousLine,
        firstLine,
        rowIsFull(previousBufferLine, 0, previousLine)
      )
    ) {
      break;
    }
    const joined: LogicalLine = {
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
    joined.text = joined.lineTexts.join('');
    if (joined.text.length > MAX_WRAPPED_LINE_LENGTH) break;
    expanded = joined;
  }

  while (true) {
    const lastLineIndex = expanded.startBufferIndex + expanded.lineTexts.length - 1;
    const lastBufferLine = buffer.getLine(lastLineIndex);
    const nextLine = buffer.getLine(lastLineIndex + 1)?.translateToString(true);
    if (!lastBufferLine || nextLine === undefined) break;
    const lastLineStartColumn = expanded.lineStartColumns[expanded.lineStartColumns.length - 1];
    const lastLineText = expanded.lineTexts[expanded.lineTexts.length - 1];
    if (
      lastLineText === undefined ||
      lastLineStartColumn === undefined ||
      !isHardBreakLinkContinuation(
        expanded.text,
        nextLine,
        rowIsFull(lastBufferLine, lastLineStartColumn, lastLineText)
      )
    ) {
      break;
    }
    const trimmedNextLine = trimPathContinuationStart(nextLine);
    const joined: LogicalLine = {
      startBufferIndex: expanded.startBufferIndex,
      lineTexts: [...expanded.lineTexts, trimmedNextLine],
      lineStartColumns: [...expanded.lineStartColumns, countLeadingWhitespace(nextLine)],
      text: expanded.text + trimmedNextLine,
    };
    if (joined.text.length > MAX_WRAPPED_LINE_LENGTH) break;
    expanded = joined;
  }

  return expanded;
}

function rowIsFull(bufferLine: BufferLineLike, startColumn: number, trimmedText: string): boolean {
  return startColumn + trimmedText.length === bufferLine.length;
}

function isHardBreakLinkContinuation(
  previousText: string,
  nextText: string,
  previousRowIsFull: boolean
): boolean {
  // Width rule (iTerm-style): a row filled to its last column followed by text
  // starting at column 0 is a hard wrap regardless of token shape. This is what
  // reconstructs edge-to-edge wrapped URLs when hovering a middle line, where
  // the protocol is out of sight of the token heuristics.
  if (previousRowIsFull && nextText.length > 0 && countLeadingWhitespace(nextText) === 0) {
    return true;
  }
  if (endsWithUrlContinuation(previousText)) {
    return startsWithUrlContinuation(nextText);
  }
  return endsWithPathContinuation(previousText) && startsWithPathContinuation(nextText);
}

function endsWithPathContinuation(text: string): boolean {
  const fragment = trailingToken(text);
  return fragment.includes('/') && !isEmbeddedInUrl(text, text.length - fragment.length);
}

function startsWithPathContinuation(text: string): boolean {
  const trimmed = trimPathContinuationStart(text);
  return /^[\w.\-@]+(?:\/|[\w.\-@]*\.[a-zA-Z][a-zA-Z0-9]{0,9}\b)/.test(trimmed);
}

function endsWithUrlContinuation(text: string): boolean {
  return URL_PROTOCOL_PATTERN.test(trailingToken(text));
}

// Stricter than the path variant: prose after a URL line ("and then ...") must not
// join, so the continuation needs a URL-ish shape — a slash, query/fragment chars,
// or an extension-like dot suffix in its first token.
function startsWithUrlContinuation(text: string): boolean {
  const trimmed = trimPathContinuationStart(text);
  return /^[\w.\-~%[\]]*(?:[/?#=&[\]]|\.[a-zA-Z][a-zA-Z0-9]{0,9}\b)/.test(trimmed);
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
