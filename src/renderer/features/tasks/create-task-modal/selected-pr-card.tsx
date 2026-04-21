import { GitPullRequest } from 'lucide-react';
import type { PullRequest } from '@shared/pull-requests';

interface SelectedPrCardProps {
  pr: PullRequest;
  onDeselect: () => void;
}

export function SelectedPrCard({ pr, onDeselect }: SelectedPrCardProps) {
  return (
    <div className="rounded-md border border-border overflow-hidden flex flex-col gap-2">
      <div className="flex flex-col gap-2 p-2">
        <div className="flex items-start gap-2 min-w-0">
          <GitPullRequest className="size-4 shrink-0 text-foreground-muted mt-0.5" />
          <div className="flex flex-col min-w-0 gap-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-xs text-foreground-muted shrink-0">
                {pr.identifier ?? ''}
              </span>
              {pr.isDraft && (
                <span className="text-xs text-foreground-muted border border-border rounded px-1 shrink-0">
                  Draft
                </span>
              )}
              <span className="text-sm truncate font-medium">{pr.title}</span>
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
      <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
        <div className="text-foreground-muted"></div>
        <div className="text-foreground-muted">
          <button className="flex items-center gap-2" onClick={onDeselect}>
            Select another PR
          </button>
        </div>
      </div>
    </div>
  );
}
