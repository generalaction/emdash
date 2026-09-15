import { claudeAdapter } from './impl/claude/adapter';
import { codexAdapter } from './impl/codex/adapter';
import { museCompletionAsset } from './impl/muse/completion-asset';

export const adapterAssets = [claudeAdapter, codexAdapter, museCompletionAsset] as const;
