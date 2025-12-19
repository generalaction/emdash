import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  ContainerConfigError,
  PackageManager,
  ResolvedContainerConfig,
  resolveContainerConfig,
} from '@shared/container';

const CONFIG_RELATIVE_PATH = path.join('.emdash', 'config.json');

const PACKAGE_MANAGER_LOCKFILES: Array<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

export type ContainerConfigLoadErrorCode = 'INVALID_JSON' | 'VALIDATION_FAILED' | 'IO_ERROR';

export class ContainerConfigLoadError extends Error {
  readonly code: ContainerConfigLoadErrorCode;
  readonly configPath?: string;
  readonly configKey?: string;
  readonly cause?: unknown;

  constructor(
    code: ContainerConfigLoadErrorCode,
    message: string,
    options: { configPath?: string; configKey?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'ContainerConfigLoadError';
    this.code = code;
    this.configPath = options.configPath;
    this.configKey = options.configKey;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export interface ContainerConfigLoadSuccess {
  ok: true;
  config: ResolvedContainerConfig;
  sourcePath: string | null;
}

export interface ContainerConfigLoadFailure {
  ok: false;
  error: ContainerConfigLoadError;
}

export type ContainerConfigLoadResult = ContainerConfigLoadSuccess | ContainerConfigLoadFailure;

export async function loadTaskContainerConfig(
  taskPath: string
): Promise<ContainerConfigLoadResult> {
  const configPath = path.join(taskPath, CONFIG_RELATIVE_PATH);
  const inferredPackageManager = inferPackageManager(taskPath);

  const readResult = await readConfigFile(configPath);
  if (readResult.error) {
    return { ok: false, error: readResult.error };
  }

  let parsedConfig: unknown = {};
  let sourcePath: string | null = null;
  if (readResult.content != null) {
    const parseResult = parseConfigJson(readResult.content, configPath);
    if (parseResult.error) {
      return { ok: false, error: parseResult.error };
    }
    parsedConfig = parseResult.value;
    sourcePath = configPath;
  }

  try {
    const resolved = resolveContainerConfig(parsedConfig, {
      inferredPackageManager,
    });
    return { ok: true, config: resolved, sourcePath };
  } catch (error) {
    if (error instanceof ContainerConfigError) {
      return {
        ok: false,
        error: new ContainerConfigLoadError('VALIDATION_FAILED', error.message, {
          configPath: sourcePath ?? configPath,
          configKey: error.path,
          cause: error,
        }),
      };
    }
    throw error;
  }
}

function inferPackageManager(taskPath: string): PackageManager | undefined {
  for (const { file, manager } of PACKAGE_MANAGER_LOCKFILES) {
    const candidate = path.join(taskPath, file);
    if (fs.existsSync(candidate)) {
      return manager;
    }
  }
  return undefined;
}

async function readConfigFile(
  configPath: string
): Promise<{ content: string | null; error: ContainerConfigLoadError | null }> {
  try {
    const content = await fsp.readFile(configPath, 'utf8');
    return { content, error: null };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { content: null, error: null };
    }
    return {
      content: null,
      error: new ContainerConfigLoadError(
        'IO_ERROR',
        `Failed to read ${configPath}: ${err.message}`,
        {
          configPath,
          cause: error,
        }
      ),
    };
  }
}

function parseConfigJson(
  content: string,
  configPath: string
): { value: unknown; error: ContainerConfigLoadError | null } {
  try {
    const parsed = JSON.parse(content);
    return { value: parsed, error: null };
  } catch (error) {
    return {
      value: null,
      error: new ContainerConfigLoadError('INVALID_JSON', `Invalid JSON in ${configPath}`, {
        configPath,
        cause: error,
      }),
    };
  }
}

export function inferPackageManagerForTask(taskPath: string): PackageManager | undefined {
  return inferPackageManager(taskPath);
}
