import { parseRepositoryRef } from '@agent/core/primitives/repository/api';
import type { PullRequest } from '@agent/plugins/pull-requests/schemas';
import { IntegrationIcon } from '@core/features/integrations/contributions/browser/integration-icon';
import {
  PrSelector,
  SelectedPrValue,
} from '@core/features/tasks/browser/components/pr-selector/pr-selector';
import { cn } from '@core/primitives/styling/browser/cn';

interface PrComboboxFieldProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  provider?: string;
  disabled?: boolean;
  className?: string;
}

export function PrComboboxField({
  value,
  onValueChange,
  projectId,
  repositoryUrl,
  provider = 'github',
  disabled,
  className,
}: PrComboboxFieldProps) {
  const repoRef = repositoryUrl ? parseRepositoryRef(repositoryUrl) : null;

  return (
    <PrSelector
      provider={provider}
      value={value}
      onValueChange={onValueChange}
      projectId={projectId}
      repositoryUrl={repositoryUrl}
      disabled={disabled}
      renderSelectedValue={(pr) => (
        <div
          className={cn(
            'flex w-full items-center justify-between gap-2 p-2 text-sm hover:bg-background-1 data-popup-open:bg-background-1 h-14',
            disabled && 'pointer-events-none opacity-50',
            className
          )}
        >
          <SelectedPrValue pr={pr} />
        </div>
      )}
      renderPlaceholder={() => (
        <div className={cn('w-full h-14', disabled && 'pointer-events-none opacity-50', className)}>
          <span className="flex h-full w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
            {repoRef ? (
              <span className="flex h-8 items-center gap-1 text-foreground-passive">
                Select {provider === 'gitlab' ? 'an MR' : 'a PR'} from
                <IntegrationIcon provider={provider} size={14} className="opacity-40" />
                <span>{repoRef.nameWithOwner}</span>
              </span>
            ) : null}
          </span>
        </div>
      )}
    />
  );
}
