import { useEffect, useMemo, useState } from 'react';
import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import { getStoredActiveIds, saveActiveIds } from '../constants/layout';
import { getAgentForTask } from '../lib/getAgentForTask';
import { withRepoKey } from '../lib/projectUtils';

interface UseAppInitializationOptions {
  checkGithubStatus: () => void;
  onProjectsLoaded: (projects: Project[]) => void;
  onProjectSelected: (project: Project) => void;
  onShowHomeView: (show: boolean) => void;
  onTaskSelected: (task: Task) => void;
  onTaskAgentSelected: (agent: Agent | null) => void;
  onInitialLoadComplete: () => void;
}

interface UseAppInitializationReturn {
  platform: string;
  isInitialLoadComplete: boolean;
  storedActiveIds: { projectId: string | null; taskId: string | null };
  applyProjectOrder: (list: Project[]) => Project[];
  saveProjectOrder: (list: Project[]) => void;
}

const ORDER_KEY = 'sidebarProjectOrder';

// Pure functions for project ordering
const applyProjectOrder = (list: Project[]) => {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return list;
    const order: string[] = JSON.parse(raw);
    const indexOf = (id: string) => {
      const idx = order.indexOf(id);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    return [...list].sort((a, b) => indexOf(a.id) - indexOf(b.id));
  } catch {
    return list;
  }
};

const saveProjectOrder = (list: Project[]) => {
  try {
    const ids = list.map((p) => p.id);
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {}
};

export function useAppInitialization(
  options: UseAppInitializationOptions
): UseAppInitializationReturn {
  const {
    checkGithubStatus,
    onProjectsLoaded,
    onProjectSelected,
    onShowHomeView,
    onTaskSelected,
    onTaskAgentSelected,
    onInitialLoadComplete,
  } = options;

  const [platform, setPlatform] = useState<string>('');
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  const storedActiveIds = useMemo(() => getStoredActiveIds(), []);

  useEffect(() => {
    const loadAppData = async () => {
      try {
        const [_appVersion, appPlatform, projects] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.getPlatform(),
          window.electronAPI.getProjects(),
        ]);

        setPlatform(appPlatform);
        const initialProjects = applyProjectOrder(projects.map((p) => withRepoKey(p, appPlatform)));
        onProjectsLoaded(initialProjects);

        checkGithubStatus();

        const projectsWithTasks = await Promise.all(
          initialProjects.map(async (project) => {
            const tasks = await window.electronAPI.getTasks(project.id);
            return withRepoKey({ ...project, tasks }, appPlatform);
          })
        );
        const ordered = applyProjectOrder(projectsWithTasks);
        onProjectsLoaded(ordered);

        const { projectId: storedProjectId, taskId: storedTaskId } = storedActiveIds;
        if (storedProjectId) {
          const project = ordered.find((p) => p.id === storedProjectId);
          if (project) {
            onProjectSelected(project);
            onShowHomeView(false);
            if (storedTaskId) {
              const task = project.tasks?.find((t) => t.id === storedTaskId);
              if (task) {
                onTaskSelected(task);
                onTaskAgentSelected(getAgentForTask(task));
              } else {
                saveActiveIds(storedProjectId, null);
              }
            }
          } else {
            onShowHomeView(true);
            saveActiveIds(null, null);
          }
        }
        setIsInitialLoadComplete(true);
        onInitialLoadComplete();
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to load app data:', error as any);
        onShowHomeView(true);
        setIsInitialLoadComplete(true);
        onInitialLoadComplete();
      }
    };

    loadAppData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    platform,
    isInitialLoadComplete,
    storedActiveIds,
    applyProjectOrder,
    saveProjectOrder,
  };
}
