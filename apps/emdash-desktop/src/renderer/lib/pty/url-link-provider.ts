import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findUrlLinks } from './file-link-detection';

/**
 * Replaces @xterm/addon-web-links: that addon only follows soft-wrapped lines
 * (isWrapped), so URLs hard-wrapped by TUIs (real newlines at terminal width)
 * were detected as just their first-line fragment. This provider shares the
 * logical-line reconstruction with FileLinkProvider, which joins hard line
 * breaks that look like link continuations.
 */
export class UrlLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpenUrl: (url: string) => void
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links: ILink[] = findUrlLinks(this.terminal.buffer.active, bufferLineNumber).map(
      (match) => ({
        range: match.range,
        text: match.text,
        activate: (event: MouseEvent) => {
          event.preventDefault();
          this.onOpenUrl(match.text);
        },
      })
    );
    callback(links.length > 0 ? links : undefined);
  }
}
