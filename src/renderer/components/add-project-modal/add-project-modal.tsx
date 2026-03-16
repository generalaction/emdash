import { useState } from 'react';
import { rpc } from '@renderer/core/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { SshConnectionSelector } from '../ssh/ssh-connection-selector';
import { Button } from '../ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldLabel } from '../ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ClonePanel, CreateNewPanel, PickExistingPanel } from './content';
import { ModeTabs } from './mode-tabs';
import { useCloneMode, useNewMode, usePickMode } from './modes';
import { usePendingProjectsContext } from './pending-projects-provider';

export type Strategy = 'local' | 'ssh';

export type Mode = 'pick' | 'new' | 'clone';

export interface BaseModeData {
  name: string;
  path: string;
}

export interface NewModeData extends BaseModeData {
  repositoryName: string;
  repositoryOwner: string;
  repositoryVisibility: 'public' | 'private';
}

export interface CloneModeData extends BaseModeData {
  repositoryUrl: string;
}

export type ModeData = BaseModeData | NewModeData | CloneModeData;

export interface AddProjectModalProps extends BaseModalProps<void> {
  strategy: Strategy;
  mode: Mode;
  connectionId?: string;
}

export function AddProjectModal({
  strategy: strategyProp,
  mode: modeProp,
  onClose,
  connectionId: connectionIdProp,
}: AddProjectModalProps) {
  const [strategy, setStrategy] = useState<Strategy>(strategyProp ?? 'local');
  const [mode, setMode] = useState<Mode>(modeProp ?? 'pick');
  const [connectionId, setConnectionId] = useState<string | undefined>(connectionIdProp);

  const { startPickProject, startNewProject, startCloneProject } = usePendingProjectsContext();
  const { navigate } = useNavigate();

  const showSshConnModal = useShowModal('addSshConnModal');
  const showAddProjectModal = useShowModal('addProjectModal');

  const handleAddConnection = () => {
    showSshConnModal({
      onSuccess: ({ connectionId: newId }) =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
          connectionId: newId,
        }),
      onClose: () =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
        }),
    });
  };

  const pickState = usePickMode();
  const newState = useNewMode();
  const cloneState = useCloneMode();

  const handleSubmit = async () => {
    try {
      if (strategy === 'local') {
        const project = await rpc.projects.getLocalProjectByPath(pickState.path);
        if (project) {
          navigate('project', { projectId: project.id });
          onClose();
          return;
        }
      }
      if (strategy === 'ssh') {
        const project = await rpc.projects.getSshProjectByPath(pickState.path, connectionId!);
        if (project) {
          navigate('project', { projectId: project.id });
          onClose();
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }

    const id = crypto.randomUUID();
    switch (mode) {
      case 'pick':
        startPickProject(id, { name: pickState.name, path: pickState.path });
        break;
      case 'new':
        startNewProject(id, {
          name: newState.name,
          path: newState.path,
          repositoryName: newState.repositoryName,
          repositoryOwner: newState.repositoryOwner?.value ?? '',
          repositoryVisibility: newState.repositoryVisibility,
        });
        break;
      case 'clone':
        startCloneProject(id, {
          name: cloneState.name,
          path: cloneState.path,
          repositoryUrl: cloneState.repositoryUrl,
        });
        break;
    }
    onClose();
    navigate('project', { projectId: id });
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Project</DialogTitle>
      </DialogHeader>
      <Tabs
        value={strategy}
        onValueChange={(v) => setStrategy(v as Strategy)}
        className="flex flex-col space-y-4"
      >
        <TabsList>
          <TabsTrigger value="local">Local</TabsTrigger>
          <TabsTrigger value="ssh">SSH</TabsTrigger>
        </TabsList>
        <TabsContent value="local" className="flex flex-col gap-4">
          <ModeTabs mode={mode} onModeChange={setMode}>
            <PickExistingPanel strategy={'local'} state={pickState} />
            <CreateNewPanel strategy={'local'} state={newState} />
            <ClonePanel strategy={'local'} state={cloneState} />
          </ModeTabs>
        </TabsContent>
        <TabsContent value="ssh" className="flex flex-col gap-6">
          <Field>
            <FieldLabel>SSH Connection</FieldLabel>
            <SshConnectionSelector
              connectionId={connectionId}
              onConnectionIdChange={setConnectionId}
              onAddConnection={handleAddConnection}
            />
          </Field>
          <ModeTabs mode={mode} onModeChange={setMode}>
            <PickExistingPanel strategy={'ssh'} connectionId={connectionId} state={pickState} />
            <CreateNewPanel strategy={'ssh'} connectionId={connectionId} state={newState} />
            <ClonePanel strategy={'ssh'} connectionId={connectionId} state={cloneState} />
          </ModeTabs>
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button type="button" onClick={handleSubmit}>
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
