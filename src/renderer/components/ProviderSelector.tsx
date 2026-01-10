import React, { useState } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { ProviderInfoCard } from './ProviderInfoCard';
import RoutingInfoCard from './RoutingInfoCard';
import { Workflow } from 'lucide-react';
import { Badge } from './ui/badge';
import type { UiProvider } from '@/providers/meta';
import { type Provider } from '../types';
import { providerConfig } from '../lib/providerConfig';

interface ProviderSelectorProps {
  value: Provider;
  onChange: (provider: Provider) => void;
  disabled?: boolean;
  className?: string;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
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
            onChange(v as Provider);
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
                  className={`h-9 w-full border-none bg-muted ${
                    disabled ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Provider is locked for this conversation.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <SelectTrigger className="h-9 w-full border-none bg-muted">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
        )}
        <SelectContent side="top" className="z-[120]">
          <TooltipProvider delayDuration={150}>
            {Object.entries(providerConfig).map(([key, config]) => (
              <TooltipRow key={key} id={key as UiProvider}>
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

const TooltipRow: React.FC<{ id: UiProvider; children: React.ReactElement }> = ({
  id,
  children,
}) => {
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
        <ProviderInfoCard id={id} />
      </TooltipContent>
    </Tooltip>
  );
};

export default ProviderSelector;

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
