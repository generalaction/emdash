import { useIntegrationsContext } from '../../core/integrations/integrations-provider';
import { useGithubContext } from '../../providers/github-context-provider';

interface IntegrationStatus {
  // Linear
  isLinearConnected: boolean | null;
  handleLinearConnect: (apiKey: string) => Promise<void>;

  // GitHub
  isGithubConnected: boolean;
  githubLoading: boolean;
  handleGithubConnect: () => Promise<void>;

  // Jira
  isJiraConnected: boolean | null;
  handleJiraConnect: (credentials: {
    siteUrl: string;
    email: string;
    token: string;
  }) => Promise<void>;

  // GitLab
  isGitlabConnected: boolean | null;
  handleGitlabConnect: (credentials: { instanceUrl: string; token: string }) => Promise<void>;

  // Plain
  isPlainConnected: boolean | null;
  handlePlainConnect: (apiKey: string) => Promise<void>;

  // Forgejo
  isForgejoConnected: boolean | null;
  handleForgejoConnect: (credentials: { instanceUrl: string; token: string }) => Promise<void>;
}

/**
 * Hook to manage integration connection status for Linear, GitHub, Jira, and GitLab.
 */
export function useIntegrationStatus(): IntegrationStatus {
  const {
    isLinearConnected,
    connectLinear,
    isJiraConnected,
    connectJira,
    isGitlabConnected,
    connectGitlab,
    isPlainConnected,
    connectPlain,
    isForgejoConnected,
    connectForgejo,
  } = useIntegrationsContext();

  const {
    authenticated: isGithubConnected,
    isLoading: githubLoading,
    handleGithubConnect,
  } = useGithubContext();

  return {
    isLinearConnected,
    handleLinearConnect: connectLinear,
    isGithubConnected,
    githubLoading,
    handleGithubConnect,
    isJiraConnected,
    handleJiraConnect: connectJira,
    isGitlabConnected,
    handleGitlabConnect: connectGitlab,
    isPlainConnected,
    handlePlainConnect: connectPlain,
    isForgejoConnected,
    handleForgejoConnect: connectForgejo,
  };
}
