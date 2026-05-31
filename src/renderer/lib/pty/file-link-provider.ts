import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findFileLinks, type FileLinkMatch } from './file-link-detection';

let activationModifierPressed = false;
let activationModifierListenersAttached = false;

type LinkDecorations = NonNullable<ILink['decorations']>;

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

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
