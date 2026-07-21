import { IntegrationIcon } from '@core/features/integrations/api/browser/integration-icon';
import {
  PrSelector,
  SelectedPrValue,
} from '@core/features/tasks/browser/components/pr-selector/pr-selector';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import { cn } from '@core/primitives/ui/browser/cn';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';

interface PrComboboxFieldProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
  className?: string;
}

export function PrComboboxField({
  value,
  onValueChange,
  projectId,
  repositoryUrl,
  disabled,
  className,
}: PrComboboxFieldProps) {
  const repoRef = repositoryUrl ? parseRepositoryRef(repositoryUrl) : null;

  return (
    <PrSelector
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
                Select a PR from
                <IntegrationIcon provider="github" size={14} className="opacity-40" />
                <span>{repoRef.nameWithOwner}</span>
              </span>
            ) : null}
          </span>
        </div>
      )}
    />
  );
}
