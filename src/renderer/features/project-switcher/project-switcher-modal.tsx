import { Command } from 'cmdk';
import { GitBranch } from 'lucide-react';
import { useRef, useState } from 'react';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { useProjectSwitcher } from './use-project-switcher';

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

export function ProjectSwitcherModal({ onClose }: BaseModalProps) {
  const [query, setQuery] = useState('');
  const { navigate } = useNavigate();
  const { projects, currentTaskId } = useProjectSwitcher();
  const listRef = useRef<HTMLDivElement>(null);

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
          <Command.Group key={project.id} heading={project.name} className={GROUP_CLASS}>
            {project.tasks.map((task) => (
              <Command.Item
                key={task.data.id}
                value={`${project.name} ${task.data.name}`}
                onSelect={() => {
                  onClose();
                  navigate('task', { projectId: project.id, taskId: task.data.id });
                }}
                className="flex cursor-pointer items-center gap-2.5 text-foreground-muted aria-selected:text-foreground rounded-md px-2 py-2 text-sm aria-selected:bg-background-2"
              >
                <GitBranch size={14} className="shrink-0 text-foreground/40" />
                <span className="flex-1 truncate">{task.data.name}</span>
                {task.data.id === currentTaskId && (
                  <span className="shrink-0 text-xs text-foreground/40">current</span>
                )}
                <AgentStatusIndicator status={taskAgentStatus(task.store)} disableTooltip />
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
