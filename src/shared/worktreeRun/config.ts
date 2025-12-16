const DEFAULT_VERSION = 1;
const DEFAULT_WORKDIR = '.';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface RunScript {
  name: string;
  command: string;
  port?: number;
  cwd?: string;
  preview?: boolean;
}

export interface RunConfigFile {
  version?: number;
  packageManager?: PackageManager;
  install?: string;
  scripts?: RunScript[];
  env?: Record<string, string>;
  setupSteps?: string[];
}

export interface ResolvedRunScript {
  name: string;
  command: string;
  port: number | null;
  cwd: string;
  preview: boolean;
}

export interface ResolvedRunConfig {
  version: 1;
  packageManager: PackageManager;
  install: string;
  scripts: ResolvedRunScript[];
  env: Record<string, string>;
  setupSteps: string[];
}

export interface ResolveRunConfigOptions {
  inferredPackageManager?: PackageManager;
}

export class RunConfigError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(message);
    this.name = 'RunConfigError';
    this.path = path;
  }
}

const VALID_PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn'];

const DEFAULT_SCRIPT: ResolvedRunScript = {
  name: 'dev',
  command: 'npm run dev',
  port: null,
  cwd: DEFAULT_WORKDIR,
  preview: true,
};

function cloneDefaultScript(packageManager: PackageManager = 'npm'): ResolvedRunScript {
  return {
    ...DEFAULT_SCRIPT,
    command: `${packageManager} run dev`,
  };
}

export function resolveRunConfig(
  input: unknown,
  options: ResolveRunConfigOptions = {}
): ResolvedRunConfig {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const version = resolveVersion(source.version);
  const packageManager = resolvePackageManager(
    source.packageManager,
    options.inferredPackageManager
  );
  const install = resolveInstallCommand(source.install, packageManager);
  const scripts = resolveScripts(source.scripts, packageManager);
  const env = resolveEnv(source.env);
  const setupSteps = resolveSetupSteps(source.setupSteps);

  return {
    version,
    packageManager,
    install,
    scripts,
    env,
    setupSteps,
  };
}

function resolveVersion(raw: unknown): 1 {
  if (raw == null) return DEFAULT_VERSION;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new RunConfigError('`version` must be an integer', 'version');
  }
  if (raw !== DEFAULT_VERSION) {
    throw new RunConfigError('Only config version 1 is supported', 'version');
  }
  return DEFAULT_VERSION;
}

function resolvePackageManager(raw: unknown, inferred?: PackageManager): PackageManager {
  if (raw == null) return inferred ?? 'npm';
  if (typeof raw !== 'string') {
    throw new RunConfigError(
      '`packageManager` must be a string ("npm" | "pnpm" | "yarn")',
      'packageManager'
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (!VALID_PACKAGE_MANAGERS.includes(normalized as PackageManager)) {
    throw new RunConfigError(
      '`packageManager` must be one of "npm", "pnpm", or "yarn"',
      'packageManager'
    );
  }
  return normalized as PackageManager;
}

function resolveInstallCommand(raw: unknown, packageManager: PackageManager): string {
  if (raw == null) return `${packageManager} install`;
  if (typeof raw !== 'string') {
    throw new RunConfigError('`install` must be a string', 'install');
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new RunConfigError('`install` cannot be empty', 'install');
  }
  return normalized;
}

function resolveScripts(raw: unknown, packageManager: PackageManager): ResolvedRunScript[] {
  if (raw == null) return [cloneDefaultScript(packageManager)];
  if (!Array.isArray(raw)) {
    throw new RunConfigError('`scripts` must be an array', 'scripts');
  }
  if (raw.length === 0) {
    return [cloneDefaultScript(packageManager)];
  }

  const result: ResolvedRunScript[] = [];
  raw.forEach((entry, index) => {
    const path = `scripts[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RunConfigError('Each script entry must be an object', path);
    }
    const { name, command, port, cwd, preview } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new RunConfigError('`name` must be a non-empty string', `${path}.name`);
    }
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new RunConfigError('`command` must be a non-empty string', `${path}.command`);
    }
    if (port != null && (typeof port !== 'number' || !Number.isInteger(port))) {
      throw new RunConfigError('`port` must be an integer when provided', `${path}.port`);
    }
    if (port != null && (port < 1 || port > 65535)) {
      throw new RunConfigError('`port` must be between 1 and 65535', `${path}.port`);
    }
    if (cwd != null && typeof cwd !== 'string') {
      throw new RunConfigError('`cwd` must be a string when provided', `${path}.cwd`);
    }
    if (preview != null && typeof preview !== 'boolean') {
      throw new RunConfigError('`preview` must be a boolean when provided', `${path}.preview`);
    }

    result.push({
      name: name.trim(),
      command: command.trim(),
      port: port != null ? (port as number) : null,
      cwd: cwd != null ? (cwd as string).trim() : DEFAULT_WORKDIR,
      preview: preview === true,
    });
  });

  ensurePreviewScript(result);
  ensureUniqueScriptNames(result);

  return result;
}

function ensurePreviewScript(scripts: ResolvedRunScript[]): void {
  const idx = scripts.findIndex((script) => script.preview);
  if (idx >= 0) {
    // Normalize to boolean true for first preview, false for the rest
    scripts.forEach((script, index) => {
      script.preview = index === idx;
    });
    return;
  }
  // If no preview specified, mark first script as preview
  scripts[0] = { ...scripts[0], preview: true };
}

function ensureUniqueScriptNames(scripts: ResolvedRunScript[]): void {
  const seen = new Map<string, number>();
  scripts.forEach((script, index) => {
    const prev = seen.get(script.name);
    if (prev != null) {
      throw new RunConfigError(
        `Duplicate script name "${script.name}" found in scripts array`,
        `scripts[${index}].name`
      );
    }
    seen.set(script.name, index);
  });
}

function resolveEnv(raw: unknown): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RunConfigError('`env` must be an object', 'env');
  }

  const result: Record<string, string> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value !== 'string') {
      throw new RunConfigError(`env["${key}"] must be a string`, `env.${key}`);
    }
    result[key] = value;
  });

  return result;
}

function resolveSetupSteps(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new RunConfigError('`setupSteps` must be an array', 'setupSteps');
  }

  const result: string[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      throw new RunConfigError(
        `Each setup step must be a string`,
        `setupSteps[${index}]`
      );
    }
    const normalized = entry.trim();
    if (normalized.length === 0) {
      throw new RunConfigError(
        `Setup step cannot be empty`,
        `setupSteps[${index}]`
      );
    }
    result.push(normalized);
  });

  return result;
}

export function createDefaultRunConfig(
  packageManager: PackageManager = 'npm'
): ResolvedRunConfig {
  return {
    version: DEFAULT_VERSION,
    packageManager,
    install: `${packageManager} install`,
    scripts: [cloneDefaultScript(packageManager)],
    env: {},
    setupSteps: [],
  };
}

export type RunConfigValidationResult =
  | { ok: true; config: ResolvedRunConfig }
  | { ok: false; error: RunConfigError };

export function validateRunConfig(
  input: unknown,
  options?: ResolveRunConfigOptions
): RunConfigValidationResult {
  try {
    const config = resolveRunConfig(input, options);
    return { ok: true, config };
  } catch (error) {
    if (error instanceof RunConfigError) {
      return { ok: false, error };
    }
    throw error;
  }
}
