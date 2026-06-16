import { describe, expect, it } from 'vitest';
import { homebrewOption, npmDependency } from './host-dependency';

describe('homebrewOption', () => {
  it('produces correct command/updateCommand/uninstallCommand without cask', () => {
    const opt = homebrewOption({ formula: 'some-formula' });
    expect(opt.method).toBe('homebrew');
    expect(opt.command).toBe('brew install some-formula');
    expect(opt.updateCommand).toBe('brew upgrade some-formula');
    expect(opt.uninstallCommand).toBe('brew uninstall some-formula');
    expect(opt.recommended).toBeUndefined();
  });

  it('includes --cask flag when cask is true', () => {
    const opt = homebrewOption({ formula: 'myapp', cask: true });
    expect(opt.command).toBe('brew install --cask myapp');
    expect(opt.updateCommand).toBe('brew upgrade --cask myapp');
    expect(opt.uninstallCommand).toBe('brew uninstall --cask myapp');
  });

  it('sets recommended when provided', () => {
    const opt = homebrewOption({ formula: 'myapp', recommended: true });
    expect(opt.recommended).toBe(true);
  });
});

describe('npmDependency', () => {
  const base = { id: 'mytool', package: '@acme/mytool' };

  it('produces identical npm option on all three platforms', () => {
    const dep = npmDependency(base);
    const macos = dep.installCommands.macos![0];
    const linux = dep.installCommands.linux![0];
    const windows = dep.installCommands.windows![0];
    expect(macos).toEqual(linux);
    expect(macos).toEqual(windows);
    expect(macos.method).toBe('npm');
    expect(macos.command).toBe('npm install -g @acme/mytool');
  });

  it('derives uninstallCommand on the npm option', () => {
    const dep = npmDependency(base);
    expect(dep.installCommands.macos![0].uninstallCommand).toBe('npm uninstall -g @acme/mytool');
  });

  it('sets releaseSource.package to bare package name (no versionSuffix)', () => {
    const dep = npmDependency({ ...base, versionSuffix: '@latest' });
    expect(dep.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@acme/mytool' },
    });
  });

  it('appends versionSuffix to install command only', () => {
    const dep = npmDependency({ ...base, versionSuffix: '@latest' });
    expect(dep.installCommands.macos![0].command).toBe('npm install -g @acme/mytool@latest');
    expect(dep.installCommands.macos![0].uninstallCommand).toBe('npm uninstall -g @acme/mytool');
  });

  it('sets update kind to package-manager', () => {
    const dep = npmDependency(base);
    expect(dep.updates).toMatchObject({ kind: 'supported', update: { kind: 'package-manager' } });
  });

  it('sets uninstall kind to package-manager', () => {
    const dep = npmDependency(base);
    expect(dep.uninstall).toEqual({ kind: 'package-manager' });
  });

  it('defaults binaryNames to [id]', () => {
    const dep = npmDependency(base);
    expect(dep.binaryNames).toEqual(['mytool']);
  });

  it('respects explicit binaryNames override', () => {
    const dep = npmDependency({ ...base, binaryNames: ['bin1', 'bin2'] });
    expect(dep.binaryNames).toEqual(['bin1', 'bin2']);
  });

  it('inserts installFlags between npm install -g and the package', () => {
    const dep = npmDependency({ ...base, installFlags: '--ignore-scripts' });
    expect(dep.installCommands.macos![0].command).toBe(
      'npm install -g --ignore-scripts @acme/mytool'
    );
    expect(dep.installCommands.macos![0].uninstallCommand).toBe('npm uninstall -g @acme/mytool');
  });

  it('marks npm option as recommended by default', () => {
    const dep = npmDependency(base);
    expect(dep.installCommands.macos![0].recommended).toBe(true);
  });

  it('does not mark npm option as recommended when recommended=false', () => {
    const dep = npmDependency({ ...base, recommended: false });
    expect(dep.installCommands.macos![0].recommended).toBeUndefined();
  });

  it('carries installDocs when provided', () => {
    const dep = npmDependency({ ...base, installDocs: 'https://example.com/docs' });
    expect(dep.installDocs).toBe('https://example.com/docs');
  });

  it('omits installDocs when not provided', () => {
    const dep = npmDependency(base);
    expect('installDocs' in dep).toBe(false);
  });

  it('carries skipVersionProbe when true', () => {
    const dep = npmDependency({ ...base, skipVersionProbe: true });
    expect(dep.skipVersionProbe).toBe(true);
  });

  it('omits skipVersionProbe when not provided', () => {
    const dep = npmDependency(base);
    expect('skipVersionProbe' in dep).toBe(false);
  });

  it('carries versionArgs when provided', () => {
    const dep = npmDependency({ ...base, versionArgs: ['version'] });
    expect(dep.versionArgs).toEqual(['version']);
  });

  it('appends extraOptions per platform after the npm entry', () => {
    const brewOpt = homebrewOption({ formula: 'mytool', cask: true });
    const dep = npmDependency({
      ...base,
      extraOptions: { macos: [brewOpt], linux: [] },
    });
    expect(dep.installCommands.macos!).toHaveLength(2);
    expect(dep.installCommands.macos![1]).toEqual(brewOpt);
    expect(dep.installCommands.linux!).toHaveLength(1);
    expect(dep.installCommands.windows!).toHaveLength(1);
  });
});
