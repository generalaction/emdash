import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEAD_REF, STAGED_REF } from '@shared/core/git/types';
import { MonacoModelRegistry } from './monaco-model-registry';

const rpcState = vi.hoisted(() => ({
  indexContent: 'base' as string | null,
  refContent: 'base' as string | null,
  diskContent: 'base' as string,
  indexSuccess: true,
  refSuccess: true,
  diskSuccess: true,
  diskTruncated: false,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      gitWorktree: {
        getFileAtIndex: vi.fn(async () =>
          rpcState.indexSuccess
            ? { success: true, data: { content: rpcState.indexContent } }
            : { success: false, error: 'index failed' }
        ),
        getFileAtRef: vi.fn(async () =>
          rpcState.refSuccess
            ? { success: true, data: { content: rpcState.refContent } }
            : { success: false, error: 'ref failed' }
        ),
      },
      fs: {
        readFile: vi.fn(async () =>
          rpcState.diskSuccess
            ? {
                success: true,
                data: {
                  content: rpcState.diskContent,
                  truncated: rpcState.diskTruncated,
                  totalSize: rpcState.diskContent.length,
                },
              }
            : { success: false, error: 'read failed' }
        ),
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
    rpcState.indexSuccess = true;
    rpcState.refSuccess = true;
    rpcState.diskSuccess = true;
    rpcState.diskTruncated = false;
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

  it('refreshes a pending-eviction git model before reusing it', async () => {
    vi.useFakeTimers();
    try {
      const registry = new MonacoModelRegistry();
      registry.notifyMonacoReady(makeFakeMonaco() as never);

      const projectId = 'project';
      const workspaceId = 'workspace';
      const root = `workspace:${workspaceId}`;
      const filePath = 'file.ts';
      const language = 'typescript';

      rpcState.refContent = 'branch-a contents';
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
      expect(registry.getModelByUri(headUri)?.getValue()).toBe('branch-a contents');

      registry.unregisterModel(headUri);
      rpcState.refContent = 'branch-b contents';

      await registry.registerModel(
        projectId,
        workspaceId,
        root,
        filePath,
        language,
        'git',
        HEAD_REF
      );

      expect(registry.getModelByUri(headUri)?.getValue()).toBe('branch-b contents');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('refreshes a pending-eviction disk model before reseeding a reopened buffer', async () => {
    vi.useFakeTimers();
    try {
      const registry = new MonacoModelRegistry();
      registry.notifyMonacoReady(makeFakeMonaco() as never);

      const projectId = 'project';
      const workspaceId = 'workspace';
      const root = `workspace:${workspaceId}`;
      const filePath = 'file.ts';
      const language = 'typescript';

      rpcState.diskContent = 'branch-a disk';
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
      expect(registry.getDiskValue(uri)).toBe('branch-a disk');
      expect(registry.getValue(uri)).toBe('branch-a disk');

      registry.unregisterModel(uri);
      registry.unregisterModel(diskUri);
      rpcState.diskContent = 'branch-b disk';

      await registry.registerModel(projectId, workspaceId, root, filePath, language, 'disk');
      await registry.registerModel(projectId, workspaceId, root, filePath, language, 'buffer');

      expect(registry.getDiskValue(uri)).toBe('branch-b disk');
      expect(registry.getValue(uri)).toBe('branch-b disk');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('clears stale git content when a pending-eviction git model refresh fails', async () => {
    vi.useFakeTimers();
    try {
      const registry = new MonacoModelRegistry();
      registry.notifyMonacoReady(makeFakeMonaco() as never);

      const projectId = 'project';
      const workspaceId = 'workspace';
      const root = `workspace:${workspaceId}`;
      const filePath = 'file.ts';
      const language = 'typescript';

      rpcState.refContent = 'branch-a contents';
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
      registry.unregisterModel(headUri);

      rpcState.refSuccess = false;
      await registry.registerModel(
        projectId,
        workspaceId,
        root,
        filePath,
        language,
        'git',
        HEAD_REF
      );

      expect(registry.modelStatus.get(headUri)).toBe('error');
      expect(registry.getModelByUri(headUri)?.getValue()).toBe('');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('clears stale disk content when a pending-eviction disk model refresh fails', async () => {
    vi.useFakeTimers();
    try {
      const registry = new MonacoModelRegistry();
      registry.notifyMonacoReady(makeFakeMonaco() as never);

      const projectId = 'project';
      const workspaceId = 'workspace';
      const root = `workspace:${workspaceId}`;
      const filePath = 'file.ts';
      const language = 'typescript';

      rpcState.diskContent = 'branch-a disk';
      const uri = await registry.registerModel(
        projectId,
        workspaceId,
        root,
        filePath,
        language,
        'disk'
      );
      const diskUri = registry.toDiskUri(uri);
      registry.unregisterModel(diskUri);

      rpcState.diskSuccess = false;
      await registry.registerModel(projectId, workspaceId, root, filePath, language, 'disk');

      expect(registry.modelStatus.get(diskUri)).toBe('error');
      expect(registry.getDiskValue(uri)).toBe('');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
