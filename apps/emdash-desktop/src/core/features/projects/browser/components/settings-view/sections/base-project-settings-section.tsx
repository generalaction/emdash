import type { GitBranchRef, GitRemote } from '@emdash/core/runtimes/git/api';
import { deriveWorktreePoolPath } from '@emdash/core/runtimes/workspace-registry/api';
import {
  Alert,
  Button,
  Field,
  Input,
  Select,
  Separator,
  Switch,
} from '@emdash/ui/react/primitives';
import { Folder, Github } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { sortGitHubAccountsByDefault } from '@core/features/projects/api/browser/components/github-account-select-model';
import {
  resolveRendererEffectiveSettings,
  useEffectiveSettingsInputs,
} from '@core/features/projects/api/browser/effective-settings/use-effective-settings';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  GITHUB_CONNECT_ACCOUNT_OPTION,
  GITHUB_INFERRED_NONE_OPTION,
  GitHubAccountSelectItem,
  GitHubAccountSelectLabel,
  GitHubZeroAccountSelectItems,
} from '@core/features/projects/contributions/browser/github-account-select';
import {
  BrokenSettingNotice,
  ProvenanceBadge,
  ProvenanceSourceLine,
  ResetProvenanceButton,
} from '@core/features/projects/contributions/browser/settings-provenance';
import type { ProvenanceFlavor } from '@core/features/projects/contributions/browser/settings-provenance-labels';
import { ProjectBranchSelector } from '@core/features/source-control/contributions/browser/project-branch-selector';
import { RemoteSelector } from '@core/features/source-control/contributions/browser/remote-selector';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import type {
  AgentGitCredentialsSetting,
  Provenance,
  Resolved,
} from '@core/primitives/project-settings/api';
import { formatDefaultBranch, resolveTmux } from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';
import { cn } from '@core/primitives/styling/browser/cn';
import type { ProjectPlacementDomainSnapshot } from '../../../../api/project-settings-page';
import {
  formToStoredGitSettings,
  storedDefaultBranchToBranchRef,
  type FormUpdate,
  type GitIdentityFormState,
  type PlacementFormState,
} from '../project-settings-form-model';

/** File-local Select option encodings; never stored or exported. */
const EXPLICIT_NO_ACCOUNT_OPTION = '__explicit_no_github_account__';

const AGENT_GIT_CREDENTIALS_OPTIONS: { value: AgentGitCredentialsSetting; label: string }[] = [
  { value: 'effective-account', label: 'Effective account' },
  { value: 'system', label: 'System' },
  { value: 'none', label: 'None' },
];

type BaseProjectSettingsSectionProps = {
  projectId: string;
  gitIdentityForm: GitIdentityFormState;
  placementForm: PlacementFormState;
  placement: ProjectPlacementDomainSnapshot;
  projectType: Project['type'];
  remotes: GitRemote[];
  worktreeDirectoryError: string | null;
  updateGitIdentity: FormUpdate<GitIdentityFormState>;
  updatePlacement: FormUpdate<PlacementFormState>;
  hostActionReason: string | null;
  hostObservationKind: 'fresh' | 'stale' | 'unavailable';
};

/**
 * Per-field provenance treatment (spec: github-git-settings §9, prototype
 * Variant A): label + badge + reset affordance, source line for inferred
 * values, broken-setting warning below the label row. Provenance is resolved
 * over the *pending* form state so edits preview exactly what a save would
 * resolve to.
 */
function ProvenanceField({
  label,
  description,
  resolved,
  flavor = 'inferred',
  isExplicit,
  onReset,
  children,
}: {
  label: string;
  description: string;
  resolved: Resolved<unknown> | null;
  flavor?: ProvenanceFlavor;
  /** Whether the form currently holds an explicit value (shows the reset affordance). */
  isExplicit: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const provenance: Provenance | null = resolved?.provenance ?? null;
  return (
    <Field.Root>
      <div className="flex items-center gap-2">
        <Field.Label>{label}</Field.Label>
        {provenance ? <ProvenanceBadge provenance={provenance} flavor={flavor} /> : null}
        {provenance && isExplicit ? (
          <ResetProvenanceButton flavor={flavor} onReset={onReset} />
        ) : null}
      </div>
      <Field.Description className="text-foreground-muted">{description}</Field.Description>
      {provenance?.kind === 'broken-setting' ? (
        <BrokenSettingNotice
          staleValue={provenance.staleValue}
          effectiveValue={brokenFallbackDisplay(resolved)}
        />
      ) : null}
      {children}
      {provenance ? <ProvenanceSourceLine provenance={provenance} /> : null}
    </Field.Root>
  );
}

function brokenFallbackDisplay(resolved: Resolved<unknown> | null): string | null {
  const value = resolved?.value ?? null;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'branch' in value) {
    return formatDefaultBranch(value as { remote: string | null; branch: string });
  }
  return String(value);
}

export const BaseProjectSettingsSection = observer(function BaseProjectSettingsSection({
  projectId,
  gitIdentityForm,
  placementForm,
  placement,
  projectType,
  remotes,
  worktreeDirectoryError,
  updateGitIdentity,
  updatePlacement,
  hostActionReason,
  hostObservationKind,
}: BaseProjectSettingsSectionProps) {
  const inputs = useEffectiveSettingsInputs(projectId);
  const effective = inputs
    ? resolveRendererEffectiveSettings(
        inputs,
        formToStoredGitSettings({ gitIdentity: gitIdentityForm, placement: placementForm })
      )
    : null;
  const accounts = sortGitHubAccountsByDefault(inputs?.accounts ?? []);
  const openGithubConnectModal = useOpenModal('githubConnectModal');
  const [isBrowsingWorktreeDirectory, setIsBrowsingWorktreeDirectory] = useState(false);

  const inheritedWorktreeRoot =
    placement.layers.hostWorktreeRoot ?? placement.layers.builtInWorktreeRoot;
  const projectPath = projectData(getProjectStore(projectId))?.path ?? null;
  const effectiveWorktreeRoot = effective?.worktreeRoot.value ?? null;
  const effectiveTmux = resolveTmux({
    projectTmux: placementForm.tmux,
    hostTmux: placement.layers.hostTmux,
    appDefaultTmux: placement.layers.appDefaultTmux,
  });
  const derivedPoolPath =
    projectPath !== null && effectiveWorktreeRoot !== null
      ? deriveWorktreePoolPath({ worktreeRoot: effectiveWorktreeRoot, repoPath: projectPath })
      : null;

  const handleBrowseWorktreeDirectory = async () => {
    if (isBrowsingWorktreeDirectory) return;

    setIsBrowsingWorktreeDirectory(true);
    try {
      const result = await (
        await getHostClient()
      ).openSelectDirectoryDialog({
        title: 'Select worktree root',
        message: 'Choose the directory where worktrees should be created.',
        defaultPath:
          placementForm.worktreeDirectory || (effectiveWorktreeRoot ?? inheritedWorktreeRoot),
      });
      if (result) {
        updatePlacement('worktreeDirectory', result);
      }
    } finally {
      setIsBrowsingWorktreeDirectory(false);
    }
  };

  const accountProvenance = effective?.githubAccount.provenance ?? null;
  const accountUnresolvable = accountProvenance?.kind === 'unresolvable';
  // Zero-account picker state (spec §5): only "Inferred (none)" + Connect.
  const zeroAccounts = inputs !== null && accounts.length === 0;
  const accountSelectValue =
    gitIdentityForm.githubAccount === undefined
      ? zeroAccounts
        ? GITHUB_INFERRED_NONE_OPTION
        : ''
      : gitIdentityForm.githubAccount.kind === 'none'
        ? EXPLICIT_NO_ACCOUNT_OPTION
        : gitIdentityForm.githubAccount.accountId;
  const effectiveDefaultBranchRef = storedDefaultBranchToBranchRef(
    effective?.defaultBranch.value ?? undefined,
    remotes
  );

  return (
    <>
      <ProvenanceField
        label="GitHub account"
        description="Used for pull requests and issues in this project."
        resolved={effective?.githubAccount ?? null}
        isExplicit={gitIdentityForm.githubAccount !== undefined}
        onReset={() => updateGitIdentity('githubAccount', undefined)}
      >
        {accountUnresolvable ? (
          <Alert.Root status="destructive">
            <Alert.Title>Account no longer available</Alert.Title>
            <Alert.Description>
              The GitHub account set for this project is no longer connected or does not match this
              repository's host. GitHub features stay paused until you pick an account or reset to
              inferred.
            </Alert.Description>
          </Alert.Root>
        ) : null}
        <Select.Root
          value={accountSelectValue}
          onValueChange={(value) => {
            if (!value) return;
            if (value === GITHUB_CONNECT_ACCOUNT_OPTION) {
              void openGithubConnectModal({});
              return;
            }
            if (value === GITHUB_INFERRED_NONE_OPTION) {
              updateGitIdentity('githubAccount', undefined);
              return;
            }
            updateGitIdentity(
              'githubAccount',
              value === EXPLICIT_NO_ACCOUNT_OPTION
                ? { kind: 'none' }
                : { kind: 'account', accountId: value }
            );
          }}
        >
          <Select.Trigger className="w-full min-w-0">
            {effective?.githubAccount.value ? (
              <GitHubAccountSelectLabel account={effective.githubAccount.value} />
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <Github className="text-muted-foreground h-4 w-4 shrink-0" />
                {accountUnresolvable ? (
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <span className="min-w-0 truncate">Unavailable GitHub account</span>
                    <span className="shrink-0 text-sm text-foreground-muted">
                      No longer connected
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 truncate">
                    {gitIdentityForm.githubAccount === undefined
                      ? 'Infer GitHub account'
                      : 'No GitHub account'}
                  </span>
                )}
              </div>
            )}
          </Select.Trigger>
          <Select.Content align="start" alignItemWithTrigger={false} sideOffset={6}>
            {zeroAccounts ? (
              <GitHubZeroAccountSelectItems />
            ) : (
              <>
                <Select.Item value={EXPLICIT_NO_ACCOUNT_OPTION} className="py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Github className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="relative -top-px shrink-0">No GitHub account</span>
                  </div>
                </Select.Item>
                {accounts.map((account) => (
                  <GitHubAccountSelectItem key={account.accountId} account={account} />
                ))}
              </>
            )}
          </Select.Content>
        </Select.Root>
      </ProvenanceField>

      <Separator />

      {hostObservationKind === 'unavailable' ? (
        <Field.Root>
          <Field.Label>Worktree root</Field.Label>
          <Field.Description className="text-foreground-muted">
            {projectType === 'local'
              ? 'Worktree placement is unavailable until the local runtime is ready.'
              : 'Worktree placement is unavailable until this Project’s Machine is ready.'}
          </Field.Description>
        </Field.Root>
      ) : (
        <>
          <fieldset disabled={hostActionReason !== null} className="contents">
            <ProvenanceField
              label="Worktree root"
              description="Where task worktrees are created."
              resolved={hostActionReason ? null : (effective?.worktreeRoot ?? null)}
              flavor="inherited"
              isExplicit={placementForm.worktreeDirectory.trim() !== ''}
              onReset={() => updatePlacement('worktreeDirectory', '')}
            >
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    aria-invalid={worktreeDirectoryError ? true : undefined}
                    className={cn(worktreeDirectoryError ? 'pr-44' : undefined)}
                    placeholder={effectiveWorktreeRoot ?? inheritedWorktreeRoot}
                    value={placementForm.worktreeDirectory}
                    onChange={(e) => updatePlacement('worktreeDirectory', e.target.value)}
                  />
                  {worktreeDirectoryError ? (
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-foreground-error">
                      {worktreeDirectoryError}
                    </span>
                  ) : null}
                </div>
                {projectType === 'local' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isBrowsingWorktreeDirectory}
                    onClick={handleBrowseWorktreeDirectory}
                  >
                    <Folder data-icon="inline-start" className="size-4" />
                    Browse
                  </Button>
                ) : null}
              </div>
              {derivedPoolPath ? (
                <span className="text-xs text-foreground-muted">
                  Worktrees for this repository go in{' '}
                  <code className="font-mono break-all">{derivedPoolPath}</code>
                </span>
              ) : null}
            </ProvenanceField>
          </fieldset>
          {hostActionReason ? (
            <p role="status" className="text-xs text-foreground-muted">
              Worktree placement is {hostActionReason.toLocaleLowerCase()}
            </p>
          ) : null}
        </>
      )}

      <Separator />

      <ProvenanceField
        label="Default branch"
        description="The branch new tasks are created from by default."
        resolved={effective?.defaultBranch ?? null}
        isExplicit={gitIdentityForm.defaultBranch !== null}
        onReset={() => updateGitIdentity('defaultBranch', null)}
      >
        <ProjectBranchSelector
          projectId={projectId}
          value={gitIdentityForm.defaultBranch ?? effectiveDefaultBranchRef ?? undefined}
          onValueChange={(branch: GitBranchRef) => updateGitIdentity('defaultBranch', branch)}
        />
      </ProvenanceField>

      <Separator />

      <ProvenanceField
        label="Base remote"
        description="Used for fetching remote branches, choosing task base branches and targeting pull requests."
        resolved={effective?.baseRemote ?? null}
        isExplicit={gitIdentityForm.baseRemote.trim() !== ''}
        onReset={() => updateGitIdentity('baseRemote', '')}
      >
        <RemoteSelector
          remotes={remotes}
          value={gitIdentityForm.baseRemote || (effective?.baseRemote.value ?? '')}
          onValueChange={(value) => updateGitIdentity('baseRemote', value)}
          className="w-full"
        />
      </ProvenanceField>

      <Separator />

      <ProvenanceField
        label="Push remote"
        description="Used when publishing task branches and pushing commits."
        resolved={effective?.pushRemote ?? null}
        isExplicit={gitIdentityForm.pushRemote.trim() !== ''}
        onReset={() => updateGitIdentity('pushRemote', '')}
      >
        <RemoteSelector
          remotes={remotes}
          value={gitIdentityForm.pushRemote || (effective?.pushRemote.value ?? '')}
          onValueChange={(value) => updateGitIdentity('pushRemote', value)}
          className="w-full"
        />
      </ProvenanceField>

      <Separator />

      <Field.Root>
        <Field.Label>Agent git credentials</Field.Label>
        <Field.Description className="text-foreground-muted">
          Which git credentials agent and terminal sessions use in this project. Effective account
          wires the account above, system keeps your machine's credentials, none disables credential
          helpers in sessions.
        </Field.Description>
        <Select.Root
          value={gitIdentityForm.agentGitCredentials}
          onValueChange={(value) => {
            if (!value) return;
            updateGitIdentity('agentGitCredentials', value as AgentGitCredentialsSetting);
          }}
        >
          <Select.Trigger className="w-full min-w-0">
            {AGENT_GIT_CREDENTIALS_OPTIONS.find(
              (option) => option.value === gitIdentityForm.agentGitCredentials
            )?.label ?? 'Effective account'}
          </Select.Trigger>
          <Select.Content align="start" alignItemWithTrigger={false} sideOffset={6}>
            {AGENT_GIT_CREDENTIALS_OPTIONS.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Field.Root>

      <Separator />

      <Field.Root orientation="horizontal">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Field.Label>Enable tmux</Field.Label>
            {hostObservationKind !== 'unavailable' || placementForm.tmux !== undefined ? (
              <ProvenanceBadge provenance={effectiveTmux.provenance} flavor="inherited" />
            ) : null}
            {placementForm.tmux !== undefined ? (
              <ResetProvenanceButton
                flavor="inherited"
                onReset={() => updatePlacement('tmux', undefined)}
              />
            ) : null}
          </div>
          <Field.Description className="text-foreground-muted">
            {hostObservationKind === 'unavailable' && placementForm.tmux === undefined
              ? 'The inherited tmux value is unavailable. Choose a value to set a Project override.'
              : 'Run the agent session inside a tmux session.'}
          </Field.Description>
        </div>
        <Switch
          checked={
            hostObservationKind === 'unavailable'
              ? (placementForm.tmux ?? false)
              : effectiveTmux.value
          }
          onCheckedChange={(checked) => updatePlacement('tmux', checked)}
        />
      </Field.Root>
    </>
  );
});
