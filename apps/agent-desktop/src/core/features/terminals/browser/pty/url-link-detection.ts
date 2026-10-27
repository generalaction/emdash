import { normalizeTerminalHttpUrl } from '@agent/core/services/preview-detection/api';
import type { ILink } from '@xterm/xterm';
import type { BufferLike, BufferLineLike } from './file-link-detection';

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/gi;
const URL_BREAK_PATTERN = /[\s"'<>`]/;
// Per direction from the target row, so any URL up to this length is found from
// every row it covers. URLs cannot contain whitespace, so the scan is bounded by
// URL length rather than by the length of the logical line.
const MAX_WRAPPED_SCAN_LENGTH = 4096;
const HAS_HTTP_URL = /https?:\/\//i;

export type UrlLinkMatch = {
  range: ILink['range'];
  text: string;
};

type CellLike = {
  getChars(): string;
  getWidth(): number;
};

type BufferLineWithCells = BufferLineLike & {
  length: number;
  getCell(index: number): CellLike | undefined;
};

type Row = {
  line: BufferLineLike;
  text: string;
};

type WrappedSpan = {
  startBufferIndex: number;
  lineTexts: string[];
  columnForOffsetOnLine: Array<(offset: number) => number>;
  text: string;
  /** The scan stopped at the length cap while the soft-wrapped line continued. */
  truncatedStart: boolean;
  truncatedEnd: boolean;
};

export function findUrlLinks(buffer: BufferLike, bufferLineNumber: number): UrlLinkMatch[] {
  const span = getUrlSpan(buffer, bufferLineNumber - 1);
  if (!span || !HAS_HTTP_URL.test(span.text)) return [];

  const links: UrlLinkMatch[] = [];
  const regex = new RegExp(URL_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(span.text)) !== null) {
    // A match running into a cut-off edge may belong to a longer URL; never copy a fragment.
    if (span.truncatedStart && !URL_BREAK_PATTERN.test(span.text.slice(0, match.index))) continue;
    if (span.truncatedEnd && regex.lastIndex === span.text.length) continue;

    const text = normalizeTerminalHttpUrl(match[0]);
    if (!URL.canParse(text)) continue;
    const startOffset = match.index;
    const endOffset = startOffset + text.length;
    const range = mapOffsetRangeToBufferRange(span, startOffset, endOffset);
    if (!range) continue;

    if (rangeContainsBufferLine(range, bufferLineNumber)) {
      links.push({ range, text });
    }
  }
  return links;
}

/**
 * Rows of the target's soft-wrapped line that a URL touching the target row can
 * span. Only xterm's soft-wrap metadata joins rows, and since URLs cannot contain
 * whitespace, expansion stops after the first neighbouring row that has any.
 */
function getUrlSpan(buffer: BufferLike, bufferIndex: number): WrappedSpan | null {
  const target = readRow(buffer, bufferIndex);
  if (!target) return null;
  const canContinue = (row: Row) => row === target || !/\s/.test(row.text);

  const rows = [target];
  let startBufferIndex = bufferIndex;
  let top = target;
  let scannedAbove = 0;
  let truncatedStart = false;
  while (canContinue(top) && top.line.isWrapped) {
    const previous = readRow(buffer, startBufferIndex - 1);
    if (!previous) break;
    scannedAbove += previous.text.length;
    if (scannedAbove > MAX_WRAPPED_SCAN_LENGTH) {
      truncatedStart = true;
      break;
    }
    rows.unshift(previous);
    startBufferIndex -= 1;
    top = previous;
  }

  let bottom = target;
  let scannedBelow = 0;
  let truncatedEnd = false;
  while (canContinue(bottom)) {
    const next = readRow(buffer, startBufferIndex + rows.length);
    if (!next?.line.isWrapped) break;
    scannedBelow += next.text.length;
    if (scannedBelow > MAX_WRAPPED_SCAN_LENGTH) {
      truncatedEnd = true;
      break;
    }
    rows.push(next);
    bottom = next;
  }

  const lineTexts = rows.map((row) => row.text);
  return {
    startBufferIndex,
    lineTexts,
    columnForOffsetOnLine: rows.map((row) => columnMapForLine(row.line)),
    text: lineTexts.join(''),
    truncatedStart,
    truncatedEnd,
  };
}

function readRow(buffer: BufferLike, bufferIndex: number): Row | null {
  const line = bufferIndex >= 0 ? buffer.getLine(bufferIndex) : undefined;
  // xterm trims only empty cells (e.g. padding left when a wide character wraps),
  // so a printed space at the wrap boundary still separates a URL from prose.
  return line ? { line, text: line.translateToString(true) } : null;
}

function columnMapForLine(line: BufferLineLike): (offset: number) => number {
  if (!hasCellAccess(line)) {
    return (offset) => offset + 1;
  }

  const offsetColumns: number[] = [];
  for (let cellIndex = 0; cellIndex < line.length; cellIndex += 1) {
    const cell = line.getCell(cellIndex);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars() || ' ';
    const column = cellIndex + 1;
    for (let i = 0; i < chars.length; i += 1) {
      offsetColumns.push(column);
    }
  }
  return (offset) => offsetColumns[offset] ?? offset + 1;
}

function hasCellAccess(line: BufferLineLike): line is BufferLineWithCells {
  return (
    'length' in line &&
    'getCell' in line &&
    typeof (line as BufferLineWithCells).length === 'number' &&
    typeof (line as BufferLineWithCells).getCell === 'function'
  );
}

function mapOffsetRangeToBufferRange(
  span: WrappedSpan,
  startOffset: number,
  endOffset: number
): ILink['range'] | null {
  const start = mapOffsetToBufferPosition(span, startOffset);
  const end = mapOffsetToBufferPosition(span, endOffset - 1);
  if (!start || !end) return null;
  return { start, end };
}

function rangeContainsBufferLine(range: ILink['range'], bufferLineNumber: number): boolean {
  return range.start.y <= bufferLineNumber && range.end.y >= bufferLineNumber;
}

function mapOffsetToBufferPosition(
  span: WrappedSpan,
  offset: number
): ILink['range']['start'] | null {
  let remaining = offset;
  for (let lineIndex = 0; lineIndex < span.lineTexts.length; lineIndex += 1) {
    const lineLength = span.lineTexts[lineIndex]?.length ?? 0;
    if (remaining < lineLength) {
      return {
        x: span.columnForOffsetOnLine[lineIndex]?.(remaining) ?? remaining + 1,
        y: span.startBufferIndex + lineIndex + 1,
      };
    }
    remaining -= lineLength;
  }
  return null;
}
