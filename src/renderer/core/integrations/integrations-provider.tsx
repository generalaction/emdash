import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import { rpc } from '../ipc';

type IntegrationsContextValue = {
  // Linear
  isLinearConnected: boolean | null;
  isLinearLoading: boolean;
  linearWorkspaceName: string | null | undefined;
  connectLinear: (apiKey: string) => Promise<void>;
  disconnectLinear: () => Promise<void>;

  // Jira
  isJiraConnected: boolean | null;
  isJiraLoading: boolean;
  connectJira: (credentials: { siteUrl: string; email: string; token: string }) => Promise<void>;
  disconnectJira: () => Promise<void>;

  // GitLab
  isGitlabConnected: boolean | null;
  isGitlabLoading: boolean;
  connectGitlab: (credentials: { instanceUrl: string; token: string }) => Promise<void>;
  disconnectGitlab: () => Promise<void>;

  // Plain
  isPlainConnected: boolean | null;
  isPlainLoading: boolean;
  connectPlain: (apiKey: string) => Promise<void>;
  disconnectPlain: () => Promise<void>;
};

const LINEAR_STATUS_KEY = ['linear:status'] as const;
const JIRA_STATUS_KEY = ['jira:status'] as const;
const GITLAB_STATUS_KEY = ['gitlab:status'] as const;
const PLAIN_STATUS_KEY = ['plain:status'] as const;

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: linearData, isFetching: linearFetching } = useQuery({
    queryKey: LINEAR_STATUS_KEY,
    queryFn: () => rpc.linear.checkConnection(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const connectLinearMutation = useMutation({
    mutationFn: (apiKey: string) => rpc.linear.saveToken(apiKey),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: LINEAR_STATUS_KEY }),
  });

  const disconnectLinearMutation = useMutation({
    mutationFn: () => rpc.linear.clearToken(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: LINEAR_STATUS_KEY }),
  });

  const connectLinear = useCallback(
    async (apiKey: string) => {
      if (!apiKey) throw new Error('Invalid API key');
      const result = await connectLinearMutation.mutateAsync(apiKey);
      if (!result?.success) {
        throw new Error(result?.error || 'Could not connect Linear. Try again.');
      }
    },
    [connectLinearMutation]
  );

  const disconnectLinear = useCallback(async () => {
    await disconnectLinearMutation.mutateAsync();
  }, [disconnectLinearMutation]);

  // ── Jira ────────────────────────────────────────────────────────────────────

  const { data: jiraData, isFetching: jiraFetching } = useQuery({
    queryKey: JIRA_STATUS_KEY,
    queryFn: () => rpc.jira.checkConnection(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const connectJiraMutation = useMutation({
    mutationFn: (credentials: { siteUrl: string; email: string; token: string }) =>
      rpc.jira.saveCredentials(credentials),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: JIRA_STATUS_KEY }),
  });

  const disconnectJiraMutation = useMutation({
    mutationFn: () => rpc.jira.clearCredentials(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: JIRA_STATUS_KEY }),
  });

  const connectJira = useCallback(
    async (credentials: { siteUrl: string; email: string; token: string }) => {
      const res = await connectJiraMutation.mutateAsync(credentials);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to connect.');
      }
    },
    [connectJiraMutation]
  );

  const disconnectJira = useCallback(async () => {
    await disconnectJiraMutation.mutateAsync();
  }, [disconnectJiraMutation]);

  // ── GitLab ──────────────────────────────────────────────────────────────────

  const { data: gitlabData, isFetching: gitlabFetching } = useQuery({
    queryKey: GITLAB_STATUS_KEY,
    queryFn: () => rpc.gitlab.checkConnection(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const connectGitlabMutation = useMutation({
    mutationFn: (credentials: { instanceUrl: string; token: string }) =>
      rpc.gitlab.saveCredentials(credentials),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: GITLAB_STATUS_KEY }),
  });

  const disconnectGitlabMutation = useMutation({
    mutationFn: () => rpc.gitlab.clearCredentials(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: GITLAB_STATUS_KEY }),
  });

  const connectGitlab = useCallback(
    async (credentials: { instanceUrl: string; token: string }) => {
      const result = await connectGitlabMutation.mutateAsync(credentials);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to connect.');
      }
    },
    [connectGitlabMutation]
  );

  const disconnectGitlab = useCallback(async () => {
    await disconnectGitlabMutation.mutateAsync();
  }, [disconnectGitlabMutation]);

  // ── Plain ────────────────────────────────────────────────────────────────────

  const { data: plainData, isFetching: plainFetching } = useQuery({
    queryKey: PLAIN_STATUS_KEY,
    queryFn: () => rpc.plain.checkConnection(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const connectPlainMutation = useMutation({
    mutationFn: (apiKey: string) => rpc.plain.saveToken(apiKey),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PLAIN_STATUS_KEY }),
  });

  const disconnectPlainMutation = useMutation({
    mutationFn: () => rpc.plain.clearToken(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PLAIN_STATUS_KEY }),
  });

  const connectPlain = useCallback(
    async (apiKey: string) => {
      if (!apiKey) throw new Error('Invalid API key');
      const result = await connectPlainMutation.mutateAsync(apiKey);
      if (!result?.success) {
        throw new Error(result?.error || 'Could not connect Plain. Try again.');
      }
    },
    [connectPlainMutation]
  );

  const disconnectPlain = useCallback(async () => {
    await disconnectPlainMutation.mutateAsync();
  }, [disconnectPlainMutation]);

  const isLinearConnected = linearData === undefined ? null : !!linearData?.connected;
  const linearWorkspaceName = linearData?.workspaceName ?? null;
  const isLinearLoading =
    linearFetching || connectLinearMutation.isPending || disconnectLinearMutation.isPending;

  const isJiraConnected = jiraData === undefined ? null : !!jiraData?.connected;
  const isJiraLoading =
    jiraFetching || connectJiraMutation.isPending || disconnectJiraMutation.isPending;

  const isGitlabConnected = gitlabData === undefined ? null : !!gitlabData?.connected;
  const isGitlabLoading =
    gitlabFetching || connectGitlabMutation.isPending || disconnectGitlabMutation.isPending;

  const isPlainConnected = plainData === undefined ? null : !!plainData?.connected;
  const isPlainLoading =
    plainFetching || connectPlainMutation.isPending || disconnectPlainMutation.isPending;

  return (
    <IntegrationsContext.Provider
      value={{
        isLinearConnected,
        isLinearLoading,
        linearWorkspaceName,
        connectLinear,
        disconnectLinear,
        isJiraConnected,
        isJiraLoading,
        connectJira,
        disconnectJira,
        isGitlabConnected,
        isGitlabLoading,
        connectGitlab,
        disconnectGitlab,
        isPlainConnected,
        isPlainLoading,
        connectPlain,
        disconnectPlain,
      }}
    >
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrationsContext() {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) throw new Error('useIntegrationsContext must be used inside IntegrationsProvider');
  return ctx;
}
