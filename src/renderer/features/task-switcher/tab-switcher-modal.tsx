import { GitBranch } from 'lucide-react';
import { useObserver } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';

export function TabSwitcherModal(_props: BaseModalProps) {
  const tasks = useObserver(() => appState.taskSwitcher.cycleList);
  const pendingTask = useObserver(() => appState.taskSwitcher.pendingTask);
  const currentTaskId = useObserver(() => appState.taskSwitcher.currentTaskId);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingTask || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-active="true"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [pendingTask]);

  if (tasks.length === 0) return null;

  return (
    <div ref={listRef} className="p-1">
      {tasks.map((task) => (
        <div
          key={task.taskId}
          data-active={task.taskId === pendingTask?.taskId}
          className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm ${
            task.taskId === pendingTask?.taskId
              ? 'bg-background-2 text-foreground'
              : 'text-foreground-muted'
          }`}
        >
          <GitBranch size={14} className="shrink-0 text-foreground/40" />
          <span className="flex-1 truncate">{task.name}</span>
          {task.taskId === currentTaskId && (
            <span className="shrink-0 text-xs text-foreground/40">current</span>
          )}
        </div>
      ))}
    </div>
  );
}
