import React, { useState } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { AgentInfoCard } from './AgentInfoCard';
import RoutingInfoCard from './RoutingInfoCard';
import { Workflow } from 'lucide-react';
import { Badge } from './ui/badge';
import type { UiAgent } from '@/providers/meta';
import { type Agent } from '../types';
import { agentConfig } from '../lib/agentConfig';

interface AgentSelectorProps {
  value: Agent;
  onChange: (agent: Agent) => void;
  disabled?: boolean;
  className?: string;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`relative block w-[12rem] min-w-0 ${className}`}>
      <Select
        value={value}
        onValueChange={(v) => {
          if (!disabled) {
            onChange(v as Agent);
          }
        }}
        disabled={disabled}
      >
        {disabled ? (
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-disabled
                  className={`w-full ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Agent is locked for this conversation.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
        )}
        <SelectContent side="top" className="z-[120]">
          <TooltipProvider delayDuration={150}>
            {Object.entries(agentConfig).map(([key, config]) => (
              <TooltipRow key={key} id={key as UiAgent}>
                <SelectItem value={key}>
                  <div className="flex items-center gap-2">
                    <img
                      src={config.logo}
                      alt={config.alt}
                      className={`h-4 w-4 rounded-sm ${config.invertInDark ? 'dark:invert' : ''}`}
                    />
                    <span>{config.name}</span>
                  </div>
                </SelectItem>
              </TooltipRow>
            ))}
            {false && (
              <RoutingTooltipRow>
                <SelectItem
                  value="__routing__"
                  onSelect={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <div
                    className="flex cursor-not-allowed items-center gap-2 opacity-70"
                    aria-disabled
                  >
                    <Workflow className="h-4 w-4 text-foreground/70" aria-hidden="true" />
                    <span className="mr-2">Routing</span>
                    <Badge className="ml-1 text-micro">Soon</Badge>
                  </div>
                </SelectItem>
              </RoutingTooltipRow>
            )}
          </TooltipProvider>
        </SelectContent>
      </Select>
    </div>
  );
};

const TooltipRow: React.FC<{ id: UiAgent; children: React.ReactElement }> = ({ id, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onPointerEnter: () => setOpen(true),
          onPointerLeave: () => setOpen(false),
        })}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="border-foreground/20 bg-background p-0 text-foreground"
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

export default AgentSelector;

export const RoutingTooltipRow: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onPointerEnter: () => setOpen(true),
          onPointerLeave: () => setOpen(false),
        })}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="border-foreground/20 bg-background p-0 text-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        <RoutingInfoCard />
      </TooltipContent>
    </Tooltip>
  );
};
