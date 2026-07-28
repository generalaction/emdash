import { spawn, type StdioOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const linuxTargets = ['linux-arm64', 'linux-x64'] as const;
type LinuxTarget = (typeof linuxTargets)[number];

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const containerName = 'emdash-workspace-remote';
const containerInstallRoot = '/home/devuser/.emdash/workspace-server';

async function main(): Promise<void> {
  const target = resolveTarget(process.env['EMDASH_WS_DEV_REMOTE_TARGET']);
  process.stdout.write(`Packaging workspace-server dev artifact for ${target}...\n`);
  await runCommand('pnpm', ['run', 'package', '--target', target], {
    env: { ...process.env, EMDASH_WS_DEV_BUILD: '1' },
  });
  const expectedVersion = await readLatestArtifactVersion();

  process.stdout.write('Starting docker remote with preinstalled workspace-server...\n');
  // --force-recreate is required: the fresh artifact is only bind-mounted into the
  // container, and only the entrypoint installs it. Without recreation the old daemon
  // keeps running the previously installed version.
  await runCommand(
    'docker',
    ['compose', 'up', '--build', '--force-recreate', '-d', 'workspace-remote'],
    {
      env: {
        ...process.env,
        WORKSPACE_SERVER_PREINSTALL: '1',
        WORKSPACE_SERVER_AUTOSTART: '1',
        ...(target === 'linux-x64' && process.arch === 'arm64'
          ? { WORKSPACE_REMOTE_PLATFORM: 'linux/amd64' }
          : {}),
      },
    }
  );

  await verifyRunningDaemonVersion(expectedVersion);

  process.stdout.write(`
Docker remote is ready on localhost:2223 (devuser / devpass) running ${expectedVersion}.

Launch the desktop app with:
pnpm run dev:remote-app

or equivalently:
EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL=file:///opt/emdash-artifacts EMDASH_WORKSPACE_SERVER_DEV_AUTO_UPDATE=1 pnpm --dir ../emdash-desktop run dev
`);
}

async function readLatestArtifactVersion(): Promise<string> {
  const latestPath = join(appDirectory, 'dist-artifacts', 'latest.txt');
  const version = (await readFile(latestPath, 'utf8')).trim();
  if (version.length === 0) {
    throw new Error(`Expected ${latestPath} to contain the packaged artifact version`);
  }
  return version;
}

async function verifyRunningDaemonVersion(expectedVersion: string): Promise<void> {
  process.stdout.write('Verifying the remote daemon version...\n');
  const deadline = Date.now() + 30_000;
  let lastError = 'daemon status was never checked';

  while (Date.now() < deadline) {
    try {
      const status = await runCommandOutput('docker', [
        'exec',
        containerName,
        'runuser',
        '-u',
        'devuser',
        '--',
        `${containerInstallRoot}/current/bin/emdash-workspace-server`,
        'status',
        '--socket',
        `${containerInstallRoot}/run/workspace.sock`,
      ]);
      const version = /\(version ([^,]+), uptime/.exec(status)?.[1];
      if (version === expectedVersion) {
        process.stdout.write(`Remote daemon is running ${version}\n`);
        return;
      }
      lastError =
        version === undefined
          ? `could not parse a version from daemon status: ${status.trim()}`
          : `daemon reports version ${version}, expected ${expectedVersion}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }

  throw new Error(`Remote daemon did not come up with ${expectedVersion}: ${lastError}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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

async function runCommandOutput(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      const output = stderr.trim();
      rejectPromise(
        new Error(
          `${command} exited ${signal === null ? `with code ${String(code)}` : `on signal ${signal}`}${
            output ? `: ${output}` : ''
          }`
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
