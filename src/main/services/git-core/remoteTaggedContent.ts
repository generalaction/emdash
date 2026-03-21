import type { ExecResult } from '../../../shared/ssh/types';
import { stripTrailingNewline } from '../../utils/diffParser';
import type { CappedTextResult } from './diffShared';

const CONTENT_PREFIX = '__EMDASH_CONTENT__';
const MISSING_MARKER = '__EMDASH_MISSING__';
const TOO_LARGE_MARKER = '__EMDASH_TOO_LARGE__';

export function parseTaggedRemoteContent(result: ExecResult): CappedTextResult {
  if (result.exitCode !== 0) {
    return { exists: false, tooLarge: false };
  }

  const output = stripTrailingNewline(result.stdout || '');
  if (output === MISSING_MARKER) {
    return { exists: false, tooLarge: false };
  }
  if (output === TOO_LARGE_MARKER) {
    return { exists: true, tooLarge: true };
  }
  if (output.startsWith(`${CONTENT_PREFIX}\n`)) {
    const content = output.slice(`${CONTENT_PREFIX}\n`.length);
    if (content.includes('\0')) {
      return { exists: true, tooLarge: false, isBinary: true };
    }
    return {
      exists: true,
      tooLarge: false,
      content,
    };
  }
  if (output === CONTENT_PREFIX) {
    return { exists: true, tooLarge: false, content: '' };
  }

  if (output.includes('\0')) {
    return { exists: true, tooLarge: false, isBinary: true };
  }

  return { exists: true, tooLarge: false, content: output };
}
