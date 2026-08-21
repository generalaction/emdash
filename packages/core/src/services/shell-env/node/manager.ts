import { applyShellEnvCapture } from './apply';
import { captureShellEnv } from './capture';
import { type ShellEnvLogger, type ShellEnvManager, type ShellEnvPolicy } from './types';
import { buildUserShellEnvSeed } from './user-env';

export type CreateShellEnvManagerOptions = {
  readonly target?: NodeJS.ProcessEnv;
  readonly policy?: Partial<ShellEnvPolicy>;
  readonly baseEnvForProbe?: () => NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly logger?: ShellEnvLogger;
};

export function createShellEnvManager(options: CreateShellEnvManagerOptions = {}): ShellEnvManager {
  const target = options.target ?? process.env;
  const userEnv = stringEnv(buildUserShellEnvSeed(options.baseEnvForProbe?.() ?? target));
  let inFlight: Promise<void> | undefined;

  return {
    env: target,
    getUserShellEnv: () => ({ ...userEnv }),
    refresh() {
      inFlight ??= refreshShellEnv(target, userEnv, options).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

async function refreshShellEnv(
  target: NodeJS.ProcessEnv,
  userEnv: Record<string, string>,
  options: CreateShellEnvManagerOptions
): Promise<void> {
  const baseEnv = buildUserShellEnvSeed(options.baseEnvForProbe?.() ?? target);
  replaceEnv(userEnv, stringEnv(baseEnv));
  const capture = await captureShellEnv({
    baseEnv,
    timeoutMs: options.timeoutMs,
  });

  if (!capture.success) {
    options.logger?.warn?.('[shell-env] Failed to resolve login-shell env', {
      shell: capture.error.shell,
      error: capture.error.message,
    });
    return;
  }

  applyShellEnvCapture(target, capture.data, options.policy, { mergeBaseEnv: baseEnv });
  applyShellEnvCapture(
    userEnv,
    capture.data,
    { ...options.policy, preserveKeys: new Set() },
    { mergeBaseEnv: baseEnv }
  );

  options.logger?.info?.('[shell-env] Resolved shell env', {
    source: capture.data.source,
    pathEntries: target.PATH?.split(process.platform === 'win32' ? ';' : ':').length ?? 0,
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function replaceEnv(target: Record<string, string>, source: Record<string, string>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
