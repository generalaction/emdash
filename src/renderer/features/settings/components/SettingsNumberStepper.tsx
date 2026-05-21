import { Minus, Plus } from 'lucide-react';
import * as React from 'react';

type SettingsNumberStepperProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  label: string;
  unit?: string;
  onChange: (value: number) => void;
};

export function SettingsNumberStepper({
  value,
  min,
  max,
  step,
  disabled,
  label,
  unit,
  onChange,
}: SettingsNumberStepperProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const display = draft ?? String(value);
  const valueWidth = `${Math.max(display.length, 1)}ch`;
  const atMin = value <= min;
  const atMax = value >= max;

  const commitDraft = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      const clamped = clamp(parsed);
      if (clamped !== value) onChange(clamped);
    }
    setDraft(null);
  };

  const bump = (direction: 1 | -1) => {
    const next = clamp(value + direction * step);
    if (next !== value) onChange(next);
  };

  return (
    <div
      className="focus-within:ring-primary/20 flex h-8 w-[148px] flex-shrink-0 items-center rounded-md border border-border bg-background p-0.5 shadow-xs transition-colors focus-within:border-border-primary focus-within:ring-2 aria-disabled:opacity-60"
      aria-disabled={disabled || undefined}
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || atMin}
        onClick={() => bump(-1)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded text-foreground-passive transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Minus className="size-3.5" />
      </button>
      <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1 text-sm text-foreground tabular-nums">
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={display}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null) commitDraft(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              bump(1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              bump(-1);
            }
          }}
          style={{ width: valueWidth }}
          className="min-w-[1ch] bg-transparent text-center outline-none disabled:cursor-not-allowed"
        />
        {unit && <span className="text-xs text-foreground-passive">{unit}</span>}
      </div>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || atMax}
        onClick={() => bump(1)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded text-foreground-passive transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
