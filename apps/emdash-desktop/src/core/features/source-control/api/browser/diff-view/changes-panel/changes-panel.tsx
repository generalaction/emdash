import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranchPlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  initializeProjectRepository,
  inspectProjectPath,
} from '@core/features/source-control/api/browser/client';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import { useTaskViewContext } from '@core/features/tasks/api/browser/task-state/task-view-context';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import type { InitializeRepositoryError } from '@core/primitives/projects/api';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import { EmptyState } from '@core/primitives/ui/browser/empty-state';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@core/primitives/ui/browser/resizable';
import { useToast } from '@core/primitives/ui/browser/use-toast';
import { GitStatusSection } from '../../../../browser/diff-view/changes-panel/git-status-section';
import {
  SECTION_HEADER_HEIGHT,
  usePanelLayout,
} from '../../../../browser/diff-view/changes-panel/hooks/use-panel-layout';
import { PullRequestsSection } from '../../../../browser/diff-view/changes-panel/pr-section';
import { StagedSection } from '../../../../browser/diff-view/changes-panel/staged-section';
import { UnstagedSection } from '../../../../browser/diff-view/changes-panel/unstaged-section';

export const ChangesPanel = observer(function ChangesPanel() {
  const { projectId } = useTaskViewContext();
  const taskView = useTaskComposition();
  const workspace = useWorkspace();
  const gitCheckout = workspace.get(gitCheckoutStoreToken);
  const project = asMounted(getProjectStore(projectId))?.data;
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const noRepositoryQueryKey = [
    'changesPanelRepositoryStatus',
    projectId,
    workspace.workspaceId,
    workspace.path,
  ] as const;
  const repositoryStatusQuery = useQuery({
    queryKey: noRepositoryQueryKey,
    enabled: !gitCheckout.hasData && !!project,
    queryFn: async () => {
      if (!project) throw new Error('Project is not mounted');
      return project.type === 'ssh'
        ? inspectProjectPath({
            type: 'ssh',
            connectionId: project.connectionId,
            path: workspace.path,
          })
        : inspectProjectPath({
            type: 'local',
            path: workspace.path,
          });
    },
  });

  const initializeRepositoryMutation = useMutation({
    mutationFn: async () => {
      return initializeProjectRepository(projectId);
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast({
          title: 'Failed to initialize Git repository',
          description: initializeRepositoryErrorMessage(result.error),
          variant: 'destructive',
        });
        return;
      }

      await Promise.all([gitCheckout.retry(), getGitRepositoryStore(projectId)?.retry()]);
      await queryClient.invalidateQueries({ queryKey: noRepositoryQueryKey });
      toast({ title: 'Git repository initialized' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to initialize Git repository',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const {
    expanded,
    toggleExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
    containerRef,
  } = usePanelLayout(changesView ?? null, taskView.isChangesPanelVisible);

  if (!diffView || !changesView) return null;
  if (!gitCheckout.hasData) {
    const status = repositoryStatusQuery.data;
    if (status?.isDirectory && !status.error && status.isGitRepo === false) {
      return (
        <EmptyState
          label="This folder is not a Git repository"
          description="Initialize Git to enable changes, commits, branches, and worktree-based tasks."
          action={
            <Button
              type="button"
              size="sm"
              onClick={() => initializeRepositoryMutation.mutate()}
              disabled={initializeRepositoryMutation.isPending}
            >
              <GitBranchPlus className="size-3.5" />
              {initializeRepositoryMutation.isPending
                ? 'Initializing…'
                : 'Initialize Git repository'}
            </Button>
          }
        />
      );
    }
    return null;
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1"
        id="changes-panel-group"
        disableCursor
      >
        <ResizablePanel
          id="changes-unstaged"
          panelRef={unstagedRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <UnstagedSection />
        </ResizablePanel>
        <ResizableHandle disabled={!expanded.unstaged || !expanded.staged} {...pointerHandlers} />
        <ResizablePanel
          id="changes-staged"
          panelRef={stagedRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <StagedSection />
        </ResizablePanel>
        <ResizableHandle
          disabled={!expanded.staged || !expanded.pullRequests}
          {...pointerHandlers}
        />
        <ResizablePanel
          id="changes-pr"
          panelRef={prRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <PullRequestsSection
            onToggleCollapsed={() => toggleExpanded('pullRequests')}
            collapsed={!expanded.pullRequests}
          />
        </ResizablePanel>
        <ResizablePanel
          id="changes-spacer"
          panelRef={spacerRef}
          minSize="0%"
          maxSize="100%"
          defaultSize="0%"
          className="border-t border-border"
        />
      </ResizablePanelGroup>
      <GitStatusSection />
    </div>
  );
});

function initializeRepositoryErrorMessage(error: InitializeRepositoryError): string {
  if (error.type === 'not-repository') return `No Git repository found at ${error.path}`;
  if ('message' in error) return error.message;
  return 'Could not initialize Git repository';
}
