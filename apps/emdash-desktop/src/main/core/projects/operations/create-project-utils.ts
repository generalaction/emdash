import type { IGitRepository, IGitRuntime } from '@emdash/core/git';
import { gitErrorMessage } from '@emdash/core/git';
import { log } from '@main/lib/logger';
import {
  remoteNameFromQualifiedRef,
  resolveBaseRefFromRemoteDefault,
} from '@shared/core/git/utils';
import { err, ok, type Result } from '@shared/lib/result';
import type { CreateProjectError } from '@shared/projects';

export async function resolveProjectBaseRef(
  git: IGitRepository,
  detectedBaseRef: string
): Promise<string> {
  const remoteName = remoteNameFromQualifiedRef(detectedBaseRef);
  if (!remoteName) return detectedBaseRef;

  try {
    const [gitDefaultBranch, refs] = await Promise.all([
      git.getDefaultBranch(remoteName),
      git.getRefs(),
    ]);
    return resolveBaseRefFromRemoteDefault({
      detectedBaseRef,
      gitDefaultBranch,
      branches: refs.branches,
    });
  } catch (error) {
    log.debug('Failed to resolve project base ref, using detected base ref', {
      detectedBaseRef,
      error,
    });
  }

  return detectedBaseRef;
}

export async function ensureProjectRepository(
  git: IGitRuntime,
  path: string,
  initGitRepository?: boolean
): Promise<Result<{ rootPath: string; baseRef: string }, CreateProjectError>> {
  const ensured = await git.ensureRepository(path, { initIfMissing: initGitRepository ?? false });
  if (!ensured.success) {
    return err(ensured.error);
  }

  const repoLeaseResult = await git.openRepository(ensured.data.rootPath).then(
    (lease) => ok(lease),
    (error: unknown) => err(error)
  );
  if (!repoLeaseResult.success) {
    return err({
      type: 'open-repository-failed',
      path: ensured.data.rootPath,
      message: gitErrorMessage(repoLeaseResult.error),
    });
  }
  const repoLease = repoLeaseResult.data;

  try {
    const baseRef = await resolveProjectBaseRef(repoLease.value, ensured.data.baseRef);
    return ok({ rootPath: ensured.data.rootPath, baseRef });
  } finally {
    repoLease.release();
  }
}
