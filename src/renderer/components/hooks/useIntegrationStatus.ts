import { useGithubContext } from '../../contexts/GithubContextProvider';
import { useIntegrationsContext } from '../../contexts/IntegrationsProvider';

interface IntegrationStatus {
  // Linear
  isLinearConnected: boolean | null;
  handleLinearConnect: (apiKey: string) => Promise<void>;

  // GitHub
  isGithubConnected: boolean;
  githubInstalled: boolean;
  githubLoading: boolean;
  handleGithubConnect: () => Promise<void>;

  // Jira
  isJiraConnected: boolean | null;
  handleJiraConnect: (credentials: {
    siteUrl: string;
    email: string;
    token: string;
  }) => Promise<void>;
}

/**
 * Hook to manage integration connection status for Linear, GitHub, and Jira.
 */
export function useIntegrationStatus(): IntegrationStatus {
  const { isLinearConnected, connectLinear, isJiraConnected, connectJira } =
    useIntegrationsContext();

  const {
    installed: githubInstalled,
    authenticated: githubAuthenticated,
    isLoading: githubLoading,
    handleGithubConnect,
  } = useGithubContext();

  const isGithubConnected = githubInstalled && githubAuthenticated;

  return {
    isLinearConnected,
    handleLinearConnect: connectLinear,
    isGithubConnected,
    githubInstalled,
    githubLoading,
    handleGithubConnect,
    isJiraConnected,
    handleJiraConnect: connectJira,
  };
}
