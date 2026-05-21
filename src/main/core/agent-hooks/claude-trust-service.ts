import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import * as toml from 'smol-toml';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/agent-provider-registry';

const CONFIG_MAX_BYTES = 2 * 1024 * 1024;
const TRUSTED_PROVIDERS = new Set<AgentProviderId>(['claude', 'codex', 'copilot']);

type TrustIo = {
  readConfig: (configPath: string) => Promise<string | null>;
  writeConfig: (configPath: string, content: string) => Promise<void>;
};

export class ProviderTrustService {
  private readonly configLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      getTaskSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
    }
  ) {}

  async maybeAutoTrustLocal({
    providerId,
    cwd,
    homedir,
    env = process.env,
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    homedir: string;
    env?: Record<string, string | undefined>;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId))) return;

    const normalizedPath = path.resolve(cwd);
    await this.autoTrust(providerId, normalizedPath, homedir, path, {
      readConfig: readLocalConfig,
      writeConfig: writeLocalConfigAtomic,
      codexHome: env.CODEX_HOME,
      copilotHome: env.COPILOT_HOME,
    });
  }

  async maybeAutoTrustSsh({
    providerId,
    cwd,
    ctx,
    remoteFs,
    env = {},
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    ctx: IExecutionContext;
    remoteFs: Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;
    env?: Record<string, string | undefined>;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId))) return;

    const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const homeDir = await resolveRemoteHome(ctx);

    await this.autoTrust(providerId, normalizedPath, homeDir, path.posix, {
      readConfig: (configPath) => readRemoteConfig(remoteFs, configPath),
      writeConfig: (configPath, content) =>
        writeRemoteConfigAtomic(remoteFs, ctx, configPath, content),
      codexHome: env.CODEX_HOME,
      copilotHome: env.COPILOT_HOME,
    });
  }

  private async shouldAutoTrust(providerId: AgentProviderId): Promise<boolean> {
    if (!TRUSTED_PROVIDERS.has(providerId)) return false;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
  }

  private async autoTrust(
    providerId: AgentProviderId,
    normalizedPath: string,
    homeDir: string,
    pathApi: Pick<typeof path, 'join'>,
    io: TrustIo & { codexHome?: string; copilotHome?: string }
  ): Promise<void> {
    const configPath = getConfigPath(providerId, homeDir, pathApi, io.codexHome, io.copilotHome);
    if (!configPath) return;

    await this.withLock(configPath, () =>
      this.ensureTrusted(providerId, normalizedPath, configPath, io)
    );
  }

  private withLock(configPath: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.configLocks.get(configPath) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.configLocks.set(configPath, next);
    return next;
  }

  private async ensureTrusted(
    providerId: AgentProviderId,
    normalizedPath: string,
    configPath: string,
    io: TrustIo
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig(configPath);
      const nextConfig = withTrustedProject(providerId, rawConfig, normalizedPath);
      if (nextConfig === null) return;
      await io.writeConfig(configPath, nextConfig);
    } catch (error: unknown) {
      log.warn('ProviderTrustService: failed to auto-trust worktree', {
        providerId,
        path: normalizedPath,
        error: String(error),
      });
    }
  }
}

export const providerTrustService = new ProviderTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

export const claudeTrustService = providerTrustService;
export { ProviderTrustService as ClaudeTrustService };

function getConfigPath(
  providerId: AgentProviderId,
  homeDir: string,
  pathApi: Pick<typeof path, 'join'>,
  codexHome?: string,
  copilotHome?: string
): string | null {
  if (providerId === 'claude') return pathApi.join(homeDir, '.claude.json');
  if (providerId === 'codex') {
    return pathApi.join(codexHome || pathApi.join(homeDir, '.codex'), 'config.toml');
  }
  if (providerId === 'copilot') {
    return pathApi.join(copilotHome || pathApi.join(homeDir, '.copilot'), 'config.json');
  }
  return null;
}

function withTrustedProject(
  providerId: AgentProviderId,
  rawConfig: string | null,
  worktreePath: string
): string | null {
  if (providerId === 'claude') return withClaudeTrustedProject(rawConfig, worktreePath);
  if (providerId === 'codex') return withCodexTrustedProject(rawConfig, worktreePath);
  if (providerId === 'copilot') return withCopilotTrustedProject(rawConfig, worktreePath);
  return null;
}

function withClaudeTrustedProject(rawConfig: string | null, worktreePath: string): string | null {
  const config = parseJsonConfig(rawConfig, 'Claude');
  if (!config) return null;

  const projects = isPlainObject(config.projects) ? config.projects : {};
  const existing = isPlainObject(projects[worktreePath]) ? projects[worktreePath] : {};

  const alreadyTrusted =
    existing['hasTrustDialogAccepted'] === true &&
    existing['hasCompletedProjectOnboarding'] === true;
  if (alreadyTrusted) return null;

  return (
    JSON.stringify(
      {
        ...config,
        projects: {
          ...projects,
          [worktreePath]: {
            ...existing,
            hasTrustDialogAccepted: true,
            hasCompletedProjectOnboarding: true,
          },
        },
      },
      null,
      2
    ) + '\n'
  );
}

function withCopilotTrustedProject(rawConfig: string | null, worktreePath: string): string | null {
  const config = parseJsonConfig(rawConfig, 'Copilot');
  if (!config) return null;

  const trustedFolders = Array.isArray(config.trustedFolders)
    ? config.trustedFolders.filter((folder): folder is string => typeof folder === 'string')
    : [];
  if (trustedFolders.includes(worktreePath)) return null;

  if (rawConfig && rawConfig.trim() !== '') {
    const edits = jsonc.modify(
      rawConfig,
      Array.isArray(config.trustedFolders) ? ['trustedFolders', -1] : ['trustedFolders'],
      Array.isArray(config.trustedFolders) ? worktreePath : [worktreePath],
      { formattingOptions: { insertSpaces: true, tabSize: 2 } }
    );
    return jsonc.applyEdits(rawConfig, edits);
  }

  return (
    JSON.stringify({ ...config, trustedFolders: [...trustedFolders, worktreePath] }, null, 2) + '\n'
  );
}

function withCodexTrustedProject(rawConfig: string | null, worktreePath: string): string | null {
  const config = parseTomlConfig(rawConfig, 'Codex');
  if (!config) return null;

  const projects = isPlainObject(config.projects) ? config.projects : {};
  const existing = isPlainObject(projects[worktreePath]) ? projects[worktreePath] : {};
  if (existing['trust_level'] === 'trusted') return null;

  const trustedProjectConfig = toml.stringify({
    projects: { [worktreePath]: { trust_level: 'trusted' } },
  });
  if (!rawConfig || rawConfig.trim() === '') return trustedProjectConfig;

  const header = trustedProjectConfig.split('\n')[0];
  const section = findTomlTableSection(rawConfig, header);
  if (!section) return appendTomlTable(rawConfig, trustedProjectConfig);

  const sectionText = rawConfig.slice(section.start, section.end);
  const trustLevelMatch = /^[ \t]*trust_level[ \t]*=.*$/m.exec(sectionText);
  if (trustLevelMatch) {
    return (
      rawConfig.slice(0, section.start + trustLevelMatch.index) +
      'trust_level = "trusted"' +
      rawConfig.slice(section.start + trustLevelMatch.index + trustLevelMatch[0].length)
    );
  }

  return (
    rawConfig.slice(0, section.end) +
    `${sectionText.endsWith('\n') ? '' : '\n'}trust_level = "trusted"\n` +
    rawConfig.slice(section.end)
  );
}

function findTomlTableSection(
  rawConfig: string,
  header: string
): { start: number; end: number } | null {
  const tableHeaderPattern = /^[ \t]*\[.*\][ \t]*(?:#.*)?$/;
  let offset = 0;

  for (const line of rawConfig.matchAll(/^.*(?:\n|$)/gm)) {
    const text = line[0];
    if (text === '') break;
    const lineStart = offset;
    const lineEnd = lineStart + text.length;
    offset = lineEnd;

    if (text.trim() !== header) continue;

    let sectionEnd = rawConfig.length;
    for (const nextLine of rawConfig.slice(lineEnd).matchAll(/^.*(?:\n|$)/gm)) {
      const nextText = nextLine[0];
      if (nextText === '') break;
      if (tableHeaderPattern.test(nextText.trimEnd())) {
        sectionEnd = lineEnd + nextLine.index;
        break;
      }
    }

    return { start: lineStart, end: sectionEnd };
  }

  return null;
}

function appendTomlTable(rawConfig: string, table: string): string {
  const trailingNewline = rawConfig.endsWith('\n') ? '' : '\n';
  const separator = rawConfig.trim() === '' || rawConfig.endsWith('\n\n') ? '' : '\n';
  return `${rawConfig}${trailingNewline}${separator}${table}`;
}

function parseJsonConfig(raw: string | null, providerName: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(raw, errors);
    if (errors.length > 0) throw new Error(jsonc.printParseErrorCode(errors[0].error));
    if (isPlainObject(parsed)) return parsed;
    log.warn(`ProviderTrustService: refusing to overwrite non-object ${providerName} config root`);
    return null;
  } catch (error: unknown) {
    log.warn(`ProviderTrustService: refusing to overwrite corrupt ${providerName} config`, {
      error: String(error),
    });
    return null;
  }
}

function parseTomlConfig(raw: string | null, providerName: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = toml.parse(raw) as Record<string, unknown>;
    if (isPlainObject(parsed)) return parsed;
    log.warn(`ProviderTrustService: refusing to overwrite non-object ${providerName} config root`);
    return null;
  } catch (error: unknown) {
    log.warn(`ProviderTrustService: refusing to overwrite corrupt ${providerName} config`, {
      error: String(error),
    });
    return null;
  }
}

async function readLocalConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return null;
    throw error;
  }
}

async function writeLocalConfigAtomic(configPath: string, content: string): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, configPath);
  } catch (error: unknown) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

async function readRemoteConfig(
  remoteFs: Pick<FileSystemProvider, 'read'>,
  configPath: string
): Promise<string | null> {
  try {
    const result = await remoteFs.read(configPath, CONFIG_MAX_BYTES);
    return result.content;
  } catch (error: unknown) {
    if (isFsNotFound(error)) return null;
    throw error;
  }
}

async function writeRemoteConfigAtomic(
  remoteFs: Pick<FileSystemProvider, 'write'>,
  ctx: IExecutionContext,
  configPath: string,
  content: string
): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
    await remoteFs.write(tmpPath, content);
    await ctx.exec('mv', [tmpPath, configPath]);
  } catch (error: unknown) {
    try {
      await ctx.exec('rm', ['-f', tmpPath]);
    } catch {}
    throw error;
  }
}

function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isFsNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === FileSystemErrorCodes.NOT_FOUND;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
