import { Titlebar } from '@/components/titlebar/Titlebar';
import ChatInterface from '@/components/ChatInterface';
import MultiAgentTask from '@/components/MultiAgentTask';
import RightSidebar from '@/components/RightSidebar';
import TitlebarContext from '@/components/titlebar/TitlebarContext';
import TaskCreationLoading from '@/components/TaskCreationLoading';
import OpenInMenu from '@/components/titlebar/OpenInMenu';
import { useCurrentProject } from '@/contexts/CurrentProjectProvider';
import { useCurrentTask } from '@/contexts/CurrentTaskProvider';
import { useProjectManagementContext } from '@/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@/contexts/TaskManagementContext';
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
    <Titlebar>
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="pointer-events-auto w-[min(60vw,720px)] truncate">
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
        </div>
      </div>
      {currentPath ? (
        <OpenInMenu
          path={currentPath}
          align="right"
          isRemote={project?.isRemote || false}
          sshConnectionId={project?.sshConnectionId || null}
        />
      ) : null}
    </Titlebar>
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

export function TaskRightSidebar() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo(project);
  const { projectDefaultBranch } = useProjectBranchOptions(project);

  useAutoPrRefresh(task?.path);

  return (
    <RightSidebar
      task={task}
      projectPath={project?.path || null}
      projectRemoteConnectionId={projectRemoteConnectionId}
      projectRemotePath={projectRemotePath}
      projectDefaultBranch={projectDefaultBranch}
      className="lg:border-l-0"
    />
  );
}
