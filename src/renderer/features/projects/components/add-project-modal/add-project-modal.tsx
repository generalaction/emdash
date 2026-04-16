import { useQuery } from '@tanstack/react-query';
import { Home, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { SshConnectionSelector } from '@renderer/features/projects/components/add-project-modal/ssh-connection-selector';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import { ClonePanel, CreateNewPanel, PickExistingPanel } from './content';
import { useCloneMode, useNewMode, usePickMode } from './modes';

export type Strategy = 'local' | 'ssh';

export type Mode = 'pick' | 'new' | 'clone';

export interface BaseModeData {
  name: string;
  path: string;
  initGitRepository?: boolean;
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

export const AddProjectModal = observer(function AddProjectModal({
  strategy: strategyProp,
  mode: modeProp,
  onClose,
  connectionId: connectionIdProp,
}: AddProjectModalProps) {
  const [strategy, setStrategy] = useState<Strategy>(strategyProp ?? 'local');
  const [mode, setMode] = useState<Mode>(modeProp ?? 'pick');
  const [connectionId, setConnectionId] = useState<string | undefined>(connectionIdProp);
  const { connections } = appState.sshConnections;
  const availableConnectionIds = useMemo(
    () =>
      connections.map((connection) => connection.id).filter((id): id is string => id !== undefined),
    [connections]
  );
  const selectedConnectionId =
    strategy === 'ssh' ? (connectionId ?? availableConnectionIds[0]) : connectionId;

  const { navigate } = useNavigate();
  const { isInitialized, needsGhAuth } = useGithubContext();

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
  const showGithubAuthDisclaimer = mode === 'new' && isInitialized && needsGhAuth;

  const activeMode = { pick: pickState, new: newState, clone: cloneState }[mode];
  const shouldCheckPickPathStatus =
    mode === 'pick' &&
    pickState.path.trim().length > 0 &&
    (strategy === 'local' || !!selectedConnectionId);
  const pickPathStatusQuery = useQuery({
    queryKey: ['projectPathStatus', strategy, selectedConnectionId, pickState.path],
    queryFn: () =>
      strategy === 'ssh'
        ? rpc.projects.getSshProjectPathStatus(pickState.path, selectedConnectionId!)
        : rpc.projects.getLocalProjectPathStatus(pickState.path),
    enabled: shouldCheckPickPathStatus,
  });
  const requiresGitInitialization =
    mode === 'pick' &&
    pickPathStatusQuery.data?.isDirectory === true &&
    pickPathStatusQuery.data.isGitRepo === false;
  const isCheckingPickPathStatus = shouldCheckPickPathStatus && pickPathStatusQuery.isPending;

  const canCreate =
    activeMode.isValid &&
    (strategy === 'local' || !!selectedConnectionId) &&
    !isCheckingPickPathStatus &&
    (!requiresGitInitialization || pickState.initGitRepository);

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
        const project = await rpc.projects.getSshProjectByPath(
          pickState.path,
          selectedConnectionId!
        );
        if (project) {
          navigate('project', { projectId: project.id });
          onClose();
          return;
        }
      }
    } catch (e) {
      log.error(e);
    }

    const id = crypto.randomUUID();
    const projectType =
      strategy === 'ssh' && selectedConnectionId
        ? { type: 'ssh' as const, connectionId: selectedConnectionId }
        : { type: 'local' as const };

    switch (mode) {
      case 'pick':
        void getProjectManagerStore().createProject(
          projectType,
          {
            mode: 'pick',
            name: pickState.name,
            path: pickState.path,
            initGitRepository: pickState.initGitRepository,
          },
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
          <ToggleGroup
            value={[strategy]}
            onValueChange={([value]) => {
              if (value) setStrategy(value as Strategy);
            }}
            size="sm"
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="local" aria-label="Local" className="rounded-l-md">
                  <Home className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Local</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="ssh" aria-label="SSH" className="rounded-r-md">
                  <Server className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>SSH</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
        {strategy === 'ssh' && !showGithubAuthDisclaimer && (
          <Field>
            <FieldLabel>SSH Connection</FieldLabel>
            <SshConnectionSelector
              connectionId={selectedConnectionId}
              onConnectionIdChange={setConnectionId}
              onAddConnection={handleAddConnection}
            />
          </Field>
        )}
        {mode === 'pick' && (
          <PickExistingPanel
            strategy={strategy}
            connectionId={selectedConnectionId}
            state={pickState}
            showInitializeGitPrompt={requiresGitInitialization}
          />
        )}
        {mode === 'new' && (
          <CreateNewPanel
            strategy={strategy}
            connectionId={selectedConnectionId}
            state={newState}
            showGithubAuthDisclaimer={showGithubAuthDisclaimer}
            onOpenAccountSettings={() => navigate('settings', { tab: 'account' })}
          />
        )}
        {mode === 'clone' && (
          <ClonePanel strategy={strategy} connectionId={selectedConnectionId} state={cloneState} />
        )}
      </DialogContentArea>
    </ModalLayout>
  );
});
