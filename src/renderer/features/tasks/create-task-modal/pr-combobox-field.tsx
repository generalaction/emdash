import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import {
  PrSelector,
  SelectedPrValue,
} from '@renderer/features/tasks/components/pr-selector/pr-selector';
import { cn } from '@renderer/utils/utils';
import type { PullRequest } from '@shared/pull-requests';
import { parseRepositoryRef } from '@shared/repository-ref';

interface PrComboboxFieldProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
  className?: string;
}

const GitHubIcon = PROVIDER_ICON_COMPONENTS['github'];

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
          <span className="flex w-full h-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
            {repoRef ? (
              <span className="flex items-center gap-1 text-foreground-passive h-8">
                    Select a PR from
                <GitHubIcon className="size-3.5 opacity-40" />
                <span>{repoRef.nameWithOwner}</span>
              </span>
            ) : null}
          </span>
        </div>
      )}
    />
  );
}
