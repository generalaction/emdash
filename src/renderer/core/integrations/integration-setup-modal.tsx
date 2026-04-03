import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import GitLabSetupForm from './GitLabSetupForm';
import { useIntegrationsContext } from './integrations-provider';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';

type IntegrationType = 'linear' | 'jira' | 'gitlab';

type IntegrationSetupModalArgs = {
  integration: IntegrationType;
};

type Props = BaseModalProps<void> & IntegrationSetupModalArgs;

const descriptions: Record<IntegrationType, { title: string; subtitle: string }> = {
  linear: {
    title: 'Connect Linear',
    subtitle: 'Enter your Linear API key to connect your workspace.',
  },
  jira: {
    title: 'Connect Jira',
    subtitle: 'Enter your Jira site URL, email, and API token to connect.',
  },
  gitlab: {
    title: 'Connect GitLab',
    subtitle: 'Enter your GitLab instance URL and personal access token.',
  },
};

export function IntegrationSetupModal({ integration, onSuccess, onClose }: Props) {
  const {
    connectLinear,
    connectJira,
    connectGitlab,
    isLinearLoading,
    isJiraLoading,
    isGitlabLoading,
  } = useIntegrationsContext();

  // Linear state
  const [linearKey, setLinearKey] = useState('');

  // Jira state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  // GitLab state
  const [gitlabInstanceUrl, setGitlabInstanceUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');

  const [error, setError] = useState<string | null>(null);

  const isLoading =
    (integration === 'linear' && isLinearLoading) ||
    (integration === 'jira' && isJiraLoading) ||
    (integration === 'gitlab' && isGitlabLoading);

  const canSubmit =
    (integration === 'linear' && !!linearKey.trim()) ||
    (integration === 'jira' && !!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())) ||
    (integration === 'gitlab' && !!(gitlabInstanceUrl.trim() && gitlabToken.trim()));

  const handleSubmit = useCallback(async () => {
    setError(null);
    try {
      switch (integration) {
        case 'linear':
          await connectLinear(linearKey.trim());
          break;
        case 'jira':
          await connectJira({
            siteUrl: jiraSite.trim(),
            email: jiraEmail.trim(),
            token: jiraToken.trim(),
          });
          break;
        case 'gitlab':
          await connectGitlab({
            instanceUrl: gitlabInstanceUrl.trim(),
            token: gitlabToken.trim(),
          });
          break;
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message || 'Failed to connect.');
    }
  }, [
    integration,
    linearKey,
    jiraSite,
    jiraEmail,
    jiraToken,
    gitlabInstanceUrl,
    gitlabToken,
    connectLinear,
    connectJira,
    connectGitlab,
    onSuccess,
  ]);

  const { title, subtitle } = descriptions[integration];

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-xs">{subtitle}</DialogDescription>
      </DialogHeader>
      <DialogContentArea>
        {integration === 'linear' && (
          <LinearSetupForm apiKey={linearKey} onChange={setLinearKey} error={error} />
        )}
        {integration === 'jira' && (
          <JiraSetupForm
            site={jiraSite}
            email={jiraEmail}
            token={jiraToken}
            onChange={(u) => {
              if (typeof u.site === 'string') setJiraSite(u.site);
              if (typeof u.email === 'string') setJiraEmail(u.email);
              if (typeof u.token === 'string') setJiraToken(u.token);
            }}
            error={error}
          />
        )}
        {integration === 'gitlab' && (
          <GitLabSetupForm
            instanceUrl={gitlabInstanceUrl}
            token={gitlabToken}
            onChange={(u) => {
              if (typeof u.instanceUrl === 'string') setGitlabInstanceUrl(u.instanceUrl);
              if (typeof u.token === 'string') setGitlabToken(u.token);
            }}
            error={error}
          />
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!canSubmit || isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
