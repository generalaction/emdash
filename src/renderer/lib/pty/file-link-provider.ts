import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findFileLinks, type FileLinkMatch } from './file-link-detection';

let activationModifierListenersAttached = false;

type LinkDecorations = NonNullable<ILink['decorations']>;
type ActivationModifierEvent = Pick<MouseEvent, 'ctrlKey' | 'metaKey'>;

export class ActivationModifierTracker {
  private pressed = false;

  constructor(private readonly isMac = isMacPlatform()) {}

  decorations(): LinkDecorations {
    return {
      pointerCursor: this.pressed,
      underline: this.pressed,
    };
  }

  update(event: ActivationModifierEvent): boolean {
    this.pressed = isActivationModifierPressed(event, this.isMac);
    return this.pressed;
  }

  reset(): void {
    this.pressed = false;
  }
}

const activationModifierTracker = new ActivationModifierTracker();

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
    const decorations = activationModifierTracker.decorations();
    const link: ILink = {
      range: match.range,
      text: match.text,
      decorations,
      hover: (event) => {
        setDecorations(link.decorations ?? decorations, activationModifierTracker.update(event));
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
  window.addEventListener('mousemove', updateActivationModifierState, true);
  window.addEventListener('mousedown', updateActivationModifierState, true);
  window.addEventListener('mouseup', updateActivationModifierState, true);
  window.addEventListener(
    'blur',
    () => {
      activationModifierTracker.reset();
    },
    true
  );
}

function updateActivationModifierState(event: ActivationModifierEvent): void {
  activationModifierTracker.update(event);
}

export function isActivationModifierPressed(
  event: ActivationModifierEvent,
  isMac = isMacPlatform()
): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
