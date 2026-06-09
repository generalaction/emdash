import { type ChangeEvent, useMemo } from 'react';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import {
  changePeriod,
  DEFAULT_CRON_STATE,
  formatTime,
  MONTH_LABELS,
  ordinal,
  parseCron,
  PERIOD_LABELS,
  PERIOD_ORDER,
  toCron,
  WEEKDAY_LABELS,
} from './cron-utils';
import type { CronPeriod, CronState } from './types';

interface CronPickerProps {
  value: string;
  onChange: (cron: string) => void;
  className?: string;
}

function useCronState(value: string): { state: CronState; parseError: boolean } {
  return useMemo(() => {
    const parsed = parseCron(value);
    if (parsed) return { state: parsed, parseError: false };
    return { state: DEFAULT_CRON_STATE, parseError: true };
  }, [value]);
}

/** Small inline <Select> styled to blend into the sentence. */
function InlineSelect({
  value,
  onValueChange,
  children,
  className,
  renderValue,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  /** Map the raw value to a display label. Required when value !== display text. */
  renderValue?: (v: string) => string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onValueChange(v);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          'h-7 border-border/60 bg-muted/20 px-2 text-sm font-medium hover:bg-muted/40',
          className
        )}
      >
        {renderValue ? <SelectValue>{renderValue}</SelectValue> : <SelectValue />}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
        {children}
      </SelectContent>
    </Select>
  );
}

/** Thin text label between selectors. */
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-foreground-passive">{children}</span>;
}

export function CronPicker({ value, onChange, className }: CronPickerProps) {
  const { state, parseError } = useCronState(value);

  function emit(next: CronState) {
    onChange(toCron(next));
  }

  function handlePeriodChange(period: string) {
    emit(changePeriod(state, period as CronPeriod));
  }

  function handleWeekDayChange(v: string) {
    emit({ ...state, weekDay: parseInt(v, 10) });
  }

  function handleMonthChange(v: string) {
    emit({ ...state, month: parseInt(v, 10) });
  }

  function handleMonthDayChange(v: string) {
    emit({ ...state, monthDay: parseInt(v, 10) });
  }

  function handleTimeChange(e: ChangeEvent<HTMLInputElement>) {
    const [rawH, rawM] = e.target.value.split(':');
    if (!rawH || !rawM) return;
    const hour = Math.max(0, Math.min(23, parseInt(rawH, 10)));
    const minute = Math.max(0, Math.min(59, parseInt(rawM, 10)));
    if (Number.isNaN(hour) || Number.isNaN(minute)) return;
    emit({ ...state, hour, minute });
  }

  function handleMinuteChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10);
    if (Number.isNaN(raw)) return;
    emit({ ...state, minute: Math.max(0, Math.min(59, raw)) });
  }

  const { period, hour, minute, weekDay, monthDay, month } = state;

  const showMonth = period === 'year';
  const showMonthDay = period === 'month' || period === 'year';
  const showWeekDay = period === 'week';
  const showTime = period === 'day' || period === 'week' || period === 'month' || period === 'year';
  const showHourMinute = period === 'hour';

  return (
    <div className={cn('flex flex-col gap-1.5 border p-2 rounded-md', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Label>Every</Label>

        {/* Period selector */}
        <InlineSelect value={period} onValueChange={handlePeriodChange}>
          {PERIOD_ORDER.map((p) => (
            <SelectItem key={p} value={p}>
              {PERIOD_LABELS[p]}
            </SelectItem>
          ))}
        </InlineSelect>

        {/* Year: month selector */}
        {showMonth && (
          <>
            <Label>in</Label>
            <InlineSelect
              value={String(month)}
              onValueChange={handleMonthChange}
              renderValue={(v) => MONTH_LABELS[parseInt(v, 10) - 1] ?? v}
            >
              {MONTH_LABELS.map((label, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {label}
                </SelectItem>
              ))}
            </InlineSelect>
          </>
        )}

        {/* Month / Year: day-of-month selector */}
        {showMonthDay && (
          <>
            <Label>on the</Label>
            <InlineSelect
              value={String(monthDay)}
              onValueChange={handleMonthDayChange}
              renderValue={(v) => ordinal(parseInt(v, 10))}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {ordinal(d)}
                </SelectItem>
              ))}
            </InlineSelect>
          </>
        )}

        {/* Week: day-of-week selector */}
        {showWeekDay && (
          <>
            <Label>on</Label>
            <InlineSelect
              value={String(weekDay)}
              onValueChange={handleWeekDayChange}
              renderValue={(v) => WEEKDAY_LABELS[parseInt(v, 10)] ?? v}
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <SelectItem key={i} value={String(i)}>
                  {label}
                </SelectItem>
              ))}
            </InlineSelect>
          </>
        )}

        {/* Day / Week / Month / Year: time input */}
        {showTime && (
          <>
            <Label>at</Label>
            <Input
              type="time"
              value={formatTime(hour, minute)}
              onChange={handleTimeChange}
              className="h-7 w-[110px] px-2 text-sm"
            />
          </>
        )}

        {/* Hour: minute-of-hour input */}
        {showHourMinute && (
          <>
            <Label>at minute</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={handleMinuteChange}
              className="h-7 w-[64px] px-2 text-sm"
            />
          </>
        )}
      </div>

      {parseError && (
        <p className="text-destructive text-xs">
          Could not parse the cron expression. Showing defaults — saving will overwrite it.
        </p>
      )}
    </div>
  );
}
