import { useHotkey } from '@tanstack/react-hotkeys';
import { TabViewProvider } from '@renderer/core/stores/generic-tab-view';

/**
 * Registers keyboard shortcuts for tab navigation within a TabViewProvider.
 *
 * Shortcuts:
 *   Mod+Alt+]  — next tab
 *   Mod+Alt+[  — previous tab
 *   Mod+1–9    — jump to tab by index
 *
 * Note: Mod+] and Mod+[ are reserved for task-level navigation
 * (nextProject / prevProject) in useKeyboardShortcuts.ts.
 * Mod+Shift+]/[ are not valid RegisterableHotkey values because
 * Shift + PunctuationKey combinations are excluded to avoid layout issues.
 */
export function useTabShortcuts(store: TabViewProvider<unknown, never> | undefined): void {
  const enabled = !!store;

  useHotkey(
    'Mod+Alt+]',
    () => {
      store?.setNextTabActive();
    },
    { enabled }
  );
  useHotkey(
    'Mod+Alt+[',
    () => {
      store?.setPreviousTabActive();
    },
    { enabled }
  );
  useHotkey(
    'Mod+1',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(0);
    },
    { enabled }
  );
  useHotkey(
    'Mod+2',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(1);
    },
    { enabled }
  );
  useHotkey(
    'Mod+3',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(2);
    },
    { enabled }
  );
  useHotkey(
    'Mod+4',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(3);
    },
    { enabled }
  );
  useHotkey(
    'Mod+5',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(4);
    },
    { enabled }
  );
  useHotkey(
    'Mod+6',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(5);
    },
    { enabled }
  );
  useHotkey(
    'Mod+7',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(6);
    },
    { enabled }
  );
  useHotkey(
    'Mod+8',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(7);
    },
    { enabled }
  );
  useHotkey(
    'Mod+9',
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(8);
    },
    { enabled }
  );
}
