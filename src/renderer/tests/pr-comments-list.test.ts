import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PullRequestComment } from '@shared/pull-requests';
import { CommentsList } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/comments-list';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
  },
}));

function makeComment(body: string): PullRequestComment {
  return {
    id: 'issue-comment:1',
    pullRequestUrl: 'https://github.com/org/repo/pull/1',
    kind: 'issue',
    body,
    url: 'https://github.com/org/repo/pull/1#issuecomment-1',
    author: {
      userId: '1',
      userName: 'arnestrickmann',
      displayName: 'Arne Strickmann',
      avatarUrl: null,
      url: 'https://github.com/arnestrickmann',
      userUpdatedAt: null,
      userCreatedAt: null,
    },
    path: null,
    line: null,
    isResolved: false,
    isOutdated: false,
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
  };
}

describe('CommentsList', () => {
  it('renders HTML image comments from non-bot authors', () => {
    const html = renderToStaticMarkup(
      React.createElement(CommentsList, {
        comments: [
          makeComment('<img width="944" alt="Image" src="https://github.com/user/image.png">'),
        ],
      })
    );

    expect(html).toContain('src="https://github.com/user/image.png"');
    expect(html).toContain('alt="Image"');
    expect(html).toContain('max-w-full');
    expect(html).toContain('max-h-80');
    expect(html).toContain('object-contain');
  });
});
