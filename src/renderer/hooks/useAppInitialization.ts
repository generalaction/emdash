import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../types/app';
import { FIRST_LAUNCH_KEY, PROJECT_ORDER_KEY } from '../constants/layout';
import { withRepoKey } from '../lib/projectUtils';
import { useGithubAuth } from './useGithubAuth';

/**
 * Hook to manage app initialization
 * Handles initial data loading, first launch detection, and welcome flow
 */

export interface AppInitializationState {
  appVersion: string;
  platform: string;
  showWelcomeScreen: boolean;
  showFirstLaunchModal: boolean;
  isInitialized: boolean;
}

export interface AppInitializationActions {
  handleWelcomeGetStarted: () => void;
  markFirstLaunchSeen: () => void;
  loadProjects: () => Promise<Project[]>;
}

export function useAppInitialization(): AppInitializationState & AppInitializationActions {
  const { checkStatus } = useGithubAuth();

  const [appVersion, setAppVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [showWelcomeScreen, setShowWelcomeScreen] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  // Apply project order from localStorage
  const applyProjectOrder = useCallback((list: Project[]) => {
    try {
      const raw = localStorage.getItem(PROJECT_ORDER_KEY);
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
  }, []);

  // Handle welcome screen get started
  const handleWelcomeGetStarted = useCallback(() => {
    setShowWelcomeScreen(false);
    setShowFirstLaunchModal(true);
  }, []);

  // Mark first launch as seen
  const markFirstLaunchSeen = useCallback(() => {
    try {
      localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    } catch {
      // ignore
    }
    try {
      void window.electronAPI.setOnboardingSeen?.(true);
    } catch {
      // ignore
    }
    setShowFirstLaunchModal(false);
  }, []);

  // Load initial projects with tasks
  const loadProjects = useCallback(async (): Promise<Project[]> => {
    try {
      const projects = await window.electronAPI.getProjects();
      const initialProjects = applyProjectOrder(
        projects.map((p) => withRepoKey(p, platform))
      );

      // Load tasks for each project
      const projectsWithTasks = await Promise.all(
        initialProjects.map(async (project) => {
          const tasks = await window.electronAPI.getTasks(project.id);
          return withRepoKey({ ...project, tasks }, platform);
        })
      );

      return applyProjectOrder(projectsWithTasks);
    } catch (error) {
      const { log } = await import('../lib/logger');
      log.error('Failed to load projects:', error as any);
      return [];
    }
  }, [platform, applyProjectOrder]);

  // Check first launch status
  useEffect(() => {
    const check = async () => {
      let seenLocal = false;
      try {
        seenLocal = localStorage.getItem(FIRST_LAUNCH_KEY) === '1';
      } catch {
        // ignore
      }
      if (seenLocal) return;

      try {
        const res = await window.electronAPI.getTelemetryStatus?.();
        if (res?.success && res.status?.onboardingSeen) return;
      } catch {
        // ignore
      }
      // Show WelcomeScreen for first-time users
      setShowWelcomeScreen(true);
    };
    void check();
  }, []);

  // Initialize app data on mount
  useEffect(() => {
    const loadAppData = async () => {
      try {
        const [appVersionData, appPlatform] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.getPlatform(),
        ]);

        setAppVersion(appVersionData);
        setPlatform(appPlatform);

        // Refresh GitHub status
        checkStatus();

        setIsInitialized(true);
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to load app data:', error as any);
        setIsInitialized(true); // Mark as initialized even on error
      }
    };

    loadAppData();
  }, [checkStatus]);

  return {
    // State
    appVersion,
    platform,
    showWelcomeScreen,
    showFirstLaunchModal,
    isInitialized,

    // Actions
    handleWelcomeGetStarted,
    markFirstLaunchSeen,
    loadProjects,
  };
}