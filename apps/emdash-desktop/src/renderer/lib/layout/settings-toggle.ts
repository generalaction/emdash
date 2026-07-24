import { appState } from '@renderer/lib/stores/app-state';

let lastToggleAt = 0;

// macOS menu accelerator and renderer hotkey both fire for one Cmd+, press;
// without this guard they'd toggle then untoggle on the same keystroke.
const DEDUP_WINDOW_MS = 150;

export function toggleSettingsView(): void {
  const now = Date.now();
  if (now - lastToggleAt < DEDUP_WINDOW_MS) return;
  lastToggleAt = now;

  appState.navigation.toggleSettings();
}
