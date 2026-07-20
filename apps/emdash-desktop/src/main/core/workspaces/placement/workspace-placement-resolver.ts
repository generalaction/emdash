import path from 'node:path';
import {
  hostRef,
  hostRefKey,
  LOCAL_HOST_REF,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import { ROOT_RELATIVE_PATH, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import {
  defaultRepositoriesRoot,
  defaultWorktreesRoot,
  deriveWorktreePoolPath,
} from '@emdash/core/runtimes/workspace/node';
import type {
  HostRuntimesClient,
  RuntimeBroker,
  RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { safePathSegment } from '@core/primitives/path-name/api';
import {
  legacyBaseProjectSettingsSchema,
  type BaseProjectSettings,
} from '@core/primitives/project-settings/api';
import type { Project, ProjectPlacementError } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projectSettings } from '@core/services/app-db/node/schema';
import type { AppSettingsService } from '@core/services/settings/node';
import { getAppSettingsService } from '@main/bootstrap/core/service-instances';
import { getProjectByPath } from '@main/core/projects/operations/getProjects';
import { getAppDb } from '@main/db/instance';
import { getDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { log } from '@main/lib/logger';

export type WorkspacePlacementError = ProjectPlacementError;

type RuntimeBrokerLike = {
  session(host: HostRef): PendingLease<Result<HostRuntimesClient, RuntimeResolveError>>;
};

type PlacementResolverDependencies = {
  broker: RuntimeBrokerLike;
  getSettings: () => Pick<AppSettingsService, 'getWithMeta'>;
  findProjectByPath: typeof getProjectByPath;
  loadProjectWorktreeDirectory: (projectId: string) => Promise<string | undefined>;
};

export class WorkspacePlacementResolver {
  private readonly homeDirectories = new Map<
    string,
    Promise<Result<string, WorkspacePlacementError>>
  >();

  constructor(private readonly dependencies: PlacementResolverDependencies) {}

  async resolveWorktreePool(project: Project): Promise<Result<string, WorkspacePlacementError>> {
    const host = projectHostRef(project);
    const homeResult = await this.getHomeDirectory(host);
    if (!homeResult.success) return homeResult;

    const configuredRoot =
      (await this.dependencies.loadProjectWorktreeDirectory(project.id)) ??
      (await this.getExplicitAppRoot('defaultWorktreeDirectory'));
    const rootResult = configuredRoot
      ? resolveConfiguredRoot(configuredRoot, homeResult.data)
      : ok(defaultWorktreesRoot(homeResult.data));
    if (!rootResult.success) return rootResult;

    return ok(
      deriveWorktreePoolPath({
        worktreesRoot: rootResult.data,
        repoPath: project.path,
      })
    );
  }

  async resolveRepositoryDestination(
    host: HostRef,
    name: string,
    chosenDir?: string
  ): Promise<Result<string, WorkspacePlacementError>> {
    const homeResult = await this.getHomeDirectory(host);
    if (!homeResult.success) return homeResult;

    const configuredRoot =
      chosenDir?.trim() || (await this.getExplicitAppRoot('defaultProjectsDirectory'));
    const rootResult = configuredRoot
      ? resolveConfiguredRoot(configuredRoot, homeResult.data)
      : ok(defaultRepositoriesRoot(homeResult.data));
    if (!rootResult.success) return rootResult;

    const lease = this.dependencies.broker.session(host);
    try {
      const session = await lease.ready();
      if (!session.success) return session;

      const pathApi = pathApiFor(rootResult.data);
      const baseName = safePathSegment(name, 'repository');
      for (let suffix = 1; ; suffix += 1) {
        const candidateName = suffix === 1 ? baseName : `${baseName}-${suffix}`;
        const candidate = pathApi.join(rootResult.data, candidateName);
        const [exists, registeredProject] = await Promise.all([
          session.data.files.fs.exists({
            root: hostPathFromNative(candidate),
            relative: ROOT_RELATIVE_PATH,
          }),
          this.dependencies.findProjectByPath(host, candidate),
        ]);
        if (!exists.success) {
          return err({
            type: 'filesystem-unavailable',
            path: candidate,
            message: fsErrorMessage(exists.error),
          });
        }
        if (!exists.data && !registeredProject) return ok(candidate);
      }
    } finally {
      await lease.release();
    }
  }

  clearHostCache(host?: HostRef): void {
    if (host) {
      this.homeDirectories.delete(hostRefKey(host));
      return;
    }
    this.homeDirectories.clear();
  }

  private getHomeDirectory(host: HostRef): Promise<Result<string, WorkspacePlacementError>> {
    const key = hostRefKey(host);
    const cached = this.homeDirectories.get(key);
    if (cached) return cached;

    const pending = this.queryHomeDirectory(host);
    this.homeDirectories.set(key, pending);
    return pending;
  }

  private async queryHomeDirectory(
    host: HostRef
  ): Promise<Result<string, WorkspacePlacementError>> {
    const lease = this.dependencies.broker.session(host);
    try {
      const session = await lease.ready();
      if (!session.success) return session;
      try {
        return ok(nativePathFromHost(await session.data.files.getHomeDir()));
      } catch (error) {
        return err({
          type: 'host-home-unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      await lease.release();
    }
  }

  private async getExplicitAppRoot(
    field: 'defaultProjectsDirectory' | 'defaultWorktreeDirectory'
  ): Promise<string | undefined> {
    const { overrides } = await this.dependencies.getSettings().getWithMeta('localProject');
    return Object.hasOwn(overrides, field) ? overrides[field] : undefined;
  }
}

async function loadProjectWorktreeDirectory(
  appDb: AppDb,
  projectId: string
): Promise<string | undefined> {
  const [row] = await appDb
    .select({ base: projectSettings.baseProjectSettingsJson })
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);
  if (!row) return undefined;

  try {
    const parsed: BaseProjectSettings = legacyBaseProjectSettingsSchema.parse(JSON.parse(row.base));
    return parsed.worktreeDirectory;
  } catch (error) {
    log.warn('Failed to read worktree placement override; using the host default', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function projectHostRef(project: Project): HostRef {
  return project.type === 'ssh' ? hostRef('remote', project.connectionId) : LOCAL_HOST_REF;
}

function resolveConfiguredRoot(
  configuredRoot: string,
  homeDirectory: string
): Result<string, WorkspacePlacementError> {
  const trimmed = configuredRoot.trim();
  const pathApi = pathApiFor(homeDirectory);
  const expanded =
    trimmed === '~'
      ? homeDirectory
      : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
        ? pathApi.join(homeDirectory, trimmed.slice(2))
        : trimmed;

  if (!pathApi.isAbsolute(expanded)) {
    return err({
      type: 'invalid-host-path',
      path: configuredRoot,
      message: 'Placement roots must be absolute paths on the target host',
    });
  }
  return ok(pathApi.normalize(expanded));
}

function pathApiFor(absolutePath: string): typeof path.posix {
  return /^[a-zA-Z]:[\\/]/u.test(absolutePath) || absolutePath.startsWith('\\\\')
    ? path.win32
    : path.posix;
}

function fsErrorMessage(error: { type: string; message?: string; path?: string }): string {
  return error.message ?? `${error.type}: ${error.path ?? 'unknown path'}`;
}

export const workspacePlacementResolver = new WorkspacePlacementResolver({
  broker: getDesktopRuntimeBroker() as RuntimeBroker,
  getSettings: getAppSettingsService,
  findProjectByPath: (...args) => getProjectByPath(...args),
  loadProjectWorktreeDirectory: (projectId) => loadProjectWorktreeDirectory(getAppDb(), projectId),
});

export const __workspacePlacementTestUtils = {
  resolveConfiguredRoot,
  projectHostRef,
  asHostPath: (path: HostAbsolutePath) => nativePathFromHost(path),
};
