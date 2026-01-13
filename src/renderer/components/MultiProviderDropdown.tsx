import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Info } from 'lucide-react';
import { type Provider } from '../types';
import { type ProviderRun } from '../types/chat';
import { providerConfig } from '../lib/providerConfig';
import { ProviderInfoCard } from './ProviderInfoCard';
import type { UiProvider } from '@/providers/meta';

const MAX_RUNS = 4;

interface MultiProviderDropdownProps {
  providerRuns: ProviderRun[];
  onChange: (providerRuns: ProviderRun[]) => void;
  defaultProvider?: Provider;
  className?: string;
}

export const MultiProviderDropdown: React.FC<MultiProviderDropdownProps> = ({
  providerRuns,
  onChange,
  defaultProvider = 'claude',
  className = '',
}) => {
  // Sort providers with default provider first
  const sortedProviders = Object.entries(providerConfig).sort(([keyA], [keyB]) => {
    if (keyA === defaultProvider) return -1;
    if (keyB === defaultProvider) return 1;
    return 0;
  });
  const [open, setOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<Provider | null>(null);
  const [runsSelectOpenFor, setRunsSelectOpenFor] = useState<Provider | null>(null);

  const selectedProviders = new Set(providerRuns.map((pr) => pr.provider));

  // Checkbox: always add/remove (multi-select)
  const toggleProvider = (provider: Provider) => {
    if (selectedProviders.has(provider)) {
      if (providerRuns.length > 1) {
        onChange(providerRuns.filter((pr) => pr.provider !== provider));
      }
    } else {
      onChange([...providerRuns, { provider, runs: 1 }]);
    }
  };

  // Row click: switch when single, add when multiple
  const handleRowClick = (provider: Provider) => {
    if (selectedProviders.has(provider)) return;
    if (providerRuns.length === 1) {
      onChange([{ provider, runs: 1 }]);
    } else {
      onChange([...providerRuns, { provider, runs: 1 }]);
    }
  };

  const updateRuns = (provider: Provider, runs: number) => {
    onChange(providerRuns.map((pr) => (pr.provider === provider ? { ...pr, runs } : pr)));
  };

  const getProviderRuns = (provider: Provider): number => {
    return providerRuns.find((pr) => pr.provider === provider)?.runs ?? 1;
  };

  // Build trigger text: "Cursor, Gemini (2x), ..." - only show runs if >1
  const triggerText = providerRuns
    .map((pr) => {
      const name = providerConfig[pr.provider]?.name;
      return pr.runs > 1 ? `${name} (${pr.runs}x)` : name;
    })
    .join(', ');

  // Show logo only when single provider selected
  const singleProvider = providerRuns.length === 1 ? providerRuns[0] : null;
  const singleProviderConfig = singleProvider ? providerConfig[singleProvider.provider] : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Select
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) {
            setHoveredProvider(null);
            setRunsSelectOpenFor(null);
          }
        }}
      >
        <SelectTrigger
          className={`flex h-9 w-full items-center justify-between border-none bg-muted px-3 text-sm ${className}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {singleProviderConfig && (
              <img
                src={singleProviderConfig.logo}
                alt={singleProviderConfig.alt}
                className={`h-4 w-4 flex-shrink-0 rounded-sm ${singleProviderConfig.invertInDark ? 'dark:invert' : ''}`}
              />
            )}
            <span className="truncate">{triggerText}</span>
          </div>
        </SelectTrigger>
        <SelectContent
          side="top"
          className="z-[1000] max-h-80 w-[var(--radix-select-trigger-width)] overflow-y-auto p-1"
        >
          <TooltipProvider delayDuration={150}>
            {sortedProviders.map(([key, config]) => {
              const provider = key as Provider;
              const isSelected = selectedProviders.has(provider);
              const isLastSelected = isSelected && providerRuns.length === 1;

              return (
                <ProviderTooltipRow
                  key={key}
                  id={provider as UiProvider}
                  isHovered={hoveredProvider === provider || runsSelectOpenFor === provider}
                  onHover={() => setHoveredProvider(provider)}
                  onLeave={() => {
                    if (runsSelectOpenFor !== provider) {
                      setHoveredProvider(null);
                    }
                  }}
                >
                  <div
                    className="flex h-8 cursor-pointer items-center justify-between rounded-sm px-2 hover:bg-accent"
                    onClick={() => handleRowClick(provider)}
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isLastSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleProvider(provider);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <img
                        src={config.logo}
                        alt={config.alt}
                        className={`h-4 w-4 flex-shrink-0 rounded-sm ${config.invertInDark ? 'dark:invert' : ''}`}
                      />
                      <span className="text-sm">{config.name}</span>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1">
                        <Select
                          value={String(getProviderRuns(provider))}
                          onValueChange={(v) => updateRuns(provider, parseInt(v, 10))}
                          onOpenChange={(isSelectOpen) => {
                            setRunsSelectOpenFor(isSelectOpen ? provider : null);
                          }}
                        >
                          <SelectTrigger
                            className="h-6 w-auto gap-1 border-none bg-transparent p-0 text-sm shadow-none"
                            title="Run up to 4 instances of this agent to compare different solutions"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent side="right" className="z-[1001] min-w-[4rem]">
                            {[1, 2, 3, 4].map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n}x
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 opacity-40 hover:opacity-60" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="z-[10000] max-w-xs"
                            style={{ zIndex: 10000 }}
                          >
                            <p>
                              Run up to {MAX_RUNS} instances of this agent to compare different
                              solutions.{' '}
                              <a
                                href="https://docs.emdash.sh/best-of-n"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Docs
                              </a>
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </ProviderTooltipRow>
              );
            })}
          </TooltipProvider>
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
};

const ProviderTooltipRow: React.FC<{
  id: UiProvider;
  children: React.ReactElement;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}> = ({ id, children, isHovered, onHover, onLeave }) => {
  return (
    <Tooltip open={isHovered}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: onHover,
          onMouseLeave: onLeave,
          onPointerEnter: onHover,
          onPointerLeave: onLeave,
        })}
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="z-[1000] border-foreground/20 bg-background p-0 text-foreground"
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onPointerEnter={onHover}
        onPointerLeave={onLeave}
      >
        <ProviderInfoCard id={id} />
      </TooltipContent>
    </Tooltip>
  );
};

export default MultiProviderDropdown;
