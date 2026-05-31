import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';

// Lookbehind on `:` keeps URLs (`https://...`) with WebLinksAddon.
const FILE_PATH_PATTERN =
  '(?<![\\w\\-./@:])(~/|/|\\.{1,2}/)?(?:[\\w\\-.@]+/)+[\\w\\-.@]+\\.[a-zA-Z][a-zA-Z0-9]{0,9}\\b';
const URL_PROTOCOL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const MAX_WRAPPED_LINE_LENGTH = 4096;
let activationModifierPressed = false;
let activationModifierListenersAttached = false;

type LinkDecorations = NonNullable<ILink['decorations']>;

type BufferLineLike = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
};

type BufferLike = {
  getLine(index: number): BufferLineLike | undefined;
};

type FileLinkMatch = {
  range: ILink['range'];
  text: string;
  isExternal: boolean;
};

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpenFile: (filePath: string) => void,
    private readonly onOpenExternal: (filePath: string) => void
  ) {
    attachActivationModifierListeners();
  }

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links = findFileLinks(this.terminal.buffer.active, bufferLineNumber).map((match) =>
      this.toXtermLink(match)
    );
    callback(links.length > 0 ? links : undefined);
  }

  private toXtermLink(match: FileLinkMatch): ILink {
    const decorations: LinkDecorations = {
      pointerCursor: activationModifierPressed,
      underline: activationModifierPressed,
    };
    const link: ILink = {
      range: match.range,
      text: match.text,
      decorations,
      hover: (event) => {
        setDecorations(link.decorations ?? decorations, isActivationModifierPressed(event));
      },
      leave: () => {
        setDecorations(link.decorations ?? decorations, false);
      },
      activate: (event, linkText) => {
        if (!isActivationModifierPressed(event)) return;
        if (match.isExternal) {
          this.onOpenExternal(linkText);
        } else {
          this.onOpenFile(normalizeFilePath(linkText));
        }
      },
      dispose: () => {
        setDecorations(link.decorations ?? decorations, false);
      },
    };
    return link;
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/^\.\//, '');
}

function isEmbeddedInUrl(text: string, startCol: number): boolean {
  const prefix = text.slice(0, startCol);
  const tokenStart = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'), -1) + 1;
  return URL_PROTOCOL_PATTERN.test(prefix.slice(tokenStart));
}

function setDecorations(decorations: LinkDecorations, enabled: boolean): void {
  decorations.pointerCursor = enabled;
  decorations.underline = enabled;
}

function attachActivationModifierListeners(): void {
  if (activationModifierListenersAttached || typeof window === 'undefined') return;
  activationModifierListenersAttached = true;
  window.addEventListener('keydown', updateActivationModifierState, true);
  window.addEventListener('keyup', updateActivationModifierState, true);
  window.addEventListener(
    'blur',
    () => {
      activationModifierPressed = false;
    },
    true
  );
}

function updateActivationModifierState(event: KeyboardEvent): void {
  activationModifierPressed = isActivationModifierPressed(event);
}

export function isActivationModifierPressed(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
  isMac = isMacPlatform()
): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

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
    const range = mapOffsetRangeToBufferRange(logicalLine, startOffset, endOffset);
    if (!range) continue;

    links.push({
      range,
      text: matched,
      isExternal: matched.startsWith('~/') || matched.startsWith('/'),
    });
  }
  return links;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

type LogicalLine = {
  startBufferIndex: number;
  lineTexts: string[];
  lineStartColumns: number[];
  text: string;
};

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
  const previousLine = buffer.getLine(expanded.startBufferIndex - 1)?.translateToString(true);
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
