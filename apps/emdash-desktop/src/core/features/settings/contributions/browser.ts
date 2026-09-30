import { agentSignInModal } from '../browser/agents-page/AgentSignInModal';
import { githubDeviceFlowModal } from '../browser/github-device-flow-modal';
import { settingsViewRuntime } from '../browser/settings-view';

export const settingsBrowserContributions = {
  views: [settingsViewRuntime],
  modalDefs: [agentSignInModal, githubDeviceFlowModal],
} as const;
