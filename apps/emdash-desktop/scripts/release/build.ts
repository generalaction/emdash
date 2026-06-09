import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { exec } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
    config: { type: 'string', default: 'electron-builder.config.ts' },
  },
  strict: true,
});

const platform = values.platform;
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  fail(
    'Usage: build.ts --platform mac|linux|win [--arch arm64|x64|both] [--targets dmg,zip] [--config electron-builder.config.ts]'
  );
}

const archInput = values.arch ?? 'both';
const archs: string[] = archInput === 'both' ? ['x64', 'arm64'] : [archInput];

const defaultTargets: Record<string, string> = {
  mac: 'dmg zip',
  linux: 'AppImage deb rpm',
  win: 'nsis msi',
};
const targets = values.targets ? values.targets.split(',').join(' ') : defaultTargets[platform];

step('Creating deployment directory with production dependencies');
const deployDir = mkdtempSync(join(tmpdir(), 'emdash-deploy-'));
exec('pnpm deploy --prod ' + deployDir, { echo: true });

step('Copying built assets into deployment directory');
cpSync('out', join(deployDir, 'out'), { recursive: true });
cpSync('drizzle', join(deployDir, 'drizzle'), { recursive: true });

try {
  for (const arch of archs) {
    step(`Building ${platform} ${targets} for ${arch}`);

    exec(
      `node --experimental-strip-types scripts/release/rebuild-native.ts --arch ${arch} --deploy-dir ${deployDir}`,
      { echo: true }
    );

    const platformFlag = `--${platform}`;
    const archFlag = `--${arch}`;
    const cmd = [
      'pnpm exec electron-builder',
      platformFlag,
      targets,
      archFlag,
      '--publish always',
      `--config ${values.config}`,
      `--projectDir ${deployDir}`,
      '--config.npmRebuild=false',
    ].join(' ');

    exec(cmd, { echo: true });
    info(`Built ${platform} ${targets} for ${arch}`);
  }

  step('Copying release artifacts to app directory');
  cpSync(join(deployDir, 'release'), 'release', { recursive: true });
} finally {
  rmSync(deployDir, { recursive: true, force: true });
}
