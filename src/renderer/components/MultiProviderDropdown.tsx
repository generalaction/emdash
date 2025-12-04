import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ChevronDown } from 'lucide-react';
import { type Provider } from '../types';
import { type ProviderRun } from '../types/chat';
import { providerConfig } from '../lib/providerConfig';

const MAX_RUNS = 4;

interface MultiProviderDropdownProps {
  providerRuns: ProviderRun[];
  onChange: (providerRuns: ProviderRun[]) => void;
  className?: string;
}

// Sort providers with Claude first
const sortedProviders = Object.entries(providerConfig).sort(([keyA], [keyB]) => {
  if (keyA === 'claude') return -1;
  if (keyB === 'claude') return 1;
  return 0;
});

export const MultiProviderDropdown: React.FC<MultiProviderDropdownProps> = ({
  providerRuns,
  onChange,
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  const selectedProviders = new Set(providerRuns.map((pr) => pr.provider));
  const totalRuns = providerRuns.reduce((sum, pr) => sum + pr.runs, 0);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-9 w-full items-center justify-between rounded-md border-none bg-gray-100 px-3 text-sm dark:bg-gray-700 ${className}`}
        >
          <span className="flex items-center gap-2 truncate">
            {singleProviderConfig && (
              <img
                src={singleProviderConfig.logo}
                alt={singleProviderConfig.alt}
                className={`h-4 w-4 rounded-sm ${singleProviderConfig.invertInDark ? 'dark:invert' : ''}`}
              />
            )}
            {triggerText}
          </span>
          <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="z-[120] max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
      >
        {sortedProviders.map(([key, config]) => {
          const provider = key as Provider;
          const isSelected = selectedProviders.has(provider);
          const isLastSelected = isSelected && providerRuns.length === 1;

          return (
            <div
              key={key}
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
                  className={`h-4 w-4 rounded-sm ${config.invertInDark ? 'dark:invert' : ''}`}
                />
                <span className="text-sm">{config.name}</span>
              </div>
              {isSelected && (
                <Select
                  value={String(getProviderRuns(provider))}
                  onValueChange={(v) => updateRuns(provider, parseInt(v, 10))}
                >
                  <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 text-sm shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="right" className="z-[130] min-w-[4rem]">
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

export default MultiProviderDropdown;
