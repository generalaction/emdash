import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findFileLinks, type FileLinkMatch } from './file-link-detection';

let activationModifierListenersAttached = false;

type LinkDecorations = NonNullable<ILink['decorations']>;
type ActivationModifierEvent = Pick<MouseEvent, 'ctrlKey' | 'metaKey'>;
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

export class ActivationModifierTracker {
  private hoveredDecorations: LinkDecorations | null = null;
  private hoveredRefresh: (() => void) | null = null;
  private pressed = false;

  constructor(private readonly isMac = isMacPlatform()) {}

  decorations(): LinkDecorations {
    return {
      pointerCursor: this.pressed,
      underline: this.pressed,
    };
  }

  update(event: ActivationModifierEvent): boolean {
    const next = this.isPressed(event);
    const changed = next !== this.pressed;
    this.pressed = next;
    this.syncHoveredDecorations();
    // xterm only re-reads link decorations on pointer events, so toggling the
    // modifier while the pointer sits still needs an explicit repaint to
    // show/hide the underline on the already-hovered link.
    if (changed) this.hoveredRefresh?.();
    return this.pressed;
  }

  isPressed(event: ActivationModifierEvent): boolean {
    return isActivationModifierPressed(event, this.isMac);
  }

  hover(decorations: LinkDecorations, event: ActivationModifierEvent, refresh?: () => void): void {
    this.hoveredDecorations = decorations;
    this.hoveredRefresh = refresh ?? null;
    this.update(event);
  }

  leave(decorations: LinkDecorations): void {
    if (this.hoveredDecorations === decorations) {
      this.hoveredDecorations = null;
      this.hoveredRefresh = null;
    }
    setDecorations(decorations, false);
  }

  reset(): void {
    this.pressed = false;
    this.syncHoveredDecorations();
    this.hoveredRefresh?.();
  }

  private syncHoveredDecorations(): void {
    if (!this.hoveredDecorations) return;
    setDecorations(this.hoveredDecorations, this.pressed);
  }
}

const activationModifierTracker = new ActivationModifierTracker();

export class FileLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpenFile: (filePath: string) => void,
    private readonly onOpenExternal: (filePath: string) => void,
    private readonly tracker = activationModifierTracker
  ) {
    attachActivationModifierListeners();
  }

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links = findFileLinks(this.terminal.buffer.active, bufferLineNumber).map((match) =>
      this.toXtermLink(match)
    );
    callback(links.length > 0 ? links : undefined);
  }

  private refreshViewport(): void {
    this.terminal.refresh(0, this.terminal.rows - 1);
  }

  private toXtermLink(match: FileLinkMatch): ILink {
    const decorations = this.tracker.decorations();
    const link: ILink = {
      range: match.range,
      text: match.text,
      decorations,
      hover: (event) => {
        this.tracker.hover(link.decorations ?? decorations, event, () => this.refreshViewport());
      },
      leave: () => {
        this.tracker.leave(link.decorations ?? decorations);
      },
      activate: (event, linkText) => {
        if (!this.tracker.isPressed(event)) return;
        if (match.isExternal) {
          this.onOpenExternal(linkText);
        } else {
          this.onOpenFile(normalizeFilePath(linkText));
        }
      },
      dispose: () => {
        this.tracker.leave(link.decorations ?? decorations);
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
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as NavigatorWithUserAgentData).userAgentData?.platform ?? navigator.platform;
  return /Mac|iPod|iPhone|iPad/i.test(platform);
}
