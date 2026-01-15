import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import type { Project, Task } from '../../types/app';

interface TitlebarContextProps {
  projects: Project[];
  selectedProject: Project | null;
  activeTask: Task | null;
  onSelectProject: (project: Project) => void;
  onSelectTask: (task: Task) => void;
}

const TitlebarContext: React.FC<TitlebarContextProps> = ({
  projects,
  selectedProject,
  activeTask,
  onSelectProject,
  onSelectTask,
}) => {
  if (!selectedProject) {
    return <div className="w-full" />;
  }

  const tasks = selectedProject?.tasks ?? [];
  const projectValue = selectedProject.id;
  const taskValue = activeTask?.id;
  const projectLabel = selectedProject.name;
  const taskLabel = activeTask?.name ?? '';

  const handleProjectChange = (value: string) => {
    const nextProject = projects.find((project) => project.id === value);
    if (nextProject) {
      onSelectProject(nextProject);
    }
  };

  const handleTaskChange = (value: string) => {
    const nextTask = tasks.find((task) => task.id === value);
    if (nextTask) {
      onSelectTask(nextTask);
    }
  };

  return (
    <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
      <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
        <Select value={projectValue} onValueChange={handleProjectChange}>
          <SelectTrigger
            className="h-7 w-auto max-w-[240px] justify-start gap-1 border-none bg-transparent px-1 py-0.5 text-[13px] font-medium leading-none text-foreground shadow-none hover:bg-background/70 data-[state=open]:bg-background/80 [&>span]:min-w-0 [&>svg]:hidden"
            aria-label="Select project"
            title={projectLabel}
          >
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent side="bottom" align="start" className="w-[min(320px,90vw)]">
            {projects.length > 0 ? (
              projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <span className="truncate">{project.name}</span>
                </SelectItem>
              ))
            ) : (
              <SelectItem value="__empty_projects__" disabled>
                No projects yet
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <span className="px-2 text-center text-[11px] text-muted-foreground/60">/</span>
      <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
        <Select value={taskValue} onValueChange={handleTaskChange} disabled={!selectedProject}>
          <SelectTrigger
            className={[
              'h-7 w-auto max-w-[320px] justify-start gap-1 border-none bg-transparent px-1 py-0.5 text-[13px] font-medium leading-none text-foreground shadow-none hover:bg-background/70 data-[state=open]:bg-background/80 data-[placeholder]:text-muted-foreground/70 [&>span]:min-w-0 [&>svg]:hidden',
              activeTask ? '' : 'min-w-[84px]',
            ].join(' ')}
            aria-label="Select task"
            title={taskLabel}
          >
            <SelectValue placeholder="" />
          </SelectTrigger>
          <SelectContent side="bottom" align="start" className="w-[min(360px,90vw)]">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <SelectItem
                  key={task.id}
                  value={task.id}
                  className="pr-2 [&>span:first-child]:hidden"
                >
                  <span className="truncate">{task.name}</span>
                </SelectItem>
              ))
            ) : (
              <SelectItem
                value="__empty_tasks__"
                disabled
                className="pr-2 [&>span:first-child]:hidden"
              >
                No tasks yet
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default TitlebarContext;
