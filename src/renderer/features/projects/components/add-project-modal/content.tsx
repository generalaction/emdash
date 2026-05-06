import { ChevronsUpDownIcon } from 'lucide-react';
import { GithubAuthDisclaimer } from '@renderer/features/integrations/components/github-auth-disclaimer';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover } from '@renderer/lib/ui/combobox-popover';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { type Strategy } from './add-project-modal';
import { LocalDirectorySelector } from './local-directory-selector';
import { type CloneModeState, type NewModeState, type PickModeState } from './modes';
import { RemoteDirectorySelector } from './remote-directory-selector';

export function PickExistingPanel({
  strategy,
  connectionId,
  state,
  showInitializeGitPrompt,
}: {
  strategy: Strategy;
  connectionId?: string;
  state: PickModeState;
  showInitializeGitPrompt: boolean;
}) {
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
        <FieldLabel>Name</FieldLabel>
        <Input
          placeholder="Enter a project name"
          value={state.name}
          onChange={(e) => state.handleNameChange(e.target.value)}
        />
      </Field>
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
  if (showGithubAuthDisclaimer) {
    return <GithubAuthDisclaimer onOpenAccountSettings={onOpenAccountSettings} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel>Repository Name</FieldLabel>
          <Input
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
                    <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
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
            <div className="flex items-center gap-3">
              <RadioGroupItem value="private" />
              <Label className="cursor-pointer font-normal">Private</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="public" />
              <Label className="cursor-pointer font-normal">Public</Label>
            </div>
          </RadioGroup>
        </Field>
      </FieldGroup>
      <Separator className="w-full" />
      <FieldGroup>
        <Field>
          <FieldLabel>Project Name</FieldLabel>
          <Input
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
  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel>Repository URL</FieldLabel>
          <Input
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
          <FieldLabel>Project Name</FieldLabel>
          <Input
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
