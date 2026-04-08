import React, { useState } from 'react';
import { type UiAgent } from '@renderer/providers/meta';
import AgentInfoCard from './agent-info-card';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type TooltipSide = React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
type TooltipAlign = React.ComponentPropsWithoutRef<typeof TooltipContent>['align'];

interface AgentTooltipRowProps {
  id: UiAgent;
  children: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: TooltipSide;
  align?: TooltipAlign;
  contentClassName?: string;
}

type AgentTooltipChildProps = {
  onMouseEnter?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: React.PointerEvent<HTMLElement>) => void;
};

export const AgentTooltipRow: React.FC<AgentTooltipRowProps> = ({
  id,
  children,
  open,
  onOpenChange,
  side = 'right',
  align = 'start',
  contentClassName = 'border border-border bg-background p-0 text-foreground shadow-lg',
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const resolvedOpen = open ?? internalOpen;
  const child = children as React.ReactElement<AgentTooltipChildProps>;
  const childProps = child.props;

  const setOpen = (nextOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <Tooltip open={resolvedOpen}>
      <TooltipTrigger
        render={React.cloneElement(child, {
          onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
            childProps.onMouseEnter?.(event);
            setOpen(true);
          },
          onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
            childProps.onMouseLeave?.(event);
            setOpen(false);
          },
          onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
            childProps.onPointerEnter?.(event);
            setOpen(true);
          },
          onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
            childProps.onPointerLeave?.(event);
            setOpen(false);
          },
        })}
      />
      <TooltipContent
        side={side}
        align={align}
        showArrow={false}
        className={contentClassName}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        <AgentInfoCard id={id} />
      </TooltipContent>
    </Tooltip>
  );
};

export default AgentTooltipRow;
