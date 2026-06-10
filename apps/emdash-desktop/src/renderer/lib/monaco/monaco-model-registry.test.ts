import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEAD_REF, STAGED_REF } from '@shared/core/git/git';
import { MonacoModelRegistry } from './monaco-model-registry';

const rpcState = vi.hoisted(() => ({
  indexContent: 'base' as string | null,
  refContent: 'base' as string | null,
  diskContent: 'base' as string,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      fs: {
        readFile: vi.fn(async () => ({
          success: true,
          data: { content: rpcState.diskContent, truncated: false, totalSize: 4 },
        })),
      },
      git: {
        getFileAtIndex: vi.fn(async () => ({
          success: true,
          data: { content: rpcState.indexContent },
        })),
        getFileAtRef: vi.fn(async () => ({
          success: true,
          data: { content: rpcState.refContent },
        })),
      },
      editor: {
        saveBuffer: vi.fn(),
        clearBuffer: vi.fn(),
      },
    },
  },
}));

class FakeModel {
  private value: string;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(
    value: string,
    readonly uri: { toString(): string; scheme: string }
  ) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  applyEdits(edits: Array<{ text: string }>): void {
    this.setValue(edits[0]?.text ?? '');
  }

  getFullModelRange(): unknown {
    return {};
  }

  onDidChangeContent(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function makeFakeMonaco() {
  const models = new Map<string, FakeModel>();
  return {
    Uri: {
      parse(value: string) {
        return {
          scheme: value.split(':')[0] ?? '',
          toString: () => value,
        };
      },
    },
    editor: {
      getModel(uri: { toString(): string }) {
        return models.get(uri.toString()) ?? null;
      },
      createModel(content: string, _language: string, uri: { toString(): string; scheme: string }) {
        const model = new FakeModel(content, uri);
        models.set(uri.toString(), model);
        return model;
      },
    },
  };
}

describe('MonacoModelRegistry', () => {
  beforeEach(() => {
    rpcState.indexContent = 'base';
    rpcState.refContent = 'base';
    rpcState.diskContent = 'base';
  });

  it('bumps bufferVersions when a disk reload updates a clean open buffer', async () => {
    // Regression: a disk-driven reload (e.g. after discard) updates the buffer
    // model's content, but the onDidChangeContent listener bails while
    // reloadingFromDisk is set and never bumps bufferVersions. Read-only reactive
    // consumers (the rendered markdown/html/svg preview) subscribe to
    // bufferVersions, so without an explicit bump they stay stale until remount.
    const registry = new MonacoModelRegistry();
    registry.notifyMonacoReady(makeFakeMonaco() as never);

    const projectId = 'project';
    const workspaceId = 'workspace';
    const root = `workspace:${workspaceId}`;
    const filePath = 'README.md';
    const language = 'markdown';

    rpcState.diskContent = 'base';
    const uri = await registry.registerModel(
      projectId,
      workspaceId,
      root,
      filePath,
      language,
      'disk'
    );
    await registry.registerModel(projectId, workspaceId, root, filePath, language, 'buffer');
    const diskUri = registry.toDiskUri(uri);

    expect(registry.getValue(uri)).toBe('base');
    const versionBefore = registry.bufferVersions.get(uri) ?? 0;

    // Simulate discard / external revert: disk now holds the reverted content.
    rpcState.diskContent = 'reverted';
    await registry.invalidateModel(diskUri);

    expect(registry.getValue(uri)).toBe('reverted');
    expect(registry.bufferVersions.get(uri) ?? 0).toBeGreaterThan(versionBefore);
  });

  it('bumps bufferVersions when accepting incoming disk content for a conflicted buffer', async () => {
    // Same regression as above, conflict-dialog path: reloadFromDisk ("Accept
    // Incoming") sets the buffer from disk while reloadingFromDisk suppresses
    // the onDidChangeContent listener, so it must bump bufferVersions itself.
    const registry = new MonacoModelRegistry();
    registry.notifyMonacoReady(makeFakeMonaco() as never);

    const projectId = 'project';
    const workspaceId = 'workspace';
    const root = `workspace:${workspaceId}`;
    const filePath = 'README.md';
    const language = 'markdown';

    rpcState.diskContent = 'base';
    const uri = await registry.registerModel(
      projectId,
      workspaceId,
      root,
      filePath,
      language,
      'disk'
    );
    await registry.registerModel(projectId, workspaceId, root, filePath, language, 'buffer');
    const diskUri = registry.toDiskUri(uri);

    // User edits the buffer, then the file changes on disk underneath them:
    // applyDiskUpdate must record a conflict instead of clobbering the edit.
    registry.getModelByUri(uri)?.setValue('user edit');
    expect(registry.isDirty(uri)).toBe(true);
    rpcState.diskContent = 'external change';
    await registry.invalidateModel(diskUri);

    expect(registry.hasPendingConflict(uri)).toBe(true);
    expect(registry.getValue(uri)).toBe('user edit');
    const versionBefore = registry.bufferVersions.get(uri) ?? 0;

    registry.reloadFromDisk(uri);

    expect(registry.getValue(uri)).toBe('external change');
    expect(registry.isDirty(uri)).toBe(false);
    expect(registry.hasPendingConflict(uri)).toBe(false);
    expect(registry.bufferVersions.get(uri) ?? 0).toBeGreaterThan(versionBefore);
  });

  it('clears a staged git model when the index no longer contains the file', async () => {
    const registry = new MonacoModelRegistry();
    registry.notifyMonacoReady(makeFakeMonaco() as never);

    const projectId = 'project';
    const workspaceId = 'workspace';
    const root = `workspace:${workspaceId}`;
    const filePath = 'file.ts';
    const language = 'typescript';

    rpcState.indexContent = 'new file contents';
    const uri = await registry.registerModel(
      projectId,
      workspaceId,
      root,
      filePath,
      language,
      'git',
      STAGED_REF
    );
    const stagedUri = registry.toGitUri(uri, STAGED_REF);

    expect(registry.getModelByUri(stagedUri)?.getValue()).toBe('new file contents');

    rpcState.indexContent = null;
    await registry.invalidateModel(stagedUri);

    expect(registry.getModelByUri(stagedUri)?.getValue()).toBe('');
  });

  it('clears a non-staged git model when the ref no longer contains the file', async () => {
    const registry = new MonacoModelRegistry();
    registry.notifyMonacoReady(makeFakeMonaco() as never);

    const projectId = 'project';
    const workspaceId = 'workspace';
    const root = `workspace:${workspaceId}`;
    const filePath = 'file.ts';
    const language = 'typescript';

    rpcState.refContent = 'head file contents';
    const uri = await registry.registerModel(
      projectId,
      workspaceId,
      root,
      filePath,
      language,
      'git',
      HEAD_REF
    );
    const headUri = registry.toGitUri(uri, HEAD_REF);

    expect(registry.getModelByUri(headUri)?.getValue()).toBe('head file contents');

    rpcState.refContent = null;
    await registry.invalidateModel(headUri);

    expect(registry.getModelByUri(headUri)?.getValue()).toBe('');
  });
});
