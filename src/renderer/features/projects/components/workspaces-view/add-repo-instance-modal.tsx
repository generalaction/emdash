import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cloud, FolderOpen, Laptop, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { SshConnectionSelector } from '@renderer/features/projects/components/add-project-modal/ssh-connection-selector';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { OptionButtonCard } from '@renderer/lib/components/option-button-card';

export interface AddRepoInstanceModalProps {
  projectId: string;
}

type WorkspaceKind = 'worktree' | 'byoi';
type HostKind = 'local' | 'ssh';
type PathMode = 'existing' | 'clone';


function repoNameFromUrl(url: string): string {
  try {
    return url.replace(/\.git$/, '').split('/').filter(Boolean).at(-1) ?? '';
  } catch {
    return '';
  }
}

export const AddRepoInstanceModal = observer(function AddRepoInstanceModal({
  projectId,
  onSuccess,
  onClose,
}: AddRepoInstanceModalProps & BaseModalProps<void>) {
  const repo = getRepositoryStore(projectId);
  const defaultCloneUrl = repo?.canonicalRepositoryUrl ?? repo?.baseRemote.url ?? '';

  const [workspaceKind, setWorkspaceKind] = useState<WorkspaceKind>('worktree');
  const [hostKind, setHostKind] = useState<HostKind>('local');
  const [pathMode, setPathMode] = useState<PathMode>('existing');
  const [connectionId, setConnectionId] = useState<string | undefined>(undefined);

  // "Existing" mode state
  const [existingPath, setExistingPath] = useState('');

  // "Clone" mode state
  const [cloneUrl, setCloneUrl] = useState(defaultCloneUrl);
  const [cloneParentDir, setCloneParentDir] = useState('');

  const [label, setLabel] = useState('');
  const [isFork, setIsFork] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const showSshConnModal = useShowModal('addSshConnModal');
  const showSelf = useShowModal('addRepoInstanceModal');
  const queryClient = useQueryClient();

  const cloneRepoName = useMemo(() => repoNameFromUrl(cloneUrl), [cloneUrl]);
  const cloneTargetPath = useMemo(() => {
    if (!cloneParentDir.trim() || !cloneRepoName) return '';
    const parent = cloneParentDir.trim().replace(/\/+$/, '');
    return `${parent}/${cloneRepoName}`;
  }, [cloneParentDir, cloneRepoName]);

  const effectivePath = pathMode === 'clone' ? cloneTargetPath : existingPath;

  const handleAddSshConnection = () => {
    showSshConnModal({
      onSuccess: (result: unknown) => {
        const newId = (result as { connectionId: string }).connectionId;
        setConnectionId(newId);
        showSelf({ projectId });
      },
      onClose: () => showSelf({ projectId }),
    });
  };

  const handleEditSshConnection = (_id: string) => {
    showSshConnModal({
      onSuccess: () => showSelf({ projectId }),
      onClose: () => showSelf({ projectId }),
    });
  };

  const handleBrowse = async () => {
    const selected = await rpc.app.openSelectDirectoryDialog({
      title: 'Select repository directory',
      message: 'Choose the root directory of the git repository',
    });
    if (selected) setExistingPath(selected);
  };

  const handleBrowseParent = async () => {
    const selected = await rpc.app.openSelectDirectoryDialog({
      title: 'Select parent directory',
      message: 'Choose the directory where the repository will be cloned into',
    });
    if (selected) setCloneParentDir(selected);
  };

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      rpc.projects.addRepoInstance({
        projectId,
        label: label.trim() || undefined,
        kind: workspaceKind === 'byoi' ? 'byoi' : hostKind,
        connectionId: hostKind === 'ssh' && workspaceKind === 'worktree' ? connectionId : undefined,
        path: workspaceKind === 'worktree' ? effectivePath || undefined : undefined,
        cloneUrl: pathMode === 'clone' && cloneUrl.trim() ? cloneUrl.trim() : undefined,
        remoteUrl: isFork && remoteUrl.trim() ? remoteUrl.trim() : undefined,
        isFork,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['listRepoInstances', projectId] });
      onSuccess();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const canSave = (() => {
    if (workspaceKind === 'byoi') return true;
    if (hostKind === 'ssh' && !connectionId) return false;
    if (pathMode === 'existing') return effectivePath.trim().length > 0;
    return cloneUrl.trim().length > 0 && cloneParentDir.trim().length > 0;
  })();

  const submitLabel = (() => {
    if (isPending) return pathMode === 'clone' ? 'Cloning…' : 'Adding…';
    return pathMode === 'clone' ? 'Clone & add repository' : 'Add repository';
  })();

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <ConfirmButton
            onClick={() => {
              setError(null);
              save();
            }}
            disabled={isPending || !canSave}
          >
            {submitLabel}
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea className="flex flex-col gap-4">
        {/* Step 1: workspace kind */}
        <Field>
          <FieldLabel>Workspace type</FieldLabel>
          <div className="flex gap-2">
            <OptionButtonCard
              active={workspaceKind === 'worktree'}
              onClick={() => setWorkspaceKind('worktree')}
              icon={<FolderOpen className="size-4" />}
              title="Worktree"
              description="Create task worktrees in a git repository"
            />
            <OptionButtonCard
              active={workspaceKind === 'byoi'}
              onClick={() => setWorkspaceKind('byoi')}
              icon={<Cloud className="size-4" />}
              title="Sandbox"
              description="Provision a workspace per task via script"
            />
          </div>
        </Field>

        {workspaceKind === 'worktree' && (
          <>
            {/* Step 2: host kind */}
            <Field>
              <FieldLabel>Location</FieldLabel>
              <div className="flex gap-2">
                <OptionButtonCard
                  active={hostKind === 'local'}
                  onClick={() => setHostKind('local')}
                  icon={<Laptop className="size-4" />}
                  title="Local machine"
                  description="A clone of the repository on this machine"
                />
                <OptionButtonCard
                  active={hostKind === 'ssh'}
                  onClick={() => setHostKind('ssh')}
                  icon={<Server className="size-4" />}
                  title="Remote (SSH)"
                  description="A clone on a remote machine"
                />
              </div>
            </Field>

            {/* SSH connection picker */}
            {hostKind === 'ssh' && (
              <Field>
                <FieldLabel>SSH connection</FieldLabel>
                <SshConnectionSelector
                  connectionId={connectionId}
                  onConnectionIdChange={setConnectionId}
                  onAddConnection={handleAddSshConnection}
                  onEditConnection={handleEditSshConnection}
                />
              </Field>
            )}

            {/* Step 3: existing path or clone */}
            <Field>
              <FieldLabel>Repository</FieldLabel>
              <ToggleGroup
                className="w-full gap-1 border-none bg-transparent"
                value={[pathMode]}
                onValueChange={([v]) => {
                  if (v) setPathMode(v as PathMode);
                }}
              >
                <ToggleGroupItem
                  className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
                  value="existing"
                >
                  Use existing path
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
                  value="clone"
                >
                  Clone repository
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {pathMode === 'existing' ? (
              <Field>
                <FieldLabel>Repository path</FieldLabel>
                {hostKind === 'local' ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="/Users/me/repos/my-project"
                      value={existingPath}
                      onChange={(e) => setExistingPath(e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={() => void handleBrowse()}>
                      Browse
                    </Button>
                  </div>
                ) : (
                  <Input
                    placeholder="/home/user/repos/my-project"
                    value={existingPath}
                    onChange={(e) => setExistingPath(e.target.value)}
                  />
                )}
                <FieldDescription>
                  {hostKind === 'local'
                    ? 'Absolute path to the root of an existing git repository on this machine'
                    : 'Absolute path to the root of an existing git repository on the remote machine'}
                </FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel>Clone URL</FieldLabel>
                  <Input
                    placeholder="https://github.com/owner/repo.git"
                    value={cloneUrl}
                    onChange={(e) => setCloneUrl(e.target.value)}
                  />
                  <FieldDescription>
                    The URL to clone from. Defaults to the project&apos;s primary remote.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Clone into directory</FieldLabel>
                  {hostKind === 'local' ? (
                    <div className="flex gap-2">
                      <Input
                        placeholder="/Users/me/repos"
                        value={cloneParentDir}
                        onChange={(e) => setCloneParentDir(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleBrowseParent()}
                      >
                        Browse
                      </Button>
                    </div>
                  ) : (
                    <Input
                      placeholder="/home/user/repos"
                      value={cloneParentDir}
                      onChange={(e) => setCloneParentDir(e.target.value)}
                    />
                  )}
                  {cloneTargetPath && (
                    <FieldDescription>
                      Will clone into:{' '}
                      <code className="rounded bg-background-2 px-1 py-0.5 font-mono text-xs">
                        {cloneTargetPath}
                      </code>
                    </FieldDescription>
                  )}
                </Field>
              </>
            )}

            {/* Fork toggle */}
            <Field orientation="horizontal">
              <input
                type="checkbox"
                id="is-fork"
                checked={isFork}
                onChange={(e) => setIsFork(e.target.checked)}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <FieldLabel htmlFor="is-fork">This repository is a fork</FieldLabel>
            </Field>

            {isFork && (
              <Field>
                <FieldLabel>Fork remote URL</FieldLabel>
                <Input
                  placeholder="https://github.com/myfork/repo"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
                <FieldDescription>
                  The remote URL of this fork (different from the primary remote)
                </FieldDescription>
              </Field>
            )}
          </>
        )}

        {workspaceKind === 'byoi' && (
          <p className="rounded-lg border border-border bg-background-1 px-3 py-2.5 text-sm text-foreground-muted">
            A sandbox workspace is provisioned per task using the provision command configured in
            your project settings.
          </p>
        )}

        {/* Optional label */}
        <Field>
          <FieldLabel>
            Label <span className="font-normal text-foreground-muted">(optional)</span>
          </FieldLabel>
          <Input
            placeholder={
              workspaceKind === 'byoi'
                ? 'Sandbox'
                : hostKind === 'ssh'
                  ? 'dev-server'
                  : 'local clone'
            }
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        {error && <FieldError>{error}</FieldError>}
      </DialogContentArea>
    </ModalLayout>
  );
});
