import type { SettingsPageTab } from '@/components/SettingsPage';

export const OPEN_SETTINGS_PAGE_EVENT = 'emdash:open-settings-page';

export interface OpenSettingsPageDetail {
  tab?: SettingsPageTab;
}

export function dispatchOpenSettingsPage(detail: OpenSettingsPageDetail = {}): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OpenSettingsPageDetail>(OPEN_SETTINGS_PAGE_EVENT, {
      detail,
    })
  );
}
