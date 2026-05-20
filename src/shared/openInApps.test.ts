import { describe, expect, it } from 'vitest';
import { isValidOpenInAppId, OPEN_IN_APPS } from './openInApps';

describe('OPEN_IN_APPS', () => {
  it('registers Alacritty as an open-in terminal option', () => {
    expect(isValidOpenInAppId('alacritty')).toBe(true);
    expect(OPEN_IN_APPS.alacritty).toMatchObject({
      id: 'alacritty',
      iconPath: 'alacritty.svg',
      label: 'Alacritty',
      supportsRemote: true,
    });
  });

  it('configures Alacritty launch commands for supported desktop platforms', () => {
    expect(OPEN_IN_APPS.alacritty.platforms.darwin?.bundleIds).toContain('org.alacritty');
    expect(OPEN_IN_APPS.alacritty.platforms.darwin?.openCommands).toContain(
      'open -n -b org.alacritty --args --working-directory {{path}}'
    );
    expect(OPEN_IN_APPS.alacritty.platforms.linux?.openCommands).toEqual([
      'alacritty --working-directory {{path}}',
    ]);
    expect(OPEN_IN_APPS.alacritty.platforms.win32?.openCommands).toContain(
      'start "" alacritty --working-directory "{{path_raw}}"'
    );
  });
});
