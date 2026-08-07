import { machinesAppStoreContributions } from '@core/features/machines/contributions/app-stores';
import { projectsAppStoreContributions } from '@core/features/projects/contributions/app-stores';
import { workbenchAppStoreContributions } from '@core/features/workbench/contributions/browser/app-stores';
import { navigationAppStoreContributions } from '@core/primitives/navigation/browser/app-stores';
import type { AppScopedStoreContribution } from '@core/primitives/scoped-stores/browser';

// Order matters: the workbench sidebar resolves the projects store at create
// time, so projects must come first. Navigation is registered before the
// feature slices so their stores can reach it as soon as they are created.
// The UpdateStore contribution is renderer-side and appended by the renderer
// bootstrap.
export const appStoreContributions: readonly AppScopedStoreContribution[] = [
  ...navigationAppStoreContributions,
  ...projectsAppStoreContributions,
  ...machinesAppStoreContributions,
  ...workbenchAppStoreContributions,
];
