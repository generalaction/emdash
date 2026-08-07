import { Dialog, Input, ModalLayout, SelectableCard, toast } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { DownloadIcon, FolderOpenIcon, PlusIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { deriveConnectionMachineStatusKind } from '@core/features/machines/api/browser/machine-status-kind';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import type { ProjectHostParams } from '@core/features/projects/api';
import { createRequiredGitHubAccountSelectState } from '@core/features/projects/api/browser/components/github-account-select-model';
import {
  getProjectManagerStore,
  getProjectSettingsStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type {
  ModeData as ProjectCreationModeData,
  ProjectType,
} from '@core/features/projects/browser/stores/project-creation-types';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useModalController, useOpenModal } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { log } from '@core/primitives/logging/browser/logger';
import { defineModal } from '@core/primitives/modals/react';
import { basenameFromAnyPath } from '@core/primitives/path-name/api';
import type { SshConfig } from '@core/primitives/ssh/api';
import { useGitHubAccounts } from '@renderer/lib/hooks/useGithubAccounts';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { ClonePanel, CreateNewPanel, PickExistingPanel } from './content';
import { LocationSelector } from './location-selector';
import { extractRepoName, useCloneMode, useNewMode, usePickMode } from './modes';
import { useProjectName } from './use-project-name';

export type Strategy = 'local' | 'ssh';

export type Mode = 'pick' | 'new' | 'clone';
type MachineOption = SshConfig & { id: string };

export interface AddProjectModalProps {
  strategy?: Strategy;
  mode?: Mode;
  connectionId?: string;
}

export const AddProjectModal = observer(function AddProjectModal({
  strategy: strategyProp,
  mode: modeProp,
  connectionId: connectionIdProp,
}: AddProjectModalProps) {
  const modal = useModalController('addProjectModal');
  const [strategy, setStrategy] = useState<Strategy>(strategyProp ?? 'local');
  const [mode, setMode] = useState<Mode>(modeProp ?? 'pick');
  const [connectionId, setConnectionId] = useState<string | undefined>(connectionIdProp);
  const [submitState, setSubmitState] = useState<'idle' | 'creating'>('idle');
  const { connections } = getMachinesStore();
  const availableConnections = useMemo(
    () =>
      connections.filter((connection): connection is MachineOption => connection.id !== undefined),
    [connections]
  );
  const availableConnectionIds = useMemo(
    () => availableConnections.map((connection) => connection.id),
    [availableConnections]
  );
  const selectedConnectionId =
    strategy === 'ssh' ? (connectionId ?? availableConnectionIds[0]) : connectionId;

  const { navigate } = useNavigate();

  const openProjectConfigImportModal = useOpenModal('projectConfigImportModal');
  const getProjectsClient = useCallback(async () => (await getDesktopWireClient()).projects, []);

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

    const outcome = await openProjectConfigImportModal({
      migrations,
      migrateProjectConfig: (request) => settingsStore.migrateProjectConfig(request),
    });
    if (outcome.success) {
      toast(`${outcome.data.migration.label} config imported`, {
        description: `${outcome.data.migration.files.join(', ')} was imported successfully.`,
      });
    }
  };

  const defaultRepositoriesRootQuery = useQuery({
    queryKey: ['projectDefaultRepositoriesRoot', strategy, selectedConnectionId],
    queryFn: async () => {
      let host: ProjectHostParams = { type: 'local' };
      if (strategy === 'ssh') {
        if (!selectedConnectionId) {
          throw new Error('Select a machine connection before resolving the repositories root.');
        }
        host = { type: 'ssh', connectionId: selectedConnectionId };
      }
      const result = await (await getProjectsClient()).getDefaultRepositoriesRoot(host);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: strategy === 'local' || !!selectedConnectionId,
  });
  const defaultPath = defaultRepositoriesRootQuery.data ?? '';

  const githubAccountsQuery = useGitHubAccounts();
  const githubAccounts = githubAccountsQuery.data;
  const [githubAccountOverride, setGithubAccountOverride] = useState<string | undefined>(undefined);
  const githubAccountSelect = useMemo(
    () => createRequiredGitHubAccountSelectState(githubAccountOverride, githubAccounts ?? []),
    [githubAccountOverride, githubAccounts]
  );
  const defaultGitHubAccountSelect = useMemo(
    () => createRequiredGitHubAccountSelectState(undefined, githubAccounts ?? []),
    [githubAccounts]
  );
  const selectedGitHubAccountId = githubAccountSelect.selectedAccountId;
  const defaultGitHubAccountId = defaultGitHubAccountSelect.selectedAccountId;

  const pickState = usePickMode();
  const newState = useNewMode(defaultPath, mode === 'new' ? selectedGitHubAccountId : null);
  const cloneState = useCloneMode(defaultPath);
  const generatedProjectName = useMemo(() => {
    switch (mode) {
      case 'pick':
        return basenameFromAnyPath(pickState.path);
      case 'new':
        return newState.repositoryName;
      case 'clone':
        return extractRepoName(cloneState.repositoryUrl);
    }
  }, [cloneState.repositoryUrl, mode, newState.repositoryName, pickState.path]);
  const projectName = useProjectName(generatedProjectName);
  const showGithubAuthDisclaimer =
    mode === 'new' && !githubAccountsQuery.isPending && selectedGitHubAccountId === null;

  const activeMode = { pick: pickState, new: newState, clone: cloneState }[mode];
  const shouldCheckPickPathStatus =
    mode === 'pick' &&
    pickState.path.trim().length > 0 &&
    (strategy === 'local' || !!selectedConnectionId);
  const pickPathStatusQuery = useQuery({
    queryKey: ['projectPathStatus', strategy, selectedConnectionId, pickState.path],
    queryFn: async () =>
      strategy === 'ssh'
        ? (await getDesktopWireClient()).projects.inspectProjectPath({
            type: 'ssh',
            path: pickState.path,
            connectionId: selectedConnectionId!,
          })
        : (await getDesktopWireClient()).projects.inspectProjectPath({
            type: 'local',
            path: pickState.path,
          }),
    enabled: shouldCheckPickPathStatus,
  });
  const pickPathInspectionError = mode === 'pick' ? pickPathStatusQuery.data?.error : undefined;
  const requiresGitInitialization =
    mode === 'pick' &&
    pickPathStatusQuery.data?.isDirectory === true &&
    !pickPathStatusQuery.data.error &&
    pickPathStatusQuery.data.isGitRepo === false;
  const isCheckingPickPathStatus = shouldCheckPickPathStatus && pickPathStatusQuery.isPending;

  const canSubmit =
    activeMode.isValid &&
    projectName.effectiveName.length > 0 &&
    (strategy === 'local' || !!selectedConnectionId) &&
    !isCheckingPickPathStatus &&
    !pickPathInspectionError &&
    (mode !== 'new' || !githubAccountsQuery.isPending) &&
    (mode !== 'pick' ||
      !requiresGitInitialization ||
      !pickState.initGitRepository ||
      !githubAccountsQuery.isPending) &&
    submitState === 'idle';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitState('creating');
    modal.setCloseGuard(true);

    const id = crypto.randomUUID();
    const projectType: ProjectType =
      strategy === 'ssh' && selectedConnectionId
        ? { type: 'ssh' as const, connectionId: selectedConnectionId }
        : { type: 'local' as const };

    let data: ProjectCreationModeData;
    switch (mode) {
      case 'pick':
        data = {
          mode: 'pick',
          name: projectName.effectiveName,
          path: pickState.path,
          initGitRepository: pickState.initGitRepository,
          githubAccountId: pickState.initGitRepository
            ? (defaultGitHubAccountId ?? undefined)
            : undefined,
        };
        break;
      case 'new':
        data = {
          mode: 'new',
          name: projectName.effectiveName,
          path: newState.path,
          repositoryName: newState.repositoryName,
          repositoryOwner: newState.repositoryOwner?.value ?? '',
          repositoryVisibility: newState.repositoryVisibility,
          githubAccountId: selectedGitHubAccountId ?? undefined,
        };
        break;
      case 'clone':
        data = {
          mode: 'clone',
          name: projectName.effectiveName,
          path: cloneState.path,
          repositoryUrl: cloneState.repositoryUrl,
        };
        break;
    }

    try {
      const result = await getProjectManagerStore().startProjectCreation(projectType, data, { id });
      modal.setCloseGuard(false);

      if (result.kind === 'existing') {
        setSubmitState('idle');
        modal.dismiss();
        navigate(projectViewDef({ projectId: result.projectId }));
        return;
      }

      void result.completion
        .then((completion) => {
          if (completion.success) {
            void maybeShowProjectConfigImportPrompt(result.projectId);
            return;
          }
          log.error(completion.error);
        })
        .catch((error) => {
          log.error(error);
        });
      setSubmitState('idle');
      modal.dismiss();
      navigate(projectViewDef({ projectId: result.projectId }));
    } catch (error) {
      log.error(error);
      modal.setCloseGuard(false);
      setSubmitState('idle');
      toast.error('Failed to check project', { description: String(error) });
    }
  };

  return (
    <ModalLayout
      header={
        <Dialog.Header showCloseButton={submitState === 'idle'}>
          <Dialog.Title>Add Project</Dialog.Title>
        </Dialog.Header>
      }
      footer={
        <Dialog.Footer>
          <ConfirmButton
            variant="primary"
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitState === 'creating' ? 'Creating...' : 'Create'}
          </ConfirmButton>
        </Dialog.Footer>
      }
    >
      <Dialog.Body className="gap-4">
        {/* Initial-focus target: keeps the modal from auto-focusing the first input. */}
        <div data-autofocus tabIndex={-1} className="flex flex-col gap-4 outline-none">
          <div className="flex items-center gap-2">
            <Input
              bare
              autoFocus
              value={projectName.name}
              placeholder={projectName.placeholder}
              className="min-w-0 flex-1 px-0 text-lg!"
              onChange={(e) => projectName.handleNameChange(e.target.value)}
            />
            <LocationSelector
              strategy={strategy}
              connectionId={selectedConnectionId}
              machines={availableConnections}
              getMachineStatusKind={(machineId) =>
                machineId
                  ? deriveConnectionMachineStatusKind(getMachinesStore().stateFor(machineId))
                  : 'idle'
              }
              onSelectLocal={() => setStrategy('local')}
              onSelectMachine={(nextConnectionId) => {
                setStrategy('ssh');
                setConnectionId(nextConnectionId);
              }}
              onManageMachines={() => {
                modal.dismiss();
                navigate(settingsViewDef({ tab: 'connections' }));
              }}
            />
          </div>
          <div className="flex w-full gap-2">
            <ModeCard
              mode="pick"
              selected={mode === 'pick'}
              icon={<FolderOpenIcon className="size-3" />}
              label="Pick Directory"
              onSelect={setMode}
            />
            <ModeCard
              mode="new"
              selected={mode === 'new'}
              icon={<PlusIcon className="size-3" />}
              label="New Repository"
              onSelect={setMode}
            />
            <ModeCard
              mode="clone"
              selected={mode === 'clone'}
              icon={<DownloadIcon className="size-2" />}
              label="Clone Repository"
              onSelect={setMode}
            />
          </div>
          {mode === 'pick' && (
            <PickExistingPanel
              strategy={strategy}
              connectionId={selectedConnectionId}
              state={pickState}
              getProjectsClient={getProjectsClient}
              inspectionError={pickPathInspectionError?.message}
              showInitializeGitPrompt={requiresGitInitialization}
            />
          )}
          {mode === 'new' && (
            <CreateNewPanel
              strategy={strategy}
              connectionId={selectedConnectionId}
              state={newState}
              getProjectsClient={getProjectsClient}
              showGithubAuthDisclaimer={showGithubAuthDisclaimer}
              accounts={githubAccountSelect.accounts}
              selectedAccount={githubAccountSelect.selectedAccount}
              onAccountChange={setGithubAccountOverride}
              onOpenAccountSettings={() => navigate(settingsViewDef({ tab: 'integrations' }))}
              ensureDefaultRoot={
                defaultRepositoriesRootQuery.data !== undefined &&
                newState.path === defaultRepositoriesRootQuery.data
              }
            />
          )}
          {mode === 'clone' && (
            <ClonePanel
              strategy={strategy}
              connectionId={selectedConnectionId}
              state={cloneState}
              getProjectsClient={getProjectsClient}
              ensureDefaultRoot={
                defaultRepositoriesRootQuery.data !== undefined &&
                cloneState.path === defaultRepositoriesRootQuery.data
              }
            />
          )}
        </div>
      </Dialog.Body>
    </ModalLayout>
  );
});

export const addProjectModal = defineModal<void>()({
  id: 'addProjectModal',
  component: AddProjectModal,
});

function ModeCard({
  mode,
  selected,
  icon,
  label,
  onSelect,
}: {
  mode: Mode;
  selected: boolean;
  icon: ReactNode;
  label: string;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <SelectableCard
      padding="2"
      borderRadius="md"
      className="flex-1"
      selected={selected}
      onClick={() => onSelect(mode)}
    >
      <span className="flex w-full items-center justify-center gap-2">
        {icon}
        <span className="text-xs">{label}</span>
      </span>
    </SelectableCard>
  );
}
