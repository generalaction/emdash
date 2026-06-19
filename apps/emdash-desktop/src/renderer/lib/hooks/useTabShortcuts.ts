import { useHotkey } from '@tanstack/react-hotkeys';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { TAB_NAVIGATION_HOTKEYS } from '@shared/shortcuts';
import { getEffectiveHotkey, getHotkeyRegistration } from './useKeyboardShortcuts';

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

export interface UseTabShortcutsOptions {
  /**
   * When false, all tab shortcuts are disabled. Use this to scope shortcuts
   * to a specific panel so they only fire when that panel is focused.
   * Defaults to true (always enabled when store is present).
   */
  focused?: boolean;
  closeActiveTab?: () => void;
}

/**
 * Hotkeys for jumping to a specific tab by position (1-indexed).
 * These are internal constants — not user-configurable via APP_SHORTCUTS.
 */
const TAB_INDEX_HOTKEYS = [
  'Mod+1',
  'Mod+2',
  'Mod+3',
  'Mod+4',
  'Mod+5',
  'Mod+6',
  'Mod+7',
  'Mod+8',
  'Mod+9',
] as const;

/**
 * Registers keyboard shortcuts for tab navigation within any TabNavigationProvider.
 *
 * Shortcuts:
 *   tabNext   (default Mod+Alt+ArrowRight)  — next tab
 *   tabPrev   (default Mod+Alt+ArrowLeft)  — previous tab
 *   Control+Tab / Control+Shift+Tab         — next / previous tab
 *   tabClose  (default Mod+W)      — close active tab
 *   Mod+1–9                        — jump to tab by index (not configurable)
 *
 * Note: Mod+] and Mod+[ are reserved for history back/forward navigation
 * (navigateForward / navigateBack) in useKeyboardShortcuts.ts.
 *
 * Pass `focused: false` to disable shortcuts when the panel is not focused,
 * preventing conflicts when multiple tab panels are mounted simultaneously.
 */
export function useTabShortcuts(
  store: TabNavigationProvider | undefined,
  options?: UseTabShortcutsOptions
): void {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const enabled = !!store && (options?.focused ?? true);
  const tabNextHotkey = getEffectiveHotkey('tabNext', keyboard);
  const tabPrevHotkey = getEffectiveHotkey('tabPrev', keyboard);
  const tabCloseHotkey = getEffectiveHotkey('tabClose', keyboard);

  useHotkey(
    getHotkeyRegistration('tabNext', keyboard),
    () => {
      store?.setNextTabActive();
    },
    { enabled: enabled && tabNextHotkey !== null, conflictBehavior: 'allow' }
  );
  useHotkey(
    getHotkeyRegistration('tabPrev', keyboard),
    () => {
      store?.setPreviousTabActive();
    },
    { enabled: enabled && tabPrevHotkey !== null, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_NAVIGATION_HOTKEYS.next,
    (e) => {
      e.preventDefault();
      store?.setNextTabActive();
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_NAVIGATION_HOTKEYS.previous,
    (e) => {
      e.preventDefault();
      store?.setPreviousTabActive();
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    getHotkeyRegistration('tabClose', keyboard),
    (e) => {
      e.preventDefault();
      (options?.closeActiveTab ?? store?.closeActiveTab)?.();
    },
    { enabled: enabled && tabCloseHotkey !== null, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[0],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(0);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[1],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(1);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[2],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(2);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[3],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(3);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[4],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(4);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[5],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(5);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[6],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(6);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[7],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(7);
    },
    { enabled, conflictBehavior: 'allow' }
  );
  useHotkey(
    TAB_INDEX_HOTKEYS[8],
    (e) => {
      e.preventDefault();
      store?.setTabActiveIndex(8);
    },
    { enabled, conflictBehavior: 'allow' }
  );
}
