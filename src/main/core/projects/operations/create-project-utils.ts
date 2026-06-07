import type { GitService } from '@main/core/git/impl/git-service';
import { log } from '@main/lib/logger';
import {
  remoteNameFromQualifiedRef,
  resolveBaseRefFromRemoteDefault,
} from '@shared/core/git/git-utils';

export async function resolveProjectBaseRef(
  git: GitService,
  detectedBaseRef: string
): Promise<string> {
  const remoteName = remoteNameFromQualifiedRef(detectedBaseRef);
  if (!remoteName) return detectedBaseRef;

  try {
    const [gitDefaultBranch, branches] = await Promise.all([
      git.getDefaultBranch(remoteName),
      git.getBranches(),
    ]);
    return resolveBaseRefFromRemoteDefault({ detectedBaseRef, gitDefaultBranch, branches });
  } catch (error) {
    log.debug('Failed to resolve project base ref, using detected base ref', {
      detectedBaseRef,
      error,
    });
  }

  return detectedBaseRef;
}

export async function ensureGitRepository(
  git: GitService,
  initGitRepository?: boolean
): ReturnType<GitService['detectInfo']> {
  let gitInfo = await git.detectInfo();
  if (!gitInfo.isGitRepo) {
    if (!initGitRepository) {
      throw new Error(
        'Directory is not a git repository. Enable "Initialize git repository" to continue.'
      );
    }
    await git.initRepository();
    gitInfo = await git.detectInfo();
  }
  if (!gitInfo.isGitRepo) {
    throw new Error('Failed to initialize git repository');
  }
  return gitInfo;
}
