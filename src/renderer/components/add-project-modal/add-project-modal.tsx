import { Home, Server } from 'lucide-react';
import { useState } from 'react';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { rpc } from '@renderer/core/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/core/modal/modal-provider';
import { getProjectManagerStore } from '@renderer/core/stores/project-selectors';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { SshConnectionSelector } from '../ssh/ssh-connection-selector';
import { ConfirmButton } from '../ui/confirm-button';
import { DialogContentArea, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldLabel } from '../ui/field';
import { ModalLayout } from '../ui/modal-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { ClonePanel, CreateNewPanel, PickExistingPanel } from './content';
import { useCloneMode, useNewMode, usePickMode } from './modes';

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
  strategy?: Strategy;
  mode?: Mode;
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

  const { value: localProjectSettings } = useAppSettingsKey('localProject');
  const defaultPath =
    strategy === 'local' ? (localProjectSettings?.defaultProjectsDirectory ?? '') : '';

  const pickState = usePickMode();
  const newState = useNewMode(defaultPath);
  const cloneState = useCloneMode(defaultPath);

  const activeMode = { pick: pickState, new: newState, clone: cloneState }[mode];
  const canCreate = activeMode.isValid && (strategy === 'local' || !!connectionId);

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
    const projectType =
      strategy === 'ssh' && connectionId
        ? { type: 'ssh' as const, connectionId }
        : { type: 'local' as const };

    switch (mode) {
      case 'pick':
        void getProjectManagerStore().createProject(
          projectType,
          { mode: 'pick', name: pickState.name, path: pickState.path },
          id
        );
        break;
      case 'new':
        void getProjectManagerStore().createProject(
          projectType,
          {
            mode: 'new',
            name: newState.name,
            path: newState.path,
            repositoryName: newState.repositoryName,
            repositoryOwner: newState.repositoryOwner?.value ?? '',
            repositoryVisibility: newState.repositoryVisibility,
          },
          id
        );
        break;
      case 'clone':
        void getProjectManagerStore().createProject(
          projectType,
          {
            mode: 'clone',
            name: cloneState.name,
            path: cloneState.path,
            repositoryUrl: cloneState.repositoryUrl,
          },
          id
        );
        break;
    }
    onClose();
    navigate('project', { projectId: id });
  };

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <ConfirmButton type="button" onClick={() => void handleSubmit()} disabled={!canCreate}>
            Create
          </ConfirmButton>
        </DialogFooter>
      }
    >
      <DialogContentArea className="gap-4">
        <div className="flex items-center gap-2">
          <ToggleGroup
            className="w-full flex-1"
            value={[mode]}
            onValueChange={([value]) => {
              if (value) setMode(value as Mode);
            }}
          >
            <ToggleGroupItem value="pick" className="flex-1">
              Pick
            </ToggleGroupItem>
            <ToggleGroupItem value="new" className="flex-1">
              New
            </ToggleGroupItem>
            <ToggleGroupItem value="clone" className="flex-1">
              Clone
            </ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={strategy}
            onValueChange={(value) => {
              if (value) setStrategy(value as Strategy);
            }}
          >
            <SelectTrigger>
              <span className="flex items-center gap-2">
                {strategy === 'local' ? (
                  <Home className="size-3.5 shrink-0 text-foreground-muted" />
                ) : (
                  <Server className="size-3.5 shrink-0 text-foreground-muted" />
                )}
                <SelectValue placeholder="Select a strategy" />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local</SelectItem>
              <SelectItem value="ssh">SSH</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {strategy === 'ssh' && (
          <Field>
            <FieldLabel>SSH Connection</FieldLabel>
            <SshConnectionSelector
              connectionId={connectionId}
              onConnectionIdChange={setConnectionId}
              onAddConnection={handleAddConnection}
            />
          </Field>
        )}
        {mode === 'pick' && (
          <PickExistingPanel strategy={strategy} connectionId={connectionId} state={pickState} />
        )}
        {mode === 'new' && (
          <CreateNewPanel strategy={strategy} connectionId={connectionId} state={newState} />
        )}
        {mode === 'clone' && (
          <ClonePanel strategy={strategy} connectionId={connectionId} state={cloneState} />
        )}
      </DialogContentArea>
    </ModalLayout>
  );
}
