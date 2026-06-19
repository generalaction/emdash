import type { ViewId } from '@renderer/app/view-registry';
import type { NavigateFnTyped, NonSettingsViewId } from './navigation-provider';

let lastToggleAt = 0;

// macOS menu accelerator and renderer hotkey both fire for one Cmd+, press;
// without this guard they'd toggle then untoggle on the same keystroke.
const DEDUP_WINDOW_MS = 150;

export function toggleSettingsView(
  navigate: NavigateFnTyped,
  currentView: ViewId,
  lastNonSettingsView: NonSettingsViewId
): void {
  const now = Date.now();
  if (now - lastToggleAt < DEDUP_WINDOW_MS) return;
  lastToggleAt = now;

  if (currentView === 'settings') {
    // Bare navigate(viewId) preserves stored params for views that statically require them.
    (navigate as (viewId: ViewId) => void)(lastNonSettingsView);
    return;
  }

  navigate('settings');
}
