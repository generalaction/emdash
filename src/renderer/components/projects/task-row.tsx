import { Task } from 'electron';
import { Archive, ArchiveRestore, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { getProvider, ProviderId } from '@shared/agent-provider-registry';
import { rpc } from '@renderer/core/ipc';
import { usePrStatus } from '@renderer/hooks/usePrStatus';
import { useTaskAgentNames } from '@renderer/hooks/useTaskAgentNames';
import { useTaskChanges } from '@renderer/hooks/useTaskChanges';
import { agentAssets } from '@renderer/providers/assets';
import AgentLogo from '../AgentLogo';
import PrPreviewTooltip from '../PrPreviewTooltip';
import { ChangesBadge } from '../TaskChanges';
import TaskDeleteButton from '../TaskDeleteButton';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Spinner } from '../ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

export function TaskRow({
  ws,
  active,
  onClick,
  onDelete,
  onArchive,
  onRestore,
  isSelectMode,
  isSelected,
  onToggleSelect,
  enablePrStatus = true,
}: {
  ws: Task;
  active: boolean;
  onClick: () => void;
  onDelete: () => void | Promise<void | boolean>;
  onArchive?: () => void | Promise<void | boolean>;
  onRestore?: () => void | Promise<void>;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  enablePrStatus?: boolean;
}) {
  const isArchived = Boolean(ws.archivedAt);
  const [isDeleting, setIsDeleting] = useState(false);
  const { pr } = usePrStatus(ws.path, enablePrStatus);
  const { totalAdditions, totalDeletions, isLoading } = useTaskChanges(ws.path, ws.id);
  const agentInfo = useTaskAgentNames(ws.id, ws.agentId);

  const handleRowClick = () => {
    if (isSelectMode) {
      onToggleSelect?.();
    } else {
      onClick();
    }
  };

  const contentClasses = [
    'task-card relative flex flex-1 items-center gap-[2px] h-16 px-3 transition-all duration-150',
    'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border before:transition-opacity',
    'cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    active
      ? 'bg-muted rounded-xl before:opacity-0'
      : isSelected
        ? 'bg-accent rounded-xl before:opacity-0'
        : 'hover:bg-accent hover:rounded-xl hover:before:opacity-0',
  ].join(' ');

  // Render agent icons + names
  // 1 chat: show agent with icon
  // 2 chats: show both unique providers with icons
  // 3+ chats: show first provider + "+N"
  const renderAgents = () => {
    const { providerIds, additionalCount } = agentInfo;
    if (providerIds.length === 0) return null;

    const totalChats = additionalCount + 1;
    const showIds = totalChats <= 2 ? providerIds : [providerIds[0]];

    return (
      <div className="flex items-center gap-2">
        {showIds.map((id) => {
          const asset = agentAssets[id as keyof typeof agentAssets];
          const provider = getProvider(id as ProviderId);
          if (!asset) return null;
          return (
            <div key={id} className="flex items-center gap-1">
              <AgentLogo
                logo={asset.logo}
                alt={asset.alt}
                isSvg={asset.isSvg}
                invertInDark={asset.invertInDark}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-muted-foreground">
                {provider?.name ?? id}
              </span>
            </div>
          );
        })}
        {totalChats > 2 && (
          <span className="text-sm font-medium text-muted-foreground">+{additionalCount}</span>
        )}
      </div>
    );
  };

  return (
    <div
      className="task-row group relative flex items-center gap-3"
      data-active={active || undefined}
      data-selected={isSelected || undefined}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelect?.()}
        aria-label={`Select ${ws.name}`}
        className={[
          'h-4 w-4 shrink-0 rounded border-muted-foreground/50 transition-opacity duration-150',

          isSelectMode || isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      />
      <div onClick={handleRowClick} role="button" tabIndex={0} className={contentClasses}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`text-sm font-medium ${isArchived ? 'text-muted-foreground' : ''}`}>
            {ws.name}
          </span>
          {isArchived && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Archived
            </span>
          )}
          {ws.status === 'running' && (
            <Spinner size="sm" className="size-3 text-muted-foreground" />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {renderAgents()}

          {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
            <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
          ) : null}

          {!isLoading && totalAdditions === 0 && totalDeletions === 0 && pr ? (
            <PrPreviewTooltip pr={pr} side="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pr.url) rpc.app.openExternal(pr.url);
                }}
                className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={`${pr.title || 'Pull Request'} (#${pr.number})`}
              >
                {pr.isDraft
                  ? 'Draft'
                  : String(pr.state).toUpperCase() === 'OPEN'
                    ? 'View PR'
                    : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
                <ArrowUpRight className="size-3" />
              </button>
            </PrPreviewTooltip>
          ) : null}

          {!isSelectMode && (
            <div className="flex items-center gap-1">
              {isArchived && onRestore ? (
                <TooltipProvider delay={300}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore();
                        }}
                        aria-label={`Unarchive task ${ws.name}`}
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Unarchive
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : onArchive && !isArchived ? (
                <TooltipProvider delay={300}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          onArchive();
                        }}
                        aria-label={`Archive task ${ws.name}`}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Archive
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              <TaskDeleteButton
                taskName={ws.name}
                taskId={ws.id}
                taskPath={ws.path}
                useWorktree={ws.useWorktree}
                onConfirm={async () => {
                  try {
                    setIsDeleting(true);
                    await onDelete();
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                isDeleting={isDeleting}
                aria-label={`Delete task ${ws.name}`}
                className="text-muted-foreground"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
