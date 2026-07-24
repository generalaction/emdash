import { applyShellEnvCapture } from './apply';
import { captureShellEnv } from './capture';
import { type ShellEnvLogger, type ShellEnvManager, type ShellEnvPolicy } from './types';

export type CreateShellEnvManagerOptions = {
  readonly target?: NodeJS.ProcessEnv;
  readonly policy?: Partial<ShellEnvPolicy>;
  readonly baseEnvForProbe?: () => NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly logger?: ShellEnvLogger;
};

export function createShellEnvManager(options: CreateShellEnvManagerOptions = {}): ShellEnvManager {
  const target = options.target ?? process.env;
  let inFlight: Promise<void> | undefined;

  return {
    env: target,
    refresh() {
      inFlight ??= refreshShellEnv(target, options).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}

async function refreshShellEnv(
  target: NodeJS.ProcessEnv,
  options: CreateShellEnvManagerOptions
): Promise<void> {
  const baseEnv = options.baseEnvForProbe?.() ?? target;
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

  options.logger?.info?.('[shell-env] Resolved shell env', {
    source: capture.data.source,
    pathEntries: target.PATH?.split(process.platform === 'win32' ? ';' : ':').length ?? 0,
  });
}
