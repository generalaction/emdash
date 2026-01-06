import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, LayoutGrid, List as ListIcon, AlertCircle } from 'lucide-react';
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

  const directTasks = (project.tasks ?? []).filter((task) => task.useWorktree === false);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border bg-background">
        <div className="container mx-auto max-w-6xl space-y-4 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
              <p className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
                {project.path}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:self-start">
              {project.githubInfo?.connected && project.githubInfo.repository ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-3 text-xs font-medium"
                  onClick={() =>
                    window.electronAPI.openExternal(
                      `https://github.com/${project.githubInfo?.repository}`
                    )
                  }
                >
                  View on GitHub
                  <ArrowUpRight className="size-3" />
                </Button>
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
          </div>

          <div className="flex items-start justify-between gap-4">
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

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('kanban')}
                className={[
                  'h-7 gap-1.5 px-2.5 text-xs',
                  viewMode === 'kanban'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <LayoutGrid className="size-3.5" />
                Board
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('list')}
                className={[
                  'h-7 gap-1.5 px-2.5 text-xs',
                  viewMode === 'list'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <ListIcon className="size-3.5" />
                List
              </Button>
            </div>
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/5">
        {viewMode === 'kanban' ? (
          <KanbanBoard project={project} onOpenTask={onOpenTask} onCreateTask={onCreateTask} />
        ) : (
          <div className="container mx-auto h-full max-w-6xl overflow-y-auto px-6 py-6">
            <ProjectTaskList
              project={project}
              onCreateTask={onCreateTask}
              activeTask={activeTask}
              onSelectTask={onSelectTask}
              onDeleteTask={onDeleteTask}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectKanbanHome;