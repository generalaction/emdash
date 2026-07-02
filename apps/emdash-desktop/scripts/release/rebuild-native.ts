import path from 'node:path';
import { cwd } from 'node:process';
import { parseArgs } from 'node:util';
import { rebuild } from '@electron/rebuild';
import { copyConptyDll } from '../copy-conpty-dll.ts';
import { NATIVE_MODULES } from './lib/config.ts';
import { exec } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    arch: { type: 'string' },
    'deploy-dir': { type: 'string' },
  },
  strict: true,
});

const arch = values.arch;
if (!arch || !['arm64', 'x64'].includes(arch)) {
  fail('Usage: rebuild-native.ts --arch arm64|x64 [--deploy-dir <path>]');
}

const deployDir = values['deploy-dir'];
const buildPath = deployDir ?? cwd();

const electronVersion = exec('node -p "require(\'electron/package.json\').version"');
step(`Rebuilding native modules for ${arch} (Electron ${electronVersion})`);

await rebuild({
  buildPath,
  electronVersion,
  arch,
  onlyModules: NATIVE_MODULES,
  force: true,
  buildFromSource: true,
});

// node-gyp rebuild wipes node-pty's build/Release, deleting the bundled
// ConPTY that useConptyDll needs at runtime — restore it for the target arch.
copyConptyDll({ nodePtyRoot: path.join(buildPath, 'node_modules', 'node-pty'), arch });

info(`Native modules rebuilt for ${arch}`);
