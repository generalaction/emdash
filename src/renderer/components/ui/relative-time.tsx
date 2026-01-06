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

  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = normalized + 'T00:00:00Z';
  }

  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function formatRelative(date: Date, nowMs: number): string {
  const diffMs = nowMs - date.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({ value, className }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => parseTimestamp(value), [value]);
  if (!date) {
    return <span className={className}>—</span>;
  }

  const label = formatRelative(date, nowMs);
  return (
    <time className={className} dateTime={date.toISOString()}>
      {label}
    </time>
  );
};

export default RelativeTime;
