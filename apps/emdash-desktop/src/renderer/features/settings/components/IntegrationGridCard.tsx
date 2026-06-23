import { CircleAlert } from 'lucide-react';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { IntegrationItem } from './IntegrationsCard';

export function IntegrationGridCard({
  integration,
  selected,
  onSelect,
}: {
  integration: IntegrationItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[integration.id];

  return (
    <div className="flex h-full min-h-0">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'group relative flex w-full items-center gap-4 rounded-lg border border-border bg-background-1 p-4 text-left text-card-foreground transition-all hover:bg-background-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          selected && 'bg-background-2'
        )}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background-2 transition-colors group-hover:bg-background-3">
          <Icon size={32} />
        </span>
        <span
          className={cn(
            'flex min-w-0 flex-1 flex-col gap-0.5',
            integration.connectionError && 'pr-6'
          )}
        >
          <span className="text-sm font-medium text-foreground">{integration.name}</span>
          <span className="truncate text-sm text-foreground-muted">{integration.description}</span>
        </span>
        {integration.connectionError && (
          <ConnectionIssueIndicator
            providerName={integration.name}
            error={integration.connectionError}
          />
        )}
      </button>
    </div>
  );
}

export function ConnectionIssueIndicator({
  providerName,
  error,
}: {
  providerName: string;
  error: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="text-destructive absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full"
            aria-label={`${providerName} connection issue`}
          >
            <CircleAlert className="h-4 w-4" />
          </span>
        }
      />
      <TooltipContent side="top">{error || 'Connection issue'}</TooltipContent>
    </Tooltip>
  );
}
