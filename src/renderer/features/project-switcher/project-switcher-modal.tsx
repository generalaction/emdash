import { Command } from 'cmdk';
import { GitBranch } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { sortTasksForSwitcher, type SwitcherTask } from '@shared/project-switcher';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

interface ProjectWithTasks {
  id: string;
  name: string;
  tasks: Array<{ store: TaskStore; data: SwitcherTask }>;
}

function useProjectsWithTasks(): ProjectWithTasks[] {
  return useObserver(() => {
    const nav = appState.navigation;
    const navParams = nav.viewParamsStore['task'] as { taskId?: string } | undefined;
    const currentTaskId = nav.currentViewId === 'task' ? navParams?.taskId : undefined;

    const result: ProjectWithTasks[] = [];
    for (const store of getProjectManagerStore().projects.values()) {
      const mounted = asMounted(store);
      if (!mounted) continue;
      const tasks: ProjectWithTasks['tasks'] = [];
      for (const taskStore of mounted.taskManager.tasks.values()) {
        const task = registeredTaskData(taskStore);
        if (!task || task.archivedAt) continue;
        tasks.push({
          store: taskStore,
          data: {
            id: task.id,
            name: task.name,
            status: task.status,
            lastInteractedAt: task.lastInteractedAt ?? task.updatedAt,
          },
        });
      }
      if (tasks.length > 0) {
        const sorted = sortTasksForSwitcher(tasks.map((t) => t.data));
        const byId = new Map(tasks.map((t) => [t.data.id, t]));
        const ordered = sorted.map((s) => byId.get(s.id)!);
        // Move current task to end
        const currentIdx = ordered.findIndex((t) => t.data.id === currentTaskId);
        if (currentIdx !== -1) {
          const [current] = ordered.splice(currentIdx, 1);
          ordered.push(current);
        }
        result.push({
          id: mounted.data.id,
          name: store.name ?? mounted.data.id,
          tasks: ordered,
        });
      }
    }
    return result;
  });
}

export function ProjectSwitcherModal({ onClose }: BaseModalProps) {
  const [query, setQuery] = useState('');
  const { navigate } = useNavigate();
  const projects = useProjectsWithTasks();
  const listRef = useRef<HTMLDivElement>(null);

  // Ctrl+Tab cycling: Tab moves selection, releasing Ctrl confirms
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        // Dispatch arrow key to move cmdk selection
        const arrow = new KeyboardEvent('keydown', {
          key: e.shiftKey ? 'ArrowUp' : 'ArrowDown',
          bubbles: true,
        });
        listRef.current?.dispatchEvent(arrow);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        // Confirm the currently highlighted item
        const selected = listRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null;
        selected?.click();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return (
    <Command className="flex flex-col overflow-hidden" shouldFilter loop>
      <div className="border-b border-foreground/10 px-1">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Switch to task…"
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-foreground/40"
          autoFocus
        />
      </div>
      <Command.List ref={listRef} className="h-96 overflow-y-auto p-1">
        <Command.Empty className="py-8 text-center text-sm text-foreground/40">
          No tasks found
        </Command.Empty>
        {projects.map((project) => (
          <Command.Group
            key={project.id}
            heading={project.name}
            className={GROUP_CLASS}
          >
            {project.tasks.map(({ store, data }) => (
              <Command.Item
                key={data.id}
                value={`${project.name} ${data.name}`}
                onSelect={() => {
                  onClose();
                  navigate('task', { projectId: project.id, taskId: data.id });
                }}
                className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
              >
                <GitBranch size={14} className="shrink-0 text-foreground/40" />
                <span className="flex-1 truncate">{data.name}</span>
                <AgentStatusIndicator
                  status={taskAgentStatus(store)}
                  disableTooltip
                />
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
      <div className="flex items-center gap-4 border-t border-foreground/10 px-3 py-2">
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↑
          </kbd>
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↓
          </kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            ↵
          </kbd>
          Select
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/40">
          <kbd className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground/50">
            Esc
          </kbd>
          Close
        </span>
      </div>
    </Command>
  );
}
