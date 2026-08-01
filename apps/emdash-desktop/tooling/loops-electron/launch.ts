import { spawnSync } from 'node:child_process';

const nodeArgs = ['--experimental-strip-types', 'tooling/loops-electron/spec.ts'];
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const command = needsXvfb ? 'xvfb-run' : process.execPath;
const args = needsXvfb ? ['-a', process.execPath, ...nodeArgs] : nodeArgs;
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
