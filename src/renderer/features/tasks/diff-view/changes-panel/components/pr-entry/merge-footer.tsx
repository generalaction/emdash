import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  HelpCircle,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { cn } from '@renderer/utils/utils';
import { type MergeSeverity, type MergeUiState } from './pr-entry';

const severityConfig: Record<MergeSeverity, SeverityConfig> = {
  success: { icon: CheckCircle2, iconClass: 'text-foreground-success' },
  warning: { icon: AlertTriangle, iconClass: 'text-foreground-warning' },
  error: { icon: XCircle, iconClass: 'text-foreground-error' },
  neutral: { icon: HelpCircle, iconClass: 'text-foreground-passive' },
};

type SeverityConfig = { icon: LucideIcon; iconClass: string };

export function MergeFooter({
  uiState,
  mergeActions,
  isMerging,
  isMarkingReady,
  onMarkReady,
}: {
  uiState: MergeUiState;
  mergeActions: SplitButtonAction[];
  isMerging: boolean;
  isMarkingReady: boolean;
  onMarkReady: () => void;
}) {
  const isDraft = uiState.kind === 'draft';
  const { icon: MergeStatusIcon, iconClass } = severityConfig[uiState.severity];

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <MergeStatusIcon className={cn('size-4 shrink-0', iconClass)} />
            <p className="truncate text-sm leading-tight text-foreground">{uiState.title}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {isDraft ? (
              <Button
                variant="outline"
                size="xs"
                onClick={onMarkReady}
                disabled={isMarkingReady}
                aria-label={isMarkingReady ? 'Marking ready...' : 'Mark ready'}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid overflow-hidden transition-[grid-template-columns,opacity,margin] duration-200 ease-out',
                    isMarkingReady
                      ? 'grid-cols-[1fr] opacity-100'
                      : '-ml-1 grid-cols-[0fr] opacity-0'
                  )}
                >
                  <Loader2 className="size-3 min-w-0 animate-spin" />
                </span>
                Mark ready
              </Button>
            ) : (
              <SplitButton
                size="xs"
                variant="outline"
                loading={isMerging}
                loadingLabel="Merging..."
                icon={<GitMerge className="size-3" />}
                actions={mergeActions}
                disabled={!uiState.canMerge && !isMerging}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
