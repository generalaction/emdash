import { parseArgs } from 'node:util';
import { exec } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
  },
  strict: true,
});

const platform = values.platform;
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  fail('Usage: build.ts --platform mac|linux|win [--arch arm64|x64|both] [--targets dmg,zip]');
}

const archInput = values.arch ?? 'both';
const archs: string[] = archInput === 'both' ? ['x64', 'arm64'] : [archInput];

const defaultTargets: Record<string, string> = {
  mac: 'dmg zip',
  linux: 'AppImage deb rpm',
  win: 'nsis msi',
};
const targets = values.targets ? values.targets.split(',').join(' ') : defaultTargets[platform];

for (const arch of archs) {
  step(`Building ${platform} ${targets} for ${arch}`);

  exec(`node --experimental-strip-types scripts/release/rebuild-native.ts --arch ${arch}`, {
    echo: true,
  });

  const platformFlag = `--${platform}`;
  const archFlag = `--${arch}`;
  const cmd = [
    'pnpm exec electron-builder',
    platformFlag,
    targets,
    archFlag,
    '--publish never',
    '--config electron-builder.config.ts',
    '--config.npmRebuild=false',
  ].join(' ');

  exec(cmd, { echo: true });
  info(`Built ${platform} ${targets} for ${arch}`);
}
