import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Task } from '@shared/tasks';
import { useProjectsContext } from '@renderer/contexts/ProjectsProvider';
import { useTasksContext } from '@renderer/contexts/tasks-provider';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';

const PINNED_TASKS_KEY = 'emdash-pinned-tasks';

interface SidebarContextValue {
  forceOpenIds: Set<string>;
  setForceOpenIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  pinnedTaskIds: Set<string>;
  handlePinTask: (task: Task) => void;
  tasksByProjectId: Record<string, Task[]>;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

interface SidebarProviderProps {
  children: React.ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const { projects } = useProjectsContext();
  const { tasks } = useTasksContext();

  const [forceOpenIds, setForceOpenIds] = useState<Set<string>>(new Set());
  const prevTaskCountsRef = React.useRef<Map<string, number>>(new Map());

  const tasksByProjectId = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const task of tasks) {
      const list = map[task.projectId] ?? [];
      list.push(task);
      map[task.projectId] = list;
    }
    return map;
  }, [tasks]);

  useEffect(() => {
    const prev = prevTaskCountsRef.current;
    const toAdd: string[] = [];
    for (const project of projects) {
      const taskCount = tasksByProjectId[project.id]?.length ?? 0;
      const prevCount = prev.get(project.id) ?? 0;
      if (prevCount === 0 && taskCount > 0) {
        toAdd.push(project.id);
      }
      prev.set(project.id, taskCount);
    }
    if (toAdd.length > 0) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setForceOpenIds((s) => {
        const next = new Set(s);
        for (const id of toAdd) next.add(id);
        return next;
      });
    }
  }, [projects, tasksByProjectId]);

  const [pinnedTaskIdsArray, setPinnedTaskIdsArray] = useLocalStorage<string[]>(
    PINNED_TASKS_KEY,
    []
  );
  const pinnedTaskIds = useMemo(() => new Set(pinnedTaskIdsArray), [pinnedTaskIdsArray]);

  const handlePinTask = useCallback(
    (task: Task) => {
      setPinnedTaskIdsArray((prev) =>
        prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]
      );
    },
    [setPinnedTaskIdsArray]
  );

  useEffect(() => {
    if (!pinnedTaskIdsArray.length) return;
    const allActiveIds = new Set(tasks.map((t) => t.id));
    const cleaned = pinnedTaskIdsArray.filter((id) => allActiveIds.has(id));
    if (cleaned.length !== pinnedTaskIdsArray.length) {
      setPinnedTaskIdsArray(cleaned);
    }
  }, [tasks, pinnedTaskIdsArray, setPinnedTaskIdsArray]);

  return (
    <SidebarContext.Provider
      value={{
        forceOpenIds,
        setForceOpenIds,
        pinnedTaskIds,
        handlePinTask,
        tasksByProjectId,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarContext() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }
  return context;
}
