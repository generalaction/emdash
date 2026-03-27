import React, { useState } from 'react';
import { AgentInfoCard } from './AgentInfoCard';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { UiAgent } from '@/providers/meta';

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

export const AgentTooltipRow: React.FC<AgentTooltipRowProps> = ({
  id,
  children,
  open,
  onOpenChange,
  side = 'right',
  align = 'start',
  contentClassName = 'border-foreground/20 bg-background p-0 text-foreground',
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const resolvedOpen = open ?? internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <Tooltip open={resolvedOpen}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
            children.props.onMouseEnter?.(event);
            setOpen(true);
          },
          onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
            children.props.onMouseLeave?.(event);
            setOpen(false);
          },
          onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
            children.props.onPointerEnter?.(event);
            setOpen(true);
          },
          onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
            children.props.onPointerLeave?.(event);
            setOpen(false);
          },
        })}
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
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
