import { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { SidebarStore } from '@renderer/features/sidebar/sidebar-store';
import { NavigationHistoryStore } from './navigation-history-store';
import { NavigationStore } from './navigation-store';
import { SshConnectionStore } from './ssh-connection-store';
import { UpdateStore } from './update-store';

class AppState {
  readonly update: UpdateStore;
  readonly projects: ProjectManagerStore;
  readonly sidebar: SidebarStore;
  readonly history: NavigationHistoryStore;
  readonly navigation: NavigationStore;
  readonly sshConnections: SshConnectionStore;

  constructor() {
    this.update = new UpdateStore();
    this.projects = new ProjectManagerStore();
    this.sidebar = new SidebarStore(this.projects);
    this.history = new NavigationHistoryStore();
    this.navigation = new NavigationStore();
    this.sshConnections = new SshConnectionStore({
      onConnectionReady: (_connectionId) => {
        // Agent installation statuses for SSH connections are fetched on-demand
        // via the useAgentInstallationStatuses hook. No explicit refresh needed here.
      },
    });
    this.sshConnections.start();
  }
}

export const appState = new AppState();

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
