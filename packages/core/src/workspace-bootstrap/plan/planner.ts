import type { BootstrapContext, BootstrapPlan } from '../api/schemas';
import { step, type BootstrapStep } from '../steps/catalog';
import type { BootstrapGitIntent } from './intent';
import { createPlannedSteps } from './steps';

export function compileBootstrapPlan(
  intent: BootstrapGitIntent,
  context: BootstrapContext
): BootstrapPlan {
  const steps: BootstrapStep[] = [];

  if (intent.kind === 'use-branch') {
    steps.push(step('add-worktree', { branchName: intent.branchName }));
    steps.push(step('copy-preserved-files', {}));
    return { steps: createPlannedSteps(steps) };
  }

  if (intent.kind === 'create-branch') {
    const { branchName, fromBranch } = intent;

    if (fromBranch.type === 'remote') {
      const remoteName = fromBranch.remote.name;
      const fromRef = `${remoteName}/${fromBranch.branch}`;
      steps.push(step('git-fetch', { remote: remoteName }));
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

    steps.push(step('add-worktree', { branchName }));
    steps.push(step('copy-preserved-files', {}));

    if (intent.pushBranch) {
      steps.push(
        step('push-branch', { branchName, remote: context.pushRemote, setUpstream: true })
      );
    }

    return { steps: createPlannedSteps(steps) };
  }

  const { headBranch, headRepositoryUrl, isFork, prNumber, taskBranch, pushBranch } = intent;
  const worktreeBranch = taskBranch ?? headBranch;

  if (isFork) {
    const remoteName = forkRemoteName(headRepositoryUrl);
    steps.push(step('ensure-remote', { name: remoteName, url: headRepositoryUrl }));
    steps.push(
      step('git-fetch', {
        remote: remoteName,
        refspec: `${headBranch}:refs/heads/${headBranch}`,
        force: true,
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
        remote: context.baseRemote,
        refspec: `refs/pull/${prNumber}/head:refs/heads/${headBranch}`,
        force: true,
      })
    );
    steps.push(
      step('set-branch-tracking', {
        branchName: headBranch,
        remote: context.baseRemote,
        remoteBranch: headBranch,
      })
    );
  }

  if (taskBranch) {
    steps.push(
      step('create-local-branch', { branchName: taskBranch, fromRef: headBranch, noTrack: true })
    );
  }

  steps.push(step('add-worktree', { branchName: worktreeBranch }));
  steps.push(step('copy-preserved-files', {}));

  if (pushBranch && taskBranch) {
    steps.push(step('push-branch', { branchName: taskBranch, remote: context.pushRemote }));
  }

  return { steps: createPlannedSteps(steps) };
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
