import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findFileLinks, type FileLinkMatch } from './file-link-detection';

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpenFile: (filePath: string) => void,
    private readonly onOpenExternal: (filePath: string) => void
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links = findFileLinks(this.terminal.buffer.active, bufferLineNumber).map((match) =>
      this.toXtermLink(match)
    );
    callback(links.length > 0 ? links : undefined);
  }

  private toXtermLink(match: FileLinkMatch): ILink {
    const link: ILink = {
      range: match.range,
      text: match.text,
      decorations: {
        pointerCursor: true,
        underline: true,
      },
      activate: (_event, linkText) => {
        if (match.isExternal) {
          this.onOpenExternal(linkText);
        } else {
          this.onOpenFile(normalizeFilePath(linkText));
        }
      },
    };
    return link;
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/^\.\//, '');
}
