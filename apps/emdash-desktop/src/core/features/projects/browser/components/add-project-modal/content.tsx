import { SettingsRow } from '@emdash/ui/react/patterns';
import { Field, Input, Select, Separator, Switch } from '@emdash/ui/react/primitives';
import { useId } from 'react';
import { GitHubIdentityStrip } from '@core/features/github/contributions/browser/identity-strip';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { Resolved } from '@core/primitives/project-settings/api';
import { type Strategy } from './add-project-modal';
import { DirectoryField } from './local-directory-selector';
import { type CloneModeState, type NewModeState, type PickModeState } from './modes';
import { OwnerSelector } from './owner-selector';
import { type ProjectDirectoryPickerClient } from './project-directory-picker';

export function PickExistingPanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  inspectionError,
  showInitializeGitPrompt,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: PickModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  inspectionError?: string;
  showInitializeGitPrompt: boolean;
}) {
  return (
    <Field.Group>
      <Field.Root>
        <Field.Label>Directory</Field.Label>
        <DirectoryField
          strategy={strategy}
          connectionId={connectionId}
          path={state.path}
          onPathChange={state.handlePathChange}
          getProjectsClient={getProjectsClient}
          title="Select a local project"
          message="Select a project directory to open"
        />
      </Field.Root>
      {inspectionError && (
        <div className="border-destructive/40 overflow-hidden rounded-md border">
          <p className="border-destructive/30 bg-destructive/10 text-destructive border-b px-2 py-1 text-xs">
            Could not inspect this directory.
          </p>
          <p className="p-2 text-xs text-foreground-muted">{inspectionError}</p>
        </div>
      )}
      {showInitializeGitPrompt && (
        <div className="overflow-hidden rounded-md border border-border">
          <p className="border-b border-border bg-background-1 px-2 py-1 text-xs text-foreground-muted">
            This directory is not a git repository.
          </p>
          <div className="p-2">
            <Field.Root orientation="horizontal">
              <Switch
                checked={state.initGitRepository}
                onCheckedChange={state.setinitGitRepository}
              />
              <Field.Label>Initialize git repository</Field.Label>
            </Field.Root>
            <p className="mt-1.5 text-xs text-foreground-muted">
              You can also open this folder now and initialize Git later from the changes view.
            </p>
          </div>
        </div>
      )}
    </Field.Group>
  );
}

export function CreateNewPanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  accounts,
  selectedAccount,
  defaultAccount,
  onAccountChange,
  onConnectGithub,
  ensureDefaultRoot,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: NewModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  accounts: GitHubAccountSummary[];
  selectedAccount: GitHubAccountSummary | null;
  /** The default-account inference the strip shows when nothing is chosen. */
  defaultAccount: GitHubAccountSummary | null;
  onAccountChange: (accountId: string) => void;
  onConnectGithub: () => void;
  ensureDefaultRoot: boolean;
}) {
  const repositoryNameId = useId();

  // No project exists yet, so the strip previews the same inference the
  // resolver would make (the default account) instead of resolver output;
  // there is no per-project setting to remember into.
  const resolvedAccount: Resolved<GitHubAccountSummary | null> = {
    value: defaultAccount,
    provenance: { kind: 'inferred', from: 'default account' },
  };
  const overrideAccount =
    selectedAccount && selectedAccount.accountId !== defaultAccount?.accountId
      ? selectedAccount
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Field.Group>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,3fr)] items-end gap-2">
          <Field.Root className="min-w-0">
            <Field.Label>Owner</Field.Label>
            <OwnerSelector
              owners={state.owners}
              owner={state.repositoryOwner}
              accounts={accounts}
              selectedAccount={selectedAccount}
              onOwnerChange={state.handleOwnerChange}
              onAccountChange={onAccountChange}
            />
          </Field.Root>
          <span className="pb-2 text-sm text-foreground-muted">/</span>
          <Field.Root className="min-w-0">
            <Field.Label htmlFor={repositoryNameId}>Repository name</Field.Label>
            <Input
              id={repositoryNameId}
              autoFocus
              placeholder="Enter a repository name"
              value={state.repositoryName}
              onChange={(e) => state.handleRepositoryNameChange(e.target.value)}
            />
          </Field.Root>
        </div>
      </Field.Group>
      <Separator className="w-full" />
      <SettingsRow
        label="Choose visibility"
        description="Choose who can see and commit to this repository"
        control={
          <Select.Root
            value={state.repositoryVisibility}
            onValueChange={(value) => state.setRepositoryVisibility(value as 'public' | 'private')}
          >
            <Select.Trigger appearance="input" className="max-w-28 min-w-28">
              {state.repositoryVisibility === 'private' ? 'Private' : 'Public'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="private">Private</Select.Item>
              <Select.Item value="public">Public</Select.Item>
            </Select.Content>
          </Select.Root>
        }
      />
      <Separator className="w-full" />
      <Field.Group>
        <Field.Root>
          <Field.Label>
            {strategy === 'local' ? 'Project Directory' : 'Remote Directory'}
          </Field.Label>
          <DirectoryField
            strategy={strategy}
            connectionId={connectionId}
            path={state.path}
            onPathChange={state.setPath}
            getProjectsClient={getProjectsClient}
            ensureDefaultRoot={ensureDefaultRoot}
            title="Select a local project"
            message="Select a project directory to open"
          />
        </Field.Root>
      </Field.Group>
      <GitHubIdentityStrip
        action="Creating repository"
        resolved={resolvedAccount}
        accounts={accounts}
        override={overrideAccount}
        persistence="action-only"
        accountRequired
        onSelect={(account) => onAccountChange(account.accountId)}
        onConnect={onConnectGithub}
      />
    </div>
  );
}

export function ClonePanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  ensureDefaultRoot,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: CloneModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  ensureDefaultRoot: boolean;
}) {
  const repositoryUrlId = useId();
  return (
    <div className="flex flex-col gap-6">
      <Field.Group>
        <Field.Root>
          <Field.Label htmlFor={repositoryUrlId}>Repository URL</Field.Label>
          <Input
            id={repositoryUrlId}
            autoFocus
            placeholder="Enter a repository URL"
            value={state.repositoryUrl}
            onChange={(e) => state.handleRepositoryUrlChange(e.target.value)}
          />
        </Field.Root>
      </Field.Group>
      <Separator className="w-full" />
      <Field.Group>
        <Field.Root>
          <Field.Label>
            {strategy === 'local' ? 'Project Directory' : 'Remote Directory'}
          </Field.Label>
          <DirectoryField
            strategy={strategy}
            connectionId={connectionId}
            path={state.path}
            onPathChange={state.setPath}
            getProjectsClient={getProjectsClient}
            ensureDefaultRoot={ensureDefaultRoot}
            title="Select a local project"
            message="Select a project directory to open"
          />
        </Field.Root>
      </Field.Group>
    </div>
  );
}
