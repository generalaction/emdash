import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Plus,
  Loader2,
  ArrowUpRight,
  Folder,
  Archive,
  ArchiveRestore,
  Search,
  Github,
  X,
  Trash2,
  Check,
  ListFilter,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Separator } from './ui/separator';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';
import { Spinner } from './ui/spinner';
import TaskDeleteButton from './TaskDeleteButton';
import ProjectDeleteButton from './ProjectDeleteButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Checkbox } from './ui/checkbox';
import BaseBranchControls from './BaseBranchControls';
import { pickDefaultBranch, type BranchOption } from './BranchSelect';
import { ConfigEditorModal } from './ConfigEditorModal';
import { useToast } from '../hooks/use-toast';
import DeletePrNotice from './DeletePrNotice';
import PrPreviewTooltip from './PrPreviewTooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { isActivePr, PrInfo } from '../lib/prStatus';
import { refreshPrStatus } from '../lib/prStatusStore';
import { useTaskBusy } from '../hooks/useTaskBusy';
import { useTaskAgentNames } from '../hooks/useTaskAgentNames';
import AgentLogo from './AgentLogo';
import { agentAssets } from '../providers/assets';
import { getProvider } from '@shared/providers/registry';
import type { ProviderId } from '@shared/providers/registry';
import type { Project, Task } from '../types/app';

const normalizeBaseRef = (ref?: string | null): string | undefined => {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

function TaskRow({
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
  const isRunning = useTaskBusy(ws.id);
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
          {(isRunning || ws.status === 'running') && (
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
                  if (pr.url) window.electronAPI.openExternal(pr.url);
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
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
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

interface ProjectMainViewProps {
  project: Project;
  onCreateTask: () => void;
  activeTask: Task | null;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  onArchiveTask?: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  onRestoreTask?: (project: Project, task: Task) => void | Promise<void>;
  onDeleteProject?: (project: Project) => void | Promise<void>;
  branchOptions: BranchOption[];
  isLoadingBranches: boolean;
  onBaseBranchChange?: (branch: string) => void;
}

const ProjectMainView: React.FC<ProjectMainViewProps> = ({
  project,
  onCreateTask,
  activeTask,
  onSelectTask,
  onDeleteTask,
  onArchiveTask,
  onRestoreTask,
  onDeleteProject,
  branchOptions,
  isLoadingBranches,
  onBaseBranchChange: onBaseBranchChangeCallback,
}) => {
  const { toast } = useToast();

  const [baseBranch, setBaseBranch] = useState<string | undefined>(() =>
    normalizeBaseRef(project.gitInfo.baseRef)
  );
  const [isSavingBaseBranch, setIsSavingBaseBranch] = useState(false);

  // Multi-select state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [acknowledgeDirtyDelete, setAcknowledgeDirtyDelete] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showFilter, setShowFilter] = useState<'active' | 'all'>('active');
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);

  const activeTasks = project.tasks ?? [];
  const activeTasksLength = activeTasks.length;

  const refetchArchivedTasks = useCallback(() => {
    const timeoutId = setTimeout(async () => {
      try {
        const result = await window.electronAPI.getArchivedTasks(project.id);
        if (Array.isArray(result)) {
          setArchivedTasks(result);
        }
      } catch {
        //
      }
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [project.id]);

  useEffect(() => {
    const cleanup = refetchArchivedTasks();
    return cleanup;
  }, [project.id, refetchArchivedTasks]);
  const tasksInProject = useMemo(
    () => (showFilter === 'all' ? [...activeTasks, ...archivedTasks] : activeTasks),
    [activeTasks, archivedTasks, showFilter]
  );
  const hasAnyTasks = activeTasks.length > 0 || archivedTasks.length > 0;
  const filteredTasks = useMemo(
    () =>
      searchFilter.trim()
        ? tasksInProject.filter((ws) =>
            ws.name.toLowerCase().includes(searchFilter.trim().toLowerCase())
          )
        : tasksInProject,
    [tasksInProject, searchFilter]
  );
  const selectedCount = selectedIds.size;
  const selectedTasks = useMemo(
    () => tasksInProject.filter((ws) => selectedIds.has(ws.id)),
    [selectedIds, tasksInProject]
  );

  // Calculate select all checkbox state
  const allFilteredSelected =
    filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.id));
  const someFilteredSelected =
    filteredTasks.some((t) => selectedIds.has(t.id)) && !allFilteredSelected;
  const [deleteStatus, setDeleteStatus] = useState<
    Record<
      string,
      {
        staged: number;
        unstaged: number;
        untracked: number;
        ahead: number;
        behind: number;
        error?: string;
        pr?: PrInfo | null;
      }
    >
  >({});
  const [deleteStatusLoading, setDeleteStatusLoading] = useState(false);
  const deleteRisks = useMemo(() => {
    const riskyIds = new Set<string>();
    const summaries: Record<string, string> = {};
    for (const ws of selectedTasks) {
      const status = deleteStatus[ws.id];
      if (!status) continue;
      const dirty =
        status.staged > 0 ||
        status.unstaged > 0 ||
        status.untracked > 0 ||
        status.ahead > 0 ||
        !!status.error ||
        (status.pr && isActivePr(status.pr));
      if (dirty) {
        riskyIds.add(ws.id);
        const parts: string[] = [];
        if (status.staged > 0)
          parts.push(`${status.staged} ${status.staged === 1 ? 'file' : 'files'} staged`);
        if (status.unstaged > 0)
          parts.push(`${status.unstaged} ${status.unstaged === 1 ? 'file' : 'files'} unstaged`);
        if (status.untracked > 0)
          parts.push(`${status.untracked} ${status.untracked === 1 ? 'file' : 'files'} untracked`);
        if (status.ahead > 0)
          parts.push(`ahead by ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}`);
        if (status.behind > 0)
          parts.push(`behind by ${status.behind} ${status.behind === 1 ? 'commit' : 'commits'}`);
        if (status.pr && isActivePr(status.pr)) parts.push('PR open');
        if (!parts.length && status.error) parts.push('status unavailable');
        summaries[ws.id] = parts.join(', ');
      }
    }
    return { riskyIds, summaries };
  }, [deleteStatus, selectedTasks]);
  const deleteDisabled: boolean =
    Boolean(isDeleting || deleteStatusLoading) ||
    (deleteRisks.riskyIds.size > 0 && acknowledgeDirtyDelete !== true);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!isSelectMode) setIsSelectMode(true);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const filteredIds = new Set(filteredTasks.map((t) => t.id));
    const allFilteredSelected = filteredTasks.every((t) => selectedIds.has(t.id));

    if (allFilteredSelected) {
      // Deselect all filtered tasks
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Select all filtered tasks
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
      if (!isSelectMode) setIsSelectMode(true);
    }
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    const toDelete = tasksInProject.filter((ws) => selectedIds.has(ws.id));
    if (toDelete.length === 0) return;

    setIsDeleting(true);
    setShowDeleteDialog(false);

    const deletedNames: string[] = [];
    for (const ws of toDelete) {
      try {
        const result = await onDeleteTask(project, ws, { silent: true });
        if (result !== false) {
          deletedNames.push(ws.name);
        }
      } catch {
        // Continue deleting remaining tasks
      }
    }

    setIsDeleting(false);
    exitSelectMode();

    if (deletedNames.length > 0) {
      refetchArchivedTasks();

      const maxNames = 3;
      const displayNames = deletedNames.slice(0, maxNames).join(', ');
      const remaining = deletedNames.length - maxNames;

      toast({
        title: deletedNames.length === 1 ? 'Task deleted' : 'Tasks deleted',
        description: remaining > 0 ? `${displayNames} and ${remaining} more` : displayNames,
      });
    }
  };

  const handleBulkArchive = async () => {
    if (!onArchiveTask) return;
    const toArchive = tasksInProject.filter((ws) => selectedIds.has(ws.id));
    if (toArchive.length === 0) return;

    setIsArchiving(true);

    const archivedNames: string[] = [];
    for (const ws of toArchive) {
      try {
        const result = await onArchiveTask(project, ws, { silent: true });
        // Only count as archived if returned true (or void for backwards compat)
        if (result !== false) {
          archivedNames.push(ws.name);
        }
      } catch {
        // Continue archiving remaining tasks
      }
    }

    setIsArchiving(false);
    exitSelectMode();

    if (archivedNames.length > 0) {
      refetchArchivedTasks();

      const maxNames = 3;
      const displayNames = archivedNames.slice(0, maxNames).join(', ');
      const remaining = archivedNames.length - maxNames;

      toast({
        title: archivedNames.length === 1 ? 'Task archived' : 'Tasks archived',
        description: remaining > 0 ? `${displayNames} and ${remaining} more` : displayNames,
      });
    }
  };

  const handleDeleteTask = useCallback(
    async (task: Task) => {
      const wasArchived = Boolean(task.archivedAt);
      const result = await onDeleteTask(project, task);

      if (wasArchived && result !== false) {
        refetchArchivedTasks();
      }

      return result;
    },
    [onDeleteTask, project, refetchArchivedTasks]
  );

  const handleArchiveTask = useCallback(
    async (task: Task) => {
      if (!onArchiveTask) return;
      const result = await onArchiveTask(project, task);
      if (result !== false) {
        refetchArchivedTasks();
      }
      return result;
    },
    [onArchiveTask, project, refetchArchivedTasks]
  );

  const handleRestoreTask = useCallback(
    async (task: Task) => {
      try {
        if (onRestoreTask) {
          await onRestoreTask(project, task);
        } else {
          const result = await window.electronAPI.restoreTask(task.id);
          if (!result?.success) throw new Error(result?.error);
        }
        setArchivedTasks((prev) => prev.filter((t) => t.id !== task.id));
        toast({ title: 'Task restored', description: task.name });
      } catch {
        toast({ title: 'Failed to restore task', variant: 'destructive' });
      }
    },
    [onRestoreTask, project, toast]
  );

  // Reset select mode when project changes
  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, [project.id]);

  useEffect(() => {
    setBaseBranch(normalizeBaseRef(project.gitInfo.baseRef));
  }, [project.id, project.gitInfo.baseRef]);

  useEffect(() => {
    if (!showDeleteDialog) {
      setDeleteStatus({});
      setAcknowledgeDirtyDelete(false);
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      setDeleteStatusLoading(true);
      const next: typeof deleteStatus = {};

      for (const ws of selectedTasks) {
        try {
          const [statusRes, infoRes, rawPr] = await Promise.allSettled([
            window.electronAPI.getGitStatus(ws.path),
            window.electronAPI.getGitInfo(ws.path),
            project.isRemote ? Promise.resolve(null) : refreshPrStatus(ws.path),
          ]);

          let staged = 0;
          let unstaged = 0;
          let untracked = 0;
          if (
            statusRes.status === 'fulfilled' &&
            statusRes.value?.success &&
            statusRes.value.changes
          ) {
            for (const change of statusRes.value.changes) {
              if (change.status === 'untracked') {
                untracked += 1;
              } else if (change.isStaged) {
                staged += 1;
              } else {
                unstaged += 1;
              }
            }
          }

          const ahead =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.aheadCount === 'number'
              ? infoRes.value.aheadCount
              : 0;
          const behind =
            infoRes.status === 'fulfilled' && typeof infoRes.value?.behindCount === 'number'
              ? infoRes.value.behindCount
              : 0;
          const prValue = rawPr.status === 'fulfilled' ? rawPr.value : null;
          const pr = isActivePr(prValue) ? prValue : null;

          next[ws.id] = {
            staged,
            unstaged,
            untracked,
            ahead,
            behind,
            error:
              statusRes.status === 'fulfilled'
                ? statusRes.value?.error
                : statusRes.reason?.message || String(statusRes.reason || ''),
            pr,
          };
        } catch (error: any) {
          next[ws.id] = {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            ahead: 0,
            behind: 0,
            error: error?.message || String(error),
          };
        }
      }

      if (!cancelled) {
        setDeleteStatus(next);
        setDeleteStatusLoading(false);
      }
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [showDeleteDialog, selectedTasks]);

  // Sync baseBranch when branchOptions change
  useEffect(() => {
    if (branchOptions.length === 0) return;
    const current = baseBranch ?? normalizeBaseRef(project.gitInfo.baseRef);
    const validDefault = pickDefaultBranch(branchOptions, current);
    if (validDefault && validDefault !== baseBranch) {
      setBaseBranch(validDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchOptions]);

  const handleBaseBranchChange = useCallback(
    async (nextValue: string) => {
      const trimmed = normalizeBaseRef(nextValue);
      if (!trimmed || trimmed === baseBranch) return;
      const previous = baseBranch;
      setBaseBranch(trimmed);
      setIsSavingBaseBranch(true);
      try {
        const res = await window.electronAPI.updateProjectSettings({
          projectId: project.id,
          baseRef: trimmed,
        });
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to update base branch');
        }
        if (project.gitInfo) {
          project.gitInfo.baseRef = trimmed;
        }
        onBaseBranchChangeCallback?.(trimmed);
      } catch (error) {
        setBaseBranch(previous);
        toast({
          variant: 'destructive',
          title: 'Failed to update base branch',
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsSavingBaseBranch(false);
      }
    },
    [baseBranch, project.id, project.gitInfo, onBaseBranchChangeCallback, toast]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-8">
          <div className="mx-auto w-full max-w-6xl">
            {/* Header */}
            <div className="px-10">
              <header className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
                <div className="flex items-center gap-2">
                  <BaseBranchControls
                    baseBranch={baseBranch}
                    branchOptions={branchOptions}
                    isLoadingBranches={isLoadingBranches}
                    isSavingBaseBranch={isSavingBaseBranch}
                    onBaseBranchChange={handleBaseBranchChange}
                    onOpenConfig={() => setShowConfigEditor(true)}
                  />
                  {project.githubInfo?.connected && project.githubInfo.repository ? (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.1, ease: 'easeInOut' }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() =>
                        window.electronAPI.openExternal(
                          `https://github.com/${project.githubInfo?.repository}`
                        )
                      }
                    >
                      <Github className="size-3.5" />
                      View on GitHub
                    </motion.button>
                  ) : null}
                  {onDeleteProject ? (
                    <ProjectDeleteButton
                      projectName={project.name}
                      tasks={project.tasks}
                      onConfirm={() => onDeleteProject?.(project)}
                      aria-label={`Delete project ${project.name}`}
                    />
                  ) : null}
                </div>
              </header>
              <Separator className="mt-4" />
            </div>

            {/* Tasks Section */}
            <div className="mt-6 flex flex-col gap-4 px-10">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">Tasks</h2>
                  <p className="text-sm text-muted-foreground">
                    Spin up a fresh, isolated task for this project.
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.1, ease: 'easeInOut' }}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  onClick={onCreateTask}
                >
                  <Plus className="mr-2 size-4" />
                  New Task
                </motion.button>
              </div>

              {hasAnyTasks ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search tasks..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-10 w-full pl-10"
                    />
                  </div>

                  <div className="flex h-7 items-center gap-2 px-3">
                    {isSelectMode ? (
                      <>
                        <Checkbox
                          checked={someFilteredSelected ? 'indeterminate' : allFilteredSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all tasks"
                          className="-ml-10 h-4 w-4 shrink-0 rounded border-muted-foreground/50"
                        />
                        <span className="text-sm text-muted-foreground">
                          {selectedCount} selected
                        </span>
                        {onArchiveTask && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground"
                            onClick={handleBulkArchive}
                            disabled={isArchiving || isDeleting || selectedCount === 0}
                            aria-label="Archive selected"
                          >
                            {isArchiving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground"
                          onClick={() => setShowDeleteDialog(true)}
                          disabled={isDeleting || isArchiving || selectedCount === 0}
                          aria-label="Delete selected"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="ml-auto text-muted-foreground"
                          onClick={exitSelectMode}
                          aria-label="Exit select mode"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground">
                          {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}{' '}
                          with Emdash
                        </span>
                        {filteredTasks.length > 0 && (
                          <button
                            type="button"
                            className="cursor-pointer text-sm text-muted-foreground underline"
                            onClick={() => setIsSelectMode(true)}
                          >
                            Select
                          </button>
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="ml-auto text-muted-foreground"
                              aria-label="Filter tasks"
                            >
                              <ListFilter className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-48 p-1">
                            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                              Show
                            </p>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                              onClick={() => setShowFilter('all')}
                            >
                              All tasks
                              {showFilter === 'all' && (
                                <Check className="h-3.5 w-3.5 text-foreground" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                              onClick={() => setShowFilter('active')}
                            >
                              Hide archived
                              {showFilter === 'active' && (
                                <Check className="h-3.5 w-3.5 text-foreground" />
                              )}
                            </button>
                          </PopoverContent>
                        </Popover>
                      </>
                    )}
                  </div>

                  {filteredTasks.length > 0 ? (
                    <div className="task-list -ml-7 flex flex-col">
                      <style>{`
                        .task-list .task-row:first-child .task-card::before { opacity: 0; }
                        .task-list .task-row:hover + .task-row .task-card::before,
                        .task-list .task-row[data-active] + .task-row .task-card::before,
                        .task-list .task-row[data-selected] + .task-row .task-card::before { opacity: 0; }
                        .task-list .task-row:last-child .task-card::after {
                          content: ''; position: absolute; inset: auto 0 0 0; height: 1px; background: hsl(var(--border));
                        }
                        .task-list .task-row:last-child:hover .task-card::after,
                        .task-list .task-row:last-child[data-active] .task-card::after,
                        .task-list .task-row:last-child[data-selected] .task-card::after { opacity: 0; }
                      `}</style>
                      {filteredTasks.map((ws) => (
                        <TaskRow
                          key={ws.id}
                          ws={ws}
                          isSelectMode={isSelectMode}
                          isSelected={selectedIds.has(ws.id)}
                          onToggleSelect={() => toggleSelect(ws.id)}
                          active={activeTask?.id === ws.id}
                          onClick={() => onSelectTask(ws)}
                          onDelete={() => handleDeleteTask(ws)}
                          onArchive={onArchiveTask ? () => handleArchiveTask(ws) : undefined}
                          enablePrStatus={!project.isRemote}
                          onRestore={ws.archivedAt ? () => handleRestoreTask(ws) : undefined}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Archive className="mb-3 h-12 w-12 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        {searchFilter.trim()
                          ? 'No tasks match your search.'
                          : showFilter === 'active'
                            ? 'All tasks are archived. Use the filter to view them.'
                            : 'No tasks found.'}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <Alert>
                  <AlertTitle>What's a task?</AlertTitle>
                  <AlertDescription>
                    Each task is an isolated copy and branch of your repo (Git-tracked files only).
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected tasks and their worktrees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {deleteStatusLoading ? (
                <motion.div
                  key="bulk-delete-loading"
                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/30 px-4 py-4"
                >
                  <Spinner
                    className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground"
                    size="sm"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">Please wait...</span>
                    <span className="text-xs text-muted-foreground">
                      Scanning tasks for uncommitted changes and open pull requests
                    </span>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {(() => {
                const tasksWithUncommittedWorkOnly = selectedTasks.filter((ws) => {
                  const summary = deleteRisks.summaries[ws.id];
                  const status = deleteStatus[ws.id];
                  if (!summary && !status?.error) return false;
                  if (status?.pr && isActivePr(status.pr)) return false;
                  return true;
                });

                return tasksWithUncommittedWorkOnly.length > 0 && !deleteStatusLoading ? (
                  <motion.div
                    key="bulk-risk"
                    initial={{ opacity: 0, y: 6, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.99 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
                  >
                    <p className="font-medium">Unmerged or unpushed work detected</p>
                    <ul className="space-y-1">
                      {tasksWithUncommittedWorkOnly.map((ws) => {
                        const summary = deleteRisks.summaries[ws.id];
                        const status = deleteStatus[ws.id];
                        return (
                          <li
                            key={ws.id}
                            className="flex items-center gap-2 rounded-md bg-amber-50/80 px-2 py-1 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-50"
                          >
                            <Folder className="h-4 w-4 fill-amber-700 text-amber-700" />
                            <span className="font-medium">{ws.name}</span>
                            <span className="text-muted-foreground">—</span>
                            <span>{summary || status?.error || 'Status unavailable'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                ) : null;
              })()}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {(() => {
                const prTasks = selectedTasks
                  .map((ws) => ({ name: ws.name, pr: deleteStatus[ws.id]?.pr }))
                  .filter((w) => w.pr && isActivePr(w.pr));
                return prTasks.length && !deleteStatusLoading ? (
                  <motion.div
                    key="bulk-pr-notice"
                    initial={{ opacity: 0, y: 6, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.99 }}
                    transition={{ duration: 0.2, ease: 'easeOut', delay: 0.02 }}
                  >
                    <DeletePrNotice tasks={prTasks as any} />
                  </motion.div>
                ) : null;
              })()}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {deleteRisks.riskyIds.size > 0 && !deleteStatusLoading ? (
                <motion.label
                  key="bulk-ack"
                  className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm"
                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.99 }}
                  transition={{ duration: 0.18, ease: 'easeOut', delay: 0.03 }}
                >
                  <Checkbox
                    id="ack-delete"
                    checked={acknowledgeDirtyDelete}
                    onCheckedChange={(val) => setAcknowledgeDirtyDelete(val === true)}
                  />
                  <span className="leading-tight">Delete tasks anyway</span>
                </motion.label>
              ) : null}
            </AnimatePresence>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive px-4 text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={deleteDisabled}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfigEditorModal
        isOpen={showConfigEditor}
        onClose={() => setShowConfigEditor(false)}
        projectPath={project.path}
        isRemote={project.isRemote}
        sshConnectionId={project.sshConnectionId}
      />
    </div>
  );
};

export default ProjectMainView;
