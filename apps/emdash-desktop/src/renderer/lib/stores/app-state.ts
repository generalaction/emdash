import { MachinesStore } from '@core/features/machines/browser/machines-store';
import { ProjectManagerStore } from '@core/features/projects/browser/stores/project-manager';
import { SidebarStore } from '@core/features/workbench/browser/sidebar/sidebar-store';
import { NavigationHistoryStore } from './navigation-history-store';
import { NavigationStore } from './navigation-store';
import { UpdateStore } from './update-store';

class AppState {
  readonly update: UpdateStore;
  readonly projects: ProjectManagerStore;
  readonly sidebar: SidebarStore;
  readonly history: NavigationHistoryStore;
  readonly navigation: NavigationStore;
  readonly machines: MachinesStore;

  constructor() {
    this.update = new UpdateStore();
    this.machines = new MachinesStore({
      onConnectionReady: (connectionId) => {
        this.projects.onSshConnectionReady(connectionId);
      },
    });
    this.projects = new ProjectManagerStore();
    this.sidebar = new SidebarStore(this.projects);
    this.history = new NavigationHistoryStore();
    this.navigation = new NavigationStore();
    if (typeof window !== 'undefined' && 'electronAPI' in window) {
      void this.machines.start();
    }
  }
}

export const appState = new AppState();

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
