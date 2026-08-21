import { describe, expect, it, vi } from 'vitest';
import { classifyTranscriptLink, createTranscriptFileCommands } from './transcript-file-commands';

describe('classifyTranscriptLink', () => {
  it.each([
    ['src/auth/jwt.ts', 'src/auth/jwt.ts'],
    ['./src/app.ts', './src/app.ts'],
    ['../shared/types.ts', '../shared/types.ts'],
    ['/home/dev/repo/src/app.ts', '/home/dev/repo/src/app.ts'],
    ['C:\\Users\\dev\\repo\\src\\app.ts', 'C:\\Users\\dev\\repo\\src\\app.ts'],
    ['D:/repo/src/app.ts', 'D:/repo/src/app.ts'],
    ['\\\\server\\share\\repo\\src\\app.ts', '\\\\server\\share\\repo\\src\\app.ts'],
    ['docs/Architecture Notes.md', 'docs/Architecture Notes.md'],
    ['README', 'README'],
    ['src/app.ts:42', 'src/app.ts'],
    ['src/app.ts:42:7', 'src/app.ts'],
    ['/home/dev/repo/src/app.ts:42', '/home/dev/repo/src/app.ts'],
    ['C:\\repo\\src\\app.ts:42:7', 'C:\\repo\\src\\app.ts'],
    ['README.md:42', 'README.md'],
    ['src/app.ts#L42', 'src/app.ts'],
    ['src/app.ts#L42C7', 'src/app.ts'],
  ])('classifies the path-like href %s as a workspace file', (href, path) => {
    expect(classifyTranscriptLink(href)).toEqual({ kind: 'workspace-file', path });
  });

  it.each([
    'https://example.com/docs',
    'HTTP://example.com/docs',
    'mailto:support@example.com',
    'file:///tmp/report.md',
    'mcp://server/resource',
    'vscode://file/tmp/report.md:42',
    'urn:isbn:123',
    'custom:42',
    '//example.com/docs',
    '#section',
    '?view=raw',
    '',
    '   ',
  ])('keeps the non-file href %j external', (href) => {
    expect(classifyTranscriptLink(href)).toEqual({ kind: 'external' });
  });
});

describe('createTranscriptFileCommands', () => {
  it('opens every chat file source and file mention in the adjacent pane', () => {
    const openFile = vi.fn(async () => {});
    const commands = createTranscriptFileCommands(
      { projectId: 'project-1', taskId: 'task-1' },
      openFile
    );

    for (const source of ['diff', 'file-op', 'resource-link', 'prose-link'] as const) {
      commands.onOpenFile({ path: `src/${source}.ts`, itemId: source, source });
    }
    commands.openMentionFile('src/mention.ts');

    expect(openFile.mock.calls).toEqual([
      ['project-1', 'task-1', 'src/diff.ts'],
      ['project-1', 'task-1', 'src/file-op.ts'],
      ['project-1', 'task-1', 'src/resource-link.ts'],
      ['project-1', 'task-1', 'src/prose-link.ts'],
      ['project-1', 'task-1', 'src/mention.ts'],
    ]);
  });
});
