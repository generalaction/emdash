import { SettingsRow } from '@emdash/ui/react/patterns';
import { Input, Select, Separator } from '@emdash/ui/react/primitives';
import { useId } from 'react';
import { GithubAuthDisclaimer } from '@core/features/integrations/api/browser/components/github-auth-disclaimer';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import { Field, FieldGroup, FieldLabel } from '@core/primitives/ui/browser/field';
import { Switch } from '@core/primitives/ui/browser/switch';
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
    <FieldGroup>
      <Field>
        <FieldLabel>Directory</FieldLabel>
        <DirectoryField
          strategy={strategy}
          connectionId={connectionId}
          path={state.path}
          onPathChange={state.handlePathChange}
          getProjectsClient={getProjectsClient}
          title="Select a local project"
          message="Select a project directory to open"
        />
      </Field>
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
            <Field orientation="horizontal">
              <Switch
                checked={state.initGitRepository}
                onCheckedChange={state.setinitGitRepository}
              />
              <FieldLabel>Initialize git repository</FieldLabel>
            </Field>
            <p className="mt-1.5 text-xs text-foreground-muted">
              You can also open this folder now and initialize Git later from the changes view.
            </p>
          </div>
        </div>
      )}
    </FieldGroup>
  );
}

export function CreateNewPanel({
  strategy,
  connectionId,
  state,
  getProjectsClient,
  showGithubAuthDisclaimer,
  accounts,
  selectedAccount,
  onAccountChange,
  onOpenAccountSettings,
  ensureDefaultRoot,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: NewModeState;
  getProjectsClient(): Promise<ProjectDirectoryPickerClient>;
  showGithubAuthDisclaimer: boolean;
  accounts: GitHubAccountSummary[];
  selectedAccount: GitHubAccountSummary | null;
  onAccountChange: (accountId: string) => void;
  onOpenAccountSettings: () => void;
  ensureDefaultRoot: boolean;
}) {
  const repositoryNameId = useId();

  if (showGithubAuthDisclaimer) {
    return <GithubAuthDisclaimer onOpenAccountSettings={onOpenAccountSettings} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <div className="flex items-end gap-2">
          <Field className="w-1/4 min-w-0">
            <FieldLabel>Owner</FieldLabel>
            <OwnerSelector
              owners={state.owners}
              owner={state.repositoryOwner}
              accounts={accounts}
              selectedAccount={selectedAccount}
              onOwnerChange={state.handleOwnerChange}
              onAccountChange={onAccountChange}
            />
          </Field>
          <span className="pb-2 text-sm text-foreground-muted">/</span>
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={repositoryNameId}>Repository name</FieldLabel>
            <Input
              id={repositoryNameId}
              autoFocus
              placeholder="Enter a repository name"
              value={state.repositoryName}
              onChange={(e) => state.handleRepositoryNameChange(e.target.value)}
            />
          </Field>
        </div>
      </FieldGroup>
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
      <FieldGroup>
        <Field>
          <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
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
        </Field>
      </FieldGroup>
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
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={repositoryUrlId}>Repository URL</FieldLabel>
          <Input
            id={repositoryUrlId}
            autoFocus
            placeholder="Enter a repository URL"
            value={state.repositoryUrl}
            onChange={(e) => state.handleRepositoryUrlChange(e.target.value)}
          />
        </Field>
      </FieldGroup>
      <Separator className="w-full" />
      <FieldGroup>
        <Field>
          <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
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
        </Field>
      </FieldGroup>
    </div>
  );
}
