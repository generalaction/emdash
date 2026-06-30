import type { ChatMentionMeta, MentionProvider } from '@emdash/chat-ui';

/**
 * Synchronous MentionProvider that resolves @-tokens to file mention metadata.
 *
 * Uses a path-heuristic: any token containing a '/' or '.' is treated as a
 * relative file path and resolved as a 'file' mention. Agents virtually always
 * @-mention files via paths like `src/auth/jwt.ts`, so false positives are rare.
 *
 * This is a singleton wired into the shared ChatContext at bootstrap so all ACP
 * conversations benefit from file mention pills without per-conversation setup.
 */
class WorkspaceFileMentionProvider implements MentionProvider {
  resolve(token: string): ChatMentionMeta | null {
    if (!token.includes('/') && !token.includes('.')) return null;
    const name = token.split('/').pop() ?? token;
    return { id: token, label: token, name, kind: 'file' };
  }
}

export const workspaceFileMentionProvider = new WorkspaceFileMentionProvider();
