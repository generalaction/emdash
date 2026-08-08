import { formatDistanceToNow } from 'date-fns';
import type { PrCheckoutDrift } from '@core/services/pull-requests/api';

/**
 * Render-ready text for the derived checkout-drift state (pr-workspace-model
 * spec, Staleness). Null for `unknown`: no honest claim can be made, so no
 * claim is rendered.
 */
export function checkoutDriftLabel(drift: PrCheckoutDrift): string | null {
  switch (drift.kind) {
    case 'unknown':
      return null;
    case 'in-sync':
      return 'Checkout in sync with PR head';
    case 'drifted': {
      const details = [
        drift.prMoved === true ? 'PR head moved' : null,
        drift.localAhead === true ? 'local commits ahead' : null,
      ].filter((part): part is string => part !== null);
      const base = 'Checkout differs from PR head';
      return details.length > 0 ? `${base} (${details.join(', ')})` : base;
    }
  }
}

/** "As of last sync" honesty: the comparison is only as fresh as the PR cache. */
export function checkoutDriftSyncNote(drift: PrCheckoutDrift): string | null {
  if (drift.kind === 'unknown' || drift.syncedAt === null) return null;
  return `as of last sync ${formatDistanceToNow(drift.syncedAt, { addSuffix: true })}`;
}

export function PrCheckoutDriftLine({ drift }: { drift: PrCheckoutDrift }) {
  const label = checkoutDriftLabel(drift);
  if (!label) return null;
  const syncNote = checkoutDriftSyncNote(drift);
  return (
    <div
      className="truncate text-xs text-foreground-muted"
      title={syncNote ? `${label} — ${syncNote}` : label}
    >
      {label}
      {syncNote && <span className="text-foreground-passive"> · {syncNote}</span>}
    </div>
  );
}
