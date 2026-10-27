import { useToast } from '@emdash/ui/react/primitives';
import { Github, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useImportGitHubCliAccounts } from '@core/features/github/api/browser/use-github-auth';
import type { IntegrationAuthUiProps } from '@core/features/integrations/api/browser/integration-auth-ui';
import { StandardIntegrationAuth } from '@core/features/integrations/contributions/browser/standard-integration-auth';

export function GitHubIntegrationAuth(props: IntegrationAuthUiProps) {
  const { toast } = useToast();
  const importCliAccountsMutation = useImportGitHubCliAccounts();
  const [cliLoading, setCliLoading] = useState(false);
  const [cliError, setCliError] = useState<string>();
  const { metadata, onSuccess } = props;

  const refreshCliAuth = async () => {
    setCliError(undefined);
    setCliLoading(true);
    try {
      const result = await importCliAccountsMutation.mutateAsync();
      if (!result.success) {
        setCliError(result.error);
        return;
      }

      if (result.importedAccountIds.length === 0) {
        setCliError('No GitHub CLI session found. Run gh auth login first.');
        return;
      }

      toast('GitHub CLI accounts imported', {
        description:
          result.importedAccountIds.length === 1
            ? '1 account is available in Emdash.'
            : `${result.importedAccountIds.length} accounts are available in Emdash.`,
      });
      onSuccess();
    } finally {
      setCliLoading(false);
    }
  };

  const hasCliImport = metadata.auth.methods.some((method) => method.kind === 'cli-import');
  return (
    <StandardIntegrationAuth
      {...props}
      oauthIcon={Github}
      extraMethods={
        hasCliImport
          ? [
              {
                id: 'cli',
                icon: Terminal,
                title: 'Import from GitHub CLI',
                description: 'Use accounts already authenticated with GitHub CLI',
                loadingLabel: 'Checking GitHub CLI accounts',
                loading: cliLoading,
                onSelect: () => void refreshCliAuth(),
                error: cliError,
              },
            ]
          : []
      }
    />
  );
}
