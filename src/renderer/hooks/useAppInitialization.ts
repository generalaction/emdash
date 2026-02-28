import { useEffect, useState } from 'react';
import type { Project, Task } from '../types/app';
import { saveActiveIds } from '../constants/layout';
import { withRepoKey } from '../lib/projectUtils';
import { rpc } from '../lib/rpc';

interface UseAppInitializationOptions {
  checkGithubStatus: () => void;
  onProjectsLoaded: (projects: Project[]) => void;
  onShowHomeView: (show: boolean) => void;
  onInitialLoadComplete: () => void;
}

interface UseAppInitializationReturn {
  platform: string;
  isInitialLoadComplete: boolean;
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
  const { checkGithubStatus, onProjectsLoaded, onShowHomeView, onInitialLoadComplete } = options;

  const [platform, setPlatform] = useState<string>('');
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  useEffect(() => {
    const loadAppData = async () => {
      try {
        const [_appVersion, appPlatform, projects] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.getPlatform(),
          rpc.db.getProjects(),
        ]);

        setPlatform(appPlatform);
        const initialProjects = applyProjectOrder(
          projects.map((p) => withRepoKey(p, appPlatform))
        );
        onProjectsLoaded(initialProjects);

        checkGithubStatus();

        const projectsWithTasks = await Promise.all(
          initialProjects.map(async (project) => {
            const tasks = await rpc.db.getTasks(project.id) as Task[];
            return withRepoKey({ ...project, tasks }, appPlatform);
          })
        );
        const ordered = applyProjectOrder(projectsWithTasks);
        onProjectsLoaded(ordered);

        // Always land on home view on app start (e.g. after restart/update)
        onShowHomeView(true);
        saveActiveIds(null, null);
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
    applyProjectOrder,
    saveProjectOrder,
  };
}
