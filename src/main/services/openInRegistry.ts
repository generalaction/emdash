import {
  OPEN_IN_APPS,
  resolveAppForPlatform,
  type CustomOpenInApp,
  type PlatformKey,
  type ResolvedOpenInApp,
} from '@shared/openInApps';
import { getAppSettings } from '../settings';

/**
 * Build the merged app list: built-ins (resolved for platform) + custom tools.
 * Custom entries with an id matching a built-in replace that built-in at its position.
 * Remaining custom entries are appended.
 */
export function getMergedApps(platform: PlatformKey): ResolvedOpenInApp[] {
  const settings = getAppSettings();
  const customs = settings.customOpenInApps ?? [];
  return mergeApps(customs, platform);
}

export function mergeApps(customs: CustomOpenInApp[], platform: PlatformKey): ResolvedOpenInApp[] {
  const customById = new Map(customs.map((c) => [c.id, c]));

  const result: ResolvedOpenInApp[] = OPEN_IN_APPS.map((builtIn) => {
    const override = customById.get(builtIn.id);
    if (override) {
      customById.delete(builtIn.id);
      return customToResolved(override);
    }
    return resolveAppForPlatform(builtIn, platform);
  });

  for (const custom of customById.values()) {
    result.push(customToResolved(custom));
  }

  return result;
}

function customToResolved(c: CustomOpenInApp): ResolvedOpenInApp {
  return {
    id: c.id,
    label: c.label,
    iconPath: c.iconPath ?? '',
    iconIsCustomPath: true,
    openCommands: [c.openCommand],
    openUrls: [],
    checkCommands: c.checkCommand ? [c.checkCommand] : [],
    bundleIds: [],
    appNames: [],
    alwaysAvailable: !c.checkCommand,
    hideIfUnavailable: false,
    autoInstall: false,
    supportsRemote: false,
    invertInDark: false,
    isCustom: true,
  };
}

export function getResolvedAppById(
  id: string,
  platform: PlatformKey
): ResolvedOpenInApp | undefined {
  return getMergedApps(platform).find((app) => app.id === id);
}
