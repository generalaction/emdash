import { describe, expect, it } from 'vitest';
import { isValidOpenInAppId, OPEN_IN_APPS } from './openInApps';

describe('OPEN_IN_APPS', () => {
  it('registers Kaku as an open-in terminal option', () => {
    expect(isValidOpenInAppId('kaku')).toBe(true);
    expect(OPEN_IN_APPS.kaku).toMatchObject({
      id: 'kaku',
      iconPath: 'kaku.png',
      label: 'Kaku',
      supportsRemote: true,
    });
  });

  it('configures Kaku launch commands for supported desktop platforms', () => {
    expect(OPEN_IN_APPS.kaku.platforms.darwin?.appNames).toContain('Kaku');
    expect(OPEN_IN_APPS.kaku.platforms.darwin?.openCommands).toContain(
      'command -v kaku >/dev/null 2>&1 && kaku start --cwd {{path}}'
    );
    expect(OPEN_IN_APPS.kaku.platforms.darwin?.openCommands).toContain(
      'open -na "Kaku" --args start --cwd {{path}}'
    );
    expect(OPEN_IN_APPS.kaku.platforms.linux?.openCommands).toEqual(['kaku start --cwd {{path}}']);
  });

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

  it('registers Athas as an open-in editor option', () => {
    expect(isValidOpenInAppId('athas')).toBe(true);
    expect(OPEN_IN_APPS.athas).toMatchObject({
      id: 'athas',
      iconPath: 'athas.svg',
      label: 'Athas',
      supportsRemote: true,
    });
  });

  it('configures Athas launch commands for supported desktop platforms', () => {
    expect(OPEN_IN_APPS.athas.platforms.darwin?.bundleIds).toContain('com.code.athas');
    expect(OPEN_IN_APPS.athas.platforms.darwin?.openCommands).toContain(
      'command -v athas >/dev/null 2>&1 && athas {{path}}'
    );
    expect(OPEN_IN_APPS.athas.platforms.darwin?.openCommands).toContain(
      'open -n -b com.code.athas --args {{path}}'
    );
    expect(OPEN_IN_APPS.athas.platforms.win32?.openCommands).toEqual(['athas "{{path_raw}}"']);
    expect(OPEN_IN_APPS.athas.platforms.linux?.openCommands).toEqual(['athas {{path}}']);
  });
});
