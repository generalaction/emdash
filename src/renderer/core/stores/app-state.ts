import { AppInfoStore } from './app-info-store';
import { DependenciesStore } from './dependencies-store';
import { NavigationStore } from './navigation-store';
import { ProjectManagerStore } from './project-manager';
import { SidebarStore } from './sidebar-store';
import { snapshotRegistry, SnapshotRegistry } from './snapshot-registry';
import { UpdateStore } from './update-store';

class AppState {
  readonly appInfo: AppInfoStore;
  readonly update: UpdateStore;
  readonly projects: ProjectManagerStore;
  readonly sidebar: SidebarStore;
  readonly snapshots: SnapshotRegistry;
  readonly navigation: NavigationStore;
  readonly dependencies: DependenciesStore;

  constructor() {
    this.snapshots = snapshotRegistry;
    this.appInfo = new AppInfoStore();
    this.update = new UpdateStore();
    this.projects = new ProjectManagerStore();
    this.sidebar = new SidebarStore(this.projects);
    this.navigation = new NavigationStore();
    this.dependencies = new DependenciesStore();
    snapshotRegistry.register('navigation', () => this.navigation.snapshot);
    snapshotRegistry.register('sidebar', () => this.sidebar.snapshot);
    this.dependencies.start();
  }
}

export const appState = new AppState();

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
