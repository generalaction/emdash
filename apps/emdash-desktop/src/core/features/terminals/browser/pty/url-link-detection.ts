import { normalizeTerminalHttpUrl } from '@emdash/core/services/preview-detection/api';
import type { ILink } from '@xterm/xterm';
import type { BufferLike } from './file-link-detection';

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/gi;
const URL_CONTINUATION_CHARS_PATTERN = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;
const INCOMPLETE_HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>`]*$/i;
const LABELED_LINE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*:\s/;
const MAX_WRAPPED_LINE_LENGTH = 4096;
const HTTP_URL_PREFIX = /^https?:\/\//i;
const HAS_HTTP_URL = /https?:\/\//i;

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

export function findUrlLinks(buffer: BufferLike, bufferLineNumber: number): UrlLinkMatch[] {
  const logicalLine = getUrlLogicalLine(buffer, bufferLineNumber - 1);
  if (!logicalLine || !HAS_HTTP_URL.test(logicalLine.text)) return [];

  const links: UrlLinkMatch[] = [];
  const regex = new RegExp(URL_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(logicalLine.text)) !== null) {
    const text = normalizeTerminalHttpUrl(match[0]);
    if (!HTTP_URL_PREFIX.test(text)) continue;
    const startOffset = match.index;
    const endOffset = startOffset + text.length;
    const range = mapOffsetRangeToBufferRange(logicalLine, startOffset, endOffset);
    if (!range) continue;

    const visibleRanges = mapOffsetRangeToVisibleBufferRanges(logicalLine, startOffset, endOffset);
    const linkRanges = shouldUseVisibleRanges(visibleRanges) ? visibleRanges : [range];
    for (const linkRange of linkRanges) {
      if (!rangeContainsBufferLine(linkRange, bufferLineNumber)) continue;
      links.push({ range: linkRange, text });
    }
  }
  return links;
}

export function copyableTerminalSelection(text: string): string {
  if (!text.includes('\n') && !text.includes('\r')) return text;
  const normalized = normalizeTerminalHttpUrl(text);
  if (!HTTP_URL_PREFIX.test(normalized)) return text;
  const joined = text.replace(/\r?\n[ \t]*/g, '');
  const trimmedJoined = joined.replace(/[),.;:!?]+$/, '');
  if (normalized === joined || normalized === trimmedJoined) return normalized;
  return text;
}

export function isHttpUrl(text: string): boolean {
  return HTTP_URL_PREFIX.test(text);
}

function getUrlLogicalLine(buffer: BufferLike, bufferIndex: number): LogicalLine | null {
  const line = buffer.getLine(bufferIndex);
  if (!line) return null;

  let startBufferIndex = bufferIndex;
  while (startBufferIndex > 0 && buffer.getLine(startBufferIndex)?.isWrapped) {
    startBufferIndex -= 1;
  }

  const previousLine = buffer.getLine(startBufferIndex - 1);
  const previousText = previousLine?.translateToString(true) ?? '';
  const firstText = buffer.getLine(startBufferIndex)?.translateToString(true) ?? '';
  if (
    previousLine &&
    !previousLine.isWrapped &&
    shouldJoinUrlContinuation(previousText, firstText)
  ) {
    startBufferIndex -= 1;
  }

  const lineTexts: string[] = [];
  const lineStartColumns: number[] = [];
  let currentIndex = startBufferIndex;
  let totalLength = 0;
  while (true) {
    const currentLine = buffer.getLine(currentIndex);
    if (!currentLine) break;

    const raw = currentLine.translateToString(true);
    const isHardContinuation = currentIndex > startBufferIndex && !currentLine.isWrapped;
    const indent = isHardContinuation ? countLeadingWhitespace(raw) : 0;
    const text = isHardContinuation ? raw.slice(indent) : raw;
    lineTexts.push(text);
    lineStartColumns.push(indent);
    totalLength += text.length;
    if (totalLength > MAX_WRAPPED_LINE_LENGTH) return null;

    const nextLine = buffer.getLine(currentIndex + 1);
    if (!nextLine) break;
    if (nextLine.isWrapped) {
      currentIndex += 1;
      continue;
    }
    if (shouldJoinUrlContinuation(lineTexts.join(''), nextLine.translateToString(true))) {
      currentIndex += 1;
      continue;
    }
    break;
  }

  return {
    startBufferIndex,
    lineTexts,
    lineStartColumns,
    text: lineTexts.join(''),
  };
}

function shouldJoinUrlContinuation(previousText: string, nextText: string): boolean {
  if (!INCOMPLETE_HTTP_URL_PATTERN.test(previousText)) return false;
  const trimmedNext = nextText.trimStart();
  const previousChar = previousText[previousText.length - 1];
  const nextChar = trimmedNext[0];
  if (!previousChar || !nextChar || !URL_CONTINUATION_CHARS_PATTERN.test(nextChar)) return false;

  const hasIndent = /^\s/.test(nextText);
  const breaksUrlSegment = /[-._~:/?#[\]@!$&'()*+,;=%]/.test(previousChar);
  if (hasIndent && !breaksUrlSegment && LABELED_LINE_PATTERN.test(trimmedNext)) {
    return false;
  }
  return hasIndent || breaksUrlSegment;
}

function countLeadingWhitespace(text: string): number {
  return text.length - text.trimStart().length;
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
