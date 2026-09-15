import { readFile } from 'node:fs/promises';
import { quoteArg } from '@emdash/core/primitives/exec/api';
import {
  EMDASH_HOOK_POSIX_GUARD,
  EMDASH_HOOK_VERSION_MARKER,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { resolveAdapterAsset } from '../../helpers/adapter-assets';
import { museCompletionAsset } from './completion-asset';

export const MUSE_COMPLETION_PATH = 'emdash-completion.mjs';

export function readMuseCompletionAsset(): Promise<string> {
  return readFile(resolveAdapterAsset(museCompletionAsset), 'utf8');
}

export function museStartCommand(): string {
  return (
    `${EMDASH_HOOK_VERSION_MARKER}; ${EMDASH_HOOK_POSIX_GUARD}; ` +
    `ELECTRON_RUN_AS_NODE=1 ${quoteArg(process.execPath, 'posix')} ` +
    `"\${XDG_CONFIG_HOME:-$HOME/.config}/muse/${MUSE_COMPLETION_PATH}" || true`
  );
}
