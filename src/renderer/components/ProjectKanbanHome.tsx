import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, AlertCircle } from 'lucide-react';
import KanbanBoard from './kanban/KanbanBoard';
import ProjectTaskList from './ProjectTaskList';
import ProjectDeleteButton from './ProjectDeleteButton';
import BaseBranchControls, { RemoteBranchOption } from './BaseBranchControls';
import { Button } from './ui/button';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
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
    if (viewMode !== 'list') {
      setIsSelectMode(false);
    }
  }, [viewMode]);

  useEffect(() => {
    setIsSelectMode(false);
  }, [project.id]);

  const tasks = project.tasks ?? [];
  const directTasks = tasks.filter((task) => task.useWorktree === false);
  const hasTasks = tasks.length > 0;

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

        <div className="flex items-center gap-2">
          <span className="break-all font-mono text-sm text-muted-foreground">
            {project.path}
          </span>
          <BaseBranchControls
            baseBranch={baseBranch}
            branchOptions={branchOptions}
            isLoadingBranches={isLoadingBranches}
            isSavingBaseBranch={isSavingBaseBranch}
            branchLoadError={branchLoadError}
            onBaseBranchChange={handleBaseBranchChange}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                setBranchReloadToken((token) => token + 1);
              }
            }}
          />
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

        {viewMode === 'list' && hasTasks ? (
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

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard project={project} onOpenTask={onOpenTask} onCreateTask={onCreateTask} />
        ) : (
          <div className="h-full overflow-y-auto px-6 py-6">
            <ProjectTaskList
              project={project}
              onCreateTask={onCreateTask}
              activeTask={activeTask}
              onSelectTask={onSelectTask}
              onDeleteTask={onDeleteTask}
              isSelectMode={isSelectMode}
              onSelectModeChange={setIsSelectMode}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectKanbanHome;
