import { GitPullRequest } from 'lucide-react';
import type { PullRequest } from '@shared/pull-requests';

interface SelectedPrCardProps {
  pr: PullRequest;
  onDeselect: () => void;
}

export function SelectedPrCard({ pr, onDeselect }: SelectedPrCardProps) {
  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-md border border-border">
      <div className="flex flex-col gap-2 p-2">
        <div className="flex min-w-0 items-start gap-2">
          <GitPullRequest className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 font-mono text-xs text-foreground-muted">
                {pr.identifier ?? ''}
              </span>
              {pr.isDraft && (
                <span className="shrink-0 rounded border border-border px-1 text-xs text-foreground-muted">
                  Draft
                </span>
              )}
              <span className="truncate text-sm font-medium">{pr.title}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-foreground-muted">
              <code className="text-xs">{pr.headRefName}</code>
              {pr.author && (
                <>
                  <span>·</span>
                  <span>{pr.author.userName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex h-6 items-center justify-between border-t border-border bg-background-1 px-2 text-xs">
        <div className="text-foreground-muted"></div>
        <div className="text-foreground-muted">
          <button type="button" className="flex items-center gap-2" onClick={onDeselect}>
            Select another PR
          </button>
        </div>
      </div>
    </div>
  );
}
