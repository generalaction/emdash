import { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { SidebarStore } from '@renderer/features/sidebar/sidebar-store';
import { NavigationHistoryStore } from './navigation-history-store';
import { NavigationStore } from './navigation-store';
import { ResourceMonitorStore } from './resource-monitor-store';
import { snapshotRegistry, type SnapshotRegistry } from './snapshot-registry';
import { SshConnectionStore } from './ssh-connection-store';
import { UpdateStore } from './update-store';

class AppState {
  readonly update: UpdateStore;
  readonly projects: ProjectManagerStore;
  readonly sidebar: SidebarStore;
  readonly snapshots: SnapshotRegistry;
  readonly history: NavigationHistoryStore;
  readonly navigation: NavigationStore;
  readonly sshConnections: SshConnectionStore;
  readonly resourceMonitor: ResourceMonitorStore;

  constructor() {
    this.snapshots = snapshotRegistry;
    this.update = new UpdateStore();
    this.projects = new ProjectManagerStore();
    this.sidebar = new SidebarStore(this.projects, () => {
      this.snapshots.saveNow('sidebar', this.sidebar.snapshot);
    });
    this.history = new NavigationHistoryStore();
    this.navigation = new NavigationStore();
    this.sshConnections = new SshConnectionStore({
      onConnectionReady: (_connectionId) => {
        // Agent installation statuses for SSH connections are fetched on-demand
        // via the useAgentInstallationStatuses hook. No explicit refresh needed here.
      },
    });
    this.resourceMonitor = new ResourceMonitorStore();
    snapshotRegistry.register('navigation', () => this.navigation.snapshot);
    snapshotRegistry.register('sidebar', () => this.sidebar.snapshot);
    this.sshConnections.start();
  }
}

export const appState = new AppState();

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
