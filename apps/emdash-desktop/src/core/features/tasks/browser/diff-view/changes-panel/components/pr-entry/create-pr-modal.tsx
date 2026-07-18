import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import { ChevronDown, CircleAlert, GitBranch, GitPullRequest } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { getGitRepositoryStore } from '@core/features/projects/browser/stores/project-selectors';
import { workspaceRegistry } from '@core/features/tasks/browser/stores/workspace-registry';
import { defineModal } from '@core/primitives/modals/react';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import { BranchDisplay } from '@renderer/lib/components/branch-display';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { RemoteSelectContent } from '@renderer/lib/components/remote-select-content';
import { useModalController } from '@renderer/lib/modal/api';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import { Alert, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectTrigger } from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { SplitButton } from '@renderer/lib/ui/split-button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { log } from '@renderer/utils/logger';
import { pullRequestErrorMessage } from '@root/src/core/services/pull-requests/api';
import { formatPushErrorDetail } from '../../../../utils';
import { resolveInitialBaseBranch } from './base-branch';
import { getTargetRemotes, resolveCreatePrTargetRemote } from './target-remote';

export type CreatePrModalArgs = {
  projectId: string;
  taskId: string;
  repositoryUrl: string;
  branchName: string;
  draft: boolean;
  workspaceId: string;
};

export const CreatePrModal = observer(function CreatePrModal({
  projectId,
  taskId: _taskId,
  repositoryUrl,
  branchName,
  draft,
  workspaceId,
}: CreatePrModalArgs) {
  const { complete } = useModalController('createPrModal');
  const [title, setTitle] = useState(branchName);
  const [description, setDescription] = useState('');
  const [selectedBaseOverride, setSelectedBaseOverride] = useState<GitBranchRef | undefined>();
  const [selectedTargetRemoteName, setSelectedTargetRemoteName] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = getGitRepositoryStore(projectId);
  const defaultBranch = repo?.defaultBranch;
  const isOnRemote = repo?.isBranchOnRemote(branchName) ?? false;
  const aheadCount = repo?.getBranchDivergence(branchName)?.ahead ?? 0;
  const needsPush = !isOnRemote || aheadCount > 0;
  const projectRemoteName = repo?.baseRemote.name ?? 'origin';
  const fallbackRepository = useMemo(() => parseRepositoryRef(repositoryUrl), [repositoryUrl]);
  const targetRemotes = useMemo(
    () =>
      fallbackRepository
        ? getTargetRemotes(repo?.remotes ?? [], { host: fallbackRepository.host })
        : [],
    [fallbackRepository, repo?.remotes]
  );
  const targetRemote = resolveCreatePrTargetRemote({
    options: targetRemotes,
    projectRemoteName,
    selectedRemoteName: selectedTargetRemoteName,
    fallbackRepositoryUrl: repositoryUrl,
  });
  const targetRepositoryUrl =
    targetRemote?.repository.repositoryUrl ?? fallbackRepository?.repositoryUrl ?? null;

  const hasGitHubRemote = Boolean(targetRepositoryUrl);
  const selectedBase =
    selectedBaseOverride ??
    resolveInitialBaseBranch(
      repo?.remoteBranches ?? [],
      undefined,
      defaultBranch,
      targetRemote?.remote.name ?? projectRemoteName
    );

  const handleTargetRemoteChange = (remoteName: string | null) => {
    if (!remoteName) return;
    setSelectedTargetRemoteName(remoteName);
    setSelectedBaseOverride(undefined);
  };

  const doCreate = async (push: boolean) => {
    if (!selectedBase?.branch) {
      setError('Select a base branch before creating the pull request.');
      return;
    }
    if (!title.trim() || !targetRepositoryUrl) return;
    setError(null);
    setIsCreating(true);
    try {
      if (push) {
        const workspace = workspaceRegistry.get(projectId, workspaceId);
        if (!workspace) throw new Error('Workspace is unavailable');
        const pushResult = await workspace.gitCheckout.push();
        if (!pushResult.success) {
          log.error('Failed to push branch:', pushResult.error);
          setError(formatPushErrorDetail(pushResult.error));
          return;
        }
      }

      const baseRepository = parseRepositoryRef(targetRepositoryUrl);
      const headRepository = repo?.pushRemote.url ? parseRepositoryRef(repo.pushRemote.url) : null;
      const head =
        baseRepository &&
        headRepository &&
        headRepository.repositoryUrl !== baseRepository.repositoryUrl
          ? `${headRepository.owner}:${branchName}`
          : branchName;

      const client = await getPullRequestsRuntimeClient();
      const result = await client.createPullRequest({
        repositoryUrl: targetRepositoryUrl,
        headRepositoryUrl: headRepository?.repositoryUrl,
        head,
        base: selectedBase.branch,
        title: title.trim(),
        body: description.trim() || undefined,
        draft,
      });

      if (result.success) {
        await client.syncSingle({
          repositoryUrl: targetRepositoryUrl,
          number: result.data.number,
        });
        complete();
      } else {
        setError(pullRequestErrorMessage(result.error));
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex max-h-[70vh] flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>{draft ? 'Create Draft PR' : 'Create Pull Request'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-4">
        {!hasGitHubRemote && (
          <p className="text-muted-foreground text-sm">
            No GitHub remote detected. Configure a GitHub remote to create pull requests.
          </p>
        )}
        <div className="flex flex-col items-center gap-2">
          <BranchDisplay
            label="Head Branch"
            branchName={branchName}
            className="rounded-md border border-border"
          />
          {targetRemotes.length > 1 && targetRemote ? (
            <Select value={targetRemote.remote.name} onValueChange={handleTargetRemoteChange}>
              <SelectTrigger
                showChevron={false}
                className="flex min-h-[58px] w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-left outline-none data-[size=default]:h-auto"
              >
                <div className="flex flex-col gap-0.5 text-left text-sm">
                  <span className="text-xs text-foreground-passive">Target</span>
                  <span className="flex items-center gap-1">
                    <GitPullRequest
                      absoluteStrokeWidth
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-foreground-muted"
                    />
                    <span className="min-w-0 truncate">{targetRemote.remote.name}</span>
                  </span>
                </div>
                <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
              </SelectTrigger>
              <RemoteSelectContent remotes={targetRemotes.map(({ remote }) => remote)} />
            </Select>
          ) : null}
          <ProjectBranchSelector
            projectId={projectId}
            value={selectedBase}
            onValueChange={setSelectedBaseOverride}
            remoteOnly
            remoteName={targetRemote?.remote.name}
            branchLabelRemote="short"
            trigger={
              <ComboboxTrigger className="flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-left outline-none">
                <div className="flex flex-col gap-0.5 text-left text-sm">
                  <span className="text-xs text-foreground-passive">Base Branch</span>
                  <span className="flex items-center gap-1">
                    <GitBranch
                      absoluteStrokeWidth
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-foreground-muted"
                    />
                    <ComboboxValue placeholder="Select a base branch" />
                  </span>
                </div>
                <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
              </ComboboxTrigger>
            }
          />
        </div>
        <Separator />
        <FieldGroup>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              placeholder="PR title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!hasGitHubRemote}
            />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={1}
              disabled={!hasGitHubRemote}
            />
          </Field>
        </FieldGroup>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Failed to create pull request</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContentArea>
      <DialogFooter>
        {needsPush ? (
          <SplitButton
            size="sm"
            loading={isCreating}
            loadingLabel="Creating..."
            disabled={!hasGitHubRemote || !selectedBase?.branch || !title.trim()}
            actions={[
              {
                value: 'push-and-create',
                label: draft ? 'Push & Create Draft' : 'Push & Create PR',
                action: () => void doCreate(true),
              },
              {
                value: 'create-only',
                label: draft ? 'Create Draft' : 'Create PR',
                description: 'Skip push and open a PR from the current remote state',
                action: () => void doCreate(false),
              },
            ]}
          />
        ) : (
          <ConfirmButton
            size="sm"
            onClick={() => void doCreate(false)}
            disabled={!hasGitHubRemote || !selectedBase?.branch || !title.trim() || isCreating}
          >
            {isCreating ? 'Creating...' : draft ? 'Create Draft' : 'Create PR'}
          </ConfirmButton>
        )}
      </DialogFooter>
    </div>
  );
});

export const createPrModal = defineModal<void>()({
  id: 'createPrModal',
  component: CreatePrModal,
  size: 'md',
});
