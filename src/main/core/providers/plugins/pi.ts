import { createPiClassifier } from '@main/core/agent-hooks/classifiers/pi';
import piEmdashExtension from '@main/core/agent-hooks/pi-emdash-extension.ts?raw';
import { createProviderPlugin } from '../types';

const PI_EMDASH_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';

export const piPlugin = createProviderPlugin(({ readProjectFile, writeProjectFile }) => ({
  gitIgnorePaths: [PI_EMDASH_EXTENSION_PATH],
  createClassifier: createPiClassifier,

  async writeHookConfig() {
    const existing = await readProjectFile(PI_EMDASH_EXTENSION_PATH);
    if (existing === piEmdashExtension) return true;
    await writeProjectFile(PI_EMDASH_EXTENSION_PATH, piEmdashExtension);
    return true;
  },
}));
