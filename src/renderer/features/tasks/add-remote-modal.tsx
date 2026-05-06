import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ComboboxPopover, type ComboboxSelectOption } from '@renderer/lib/ui/combobox-popover';
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

export function AddRemoteModal({
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
  const [selectedOwner, setSelectedOwner] = useState<ComboboxSelectOption | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [url, setUrl] = useState('');

  const { data } = useQuery({
    queryKey: ['owners'],
    queryFn: () => rpc.github.getOwners(),
  });
  const selectedRemote = getRepositoryStore(projectId)?.configuredRemote.name ?? 'origin';

  const owners = data?.owners?.map((o) => ({ value: o.login, label: o.login })) ?? [];
  const owner = selectedOwner ?? owners[0] ?? null;

  const isValid =
    tab === 'create' ? repositoryName.trim().length > 0 && !!owner : url.trim().length > 0;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (tab === 'create') {
        if (!owner) {
          setError('No repository owner available');
          return;
        }

        const result = await rpc.github.createRepository({
          name: repositoryName.trim(),
          owner: owner.value,
          isPrivate: visibility === 'private',
        });

        if (!result.success) {
          setError(result.error ?? 'Failed to create repository');
          return;
        }

        const cloneUrl = `https://github.com/${result.nameWithOwner}.git`;
        const addRemoteResult = await rpc.repository.addRemote(projectId, selectedRemote, cloneUrl);

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

      const publishResult = await rpc.git.publishBranch(
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
                        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    }
                  />
                }
                items={owners}
                defaultValue={owner}
                value={owner}
                onValueChange={setSelectedOwner}
              />
            </Field>
            <Field>
              <FieldLabel>Visibility</FieldLabel>
              <RadioGroup
                value={visibility}
                onValueChange={(v) => setVisibility(v as 'public' | 'private')}
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

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContentArea>
    </ModalLayout>
  );
}
