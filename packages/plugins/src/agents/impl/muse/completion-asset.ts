import { defineAdapterAsset } from '../../helpers/adapter-assets';

export const museCompletionAsset = defineAdapterAsset({
  name: 'muse-completion',
  source: './src/agents/impl/muse/completion-observer.ts',
  format: 'esm',
});
