import React from 'react';
import { type UiAgent } from '@renderer/lib/providers/meta';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { AgentInfoCard } from './agent-info-card';

interface AgentTooltipRowProps {
  id: UiAgent;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

export const AgentTooltipRow: React.FC<AgentTooltipRowProps> = ({
  id,
  children,
  side = 'right',
  align = 'start',
}) => {
  return (
    <Popover>
      <PopoverTrigger openOnHover nativeButton={false} delay={0} closeDelay={0} render={children} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
      >
        <AgentInfoCard id={id} />
      </PopoverContent>
    </Popover>
  );
};
