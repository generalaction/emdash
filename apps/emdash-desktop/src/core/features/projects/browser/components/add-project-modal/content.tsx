import { ChevronsUpDownIcon } from 'lucide-react';
import { useId } from 'react';
import { GithubAuthDisclaimer } from '@core/features/integrations/api/browser/components/github-auth-disclaimer';
import { ComboboxTrigger, ComboboxValue } from '@core/primitives/ui/browser/combobox';
import { ComboboxPopover } from '@core/primitives/ui/browser/combobox-popover';
import { Field, FieldGroup, FieldLabel } from '@core/primitives/ui/browser/field';
import { Input } from '@core/primitives/ui/browser/input';
import { Label } from '@core/primitives/ui/browser/label';
import { RadioGroup, RadioGroupItem } from '@core/primitives/ui/browser/radio-group';
import { Separator } from '@core/primitives/ui/browser/separator';
import { Switch } from '@core/primitives/ui/browser/switch';
import { type Strategy } from './add-project-modal';
import { LocalDirectorySelector } from './local-directory-selector';
import { type CloneModeState, type NewModeState, type PickModeState } from './modes';
import { RemoteDirectorySelector } from './remote-directory-selector';

export function PickExistingPanel({
  strategy,
  connectionId,
  state,
  inspectionError,
  showInitializeGitPrompt,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: PickModeState;
  inspectionError?: string;
  showInitializeGitPrompt: boolean;
}) {
  const nameId = useId();
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Directory</FieldLabel>
        {strategy === 'local' ? (
          <LocalDirectorySelector
            path={state.path}
            onPathChange={state.handlePathChange}
            title="Select a local project"
            message="Select a project directory to open"
          />
        ) : (
          <RemoteDirectorySelector
            connectionId={connectionId}
            value={state.path}
            onChange={state.handlePathChange}
          />
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          id={nameId}
          placeholder="Enter a project name"
          value={state.name}
          onChange={(e) => state.handleNameChange(e.target.value)}
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
  showGithubAuthDisclaimer,
  onOpenAccountSettings,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: NewModeState;
  showGithubAuthDisclaimer: boolean;
  onOpenAccountSettings: () => void;
}) {
  const repositoryNameId = useId();
  const projectNameId = useId();

  if (showGithubAuthDisclaimer) {
    return <GithubAuthDisclaimer onOpenAccountSettings={onOpenAccountSettings} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={repositoryNameId}>Repository Name</FieldLabel>
          <Input
            id={repositoryNameId}
            autoFocus
            placeholder="Enter a repository name"
            value={state.repositoryName}
            onChange={(e) => state.handleRepositoryNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Owner</FieldLabel>
          <ComboboxPopover
            trigger={
              <ComboboxTrigger
                render={
                  <button className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
                    <ComboboxValue />
                    <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
                  </button>
                }
              />
            }
            items={state.owners}
            defaultValue={state.repositoryOwner}
            value={state.repositoryOwner ?? null}
            onValueChange={state.handleOwnerChange}
          />
        </Field>
        <Field>
          <FieldLabel>Privacy</FieldLabel>
          <RadioGroup
            value={state.repositoryVisibility}
            onValueChange={(value) => state.setRepositoryVisibility(value as 'public' | 'private')}
          >
            <Label className="flex cursor-pointer items-center gap-3 font-normal">
              <RadioGroupItem value="private" />
              Private
            </Label>
            <Label className="flex cursor-pointer items-center gap-3 font-normal">
              <RadioGroupItem value="public" />
              Public
            </Label>
          </RadioGroup>
        </Field>
      </FieldGroup>
      <Separator className="w-full" />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={projectNameId}>Project Name</FieldLabel>
          <Input
            id={projectNameId}
            placeholder="Enter a project name"
            value={state.name}
            onChange={(e) => state.handleNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
          {strategy === 'local' ? (
            <LocalDirectorySelector
              path={state.path}
              onPathChange={state.setPath}
              title="Select a local project"
              message="Select a project directory to open"
            />
          ) : (
            <RemoteDirectorySelector
              connectionId={connectionId}
              value={state.path}
              onChange={state.setPath}
            />
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}

export function ClonePanel({
  strategy,
  connectionId,
  state,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: CloneModeState;
}) {
  const repositoryUrlId = useId();
  const projectNameId = useId();
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
          <FieldLabel htmlFor={projectNameId}>Project Name</FieldLabel>
          <Input
            id={projectNameId}
            placeholder="Enter a project name"
            value={state.name}
            onChange={(e) => state.handleNameChange(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
          {strategy === 'local' ? (
            <LocalDirectorySelector
              path={state.path}
              onPathChange={state.setPath}
              title="Select a local project"
              message="Select a project directory to open"
            />
          ) : (
            <RemoteDirectorySelector
              connectionId={connectionId}
              value={state.path}
              onChange={state.setPath}
            />
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}
