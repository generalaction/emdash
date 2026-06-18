import { detectPlatform, getHotkeyManager, matchesKeyboardEvent } from '@tanstack/hotkeys';

type HotkeyRegistration =
  ReturnType<typeof getHotkeyManager>['registrations']['state'] extends Map<
    string,
    infer Registration
  >
    ? Registration
    : never;

export interface DispatchMatchingHotkeysOptions {
  filter?: (registration: HotkeyRegistration) => boolean;
  dispatch?: 'first' | 'all';
}

const HOTKEY_PLATFORM = detectPlatform();

/**
 * Dispatches TanStack hotkey registrations for events captured by widgets that
 * stop normal document-level hotkey propagation (Monaco, xterm, webviews, etc.).
 */
export function dispatchMatchingHotkeys(
  event: KeyboardEvent,
  options: DispatchMatchingHotkeysOptions = {}
): boolean {
  const manager = getHotkeyManager();
  const dispatch = options.dispatch ?? 'all';
  let handled = false;

  for (const [, registration] of manager.registrations.state) {
    if (!registration.options.enabled) continue;
    if (options.filter && !options.filter(registration)) continue;
    if (!matchesKeyboardEvent(event, registration.parsedHotkey, HOTKEY_PLATFORM)) continue;

    if (registration.options.preventDefault) event.preventDefault();
    registration.callback(event, {
      hotkey: registration.hotkey,
      parsedHotkey: registration.parsedHotkey,
    });
    handled = true;

    if (dispatch === 'first') return true;
  }

  return handled;
}
