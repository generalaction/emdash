import type { ContentSearchRange } from '@runtimes/file-search/api';

export type ParsedRipgrepMatch = Readonly<{
  path: string;
  lineNumber: number;
  text: string;
  ranges: ContentSearchRange[];
}>;

/** Parses one ripgrep JSON-lines record; non-match records intentionally return null. */
export function parseRipgrepJsonLine(line: string): ParsedRipgrepMatch | null {
  const event = JSON.parse(line) as unknown;
  if (!isRecord(event) || event.type !== 'match') return null;
  if (!isRecord(event.data)) throw new Error('ripgrep match record has no data object');

  const pathText = decodeText(event.data.path, 'path').toString('utf8');
  const lineBytes = decodeText(event.data.lines, 'lines');
  const lineNumber = event.data.line_number;
  if (!Number.isInteger(lineNumber) || (lineNumber as number) < 1) {
    throw new Error('ripgrep match record has an invalid line number');
  }
  if (!Array.isArray(event.data.submatches) || event.data.submatches.length === 0) {
    throw new Error('ripgrep match record has no submatches');
  }

  const ranges = event.data.submatches.map((submatch): ContentSearchRange => {
    if (!isRecord(submatch)) throw new Error('ripgrep emitted an invalid submatch');
    const start = submatch.start;
    const end = submatch.end;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < 0 ||
      (end as number) <= (start as number) ||
      (end as number) > lineBytes.length
    ) {
      throw new Error('ripgrep emitted invalid submatch byte offsets');
    }
    return {
      startColumn: utf16ColumnAt(lineBytes, start as number),
      endColumn: utf16ColumnAt(lineBytes, end as number),
    };
  });

  return {
    path: pathText,
    lineNumber: lineNumber as number,
    text: stripLineTerminator(lineBytes.toString('utf8')),
    ranges,
  };
}

function decodeText(value: unknown, field: string): Buffer {
  if (!isRecord(value)) throw new Error(`ripgrep ${field} is not a text object`);
  if (typeof value.text === 'string') return Buffer.from(value.text, 'utf8');
  if (typeof value.bytes === 'string') return Buffer.from(value.bytes, 'base64');
  throw new Error(`ripgrep ${field} has neither text nor bytes`);
}

function utf16ColumnAt(line: Buffer, byteOffset: number): number {
  return line.subarray(0, byteOffset).toString('utf8').length + 1;
}

function stripLineTerminator(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n') || line.endsWith('\r')) return line.slice(0, -1);
  return line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
