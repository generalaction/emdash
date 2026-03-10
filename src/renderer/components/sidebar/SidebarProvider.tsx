import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useProjectManagementContext } from '@renderer/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@renderer/contexts/TaskManagementProvider';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';
import type { Task } from '@renderer/types/chat';

const PINNED_TASKS_KEY = 'emdash-pinned-tasks';

interface SidebarContextValue {
  forceOpenIds: Set<string>;
  setForceOpenIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  pinnedTaskIds: Set<string>;
  handlePinTask: (task: Task) => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

interface SidebarProviderProps {
  children: React.ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const { projects } = useProjectManagementContext();
  const { tasksByProjectId } = useTaskManagementContext();

  const [forceOpenIds, setForceOpenIds] = useState<Set<string>>(new Set());
  const prevTaskCountsRef = React.useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const prev = prevTaskCountsRef.current;
    for (const project of projects) {
      const taskCount = tasksByProjectId[project.id]?.length ?? 0;
      const prevCount = prev.get(project.id) ?? 0;
      if (prevCount === 0 && taskCount > 0) {
        setForceOpenIds((s) => new Set(s).add(project.id));
      }
      prev.set(project.id, taskCount);
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
    const allActiveIds = new Set(
      Object.values(tasksByProjectId)
        .flat()
        .map((t) => t.id)
    );
    const cleaned = pinnedTaskIdsArray.filter((id) => allActiveIds.has(id));
    if (cleaned.length !== pinnedTaskIdsArray.length) {
      setPinnedTaskIdsArray(cleaned);
    }
  }, [tasksByProjectId, pinnedTaskIdsArray, setPinnedTaskIdsArray]);

  const value = useMemo(
    () => ({ forceOpenIds, setForceOpenIds, pinnedTaskIds, handlePinTask }),
    [forceOpenIds, pinnedTaskIds, handlePinTask]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebarContext() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }
  return context;
}
