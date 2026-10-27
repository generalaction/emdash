import { createHash } from 'node:crypto';

export const LEGACY_TMUX_SESSION_PREFIX = 'emdash-';
export const TMUX_IDENTITY_OPTION = '@emdash_identity';
const TMUX_NAME_MAX_LENGTH = 48;
const TMUX_HASH_LENGTH = 10;

export function makeTmuxSessionName(identity: string, label = 'session'): string {
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, TMUX_HASH_LENGTH);
  const sanitized = sanitizeTmuxSessionLabel(label);
  const maxLabelLength = TMUX_NAME_MAX_LENGTH - TMUX_HASH_LENGTH - 1;
  const graphemes = Array.from(
    new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(sanitized),
    ({ segment }) => segment
  );
  return `${graphemes.slice(0, maxLabelLength).join('')}-${hash}`;
}

export function makeLegacyTmuxSessionName(identity: string): string {
  return `${LEGACY_TMUX_SESSION_PREFIX}${Buffer.from(identity, 'utf8').toString('base64url')}`;
}

export function decodeLegacyTmuxSessionName(sessionName: string): string | null {
  if (!sessionName.startsWith(LEGACY_TMUX_SESSION_PREFIX)) return null;
  const encoded = sessionName.slice(LEGACY_TMUX_SESSION_PREFIX.length);
  if (!encoded) return null;
  try {
    const identity = Buffer.from(encoded, 'base64url').toString('utf8');
    return makeLegacyTmuxSessionName(identity) === sessionName ? identity : null;
  } catch {
    return null;
  }
}

export function encodeTmuxIdentity(identity: string): string {
  const encoded = Buffer.from(JSON.stringify({ version: 1, identity }), 'utf8').toString(
    'base64url'
  );
  return `v1:${encoded}`;
}

export function decodeTmuxIdentity(value: string): string | null {
  if (!value.startsWith('v1:')) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value.slice('v1:'.length), 'base64url').toString('utf8')
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('identity' in parsed) ||
      typeof parsed.identity !== 'string' ||
      !parsed.identity
    ) {
      return null;
    }
    return parsed.identity;
  } catch {
    return null;
  }
}

function sanitizeTmuxSessionLabel(label: string): string {
  const sanitized = label
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[.:]+/gu, '-')
    .replaceAll(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replaceAll(/-+/gu, '-')
    .replaceAll(/^[-_]+|[-_]+$/gu, '');
  return sanitized || 'session';
}
