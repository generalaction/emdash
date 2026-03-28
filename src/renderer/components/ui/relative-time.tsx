import { formatDistanceToNowStrict } from 'date-fns';
import React, { useEffect, useMemo, useState } from 'react';

type RelativeTimeProps = {
  value: string | number | Date;
  className?: string;
};

function parseTimestamp(input: string | number | Date): Date | null {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const normalized = raw.includes('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z';

  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({ value, className }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => parseTimestamp(value), [value]);
  if (!date) {
    return <span className={className}>—</span>;
  }

  const label = formatDistanceToNowStrict(date, { addSuffix: true });
  return (
    <time className={className} dateTime={date.toISOString()}>
      {label}
    </time>
  );
};

export default RelativeTime;
