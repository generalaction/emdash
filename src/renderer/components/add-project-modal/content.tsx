import { Tabs } from '@base-ui/react/tabs';
import { Folder, Github, Plus } from 'lucide-react';
import { useState } from 'react';
import { useShowModal } from '@renderer/contexts/ModalProvider';
import { SshConnectionSelector } from '../ssh/ssh-connection-selector';
import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { Mode } from './add-project-modal';
import { ButtonCard } from './button-card';
import { LocalDirectorySelector } from './local-directory-selector';
import { NewRepositoryConfig } from './new-repository-config';

export function AddLocalProjectContent({ mode: initialMode }: { mode?: Mode }) {
  const [path, setPath] = useState<string>('');
  const [mode, setMode] = useState<Mode>(initialMode || 'pick');
  const [name, setName] = useState<string>('');

  const [repositoryName, setRepositoryName] = useState<string>('');
  const [repositoryVisibility, setRepositoryVisibility] = useState<'public' | 'private'>('public');

  const [repositoryUrl, setRepositoryUrl] = useState<string>('');
  return (
    <>
      <Label>Add a local project</Label>
      <Tabs.Root value={mode} onValueChange={setMode} defaultValue="pick" className="space-y-4">
        <AddProjectModeTabs />
        <Tabs.Panel value="pick" className="space-y-4">
          <Field>
            <FieldLabel>Project Directory</FieldLabel>
            <LocalDirectorySelector
              path={path}
              onPathChange={setPath}
              title="Select a local project"
              message="Select a project directory to open"
            />
          </Field>
          <Field>
            <FieldLabel>Project Name</FieldLabel>
            <Input
              placeholder="Enter a project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Tabs.Panel>
        <Tabs.Panel value="new" className="space-y-4">
          <NewRepositoryConfig
            path={path}
            onPathChange={setPath}
            name={name}
            onNameChange={setName}
            repositoryName={repositoryName}
            onRepositoryNameChange={setRepositoryName}
            repositoryVisibility={repositoryVisibility}
            onRepositoryVisibilityChange={setRepositoryVisibility}
          />
        </Tabs.Panel>
        <Tabs.Panel value="clone" className="space-y-4">
          <Field>
            <FieldLabel>Repository URL</FieldLabel>
            <Input
              placeholder="Enter a repository URL"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Project Directory</FieldLabel>
            <LocalDirectorySelector
              onPathChange={setPath}
              title="Select a local project"
              message="Select a project directory to open"
            />
          </Field>
          <Field>
            <FieldLabel>Project Name</FieldLabel>
            <Input
              placeholder="Enter a project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}

function AddProjectModeTabs() {
  return (
    <Tabs.List className="w-full flex gap-2">
      <Tabs.Tab
        value="pick"
        render={
          <ButtonCard>
            <Folder className="size-6" />
            Pick existing
          </ButtonCard>
        }
      />
      <Tabs.Tab
        value="new"
        render={
          <ButtonCard>
            <Plus className="size-6" />
            New
          </ButtonCard>
        }
      />
      <Tabs.Tab
        value="clone"
        render={
          <ButtonCard>
            <Github className="size-6" />
            Clone
          </ButtonCard>
        }
      />
    </Tabs.List>
  );
}

export function AddSshProjectContent({
  mode: initialMode,
  name: initialName,
  connectionId: initialConnectionId,
}: {
  mode?: Mode;
  name?: string;
  connectionId?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode || 'pick');
  const [name, setName] = useState<string>(initialName || '');
  const [connectionId, setConnectionId] = useState<string | undefined>(initialConnectionId);

  const showAddSshConnModal = useShowModal('addSshConnModal');

  const handleConnectionChange = (connectionId: string) => {
    setConnectionId(connectionId);
  };

  const showAddProjectModal = useShowModal('addProjectModal');

  const handleAddConnection = () => {
    const restoreModal = () => {
      showAddProjectModal({
        type: 'ssh',
        mode,
        data: {
          name,
          connectionId,
        },
      });
    };
    showAddSshConnModal({
      onSuccess: ({ connectionId }) => {
        handleConnectionChange(connectionId);
        restoreModal();
      },
      onClose: () => {
        restoreModal();
      },
    });
  };
  return (
    <>
      <Field>
        <FieldLabel>Select a SSH Connection</FieldLabel>
        <SshConnectionSelector
          connectionId={connectionId}
          onConnectionIdChange={handleConnectionChange}
          onAddConnection={handleAddConnection}
        />
      </Field>
      <Tabs.Root value={mode} onValueChange={setMode} defaultValue="pick" className="space-y-4">
        <AddProjectModeTabs />
        <Tabs.Panel value="pick" className="space-y-4">
          <Field>
            <FieldLabel>Project Name</FieldLabel>
            <Input
              placeholder="Enter a project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Tabs.Panel>
        <Tabs.Panel value="clone" className="space-y-4">
          <Field>
            <FieldLabel>Project Name</FieldLabel>
            <Input
              placeholder="Enter a project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Tabs.Panel>
        <Tabs.Panel value="new" className="space-y-4">
          <Field>
            <FieldLabel>Project Name</FieldLabel>
            <Input
              placeholder="Enter a project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}
