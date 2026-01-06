import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, AlertCircle, Loader2 } from 'lucide-react';
import KanbanBoard from './kanban/KanbanBoard';
import ProjectTaskList from './ProjectTaskList';
import ProjectDeleteButton from './ProjectDeleteButton';
import BaseBranchControls, { RemoteBranchOption } from './BaseBranchControls';
import { Button } from './ui/button';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import TaskBulkDeleteDialog from './TaskBulkDeleteDialog';
import { useToast } from '../hooks/use-toast';
import type { Project, Task } from '../types/app';

interface ProjectKanbanHomeProps {
  project: Project;
  activeTask: Task | null;
  onCreateTask: () => void;
  onOpenTask: (task: Task) => void;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  onDeleteProject?: (project: Project) => void | Promise<void>;
}

const normalizeBaseRef = (ref?: string | null): string | undefined => {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const ProjectKanbanHome: React.FC<ProjectKanbanHomeProps> = ({
  project,
  activeTask,
  onCreateTask,
  onOpenTask,
  onSelectTask,
  onDeleteTask,
  onDeleteProject,
}) => {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Base Branch State
  const [baseBranch, setBaseBranch] = useState<string | undefined>(() =>
    normalizeBaseRef(project.gitInfo.baseRef)
  );
  const [branchOptions, setBranchOptions] = useState<RemoteBranchOption[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSavingBaseBranch, setIsSavingBaseBranch] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null);
  const [branchReloadToken, setBranchReloadToken] = useState(0);

  useEffect(() => {
    setBaseBranch(normalizeBaseRef(project.gitInfo.baseRef));
  }, [project.id, project.gitInfo.baseRef]);

  useEffect(() => {
    let cancelled = false;

    const loadBranches = async () => {
      if (!project.path) return;
      setIsLoadingBranches(true);
      setBranchLoadError(null);
      try {
        const res = await window.electronAPI.listRemoteBranches({ projectPath: project.path });
        if (!res?.success) {
          throw new Error(res?.error || 'Failed to load remote branches');
        }

        const options =
          res.branches?.map((item) => ({
            value: item.label,
            label: item.label,
          })) ?? [];

        const current = baseBranch ?? normalizeBaseRef(project.gitInfo.baseRef);
        const withCurrent =
          current && !options.some((opt) => opt.value === current)
            ? [{ value: current, label: current }, ...options]
            : options;

        if (!cancelled) {
          setBranchOptions(withCurrent);
        }
      } catch (error) {
        if (!cancelled) {
          setBranchLoadError(error instanceof Error ? error.message : String(error));
          setBranchOptions((prev) => {
            if (prev.length > 0) return prev;
            return baseBranch ? [{ value: baseBranch, label: baseBranch }] : [];
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false);
        }
      }
    };

    loadBranches();
    return () => {
      cancelled = true;
    };
  }, [project.id, project.path, project.gitInfo.baseRef, baseBranch, branchReloadToken]);

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
        setBranchOptions((prev) => {
          if (prev.some((opt) => opt.value === trimmed)) return prev;
          return [{ value: trimmed, label: trimmed }, ...prev];
        });
        toast({
          title: 'Base branch updated',
          description: `New task runs will start from ${trimmed}.`,
        });
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
    [baseBranch, project.id, toast]
  );

  useEffect(() => {
    if (!isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [isSelectMode]);

  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, [project.id]);

  const tasks = project.tasks ?? [];
  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedIds.has(task.id)),
    [selectedIds, tasks]
  );
  const selectedTargets = useMemo(
    () => selectedTasks.map((task) => ({ id: task.id, name: task.name, path: task.path })),
    [selectedTasks]
  );
  const selectedCount = selectedIds.size;
  const directTasks = tasks.filter((task) => task.useWorktree === false);
  const hasTasks = tasks.length > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedTasks.length === 0) return;
    const toDelete = [...selectedTasks];
    setShowBulkDeleteDialog(false);
    setIsBulkDeleting(true);

    const deletedNames: string[] = [];
    try {
      for (const task of toDelete) {
        try {
          const result = await onDeleteTask(project, task, { silent: true });
          if (result !== false) {
            deletedNames.push(task.name);
          }
        } catch {
          // Continue deleting remaining tasks
        }
      }
    } finally {
      setIsBulkDeleting(false);
      exitSelectMode();
    }

    if (deletedNames.length > 0) {
      const maxNames = 3;
      const displayNames = deletedNames.slice(0, maxNames).join(', ');
      const remaining = deletedNames.length - maxNames;

      toast({
        title: deletedNames.length === 1 ? 'Task deleted' : 'Tasks deleted',
        description: remaining > 0 ? `${displayNames} and ${remaining} more` : displayNames,
      });
    }
  }, [exitSelectMode, onDeleteTask, project, selectedTasks, toast]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="space-y-3 px-6 py-4">
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-medium italic tracking-tight">{project.name}</h1>
          {onDeleteProject ? (
            <ProjectDeleteButton
              projectName={project.name}
              tasks={project.tasks}
              onConfirm={() => onDeleteProject?.(project)}
              aria-label={`Delete project ${project.name}`}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="break-all font-mono text-sm text-muted-foreground">
              {project.path}
            </span>
            {project.githubInfo?.connected && project.githubInfo.repository ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  window.electronAPI.openExternal(
                    `https://github.com/${project.githubInfo?.repository}`
                  )
                }
                aria-label="View on GitHub"
              >
                <ArrowUpRight className="size-4" />
              </Button>
            ) : null}
          </div>
          <BaseBranchControls
            baseBranch={baseBranch}
            branchOptions={branchOptions}
            isLoadingBranches={isLoadingBranches}
            isSavingBaseBranch={isSavingBaseBranch}
            branchLoadError={branchLoadError}
            projectPath={project.path}
            onBaseBranchChange={handleBaseBranchChange}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                setBranchReloadToken((token) => token + 1);
              }
            }}
          />
        </div>

        {directTasks.length > 0 && (
          <Alert className="border-border bg-muted/50">
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            <AlertTitle className="text-sm font-medium text-foreground">
              Direct branch mode
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {directTasks.length === 1 ? (
                <>
                  <span className="font-medium text-foreground">{directTasks[0].name}</span>{' '}
                  is running directly on your current branch.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {directTasks.map((t) => t.name).join(', ')}
                  </span>{' '}
                  are running directly on your current branch.
                </>
              )}{' '}
              Changes will affect your working directory.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Tabs row */}
      <div className="flex items-center justify-between border-b border-border px-6 pb-0">
        <div className="flex">
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              viewMode === 'kanban'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            Board
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={[
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              viewMode === 'list'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            List
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isSelectMode && selectedCount > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 px-3 text-xs font-medium"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          ) : null}
          {hasTasks ? (
            <button
              type="button"
              onClick={() => setIsSelectMode((prev) => !prev)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              aria-pressed={isSelectMode}
            >
              {isSelectMode ? 'Cancel' : 'Select'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            project={project}
            onOpenTask={onOpenTask}
            onCreateTask={onCreateTask}
            onDeleteTask={(task) => onDeleteTask(project, task)}
            isSelectMode={isSelectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        ) : (
          <div className="h-full overflow-y-auto px-6 py-6">
            <ProjectTaskList
              project={project}
              activeTask={activeTask}
              onSelectTask={onSelectTask}
              onDeleteTask={onDeleteTask}
              isSelectMode={isSelectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          </div>
        )}
      </div>

      <TaskBulkDeleteDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        tasks={selectedTargets}
        onConfirm={handleBulkDelete}
        isDeleting={isBulkDeleting}
      />
    </div>
  );
};

export default ProjectKanbanHome;
