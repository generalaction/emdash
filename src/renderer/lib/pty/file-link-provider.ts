import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';

// Lookbehind on `:` keeps URLs (`https://...`) with WebLinksAddon.
const FILE_PATH_PATTERN =
  '(?<![\\w\\-./@:])(~/|/|\\.{1,2}/)?(?:[\\w\\-.@]+/)+[\\w\\-.@]+\\.[a-zA-Z][a-zA-Z0-9]{0,9}\\b';

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpenFile: (filePath: string) => void,
    private readonly onOpenExternal: (filePath: string) => void
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }
    const text = line.translateToString(true);
    if (!text || text.indexOf('/') === -1) {
      callback(undefined);
      return;
    }

    const links: ILink[] = [];
    // Fresh regex per call — module-level /g state isn't safe across reentrancy.
    const regex = new RegExp(FILE_PATH_PATTERN, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matched = match[0];
      const startCol = match.index;
      const endCol = startCol + matched.length;
      const isExternal = matched.startsWith('~/') || matched.startsWith('/');

      links.push({
        range: {
          start: { x: startCol + 1, y: bufferLineNumber },
          end: { x: endCol, y: bufferLineNumber },
        },
        text: matched,
        decorations: { pointerCursor: true, underline: true },
        activate: (_event, linkText) => {
          if (isExternal) {
            this.onOpenExternal(linkText);
          } else {
            this.onOpenFile(normalizeFilePath(linkText));
          }
        },
      });
    }
    callback(links.length > 0 ? links : undefined);
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/^\.\//, '');
}
