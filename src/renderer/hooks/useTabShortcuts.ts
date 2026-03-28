import { useHotkey } from '@tanstack/react-hotkeys';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { getEffectiveHotkey } from './useKeyboardShortcuts';

/**
 * Minimal interface required for tab navigation shortcuts.
 * Both TabViewProvider stores and EditorViewStore satisfy this shape.
 */
export interface TabNavigationProvider {
  setNextTabActive: () => void;
  setPreviousTabActive: () => void;
  setTabActiveIndex: (index: number) => void;
  closeActiveTab: () => void;
}

/**
 * Registers keyboard shortcuts for tab navigation within any TabNavigationProvider.
 *
 * Shortcuts:
 *   tabNext   (default Mod+Alt+])  — next tab
 *   tabPrev   (default Mod+Alt+[)  — previous tab
 *   tabClose  (default Mod+W)      — close active tab
 *   Mod+1–9                        — jump to tab by index (not configurable)
 *
 * Note: Mod+] and Mod+[ are reserved for task-level navigation
 * (nextProject / prevProject) in useKeyboardShortcuts.ts.
 */
export function useTabShortcuts(store: TabNavigationProvider | undefined): void {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const enabled = !!store;

  useHotkey(
    getEffectiveHotkey('tabNext', keyboard),
    () => {
      store?.setNextTabActive();
    },
    { enabled }
  );
  useHotkey(
    getEffectiveHotkey('tabPrev', keyboard),
    () => {
      store?.setPreviousTabActive();
    },
    { enabled }
  );
  useHotkey(
    getEffectiveHotkey('tabClose', keyboard),
    (e) => {
      e.preventDefault();
      store?.closeActiveTab();
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
