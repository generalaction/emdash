import type { ChatMentionMeta, MentionProvider } from '@emdash/chat-ui';
import { parseIssueMentionToken } from '@core/primitives/issues/api';
import { issueMentionIconUrl } from '@core/primitives/issues/browser/issue-mention-icons';
import { diffCommentsMention } from './diff-comments-mention';
import { workspaceFileMentionProvider } from './workspace-file-mention-provider';

class ChatMentionProvider implements MentionProvider {
  resolve(token: string, _uri?: string): ChatMentionMeta | null {
    if (token === diffCommentsMention.id) return diffCommentsMention;
    const issue = parseIssueMentionToken(token);
    if (issue) {
      return {
        id: issue.token,
        label: issue.token,
        name: issue.identifier,
        kind: 'issue',
        iconUrl: issueMentionIconUrl(issue.provider),
      };
    }

    return workspaceFileMentionProvider.resolve(token);
  }
}

export const chatMentionProvider = new ChatMentionProvider();
