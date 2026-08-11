export {
  applyShellEnvCapture,
  createDefaultShellEnvPolicy,
  currentShellEnvPlatform,
  ensureUserBinDirsInPath,
  mergePath,
  type ApplyShellEnvOptions,
} from './apply';
export {
  captureShellEnv,
  parseEnvOutput,
  resolveLoginShell,
  type CaptureShellEnvOptions,
} from './capture';
export { createShellEnvManager, type CreateShellEnvManagerOptions } from './manager';
export {
  DEFAULT_SHELL_ENV_PRESERVE_KEYS,
  SHELL_ENV_CAPTURE_GUARD,
  type ShellEnvCapture,
  type ShellEnvCaptureError,
  type ShellEnvLogger,
  type ShellEnvManager,
  type ShellEnvPlatform,
  type ShellEnvPolicy,
  type ShellEnvSource,
} from './types';
export {
  ensureWindowsNpmGlobalBinInPath,
  getWindowsEnvKey,
  getWindowsEnvValue,
  getWindowsPathEnvKey,
  prependWindowsPathEntry,
  windowsNpmGlobalBin,
} from './windows-env';
