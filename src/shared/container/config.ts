const DEFAULT_VERSION = 1;
const DEFAULT_START_COMMAND = 'npm run dev';
const DEFAULT_WORKDIR = '.';

export const DEFAULT_PREVIEW_SERVICE = 'app';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface ContainerPortConfig {
  service: string;
  container: number;
  preview?: boolean;
  protocol?: 'tcp';
}

export interface ContainerConfigFile {
  version?: number;
  packageManager?: PackageManager;
  start?: string;
  envFile?: string;
  workdir?: string;
  ports?: ContainerPortConfig[];
}

export interface ResolvedContainerPortConfig {
  service: string;
  container: number;
  protocol: 'tcp';
  preview: boolean;
}

export interface ResolvedContainerConfig {
  version: 1;
  packageManager: PackageManager;
  start: string;
  envFile?: string;
  workdir: string;
  ports: ResolvedContainerPortConfig[];
}

export interface ResolveContainerConfigOptions {
  inferredPackageManager?: PackageManager;
}

export class ContainerConfigError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(message);
    this.name = 'ContainerConfigError';
    this.path = path;
  }
}

const VALID_PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn'];

const DEFAULT_PORT: ResolvedContainerPortConfig = {
  service: DEFAULT_PREVIEW_SERVICE,
  container: 3000,
  protocol: 'tcp',
  preview: true,
};

function cloneDefaultPort(): ResolvedContainerPortConfig {
  return { ...DEFAULT_PORT };
}

export function resolveContainerConfig(
  input: unknown,
  options: ResolveContainerConfigOptions = {}
): ResolvedContainerConfig {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const version = resolveVersion(source.version);
  const packageManager = resolvePackageManager(
    source.packageManager,
    options.inferredPackageManager
  );
  const start = resolveStartCommand(source.start);
  const envFile = resolveEnvFile(source.envFile);
  const workdir = resolveWorkdir(source.workdir);
  const ports = resolvePorts(source.ports);

  return {
    version,
    packageManager,
    start,
    envFile,
    workdir,
    ports,
  };
}

function resolveVersion(raw: unknown): 1 {
  if (raw == null) return DEFAULT_VERSION;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ContainerConfigError('`version` must be an integer', 'version');
  }
  if (raw !== DEFAULT_VERSION) {
    throw new ContainerConfigError('Only config version 1 is supported in M1', 'version');
  }
  return DEFAULT_VERSION;
}

function resolvePackageManager(raw: unknown, inferred?: PackageManager): PackageManager {
  if (raw == null) return inferred ?? 'npm';
  if (typeof raw !== 'string') {
    throw new ContainerConfigError(
      '`packageManager` must be a string ("npm" | "pnpm" | "yarn")',
      'packageManager'
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (!VALID_PACKAGE_MANAGERS.includes(normalized as PackageManager)) {
    throw new ContainerConfigError(
      '`packageManager` must be one of "npm", "pnpm", or "yarn"',
      'packageManager'
    );
  }
  return normalized as PackageManager;
}

function resolveStartCommand(raw: unknown): string {
  if (raw == null) return DEFAULT_START_COMMAND;
  if (typeof raw !== 'string') {
    throw new ContainerConfigError('`start` must be a string', 'start');
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new ContainerConfigError('`start` cannot be empty', 'start');
  }
  return normalized;
}

function resolveEnvFile(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') {
    throw new ContainerConfigError('`envFile` must be a string path', 'envFile');
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new ContainerConfigError('`envFile` cannot be empty', 'envFile');
  }
  return normalized;
}

function resolveWorkdir(raw: unknown): string {
  if (raw == null) return DEFAULT_WORKDIR;
  if (typeof raw !== 'string') {
    throw new ContainerConfigError('`workdir` must be a string', 'workdir');
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new ContainerConfigError('`workdir` cannot be empty', 'workdir');
  }
  return normalized;
}

function resolvePorts(raw: unknown): ResolvedContainerPortConfig[] {
  if (raw == null) return [cloneDefaultPort()];
  if (!Array.isArray(raw)) {
    throw new ContainerConfigError('`ports` must be an array', 'ports');
  }
  if (raw.length === 0) {
    return [cloneDefaultPort()];
  }

  const result: ResolvedContainerPortConfig[] = [];
  raw.forEach((entry, index) => {
    const path = `ports[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContainerConfigError('Each port entry must be an object', path);
    }
    const { service, container, preview, protocol } = entry as Record<string, unknown>;
    if (typeof service !== 'string' || service.trim().length === 0) {
      throw new ContainerConfigError('`service` must be a non-empty string', `${path}.service`);
    }
    if (typeof container !== 'number' || !Number.isInteger(container)) {
      throw new ContainerConfigError('`container` must be an integer', `${path}.container`);
    }
    if (container < 1 || container > 65535) {
      throw new ContainerConfigError(
        '`container` must be between 1 and 65535',
        `${path}.container`
      );
    }
    if (protocol != null && protocol !== 'tcp') {
      throw new ContainerConfigError('Only TCP protocol is supported in M1', `${path}.protocol`);
    }
    if (preview != null && typeof preview !== 'boolean') {
      throw new ContainerConfigError(
        '`preview` must be a boolean when provided',
        `${path}.preview`
      );
    }
    result.push({
      service: service.trim(),
      container,
      protocol: 'tcp',
      preview: preview === true,
    });
  });

  ensurePreviewPort(result);
  ensureUniqueServices(result);

  return result;
}

function ensurePreviewPort(ports: ResolvedContainerPortConfig[]): void {
  const idx = ports.findIndex((port) => port.preview);
  if (idx >= 0) {
    // Normalize to boolean true for first preview, false for the rest.
    ports.forEach((port, index) => {
      port.preview = index === idx;
    });
    return;
  }
  ports[0] = { ...ports[0], preview: true };
}

function ensureUniqueServices(ports: ResolvedContainerPortConfig[]): void {
  const seen = new Map<string, number>();
  ports.forEach((port, index) => {
    const prev = seen.get(port.service);
    if (prev != null) {
      throw new ContainerConfigError(
        `Duplicate service name "${port.service}" found in ports array`,
        `ports[${index}].service`
      );
    }
    seen.set(port.service, index);
  });
}

export function createDefaultContainerConfig(): ResolvedContainerConfig {
  return {
    version: DEFAULT_VERSION,
    packageManager: 'npm',
    start: DEFAULT_START_COMMAND,
    workdir: DEFAULT_WORKDIR,
    ports: [cloneDefaultPort()],
  };
}

export type ContainerConfigSchema = {
  readonly $schema: 'http://json-schema.org/draft-07/schema#';
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: {
    readonly version: { readonly type: 'integer'; readonly enum: readonly [1] };
    readonly packageManager: {
      readonly type: 'string';
      readonly enum: readonly ['npm', 'pnpm', 'yarn'];
    };
    readonly start: { readonly type: 'string'; readonly minLength: 1 };
    readonly envFile: { readonly type: 'string'; readonly minLength: 1 };
    readonly workdir: { readonly type: 'string'; readonly minLength: 1 };
    readonly ports: {
      readonly type: 'array';
      readonly minItems: 1;
      readonly items: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly required: readonly ['service', 'container'];
        readonly properties: {
          readonly service: { readonly type: 'string'; readonly minLength: 1 };
          readonly container: {
            readonly type: 'integer';
            readonly minimum: 1;
            readonly maximum: 65535;
          };
          readonly preview: { readonly type: 'boolean' };
          readonly protocol: { readonly type: 'string'; readonly enum: readonly ['tcp'] };
        };
      };
    };
  };
};

export const CONTAINER_CONFIG_JSON_SCHEMA: ContainerConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', enum: [1] as const },
    packageManager: { type: 'string', enum: ['npm', 'pnpm', 'yarn'] as const },
    start: { type: 'string', minLength: 1 },
    envFile: { type: 'string', minLength: 1 },
    workdir: { type: 'string', minLength: 1 },
    ports: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'container'] as const,
        properties: {
          service: { type: 'string', minLength: 1 },
          container: { type: 'integer', minimum: 1, maximum: 65535 },
          preview: { type: 'boolean' },
          protocol: { type: 'string', enum: ['tcp'] as const },
        },
      },
    },
  },
};

export type ContainerConfigValidationResult =
  | { ok: true; config: ResolvedContainerConfig }
  | { ok: false; error: ContainerConfigError };

export function validateContainerConfig(
  input: unknown,
  options?: ResolveContainerConfigOptions
): ContainerConfigValidationResult {
  try {
    const config = resolveContainerConfig(input, options);
    return { ok: true, config };
  } catch (error) {
    if (error instanceof ContainerConfigError) {
      return { ok: false, error };
    }
    throw error;
  }
}
