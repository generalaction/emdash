import { format } from 'date-fns';
import React, { useMemo } from 'react';

type AbsoluteTimeProps = {
  value: string | number | Date;
  className?: string;
  /** When true, includes the year regardless of recency. */
  includeYear?: boolean;
};

function parseTimestamp(input: string | number | Date): Date | null {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const normalized = raw.includes('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const AbsoluteTime: React.FC<AbsoluteTimeProps> = ({ value, className, includeYear }) => {
  const date = useMemo(() => parseTimestamp(value), [value]);
  if (!date) return <span className={className}>—</span>;

  const showYear = includeYear || date.getFullYear() !== new Date().getFullYear();
  const pattern = showYear ? 'MMM d yyyy, HH:mm' : 'MMM d, HH:mm';

  return (
    <time className={className} dateTime={date.toISOString()}>
      {format(date, pattern)}
    </time>
  );
};
