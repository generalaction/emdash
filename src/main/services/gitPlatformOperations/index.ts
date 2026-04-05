import type { GitPlatform } from '../../../shared/git/platform';
import { databaseService } from '../DatabaseService';
import { githubService } from '../GitHubService';
import { RemoteGitService } from '../RemoteGitService';
import { sshService } from '../ssh/SshService';
import { resolveRemoteProjectForWorktreePath } from '../../utils/remoteProjectResolver';
import { createLocalExecutor, createRemoteExecutor } from './executor';
import { GitHubOperations } from './GitHubOperations';
import { GitLabOperations } from './GitLabOperations';
import type { GitPlatformOperations } from './types';

const remoteGitService = new RemoteGitService(sshService);

export type { GitPlatformOperations } from './types';
export type {
  CommandExecutor,
  CheckRunResult,
  CommentResult,
  PrDetails,
  PrListResult,
} from './types';
export { GitHubOperations } from './GitHubOperations';
export { GitLabOperations } from './GitLabOperations';

export async function resolveGitPlatform(taskPath: string): Promise<GitPlatform> {
  try {
    return await databaseService.getGitPlatformForTaskPath(taskPath);
  } catch {
    return 'github';
  }
}

export async function getOperations(taskPath: string): Promise<GitPlatformOperations> {
  const platform = await resolveGitPlatform(taskPath);
  const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);

  const executor = remoteProject
    ? createRemoteExecutor(remoteProject.sshConnectionId, taskPath, platform, remoteGitService)
    : createLocalExecutor(taskPath, platform);

  return platform === 'gitlab'
    ? new GitLabOperations(executor)
    : new GitHubOperations(executor, githubService);
}
