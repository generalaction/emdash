import { asAvailableProject } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { SidebarNavigationController } from '@core/features/workbench/browser/sidebar/sidebar-navigation';
import { SidebarStore } from '@core/features/workbench/browser/sidebar/sidebar-store';
import { navigationStoreToken } from '@core/primitives/navigation/browser/app-stores';
import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const sidebarStoreToken = scopedStoreToken<SidebarStore>('workbench.sidebar');
const sidebarNavigationControllerToken = scopedStoreToken<SidebarNavigationController>(
  'workbench.sidebar-navigation'
);

// SidebarStore resolves the projects store at create time, so the projects
// contribution must be registered before this one in the app-scope manifest.
export const workbenchAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: sidebarStoreToken,
    create: (_context, stores) => new SidebarStore(stores.get(projectManagerStoreToken)),
  }),
  contributeScopedStore({
    token: sidebarNavigationControllerToken,
    create: (_context, stores) => {
      const projects = stores.get(projectManagerStoreToken);
      return new SidebarNavigationController(
        stores.get(navigationStoreToken),
        stores.get(sidebarStoreToken),
        (projectId, taskId) => {
          const project = asAvailableProject(projects.projects.get(projectId));
          return project?.get(taskManagerStoreToken).tasks.get(taskId)?.data.isPinned === true;
        }
      );
    },
    activate: (controller) => controller.activate(),
    dispose: (controller) => controller.dispose(),
  }),
];

/** Returns the app-scoped SidebarStore. */
export function getSidebarStore(): SidebarStore {
  return getAppStores().get(sidebarStoreToken);
}
