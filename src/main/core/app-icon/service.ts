import { app } from 'electron';
import betaIcon from '@/assets/images/emdash/emdash-beta.icns?asset';
import canaryIcon from '@/assets/images/emdash/emdash-canary.icns?asset';
import defaultIcon from '@/assets/images/emdash/icon-dock.png?asset';
import { log } from '@main/lib/logger';
import type { AppIconId } from '@shared/app-icons';

const iconPathById = {
  default: defaultIcon,
  beta: betaIcon,
  canary: canaryIcon,
} satisfies Record<AppIconId, string>;

export const appIconService = {
  isSupported() {
    return process.platform === 'darwin';
  },

  apply(icon: AppIconId) {
    if (!this.isSupported()) return;

    const iconPath = iconPathById[icon];

    try {
      app.dock?.setIcon(iconPath);
    } catch (error) {
      log.warn('Failed to set app icon:', error);
    }
  },
};
