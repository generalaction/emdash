import { parseArgs } from 'node:util';
import { NATIVE_MODULES } from './lib/config.ts';
import { exec } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
  },
  strict: true,
});

const arch = values.arch;
if (!arch || !['arm64', 'x64'].includes(arch)) {
  fail('Usage: rebuild-native.ts --arch arm64|x64');
}

const electronVersion = exec('node -p "require(\'electron/package.json\').version"');
step(`Rebuilding native modules for ${arch} (Electron ${electronVersion})`);

const modules = NATIVE_MODULES.join(',');
exec(`pnpm exec electron-rebuild -f -a ${arch} -v ${electronVersion} -o ${modules}`, {
  echo: true,
  env: { npm_config_build_from_source: 'true' },
});

info(`Native modules rebuilt for ${arch}`);
