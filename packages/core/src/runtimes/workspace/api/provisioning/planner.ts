import path from 'node:path';
import { step, type BootstrapStep } from '@runtimes/workspace/api/provisioning/catalog';
import type { BootstrapPlan } from '@runtimes/workspace/api/provisioning/schemas';
import type { BootstrapGitIntent } from './intent';
import { createPlannedSteps } from './steps';

export type CompileBootstrapPlanOptions = {
  worktreePoolPath: string;
  baseRemote: string;
};

export type CompiledBootstrapPlan = {
  plan: BootstrapPlan;
  workspacePath: string;
};

export function compileBootstrapPlan(
  intent: BootstrapGitIntent,
  options: CompileBootstrapPlanOptions
): CompiledBootstrapPlan {
  const steps: BootstrapStep[] = [];

  if (intent.kind === 'use-branch') {
    const workspacePath = worktreePathForBranch(options.worktreePoolPath, intent.branchName);
    steps.push(step('add-worktree', { branchName: intent.branchName, path: workspacePath }));
    steps.push(step('copy-preserved-files', {}));
    return { plan: { steps: createPlannedSteps(steps) }, workspacePath };
  }

  if (intent.kind === 'create-branch') {
    const { branchName, fromBranch } = intent;
    const workspacePath = worktreePathForBranch(options.worktreePoolPath, branchName);

    if (fromBranch.type === 'remote') {
      const remoteName = fromBranch.remote.name;
      const fromRef = `${remoteName}/${fromBranch.branch}`;
      steps.push(
        step('git-fetch', {
          remote: remoteName,
          refspec: `+refs/heads/${fromBranch.branch}:refs/remotes/${remoteName}/${fromBranch.branch}`,
          noTags: true,
          filter: 'blob:none',
        })
      );
      steps.push({
        ...step('create-local-branch', { branchName, fromRef, noTrack: true }),
      });
      steps.push(step('set-branch-base', { branchName, baseRef: fromRef }));
    } else {
      steps.push(
        step('create-local-branch', { branchName, fromRef: fromBranch.branch, noTrack: true })
      );
      steps.push(step('set-branch-base', { branchName, baseRef: fromBranch.branch }));
    }

    steps.push(step('add-worktree', { branchName, path: workspacePath }));
    steps.push(step('copy-preserved-files', {}));
    if (intent.pushRemote) {
      steps.push(
        step('push-branch', {
          branchName,
          remote: intent.pushRemote,
          setUpstream: true,
        })
      );
    }

    return { plan: { steps: createPlannedSteps(steps) }, workspacePath };
  }

  if (intent.kind === 'clone-repository') {
    const remoteName = intent.remoteName ?? 'origin';
    steps.push(
      step('git-clone', {
        url: intent.url,
        path: intent.destination,
        remoteName: intent.remoteName,
        depth: intent.depth,
        noTags: true,
        filter: 'blob:none',
      })
    );
    if (intent.initialize) {
      steps.push(
        step('write-file', {
          path: 'README.md',
          content: initialReadmeContent(intent.initialize.name, intent.initialize.description),
        })
      );
      steps.push(
        step('git-commit', {
          message: 'Initial commit',
          paths: ['README.md'],
        })
      );
      steps.push(
        step('push-branch', { branchName: 'HEAD', remote: remoteName, setUpstream: true })
      );
    }
    return { plan: { steps: createPlannedSteps(steps) }, workspacePath: intent.destination };
  }

  if (intent.kind === 'plain-directory') {
    steps.push(step('create-directory', { path: intent.path }));
    return { plan: { steps: createPlannedSteps(steps) }, workspacePath: intent.path };
  }

  const { headBranch, headRepositoryUrl, isFork, prNumber, taskBranch } = intent;
  const worktreeBranch = taskBranch ?? headBranch;
  const workspacePath = worktreePathForBranch(options.worktreePoolPath, worktreeBranch);

  if (isFork) {
    const remoteName = forkRemoteName(headRepositoryUrl);
    steps.push(step('ensure-remote', { name: remoteName, url: headRepositoryUrl }));
    steps.push(
      step('git-fetch', {
        remote: remoteName,
        refspec: `${headBranch}:refs/heads/${headBranch}`,
        force: true,
        noTags: true,
        filter: 'blob:none',
      })
    );
    steps.push(
      step('set-branch-tracking', {
        branchName: headBranch,
        remote: remoteName,
        remoteBranch: headBranch,
      })
    );
  } else {
    steps.push(
      step('git-fetch', {
        remote: options.baseRemote,
        refspec: `refs/pull/${prNumber}/head:refs/heads/${headBranch}`,
        force: true,
        noTags: true,
        filter: 'blob:none',
      })
    );
    steps.push(
      step('set-branch-tracking', {
        branchName: headBranch,
        remote: options.baseRemote,
        remoteBranch: headBranch,
      })
    );
  }

  if (taskBranch) {
    steps.push(
      step('create-local-branch', { branchName: taskBranch, fromRef: headBranch, noTrack: true })
    );
  }

  steps.push(step('add-worktree', { branchName: worktreeBranch, path: workspacePath }));
  steps.push(step('copy-preserved-files', {}));

  return { plan: { steps: createPlannedSteps(steps) }, workspacePath };
}

function forkRemoteName(repositoryUrl: string): string {
  const withoutSuffix = repositoryUrl.replace(/\.git$/i, '');
  const pathPart = withoutSuffix.includes(':')
    ? withoutSuffix.slice(withoutSuffix.indexOf(':') + 1)
    : withoutSuffix
        .replace(/^https?:\/\//i, '')
        .split('/')
        .slice(1)
        .join('/');
  const owner = pathPart.split('/').filter(Boolean).at(0);
  return owner?.replace(/[^a-zA-Z0-9._-]/g, '-') || 'fork';
}

function worktreePathForBranch(worktreePoolPath: string, branchName: string): string {
  return path.join(worktreePoolPath, sanitizeBranchName(branchName));
}

function sanitizeBranchName(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function initialReadmeContent(name: string, description: string | undefined): string {
  return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}
