import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Titlebar } from '@/components/titlebar/Titlebar';
import ChatInterface from '@/components/ChatInterface';
import MultiAgentTask from '@/components/MultiAgentTask';
import RightSidebar from '@/components/RightSidebar';
import TitlebarContext from '@/components/titlebar/TitlebarContext';
import TaskCreationLoading from '@/components/TaskCreationLoading';
import OpenInMenu from '@/components/titlebar/OpenInMenu';
import { DiffViewer } from '@/components/diff-viewer/DiffViewer';
import { useCurrentProject } from '@/contexts/CurrentProjectProvider';
import { useCurrentTask } from '@/contexts/CurrentTaskProvider';
import { useProjectManagementContext } from '@/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@/contexts/TaskManagementProvider';
import { useWorkspaceNavigation } from '@/contexts/WorkspaceNavigationContext';
import { useProjectBranchOptions } from '@/hooks/useProjectBranchOptions';
import { useProjectRemoteInfo } from '@/hooks/useProjectRemoteInfo';
import { useAutoPrRefresh } from '@/hooks/useAutoPrRefresh';
import { getAgentForTask } from '@/lib/getAgentForTask';

export function TaskTitlebar() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { projects } = useProjectManagementContext();
  const { tasksByProjectId } = useTaskManagementContext();
  const { navigate } = useWorkspaceNavigation();

  const isTaskMultiAgent = Boolean(task?.metadata?.multiAgent?.enabled);
  const currentPath = isTaskMultiAgent
    ? null
    : task?.path || (project?.isRemote ? project?.remotePath : project?.path) || null;

  const projectWithTasks = project
    ? { ...project, tasks: tasksByProjectId[project.id] ?? project.tasks ?? [] }
    : null;

  return (
    <Titlebar
      leftSlot={
        <TitlebarContext
          projects={projects.map((p) => ({
            ...p,
            tasks: tasksByProjectId[p.id] ?? p.tasks ?? [],
          }))}
          selectedProject={projectWithTasks}
          activeTask={task}
          onSelectProject={(p) => navigate('project', { projectId: p.id })}
          onSelectTask={(t) => navigate('task', { projectId: t.projectId, taskId: t.id })}
        />
      }
      rightSlot={
        currentPath ? (
          <OpenInMenu
            path={currentPath}
            align="right"
            isRemote={project?.isRemote || false}
            sshConnectionId={project?.sshConnectionId || null}
          />
        ) : null
      }
    />
  );
}

export function TaskMainPanel() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { handleTaskInterfaceReady, handleRenameTask, isCreatingTask } = useTaskManagementContext();
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo(project);
  const { projectDefaultBranch } = useProjectBranchOptions(project);

  if (!task || !project) {
    if (isCreatingTask) {
      return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="absolute inset-0 z-10 bg-background">
            <TaskCreationLoading />
          </div>
        </div>
      );
    }
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  const initialAgent = getAgentForTask(task) || undefined;
  const isMultiAgent = Boolean(task.metadata?.multiAgent?.enabled);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {isMultiAgent ? (
        <MultiAgentTask
          task={task}
          projectName={project.name}
          projectId={project.id}
          projectPath={project.path}
          projectRemoteConnectionId={projectRemoteConnectionId}
          projectRemotePath={projectRemotePath}
          defaultBranch={projectDefaultBranch}
          onTaskInterfaceReady={handleTaskInterfaceReady}
        />
      ) : (
        <ChatInterface
          task={task}
          project={project}
          projectName={project.name}
          projectPath={project.path}
          projectRemoteConnectionId={projectRemoteConnectionId}
          projectRemotePath={projectRemotePath}
          defaultBranch={projectDefaultBranch}
          className="min-h-0 flex-1"
          initialAgent={initialAgent}
          onTaskInterfaceReady={handleTaskInterfaceReady}
          onRenameTask={handleRenameTask}
        />
      )}
      {isCreatingTask && (
        <div className="absolute inset-0 z-10 bg-background">
          <TaskCreationLoading />
        </div>
      )}
    </div>
  );
}

interface DiffState {
  taskId: string;
  taskPath: string;
  initialFile?: string | null;
}

export function TaskRightSidebar() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo(project);
  const { projectDefaultBranch } = useProjectBranchOptions(project);
  const [diffState, setDiffState] = useState<DiffState | null>(null);

  useAutoPrRefresh(task?.path);

  const handleOpenChanges = (filePath?: string, taskPath?: string) => {
    if (!task || !taskPath) return;
    setDiffState({ taskId: task.id, taskPath, initialFile: filePath ?? null });
  };

  return (
    <>
      <RightSidebar
        task={task}
        projectPath={project?.path || null}
        projectRemoteConnectionId={projectRemoteConnectionId}
        projectRemotePath={projectRemotePath}
        projectDefaultBranch={projectDefaultBranch}
        className="lg:border-l-0"
        onOpenChanges={handleOpenChanges}
      />
      <DialogPrimitive.Root open={!!diffState} onOpenChange={(open) => !open && setDiffState(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className="fixed inset-0 z-[200] bg-background focus:outline-none"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Diff Viewer</DialogPrimitive.Title>
            {diffState && (
              <DiffViewer
                taskId={diffState.taskId}
                taskPath={diffState.taskPath}
                initialFile={diffState.initialFile}
                onClose={() => setDiffState(null)}
              />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
