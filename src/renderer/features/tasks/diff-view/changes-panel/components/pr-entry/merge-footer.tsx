import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  HelpCircle,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { SplitButton, SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { MergeSeverity, MergeUiState } from './pr-entry';

const severityConfig: Record<MergeSeverity, SeverityConfig> = {
  success: { icon: CheckCircle2, iconClass: 'text-green-600' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-500' },
  error: { icon: XCircle, iconClass: 'text-red-500' },
  neutral: { icon: HelpCircle, iconClass: 'text-foreground-passive' },
};

type SeverityConfig = { icon: LucideIcon; iconClass: string };

export function MergeFooter({
  uiState,
  mergeActions,
  isMerging,
  onRefresh,
  onMarkReady,
}: {
  uiState: MergeUiState;
  mergeActions: SplitButtonAction[];
  isMerging: boolean;
  onRefresh: () => void;
  onMarkReady: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      onRefresh();
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      setIsRefreshing(false);
    }
  };

  const isDraft = uiState.kind === 'draft';
  const { icon: MergeStatusIcon, iconClass } = severityConfig[uiState.severity];

  return (
    <div className="shrink-0 border-t border-border px-3 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 justify-between">
          <div className="flex items-center gap-1.5">
            <MergeStatusIcon className={cn('size-3.5 shrink-0', iconClass)} />
            <p className="text-sm leading-tight text-foreground truncate">{uiState.title}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon-xs"
                  className="text-foreground-muted"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn('size-3', { 'animate-spin': isRefreshing })} />
                </Button>
              </TooltipTrigger>

              <TooltipContent>Refresh Pull Request</TooltipContent>
            </Tooltip>

            {isDraft ? (
              <Button variant="outline" size="xs" onClick={onMarkReady}>
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
