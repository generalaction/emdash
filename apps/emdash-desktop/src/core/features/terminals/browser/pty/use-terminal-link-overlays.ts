import { useEffect, useState } from 'react';
import { activationModifierKeyName } from '@core/features/terminals/api/browser/pty/file-link-provider';
import type {
  TerminalLinkActions,
  TerminalLinkOverlayEvent,
} from '@core/features/terminals/api/browser/pty/pty';

export type TerminalLinkTooltipState = {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  hint: string;
};

export type TerminalLinkPopoverState = {
  visible: boolean;
  x: number;
  y: number;
  path: string;
};

export type TerminalSelectionState = {
  visible: boolean;
  x: number;
  y: number;
  text: string;
};

export type TerminalLinkOverlayState = {
  tooltip: TerminalLinkTooltipState;
  filePopover: TerminalLinkPopoverState;
  selectionPopover: TerminalSelectionState;
  closeTooltip: () => void;
  closeFilePopover: () => void;
  closeSelectionPopover: () => void;
};

/**
 * Hosts the terminal link overlays (hover tooltip, cmd+click file popover,
 * selection menu). Reacts to FrontendPty link-overlay events; popover
 * coordinates come from the tracked pointer position since xterm reports raw
 * MouseEvent data rather than React anchors.
 */
export function useTerminalLinkOverlays(options: {
  subscribe: (listener: (event: TerminalLinkOverlayEvent) => void) => () => void;
  getPointer: () => { x: number; y: number };
  linkActions?: TerminalLinkActions;
}): TerminalLinkOverlayState {
  const { subscribe, getPointer, linkActions } = options;

  const [tooltip, setTooltip] = useState<TerminalLinkTooltipState>({
    visible: false,
    x: 0,
    y: 0,
    text: '',
    hint: '',
  });
  const [filePopover, setFilePopover] = useState<TerminalLinkPopoverState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
  });
  const [selectionPopover, setSelectionPopover] = useState<TerminalSelectionState>({
    visible: false,
    x: 0,
    y: 0,
    text: '',
  });

  useEffect(() => {
    if (!linkActions) return;

    const unsubscribe = subscribe((event) => {
      const pointer = getPointer();
      switch (event.type) {
        case 'file-link-hover': {
          setTooltip({
            visible: true,
            x: pointer.x,
            y: pointer.y,
            text: event.path,
            hint: `${activationModifierKeyName()}+Click to open`,
          });
          break;
        }
        case 'file-link-hover-end': {
          setTooltip((prev) => ({ ...prev, visible: false }));
          break;
        }
        case 'file-link-popover': {
          setTooltip((prev) => ({ ...prev, visible: false }));
          setFilePopover({ visible: true, x: pointer.x, y: pointer.y, path: event.path });
          break;
        }
        case 'selection-change': {
          if (event.text) {
            setSelectionPopover({ visible: true, x: pointer.x, y: pointer.y, text: event.text });
          } else {
            setSelectionPopover((prev) => ({ ...prev, visible: false }));
          }
          break;
        }
      }
    });
    return unsubscribe;
  }, [subscribe, getPointer, linkActions]);

  return {
    tooltip,
    filePopover,
    selectionPopover,
    closeTooltip: () => setTooltip((prev) => ({ ...prev, visible: false })),
    closeFilePopover: () => setFilePopover((prev) => ({ ...prev, visible: false })),
    closeSelectionPopover: () => setSelectionPopover((prev) => ({ ...prev, visible: false })),
  };
}
