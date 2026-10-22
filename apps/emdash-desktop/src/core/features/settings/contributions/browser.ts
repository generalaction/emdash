import { agentSignInModal } from '../browser/agents-page/AgentSignInModal';
import { settingsViewRuntime } from '../browser/settings-view';

export const settingsBrowserContributions = {
  views: [settingsViewRuntime],
  modalDefs: [agentSignInModal],
} as const;
