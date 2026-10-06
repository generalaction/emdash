import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AppDetectionResults,
  AppDetectionStatus,
} from '@core/primitives/open-in-apps/api/app-detection';
import {
  OPEN_IN_APPS,
  type OpenInAppConfig,
  type PlatformKey,
} from '@core/primitives/open-in-apps/api/open-in-apps';
import { buildExternalToolEnv } from '@main/lib/childProcessEnv';
import { log } from '@main/lib/logger';
import { userShellEnvManager } from '@main/lib/userEnv';

// Detection asks exactly what launch asks, in the environment launch uses:
// - `open -a Name` / `open -b id` resolve through LaunchServices, so macOS asks
//   LaunchServices directly, in one batched call.
// - `cli {{path}}` resolves through PATH, so CLIs are looked up on PATH in-process.
// - Visual Studio and Android Studio Canary launch through vswhere and Spotlight,
//   so those two run the same lookup.
// Every lookup is noninteractive. Never use AppleScript's `id of application`:
// for a missing app it shows a "Where is…?" chooser, beeps, and blocks.

const COMMAND_TIMEOUT_MS = 5_000;

type CommandResult = { ok: true; stdout: string } | { ok: false; code?: string | number };

export type RunCommand = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal
) => Promise<CommandResult>;

export const runCommand = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  timeout = COMMAND_TIMEOUT_MS
): Promise<CommandResult> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        env,
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
        timeout,
        signal,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout) => {
        resolve(error ? { ok: false, code: error.code ?? undefined } : { ok: true, stdout });
      }
    );
  });

const MAC_LAUNCH_SERVICES_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const files = $.NSFileManager.defaultManager;
  const exists = (p) => !p.isNil() && Boolean(files.fileExistsAtPath(p));
  const results = {};
  for (const app of JSON.parse(argv[0])) {
    results[app.id] =
      app.bundleIds.some((id) => {
        const url = workspace.URLForApplicationWithBundleIdentifier(id);
        return !url.isNil() && exists(url.path);
      }) || app.appNames.some((name) => exists(workspace.fullPathForApplication(name)));
  }
  return JSON.stringify(results);
}`;

async function resolveLaunchEnv(): Promise<NodeJS.ProcessEnv> {
  // Launch commands run with the login-shell PATH, which is captured
  // asynchronously at boot. Checking earlier would miss CLIs outside the
  // minimal PATH that GUI-launched apps start with.
  await userShellEnvManager.current();
  return buildExternalToolEnv();
}

function envValue(env: NodeJS.ProcessEnv, key: string, platform: PlatformKey) {
  if (platform !== 'win32') return env[key];
  const match = Object.keys(env).find((name) => name.toUpperCase() === key);
  return match ? env[match] : undefined;
}

async function isExecutableFile(file: string, platform: PlatformKey): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    if (platform !== 'win32') await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: PlatformKey
): Promise<boolean> {
  const win = platform === 'win32';
  const dirs = (envValue(env, 'PATH', platform) ?? '').split(win ? ';' : ':').filter(Boolean);
  const extensions = win
    ? (envValue(env, 'PATHEXT', platform) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      if (await isExecutableFile(path.join(dir, command + extension), platform)) return true;
    }
  }
  return false;
}

type DetectorOptions = {
  platform?: PlatformKey;
  apps?: readonly OpenInAppConfig[];
  run?: RunCommand;
  resolveEnv?: () => Promise<NodeJS.ProcessEnv>;
};

export function createInstalledAppDetector(options: DetectorOptions = {}) {
  const platform = options.platform ?? (process.platform as PlatformKey);
  const apps = options.apps ?? Object.values(OPEN_IN_APPS);
  const run = options.run ?? runCommand;
  const resolveEnv = options.resolveEnv ?? resolveLaunchEnv;
  const lifetime = new AbortController();
  let inFlight: Promise<AppDetectionResults> | undefined;
  let lastResults: AppDetectionResults = {};

  async function queryLaunchServices(
    env: NodeJS.ProcessEnv
  ): Promise<Record<string, boolean> | null> {
    const candidates = apps.flatMap((app) => {
      const config = app.platforms.darwin;
      return config && !app.alwaysAvailable && (config.bundleIds || config.appNames)
        ? [{ id: app.id, bundleIds: config.bundleIds ?? [], appNames: config.appNames ?? [] }]
        : [];
    });
    if (candidates.length === 0) return {};
    const result = await run(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', MAC_LAUNCH_SERVICES_SCRIPT, JSON.stringify(candidates)],
      env,
      lifetime.signal
    );
    if (result.ok) {
      try {
        const parsed: unknown = JSON.parse(result.stdout);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, boolean>;
        }
      } catch {
        /* Reported below. */
      }
    }
    log.warn('[open-in] LaunchServices lookup failed', {
      code: result.ok ? 'invalid-output' : result.code,
    });
    return null;
  }

  async function lookup(
    label: string,
    file: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    missingCode?: string
  ): Promise<AppDetectionStatus> {
    const result = await run(file, args, env, lifetime.signal);
    if (result.ok) return result.stdout.trim() ? 'detected' : 'not-detected';
    if (missingCode !== undefined && result.code === missingCode) return 'not-detected';
    log.warn('[open-in] Detection lookup failed', { lookup: label, code: result.code });
    return 'unknown';
  }

  async function detect(
    app: OpenInAppConfig,
    env: NodeJS.ProcessEnv,
    launchServices: Record<string, boolean> | null
  ): Promise<AppDetectionStatus> {
    if (app.alwaysAvailable) return 'detected';
    const config = app.platforms[platform];
    if (!config) return 'not-detected';

    let status: AppDetectionStatus = 'not-detected';
    if (platform === 'darwin' && (config.bundleIds || config.appNames)) {
      const found = launchServices?.[app.id];
      if (found === true) return 'detected';
      if (found !== false) status = 'unknown';
    }
    for (const command of config.checkCommands ?? []) {
      if (await findOnPath(command, env, platform)) return 'detected';
    }
    if (platform === 'darwin' && config.mdfindQuery) {
      const spotlight = await lookup('spotlight', '/usr/bin/mdfind', [config.mdfindQuery], env);
      if (spotlight !== 'not-detected') return spotlight;
    }
    if (platform === 'win32' && config.winVswhere) {
      const vswhere = path.win32.join(
        envValue(env, 'ProgramFiles(x86)', platform) ?? 'C:\\Program Files (x86)',
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe'
      );
      const args = ['-latest', '-property', 'productPath'];
      const found = await lookup('vswhere', vswhere, args, env, 'ENOENT');
      if (found !== 'not-detected') return found;
    }
    return status;
  }

  async function scan(): Promise<AppDetectionResults> {
    const started = Date.now();
    const env = await resolveEnv();
    const launchServices = platform === 'darwin' ? await queryLaunchServices(env) : {};
    const statuses = await Promise.all(apps.map((app) => detect(app, env, launchServices)));
    const results: AppDetectionResults = {};
    apps.forEach((app, index) => {
      const status = statuses[index]!;
      results[app.id] =
        status === 'unknown' && lastResults[app.id] === 'detected' ? 'detected' : status;
    });
    lastResults = results;
    log.info('[open-in] Detection completed', { elapsedMs: Date.now() - started, results });
    return { ...results };
  }

  return {
    check(): Promise<AppDetectionResults> {
      inFlight ??= scan().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    dispose(): void {
      lifetime.abort();
    },
  };
}
