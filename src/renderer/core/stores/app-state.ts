import { NavigationStore } from './navigation-store';
import { ProjectManagerStore } from './project-manager';
import { SidebarStore } from './sidebar-store';
import { snapshotRegistry, SnapshotRegistry } from './snapshot-registry';

class AppState {
  readonly projects: ProjectManagerStore;
  readonly sidebar: SidebarStore;
  readonly snapshots: SnapshotRegistry;
  readonly navigation: NavigationStore;

  constructor() {
    this.snapshots = snapshotRegistry;
    this.projects = new ProjectManagerStore();
    this.sidebar = new SidebarStore(this.projects);
    this.navigation = new NavigationStore();
    snapshotRegistry.register('navigation', () => this.navigation.snapshot);
  }
}

export const appState = new AppState();

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
