import { spawn, type StdioOptions } from 'node:child_process';

const linuxTargets = ['linux-arm64', 'linux-x64'] as const;
type LinuxTarget = (typeof linuxTargets)[number];

async function main(): Promise<void> {
  const target = resolveTarget(process.env['EMDASH_WS_DEV_REMOTE_TARGET']);
  process.stdout.write(`Packaging workspace-server dev artifact for ${target}...\n`);
  await runCommand('pnpm', ['run', 'package', '--target', target], {
    env: { ...process.env, EMDASH_WS_DEV_BUILD: '1' },
  });

  process.stdout.write('Starting docker remote with preinstalled workspace-server...\n');
  await runCommand('docker', ['compose', 'up', '--build', '-d', 'workspace-remote'], {
    env: {
      ...process.env,
      WORKSPACE_SERVER_PREINSTALL: '1',
      WORKSPACE_SERVER_AUTOSTART: '1',
      ...(target === 'linux-x64' && process.arch === 'arm64'
        ? { WORKSPACE_REMOTE_PLATFORM: 'linux/amd64' }
        : {}),
    },
  });

  process.stdout.write(`
Docker remote is ready on localhost:2223 (devuser / devpass).

Launch the desktop app with:
EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL=file:///opt/emdash-artifacts EMDASH_WORKSPACE_SERVER_DEV_AUTO_UPDATE=1 pnpm --dir ../emdash-desktop run dev
`);
}

function resolveTarget(value: string | undefined): LinuxTarget {
  if (value === undefined || value.trim().length === 0) {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  if (isLinuxTarget(value)) return value;
  throw new Error(`Unsupported dev remote target '${value}'. Expected ${linuxTargets.join(', ')}`);
}

function isLinuxTarget(value: string): value is LinuxTarget {
  return (linuxTargets as readonly string[]).includes(value);
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdio?: StdioOptions;
  } = {}
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${command} exited ${signal === null ? `with code ${String(code)}` : `on signal ${signal}`}`
        )
      );
    });
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `workspace-server dev remote failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
