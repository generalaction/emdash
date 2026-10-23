import { useEffect, useState } from 'react';

export function formatCountdown(value: number, now: number): string | null {
  const remaining = value - now;
  if (remaining <= 0) return null;
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
}

export interface CountdownTimeProps {
  value: number;
  expiredLabel?: string;
  className?: string;
}

/** Compact time until an event, without inferring that the event has occurred. */
export function CountdownTime({ value, expiredLabel = 'Due', className }: CountdownTimeProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(value)) return <span className={className}>—</span>;
  const label = formatCountdown(value, now);
  return (
    <time dateTime={new Date(value).toISOString()} className={className}>
      {label ?? expiredLabel}
    </time>
  );
}
