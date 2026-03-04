import { Titlebar } from '@/components/titlebar/Titlebar';
import ProjectMainView from '@/components/ProjectMainView';
import TitlebarContext from '@/components/titlebar/TitlebarContext';
import { useCurrentProject } from '@/contexts/CurrentProjectProvider';
import { useProjectManagementContext } from '@/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@/contexts/TaskManagementContext';
import { useWorkspaceNavigation } from '@/contexts/WorkspaceNavigationContext';
import { useProjectBranchOptions } from '@/hooks/useProjectBranchOptions';

export function ProjectTitlebar() {
  const project = useCurrentProject();
  const { projects } = useProjectManagementContext();
  const { tasksByProjectId } = useTaskManagementContext();
  const { navigate } = useWorkspaceNavigation();

  const tasks = project ? (tasksByProjectId[project.id] ?? []) : [];
  const projectWithTasks = project ? { ...project, tasks } : null;

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
            activeTask={null}
            onSelectProject={(p) => navigate('project', { projectId: p.id })}
            onSelectTask={(task) =>
              navigate('task', { projectId: task.projectId, taskId: task.id })
            }
          />
        </div>
      </div>
    </Titlebar>
  );
}

export function ProjectMainPanel() {
  const project = useCurrentProject();
  const { handleDeleteProject } = useProjectManagementContext();
  const {
    tasksByProjectId,
    openTaskModal,
    handleSelectTask,
    handleDeleteTask,
    handleArchiveTask,
    handleRestoreTask,
  } = useTaskManagementContext();
  const { projectBranchOptions, projectDefaultBranch, isLoadingBranches, setProjectDefaultBranch } =
    useProjectBranchOptions(project);

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  const tasks = tasksByProjectId[project.id] ?? [];
  const projectWithTasks = { ...project, tasks };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProjectMainView
        project={projectWithTasks}
        onCreateTask={() => openTaskModal()}
        activeTask={null}
        onSelectTask={handleSelectTask}
        onDeleteTask={handleDeleteTask}
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreTask}
        onDeleteProject={handleDeleteProject}
        branchOptions={projectBranchOptions}
        isLoadingBranches={isLoadingBranches}
        onBaseBranchChange={setProjectDefaultBranch}
      />
    </div>
  );
}
