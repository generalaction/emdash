import { describe, expect, it, vi } from 'vitest';
import { classifyTranscriptLink, createTranscriptFileCommands } from './transcript-file-commands';

vi.mock('@core/features/editor/api/browser/open-file-in-file-editor', () => ({
  openFileInAdjacentPane: vi.fn(),
}));

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
  ])('classifies the path-like href %s as a workspace file', (href, path) => {
    expect(classifyTranscriptLink(href)).toEqual({ kind: 'workspace-file', path });
  });

  it.each([
    ['src/app.ts:42', 'src/app.ts', 42],
    ['src/app.ts:42:7', 'src/app.ts', 42],
    ['/home/dev/repo/src/app.ts:42', '/home/dev/repo/src/app.ts', 42],
    ['C:\\repo\\src\\app.ts:42:7', 'C:\\repo\\src\\app.ts', 42],
    ['README.md:42', 'README.md', 42],
    ['src/app.ts#L42', 'src/app.ts', 42],
    ['src/app.ts#L42C7', 'src/app.ts', 42],
  ])('retains the line in the file href %s', (href, path, line) => {
    expect(classifyTranscriptLink(href)).toEqual({ kind: 'workspace-file', path, line });
  });

  it.each(['src/app.ts:0', 'src/app.ts:9007199254740992'])(
    'opens %s without an invalid line selection',
    (href) => {
      expect(classifyTranscriptLink(href)).toEqual({ kind: 'workspace-file', path: 'src/app.ts' });
    }
  );

  it.each([
    'https://example.com/docs',
    'HTTP://example.com/docs',
    'mailto:support@example.com',
    'file:///tmp/report.md',
    'mcp://server/resource',
    'vscode://file/tmp/report.md:42',
    'https://example.com/docs.ts:42',
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
  it('opens a prose link at the classified line in the adjacent pane', () => {
    const openFile = vi.fn(async () => {});
    const commands = createTranscriptFileCommands(
      { projectId: 'project-1', taskId: 'task-1' },
      openFile
    );
    const classification = commands.classifyLink('src/app.ts:42');
    expect(classification).toEqual({ kind: 'workspace-file', path: 'src/app.ts', line: 42 });
    if (classification.kind !== 'workspace-file') return;

    commands.onOpenFile({
      path: classification.path,
      line: classification.line,
      itemId: 'message-1#0',
      source: 'prose-link',
    });

    expect(openFile).toHaveBeenCalledWith('project-1', 'task-1', 'src/app.ts', { line: 42 });
  });

  it('opens every chat file source and file mention in the adjacent pane', () => {
    const openFile = vi.fn(async () => {});
    const commands = createTranscriptFileCommands(
      { projectId: 'project-1', taskId: 'task-1' },
      openFile
    );

    commands.onOpenFile({ path: 'src/diff.ts', itemId: 'diff', source: 'diff' });
    commands.onOpenFile({
      path: 'src/file-op.ts',
      line: 17,
      itemId: 'file-op',
      source: 'file-op',
    });
    commands.onOpenFile({
      path: 'src/resource-link.ts',
      itemId: 'resource-link',
      source: 'resource-link',
    });
    commands.onOpenFile({
      path: 'src/prose-link.ts',
      itemId: 'prose-link',
      source: 'prose-link',
    });
    commands.openMentionFile('src/mention.ts');

    expect(openFile.mock.calls).toEqual([
      ['project-1', 'task-1', 'src/diff.ts'],
      ['project-1', 'task-1', 'src/file-op.ts', { line: 17 }],
      ['project-1', 'task-1', 'src/resource-link.ts'],
      ['project-1', 'task-1', 'src/prose-link.ts'],
      ['project-1', 'task-1', 'src/mention.ts'],
    ]);
  });
});
