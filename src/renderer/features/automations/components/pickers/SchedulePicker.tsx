import { CalendarClock, ChevronDown } from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { formatCronLabel } from '@shared/automations/format';
import {
  DEFAULT_SCHEDULE,
  INTERVAL_MINUTE_OPTIONS,
  parseCronToSchedule,
  SCHEDULE_KIND_LABELS,
  SCHEDULE_KIND_ORDER,
  scheduleToCron,
  WEEKDAY_LABELS,
  WEEKDAY_TOKENS,
  type ScheduleKind,
  type ScheduleSpec,
  type WeekdayToken,
} from '@shared/automations/schedule';
import { PILL_TRIGGER_CLASS } from './pill-trigger';

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function changeScheduleKind(prev: ScheduleSpec, kind: ScheduleKind): ScheduleSpec {
  const hour = prev.kind === 'interval' || prev.kind === 'hourly' ? 9 : prev.hour;
  const minute = prev.kind === 'interval' ? 0 : prev.minute;
  switch (kind) {
    case 'daily':
    case 'weekdays':
    case 'weekends':
      return { kind, hour, minute };
    case 'weekly': {
      const weekday = prev.kind === 'weekly' ? prev.weekday : 'MON';
      return { kind, hour, minute, weekday };
    }
    case 'hourly':
      return { kind, minute };
    case 'interval': {
      const intervalMinutes =
        prev.kind === 'interval'
          ? prev.intervalMinutes
          : (INTERVAL_MINUTE_OPTIONS[3] ?? INTERVAL_MINUTE_OPTIONS[0] ?? 15);
      return { kind, intervalMinutes };
    }
  }
}

function formatTimeValue(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

interface SchedulePickerProps {
  value: string;
  onChange: (next: string) => void;
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const [open, setOpen] = useState(false);
  const schedule = useMemo<ScheduleSpec>(
    () => parseCronToSchedule(value) ?? DEFAULT_SCHEDULE,
    [value]
  );
  const label = useMemo(() => formatCronLabel(value), [value]);

  function update(next: ScheduleSpec) {
    onChange(scheduleToCron(next));
  }

  function handleTimeChange(event: ChangeEvent<HTMLInputElement>) {
    if (
      schedule.kind !== 'daily' &&
      schedule.kind !== 'weekdays' &&
      schedule.kind !== 'weekends' &&
      schedule.kind !== 'weekly'
    ) {
      return;
    }
    const [rawHour, rawMinute] = event.target.value.split(':');
    if (!rawHour || !rawMinute) return;
    const parsedHour = parseInt(rawHour, 10);
    const parsedMinute = parseInt(rawMinute, 10);
    if (Number.isNaN(parsedHour) || Number.isNaN(parsedMinute)) return;
    const hour = clampInt(parsedHour, 0, 23);
    const minute = clampInt(parsedMinute, 0, 59);
    update({ ...schedule, hour, minute });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(PILL_TRIGGER_CLASS, 'w-full justify-between gap-1.5')}>
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="size-3 shrink-0 text-foreground-passive" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Schedule</Label>
          <Select
            value={schedule.kind}
            onValueChange={(next) => {
              if (next) update(changeScheduleKind(schedule, next as ScheduleKind));
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>
                {(value) => SCHEDULE_KIND_LABELS[value as ScheduleKind] ?? ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
              {SCHEDULE_KIND_ORDER.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {SCHEDULE_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {schedule.kind === 'weekly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Day</Label>
            <Select
              value={schedule.weekday}
              onValueChange={(next) => {
                if (next) update({ ...schedule, weekday: next as WeekdayToken });
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>{(value) => WEEKDAY_LABELS[value as WeekdayToken] ?? ''}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
                {WEEKDAY_TOKENS.map((token) => (
                  <SelectItem key={token} value={token}>
                    {WEEKDAY_LABELS[token]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(schedule.kind === 'daily' ||
          schedule.kind === 'weekdays' ||
          schedule.kind === 'weekends' ||
          schedule.kind === 'weekly') && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Time</Label>
            <Input
              type="time"
              value={formatTimeValue(schedule.hour, schedule.minute)}
              onChange={handleTimeChange}
            />
          </div>
        )}

        {schedule.kind === 'hourly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Minute</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={schedule.minute}
              onChange={(event) =>
                update({
                  kind: 'hourly',
                  minute: clampInt(parseInt(event.target.value, 10), 0, 59),
                })
              }
            />
          </div>
        )}

        {schedule.kind === 'interval' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Every</Label>
            <Select
              value={String(schedule.intervalMinutes)}
              onValueChange={(next) => {
                if (next) update({ kind: 'interval', intervalMinutes: parseInt(next, 10) });
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>{(value) => (value ? `${value} minutes` : '')}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
                {INTERVAL_MINUTE_OPTIONS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
