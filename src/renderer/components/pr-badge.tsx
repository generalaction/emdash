import { type PullRequest } from '@shared/pull-requests';
import { PrNumberBadge, StatusIcon } from './projects/pr-row';

export function PrBadge({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5 rounded-md bg-background-2 max-w-52">
      <StatusIcon className="size-3" status={pr.status} />
      <PrNumberBadge number={pr.metadata.number} className="text-[10px]" />
      <span className="text-xs text-foreground-muted truncate">{pr.title}</span>
    </div>
  );
}
