import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import {
  PrSelector,
  SelectedPrValue,
} from '@renderer/features/tasks/components/pr-selector/pr-selector';
import { cn } from '@renderer/utils/utils';
import type { PullRequest } from '@shared/pull-requests';
import { parseGitHubRepository } from '@shared/github-repository';

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
  const repoRef = repositoryUrl ? parseGitHubRepository(repositoryUrl) : null;

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
          <span className="flex w-full items-center justify-center gap-2 p-2 text-sm text-foreground-passive transition-colors hover:bg-background-2">
            Select a PR from
            {repoRef ? (
              <span className="flex items-center gap-1 text-foreground-muted h-8">
                <GitHubIcon className="size-3.5" />
                <span>{repoRef.nameWithOwner}</span>
              </span>
            ) : null}
          </span>
        </div>
      )}
    />
  );
}
