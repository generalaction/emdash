import React from 'react';
import { type Provider } from '../types';
import { providerConfig } from '../lib/providerConfig';

interface MultiProviderSelectorProps {
  value: Provider[];
  onChange: (next: Provider[]) => void;
  max?: number; // limit selection
  className?: string;
}

export const MultiProviderSelector: React.FC<MultiProviderSelectorProps> = ({
  value,
  onChange,
  max = 4,
  className = '',
}) => {
  const selected = new Set(value);
  const toggle = (p: Provider) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else {
      if (next.size >= max) return; // enforce limit
      next.add(p);
    }
    onChange(Array.from(next));
  };

  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${className}`}>
      {(Object.keys(providerConfig) as Provider[]).map((id) => {
        const info = providerConfig[id];
        const active = selected.has(id);
        return (
          <button
            type="button"
            key={id}
            onClick={() => toggle(id)}
            className={[
              'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm',
              active
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50',
            ].join(' ')}
            aria-pressed={active}
          >
            <img
              src={info.logo}
              alt={info.alt}
              className={`h-4 w-4 rounded-sm ${info.invertInDark ? 'dark:invert' : ''}`}
            />
            <span className="truncate">{info.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default MultiProviderSelector;
