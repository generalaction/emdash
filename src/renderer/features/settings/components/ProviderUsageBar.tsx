import { useQuery } from '@tanstack/react-query';
import { ChevronRight, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';
import type {
  ProviderUsage,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@shared/provider-usage';
import { rpc } from '@renderer/lib/ipc';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';

type Props = {
  providerId: 'claude' | 'codex';
};

const PLAN_LABELS: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  max5x: 'Max 5×',
  max20x: 'Max 20×',
  plus: 'Plus',
  business: 'Business',
  team: 'Team',
  enterprise: 'Enterprise',
  free: 'Free',
};

function formatPlan(plan: string | null): string | null {
  if (!plan) return null;
  return PLAN_LABELS[plan.toLowerCase()] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return 'resets soon';
  const absolute = date.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 48) return `${absolute} (${Math.floor(hours / 24)}d)`;
  if (hours >= 1) return `${absolute} (${hours}h)`;
  const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  return `${absolute} (${minutes}m)`;
}

function utilizationTone(value: number): string {
  if (value >= 90) return 'bg-destructive';
  if (value >= 75) return 'bg-amber-500';
  return 'bg-primary';
}

function UsageWindowRow({ window }: { window: ProviderUsageWindow }) {
  const reset = formatReset(window.resetsAt);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-tiny">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {window.utilization.toFixed(0)}% used
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${utilizationTone(window.utilization)}`}
          style={{ width: `${window.utilization}%` }}
        />
      </div>
      {reset ? <div className="text-tiny text-muted-foreground/80">Resets {reset}</div> : null}
    </div>
  );
}

function UsageDetails({
  usage,
  onRefresh,
  isRefreshing,
}: {
  usage: ProviderUsage;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const planLabel = formatPlan(usage.plan);
  const updated = new Date(usage.fetchedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="mt-2 space-y-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          {planLabel ? (
            <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-tiny font-medium">
              {planLabel} plan
            </span>
          ) : null}
          {usage.account ? (
            <span className="truncate text-tiny text-muted-foreground">{usage.account}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-tiny text-muted-foreground transition hover:bg-muted/40 disabled:opacity-60"
          aria-label="Refresh usage"
        >
          <RefreshCw
            className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>Updated {updated}</span>
        </button>
      </div>
      <div className="space-y-2.5">
        {usage.windows.map((window) => (
          <UsageWindowRow key={window.label} window={window} />
        ))}
      </div>
      {usage.credits ? (
        <div className="border-t border-border/60 pt-2 text-tiny">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">{usage.credits.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {usage.credits.used.toFixed(2)} / {usage.credits.limit} {usage.credits.currency}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ProviderUsageBar: React.FC<Props> = ({ providerId }) => {
  const [open, setOpen] = useState(false);

  const { data, isFetching, refetch } = useQuery<ProviderUsageResult>({
    queryKey: ['providerUsage', providerId] as const,
    queryFn: () => rpc.providerUsage.get(providerId) as Promise<ProviderUsageResult>,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: open,
  });

  const handleRefresh = () => {
    void rpc.providerUsage.refresh(providerId).then(() => refetch());
  };

  const usage = data?.status === 'ok' ? data.usage : null;
  const summaryUtilization =
    usage?.windows.reduce((max, w) => Math.max(max, w.utilization), 0) ?? null;

  return (
    <div className="pl-9 pr-3 pb-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-tiny text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <ChevronRight
            className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span>Usage limits</span>
          {summaryUtilization !== null && !open ? (
            <span className="tabular-nums text-muted-foreground/70">
              · peak {summaryUtilization.toFixed(0)}%
            </span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {data?.status === 'ok' && usage ? (
            <UsageDetails usage={usage} onRefresh={handleRefresh} isRefreshing={isFetching} />
          ) : data?.status === 'unauthenticated' ? (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-tiny text-muted-foreground">
              Sign in to {providerId === 'claude' ? 'Claude Code' : 'Codex'} to see usage.
            </div>
          ) : data?.status === 'error' ? (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-tiny text-muted-foreground">
              {data.message}
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-tiny text-muted-foreground">
              {isFetching ? 'Loading usage…' : 'No usage data.'}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
