import { err, ok, type Result } from '@emdash/shared';
import {
  gitErrorMessage,
  type RuntimeGit,
  type RuntimeGitRepository,
} from '@main/core/git/runtime-git';
import { log } from '@main/lib/logger';
import {
  remoteNameFromQualifiedRef,
  resolveBaseRefFromRemoteDefault,
} from '@shared/core/git/utils';
import type { CreateProjectError } from '@shared/projects';

export async function resolveProjectBaseRef(
  git: RuntimeGitRepository,
  detectedBaseRef: string
): Promise<string> {
  const remoteName = remoteNameFromQualifiedRef(detectedBaseRef);
  if (!remoteName) return detectedBaseRef;

  try {
    const [defaultBranch, refs] = await Promise.all([
      git.getDefaultBranch(remoteName),
      git.getRefs(),
    ]);
    if (!defaultBranch.success) throw new Error(gitErrorMessage(defaultBranch.error));
    return resolveBaseRefFromRemoteDefault({
      detectedBaseRef,
      gitDefaultBranch: defaultBranch.data,
      branches: refs.branches,
    });
  } catch (error) {
    log.debug('Failed to resolve project base ref, using detected base ref', {
      detectedBaseRef,
      error,
    });
    return detectedBaseRef;
  }
}

export async function ensureProjectRepository(
  git: RuntimeGit,
  path: string,
  initGitRepository?: boolean
): Promise<Result<{ rootPath: string; baseRef: string }, CreateProjectError>> {
  const ensured = await git.ensureRepository(path, initGitRepository ?? false);
  if (!ensured.success) return err(ensured.error);

  try {
    const repository = git.repository(ensured.data.rootPath);
    const baseRef = await resolveProjectBaseRef(repository, ensured.data.baseRef);
    return ok({ rootPath: ensured.data.rootPath, baseRef });
  } catch (error) {
    return err({
      type: 'open-repository-failed',
      path: ensured.data.rootPath,
      message: gitErrorMessage(error),
    });
  }
}
