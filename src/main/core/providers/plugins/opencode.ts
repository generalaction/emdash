import { createOpenCodeClassifier } from '@main/core/agent-hooks/classifiers/opencode';
import openCodePluginContent from '@main/core/agent-hooks/opencode-notifications-plugin.js?raw';
import { createProviderPlugin } from '../types';

const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';

export const openCodePlugin = createProviderPlugin(({ readProjectFile, writeProjectFile }) => ({
  gitIgnorePaths: [OPENCODE_PLUGIN_PATH],
  createClassifier: createOpenCodeClassifier,

  async writeHookConfig() {
    const existing = await readProjectFile(OPENCODE_PLUGIN_PATH);
    if (existing === openCodePluginContent) return true;
    await writeProjectFile(OPENCODE_PLUGIN_PATH, openCodePluginContent);
    return true;
  },
}));
