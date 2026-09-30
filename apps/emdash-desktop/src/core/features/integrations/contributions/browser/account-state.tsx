import { Button } from '@emdash/ui/react/primitives';
import type { ReactNode } from 'react';
import type { ProviderAccountReportingState } from '@core/features/integrations/api/account-reporting';
import { getProjectViewStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

export type BlockingProviderAccountState = Exclude<
  ProviderAccountReportingState,
  { kind: 'silent' }
>;

export function ProviderAccountStateEmpty({
  state,
  providerId,
  providerName,
  projectId,
  icon,
}: {
  state: BlockingProviderAccountState;
  providerId: string;
  providerName: string;
  projectId?: string;
  icon?: ReactNode;
}) {
  const openIntegrationSetup = useOpenModal('integrationSetupModal');
  const { navigate } = useNavigate();

  if (state.kind === 'disabled') {
    return <p className="px-4 py-3 text-center text-sm text-foreground-muted">{state.message}</p>;
  }
  if (state.kind === 'connect') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        {icon ? (
          <span className="flex size-8 items-center justify-center rounded-full bg-background-2">
            {icon}
          </span>
        ) : null}
        <p className="max-w-64 text-sm text-foreground-muted">{state.message}</p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={() => {
            void openIntegrationSetup({ integration: providerId });
          }}
        >
          Connect {providerName}
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
