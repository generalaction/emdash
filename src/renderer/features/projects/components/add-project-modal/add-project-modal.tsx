import { useQuery } from '@tanstack/react-query';
import { Home, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { SshConnectionSelector } from '@renderer/features/projects/components/add-project-modal/ssh-connection-selector';
import {
  getProjectManagerStore,
  getProjectSettingsStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { appState } from '@renderer/lib/stores/app-state';
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
  const showConfirm = useShowModal('confirmActionModal');
  const showProjectConfigImportModal = useShowModal('projectConfigImportModal');

  const maybeShowProjectConfigImportPrompt = async (projectId: string) => {
    const projectManager = getProjectManagerStore();
    await projectManager.mountProject(projectId).catch((error) => {
      log.error(error);
    });

    const settingsStore = getProjectSettingsStore(projectId);
    if (!settingsStore) return;

    await settingsStore.load();
    if (!settingsStore.shouldPromptConfigMigration) return;

    const migrations = settingsStore.configMigrations ?? [];
    if (migrations.length === 0) return;

    showProjectConfigImportModal({
      migrations,
      migrateProjectConfig: (request) => settingsStore.migrateProjectConfig(request),
      onSuccess: ({ migration }) => {
        toast({
          title: `${migration.label} config imported`,
          description: `${migration.files.join(', ')} was imported successfully.`,
        });
      },
    });
  };

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

  const handleEditConnection = (id: string) => {
    const conn = appState.sshConnections.connections.find((c) => c.id === id);
    if (!conn) return;
    showSshConnModal({
      initialConfig: conn,
      onSuccess: () =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
          connectionId: id,
        }),
      onClose: () =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
          connectionId: id,
        }),
    });
  };

  const handleDeleteConnection = async (id: string) => {
    const conn = appState.sshConnections.connections.find((c) => c.id === id);
    if (!conn) return;

    const reopenAddProjectModal = (nextConnectionId?: string) => {
      showAddProjectModal({
        strategy: 'ssh',
        mode,
        connectionId: nextConnectionId,
      });
    };

    let usage;
    try {
      usage = await rpc.ssh.getConnectionUsage();
    } catch (error) {
      toast({
        title: 'Failed to load SSH connection usage',
        description: String(error),
        variant: 'destructive',
      });
      return;
    }

    const projects = usage[id] ?? [];
    if (projects.length > 0) {
      const projectNames = projects.map((project) => project.name).join(', ');
      showConfirm({
        title: 'Cannot delete SSH connection',
        description: `This SSH connection is used by: ${projectNames}. Change those projects to another connection before deleting it.`,
        confirmLabel: 'Close',
        onClose: () => reopenAddProjectModal(id),
        onSuccess: () => reopenAddProjectModal(id),
      });
      return;
    }

    showConfirm({
      title: 'Delete SSH connection',
      description: `This will remove "${conn.name}" and its saved credentials from this device.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onClose: () => reopenAddProjectModal(id),
      onSuccess: () => {
        void appState.sshConnections
          .deleteConnection(id)
          .then(() => {
            const nextConnectionId = appState.sshConnections.connections.find(
              (connection) => connection.id !== id
            )?.id;
            reopenAddProjectModal(nextConnectionId);
          })
          .catch((error) => {
            toast({
              title: 'Failed to delete SSH connection',
              description: String(error),
              variant: 'destructive',
            });
            reopenAddProjectModal(id);
          });
      },
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
        ? rpc.projects.inspectProjectPath({
            type: 'ssh',
            path: pickState.path,
            connectionId: selectedConnectionId!,
          })
        : rpc.projects.inspectProjectPath({ type: 'local', path: pickState.path }),
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

  const isSubmittingRef = useRef(false);

  const handleSubmit = async () => {
    // Guard against a double submit (e.g. a laggy machine registering two
    // clicks before onClose fires). Each submit mints its own random id and
    // navigates to it, so a second pass would navigate to a project that the
    // deduped creation never produces. Reset on inspection failures so future
    // keep-open error handling can still retry within the same modal instance.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      const projectPath =
        mode === 'pick'
          ? pickState.path
          : mode === 'new'
            ? `${newState.path}/${newState.name}`
            : `${cloneState.path}/${cloneState.name}`;
      const inspection = await rpc.projects.inspectProjectPath(
        strategy === 'ssh'
          ? { type: 'ssh', path: projectPath, connectionId: selectedConnectionId! }
          : { type: 'local', path: projectPath }
      );
      if (inspection.existingProject) {
        navigate('project', { projectId: inspection.existingProject.id });
        onClose();
        return;
      }
    } catch (e) {
      isSubmittingRef.current = false;
      log.error(e);
    }

    const id = crypto.randomUUID();
    const projectType =
      strategy === 'ssh' && selectedConnectionId
        ? { type: 'ssh' as const, connectionId: selectedConnectionId }
        : { type: 'local' as const };

    let createPromise: Promise<string | undefined>;
    switch (mode) {
      case 'pick':
        createPromise = getProjectManagerStore().createProject(
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
        createPromise = getProjectManagerStore().createProject(
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
        createPromise = getProjectManagerStore().createProject(
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
    void createPromise
      .then((createdProjectId) => {
        if (createdProjectId === id) void maybeShowProjectConfigImportPrompt(createdProjectId);
      })
      .catch((error) => {
        log.error(error);
      });
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
      <DialogContentArea data-autofocus tabIndex={-1} className="gap-4">
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
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem value="local" aria-label="Local">
                    <Home className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Local</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem value="ssh" aria-label="SSH">
                    <Server className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
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
              onEditConnection={handleEditConnection}
              onDeleteConnection={(id) => void handleDeleteConnection(id)}
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
