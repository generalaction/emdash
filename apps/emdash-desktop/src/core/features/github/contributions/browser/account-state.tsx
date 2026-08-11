import { Button } from '@emdash/ui/react/primitives';
import { Github } from 'lucide-react';
import {
  githubAccountReportingState,
  type GitHubAccountReportingState,
} from '@core/features/github/api/account-reporting';
import { useGitHubAccounts } from '@core/features/github/api/browser/useGithubAccounts';
import { useEffectiveSettings } from '@core/features/projects/api/browser/effective-settings/use-effective-settings';
import { getProjectViewStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

export type BlockingGitHubAccountState = Exclude<GitHubAccountReportingState, { kind: 'silent' }>;

/**
 * The project's §7 reporting-matrix row when GitHub flows must not proceed
 * (spec: github-git-settings §7), resolved by the same blessed resolver the
 * settings page renders. Null while inputs load, when resolution produced an
 * account, and on the silent-default row (inferred-absent with accounts
 * connected). Call only inside `observer` components.
 */
export function useBlockingGitHubAccountState(
  projectId: string | undefined
): BlockingGitHubAccountState | null {
  const effective = useEffectiveSettings(projectId ?? '');
  const { data: accounts } = useGitHubAccounts();
  if (!projectId || !effective || !accounts) return null;
  if (effective.githubAccount.value !== null) return null;
  const state = githubAccountReportingState(
    effective.githubAccount.provenance,
    accounts.length > 0
  );
  return state.kind === 'silent' ? null : state;
}

/**
 * Empty-state rendering for the blocking reporting-matrix rows: `disabled`
 * is quiet intent (no error styling, no retry affordance), `connect` offers
 * the connect flow, and `unresolvable` fails closed with a fix affordance
 * (the project settings account picker).
 */
export function GitHubAccountStateEmpty({
  state,
  projectId,
}: {
  state: BlockingGitHubAccountState;
  projectId?: string;
}) {
  const openGithubConnectModal = useOpenModal('githubConnectModal');
  const { navigate } = useNavigate();

  if (state.kind === 'disabled') {
    return <p className="px-4 py-3 text-center text-sm text-foreground-muted">{state.message}</p>;
  }

  if (state.kind === 'connect') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-background-2">
          <Github className="size-4 text-foreground-muted" />
        </span>
        <p className="max-w-64 text-sm text-foreground-muted">{state.message}</p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={() => void openGithubConnectModal({})}
        >
          Connect GitHub
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <p className="max-w-64 text-sm text-foreground-error">{state.message}</p>
      {projectId ? (
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={() => {
            navigate(projectViewDef({ projectId }));
            getProjectViewStore(projectId)?.setProjectView('settings');
          }}
        >
          Open project settings
        </Button>
      ) : null}
    </div>
  );
}
