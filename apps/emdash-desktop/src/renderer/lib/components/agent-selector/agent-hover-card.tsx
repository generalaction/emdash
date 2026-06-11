import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent } from '@renderer/lib/ui/popover';
import { type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { AgentInfoCard } from './agent-info-card';

const OPEN_DELAY_MS = 500;
const CLOSE_DELAY_MS = 200;

interface RowHoverProps {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

export interface AgentHoverCardController {
  open: boolean;
  activeId: AgentProviderId | null;
  getRowHoverProps: (id: AgentProviderId) => RowHoverProps;
  popupHoverProps: RowHoverProps;
  handleOpenChange: (open: boolean) => void;
  close: () => void;
}

/**
 * Shared hover-card timing for the agent list. A single card is shown after a
 * one-second delay on first hover; while it is open, hovering other rows swaps
 * the content instantly instead of reopening. Moving onto the card keeps it open
 * so its links/copy button stay interactive.
 */
export function useAgentHoverCard(): AgentHoverCardController {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<AgentProviderId | null>(null);
  const openRef = useRef(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const setOpenState = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearOpenTimer, clearCloseTimer]
  );

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenState(false);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer, setOpenState]);

  const handleRowEnter = useCallback(
    (id: AgentProviderId) => {
      clearCloseTimer();
      setActiveId(id);
      // Already warm → just switched content, no reopen and no delay.
      if (openRef.current) return;
      if (openTimer.current === null) {
        openTimer.current = window.setTimeout(() => {
          openTimer.current = null;
          setOpenState(true);
        }, OPEN_DELAY_MS);
      }
    },
    [clearCloseTimer, setOpenState]
  );

  const handleRowLeave = useCallback(() => {
    clearOpenTimer();
    scheduleClose();
  }, [clearOpenTimer, scheduleClose]);

  const getRowHoverProps = useCallback(
    (id: AgentProviderId): RowHoverProps => ({
      onMouseEnter: () => handleRowEnter(id),
      onMouseLeave: handleRowLeave,
    }),
    [handleRowEnter, handleRowLeave]
  );

  const popupHoverProps: RowHoverProps = {
    onMouseEnter: clearCloseTimer,
    onMouseLeave: scheduleClose,
  };

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        clearOpenTimer();
        clearCloseTimer();
      }
      setOpenState(next);
    },
    [clearOpenTimer, clearCloseTimer, setOpenState]
  );

  const close = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpenState(false);
  }, [clearOpenTimer, clearCloseTimer, setOpenState]);

  return {
    open,
    activeId,
    getRowHoverProps,
    popupHoverProps,
    handleOpenChange,
    close,
  };
}

interface AgentHoverCardProps {
  anchor: HTMLElement | null;
  controller: AgentHoverCardController;
  connectionId?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

/** Single shared hover card anchored beside the combobox panel. */
export const AgentHoverCard: React.FC<AgentHoverCardProps> = ({
  anchor,
  controller,
  connectionId,
  side = 'right',
  align = 'start',
}) => {
  const { open, activeId, popupHoverProps, handleOpenChange } = controller;

  if (!anchor || !activeId) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverContent
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        className="w-auto p-0 text-foreground"
        onMouseEnter={popupHoverProps.onMouseEnter}
        onMouseLeave={popupHoverProps.onMouseLeave}
      >
        <AgentInfoCard id={activeId} connectionId={connectionId} />
      </PopoverContent>
    </Popover>
  );
};
