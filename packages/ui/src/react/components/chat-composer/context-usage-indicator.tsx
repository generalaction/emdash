import { Button } from '@react/primitives/button';
import { Popover } from '@react/primitives/popover';
import * as styles from './chat-composer.css';

// ── Data type ─────────────────────────────────────────────────────────────────

export interface ContextUsage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatCost(cost: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cost.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(cost.amount);
  } catch {
    return `${cost.amount} ${cost.currency}`;
  }
}

// ── Donut SVG ─────────────────────────────────────────────────────────────────

function ContextDonut({ fraction }: { fraction: number }) {
  const pct = Math.round(fraction * 100);
  return (
    <svg viewBox="0 0 36 36" className={styles.donut} aria-hidden="true">
      <circle
        className={styles.donutTrack}
        cx="18"
        cy="18"
        r="15"
        fill="none"
        strokeWidth="5"
      />
      <circle
        className={fraction >= 0.9 ? styles.donutProgressWarn : styles.donutProgress}
        cx="18"
        cy="18"
        r="15"
        fill="none"
        strokeWidth="5"
        pathLength={100}
        strokeDasharray={`${pct} 100`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

// ── Indicator ─────────────────────────────────────────────────────────────────

export function ContextUsageIndicator({
  usage,
  disabled,
}: {
  usage: ContextUsage;
  disabled?: boolean;
}) {
  const fraction = Math.min(1, Math.max(0, usage.used / usage.size));
  const pct = Math.round(fraction * 100);

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button
          variant="ghost"
          size="sm"
          icon
          disabled={disabled}
          aria-label={`Context window: ${pct}% used`}
        >
          <ContextDonut fraction={fraction} />
        </Button>
      </Popover.Trigger>
      <Popover.Content align="end" side="top">
        <Popover.Header>
          <Popover.Title>Context window</Popover.Title>
        </Popover.Header>
        <Popover.Description>
          {pct}% used &middot; {formatTokens(usage.used)} / {formatTokens(usage.size)} tokens
        </Popover.Description>
        {usage.cost ? (
          <div className={styles.usageCostRow}>Session cost: {formatCost(usage.cost)}</div>
        ) : null}
      </Popover.Content>
    </Popover.Root>
  );
}
