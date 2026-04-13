import type { ViewId } from '@renderer/app/view-registry';

export type NonSettingsViewId = Exclude<ViewId, 'settings'>;

export function getSettingsToggleDestination(
  currentView: ViewId,
  lastNonSettingsView: NonSettingsViewId | null
): ViewId {
  if (currentView !== 'settings') {
    return 'settings';
  }

  return lastNonSettingsView ?? 'home';
}
