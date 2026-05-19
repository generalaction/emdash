import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { appState } from '@renderer/lib/stores/app-state';

export const TabSwitcherOverlay = observer(function TabSwitcherOverlay() {
  const store = appState.taskSwitcher;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!store.isVisible || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-active="true"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [store.isVisible, store.pendingTask]);

  if (!store.isVisible) return null;

  const tasks = store.cycleList;
  if (tasks.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15%] pointer-events-none">
      <div
        ref={listRef}
        className="pointer-events-auto w-full max-w-xs rounded-xl bg-background-quaternary p-1 ring-1 ring-foreground/10 shadow-lg"
      >
        {tasks.map((task) => (
          <div
            key={task.taskId}
            data-active={task.taskId === store.pendingTask?.taskId}
            className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm ${
              task.taskId === store.pendingTask?.taskId
                ? 'bg-background-2 text-foreground'
                : 'text-foreground-muted'
            }`}
          >
            <GitBranch size={14} className="shrink-0 text-foreground/40" />
            <span className="flex-1 truncate">{task.name}</span>
            {task.taskId === store.currentTaskId && (
              <span className="shrink-0 text-xs text-foreground/40">current</span>
            )}
            <span className="shrink-0 text-xs text-foreground/40">{task.projectName}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
