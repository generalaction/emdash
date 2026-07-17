import { AgentSignInModal } from '../browser/agents-page/AgentSignInModal';
import { GithubConnectModal } from '../browser/components/github-connect-modal';
import { settingsViewRuntime } from '../browser/settings-view';

export const settingsBrowserContributions = {
  views: [settingsViewRuntime],
  modals: {
    githubConnectModal: {
      component: GithubConnectModal,
      size: 'md',
    },
    agentSignInModal: {
      component: AgentSignInModal,
      size: 'lg',
    },
  },
} as const;
