import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import ForgejoSetupForm from './ForgejoSetupForm';
import GitLabSetupForm from './GitLabSetupForm';
import { useIntegrationsContext } from './integrations-provider';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';
import PlainSetupForm from './PlainSetupForm';

type IntegrationType = 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo';

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
  plain: {
    title: 'Connect Plain',
    subtitle: 'Enter your Plain API key to connect your workspace.',
  },
  forgejo: {
    title: 'Connect Forgejo',
    subtitle: 'Enter your Forgejo instance URL and API token.',
  },
};

export function IntegrationSetupModal({ integration, onSuccess, onClose }: Props) {
  const {
    connectLinear,
    connectJira,
    connectGitlab,
    connectPlain,
    connectForgejo,
    isLinearLoading,
    isJiraLoading,
    isGitlabLoading,
    isPlainLoading,
    isForgejoLoading,
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

  // Plain state
  const [plainKey, setPlainKey] = useState('');

  // Forgejo state
  const [forgejoInstanceUrl, setForgejoInstanceUrl] = useState('');
  const [forgejoToken, setForgejoToken] = useState('');

  const [error, setError] = useState<string | null>(null);

  const isLoading =
    (integration === 'linear' && isLinearLoading) ||
    (integration === 'jira' && isJiraLoading) ||
    (integration === 'gitlab' && isGitlabLoading) ||
    (integration === 'plain' && isPlainLoading) ||
    (integration === 'forgejo' && isForgejoLoading);

  const canSubmit =
    (integration === 'linear' && !!linearKey.trim()) ||
    (integration === 'jira' && !!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())) ||
    (integration === 'gitlab' && !!(gitlabInstanceUrl.trim() && gitlabToken.trim())) ||
    (integration === 'plain' && !!plainKey.trim()) ||
    (integration === 'forgejo' && !!(forgejoInstanceUrl.trim() && forgejoToken.trim()));

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
        case 'plain':
          await connectPlain(plainKey.trim());
          break;
        case 'forgejo':
          await connectForgejo({
            instanceUrl: forgejoInstanceUrl.trim(),
            token: forgejoToken.trim(),
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
    plainKey,
    forgejoInstanceUrl,
    forgejoToken,
    connectLinear,
    connectJira,
    connectGitlab,
    connectPlain,
    connectForgejo,
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
        {integration === 'plain' && (
          <PlainSetupForm apiKey={plainKey} onChange={setPlainKey} error={error} />
        )}
        {integration === 'forgejo' && (
          <ForgejoSetupForm
            instanceUrl={forgejoInstanceUrl}
            token={forgejoToken}
            onChange={(u) => {
              if (typeof u.instanceUrl === 'string') setForgejoInstanceUrl(u.instanceUrl);
              if (typeof u.token === 'string') setForgejoToken(u.token);
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
