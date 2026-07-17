import { AgentSignInModal } from '../browser/agents-page/AgentSignInModal';
import { GithubConnectModal } from '../browser/components/github-connect-modal';
import { settingsView } from '../browser/settings-view';

export const settingsBrowserContributions = {
  views: {
    settings: settingsView,
  },
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
