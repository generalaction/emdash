import { ChevronsUpDownIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  getProjectSettingsStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useGitHubRepositoryOwnerSelect } from '@renderer/lib/hooks/useGithubRepositoryOwners';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover } from '@renderer/lib/ui/combobox-popover';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

export type AddRemoteModalArgs = {
  projectId: string;
  projectName: string;
  branchName: string;
  workspaceId: string;
};

type Props = BaseModalProps<void> & AddRemoteModalArgs;
type Tab = 'create' | 'link';

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export const AddRemoteModal = observer(function AddRemoteModal({
  projectId,
  projectName,
  workspaceId,
  branchName,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<Tab>('create');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [repositoryName, setRepositoryName] = useState(projectName);
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [url, setUrl] = useState('');

  const settingsStore = getProjectSettingsStore(projectId);
  const rawGitHubAccountId = settingsStore?.settings?.githubAccountId ?? null;
  const githubAccountId =
    typeof rawGitHubAccountId === 'string' && rawGitHubAccountId.trim().length > 0
      ? rawGitHubAccountId.trim()
      : null;
  const settingsError = settingsStore?.pageData.error ?? null;
  const settingsLoading =
    !!settingsStore && settingsStore.pageData.data === null && settingsError === null;

  const {
    owners,
    owner,
    isLoading: ownersLoading,
    errorMessage: ownersErrorMessage,
    handleOwnerChange,
  } = useGitHubRepositoryOwnerSelect(githubAccountId);
  const selectedRemote = getRepositoryStore(projectId)?.pushRemote.name ?? 'origin';
  const canSubmitCreateRepository =
    githubAccountId !== null &&
    !settingsLoading &&
    !ownersLoading &&
    !settingsError &&
    !ownersErrorMessage &&
    repositoryName.trim().length > 0 &&
    !!owner;
  const isValid = tab === 'create' ? canSubmitCreateRepository : url.trim().length > 0;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (tab === 'create') {
        if (!githubAccountId) {
          setError(
            'Select a GitHub account in project settings before creating a GitHub repository'
          );
          return;
        }
        if (!owner) {
          setError(ownersErrorMessage ?? 'No repository owner available');
          return;
        }

        const result = await rpc.github.createRepository({
          name: repositoryName.trim(),
          owner: owner.value,
          isPrivate: visibility === 'private',
          accountId: githubAccountId,
        });

        if (!result.success) {
          setError(result.error ?? 'Failed to create repository');
          return;
        }

        if (!result.repoUrl) {
          setError('Created repository did not include a remote URL');
          return;
        }

        const addRemoteResult = await rpc.repository.addRemote(
          projectId,
          selectedRemote,
          result.repoUrl
        );

        if (!addRemoteResult.success) {
          setError(toErrorMessage(addRemoteResult.error, 'Failed to add remote'));
          return;
        }
      } else {
        const addRemoteResult = await rpc.repository.addRemote(
          projectId,
          selectedRemote,
          url.trim()
        );

        if (!addRemoteResult.success) {
          setError(toErrorMessage(addRemoteResult.error, 'Failed to add remote'));
          return;
        }
      }

      const fetchResult = await rpc.repository.fetch(projectId);
      if (!fetchResult.success) {
        setError(toErrorMessage(fetchResult.error, 'Failed to fetch remote'));
        return;
      }

      const publishResult = await rpc.workspace.git.publishBranch(
        projectId,
        workspaceId,
        branchName,
        selectedRemote
      );
      if (!publishResult.success) {
        if (publishResult.error.type === 'rejected') {
          const repositoryStore = getRepositoryStore(projectId);
          repositoryStore?.refreshLocal();
          repositoryStore?.refreshRemote();
          setError(
            'Remote already has commits. Linking succeeded, but integrating histories must be resolved manually.'
          );
          return;
        }
        setError(toErrorMessage(publishResult.error, 'Failed to publish branch'));
        return;
      }

      const repositoryStore = getRepositoryStore(projectId);
      repositoryStore?.refreshLocal();
      repositoryStore?.refreshRemote();
      onSuccess();
    } catch (e) {
      setError(toErrorMessage(e, 'An error occurred'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>Add Remote</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
            {isSubmitting ? 'Adding...' : tab === 'create' ? 'Create & Publish' : 'Link & Publish'}
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea className="gap-4">
        <ToggleGroup
          className="w-full"
          value={[tab]}
          onValueChange={([v]) => {
            if (v) setTab(v as Tab);
          }}
        >
          <ToggleGroupItem className="flex-1" value="create">
            Create Repository
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="link">
            Link Existing
          </ToggleGroupItem>
        </ToggleGroup>

        {tab === 'create' && (
          <FieldGroup>
            <Field>
              <FieldLabel>Repository Name</FieldLabel>
              <Input
                autoFocus
                value={repositoryName}
                onChange={(e) => setRepositoryName(e.target.value)}
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
                items={owners}
                defaultValue={owner}
                value={owner}
                onValueChange={handleOwnerChange}
              />
              {githubAccountId === null && !settingsLoading && !settingsError && (
                <p className="text-muted-foreground text-xs">
                  Select a GitHub account in project settings before creating a GitHub repository.
                </p>
              )}
              {settingsError && <p className="text-destructive text-xs">{settingsError}</p>}
              {ownersErrorMessage && (
                <p className="text-destructive text-xs">{ownersErrorMessage}</p>
              )}
            </Field>
            <Field>
              <FieldLabel>Visibility</FieldLabel>
              <RadioGroup
                value={visibility}
                onValueChange={(v) => setVisibility(v as 'public' | 'private')}
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
        )}

        {tab === 'link' && (
          <FieldGroup>
            <Field>
              <FieldLabel>Remote URL</FieldLabel>
              <Input
                autoFocus
                placeholder="https://git.example.com/owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
          </FieldGroup>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </DialogContentArea>
    </ModalLayout>
  );
});
