import { err, ok } from '@emdash/shared';
import { waitFor } from '@emdash/shared/testing';
import { defineContract, type LiveStateData } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonacoModelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import { sourceControlContract } from '@core/features/source-control/api';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import { HEAD_REF, STAGED_REF, type GitRef } from '@core/primitives/git/api';
import { editorContract, type EditorFileContentModel } from '../../api';

const runtimeClients = vi.hoisted(() => ({
  files: undefined as unknown,
  git: undefined as unknown,
}));
const editorClient = vi.hoisted(() => ({
  clearBuffer: vi.fn().mockResolvedValue(undefined),
  saveBuffer: vi.fn().mockResolvedValue(undefined),
}));
const filesTestContract = defineContract({ content: editorContract.content });
const gitTestContract = defineContract({
  checkout: defineContract({ content: sourceControlContract.checkout.content }),
});

vi.mock('@core/features/editor/api/browser/client', () => ({
  getEditorClient: async () => ({ ...(runtimeClients.files as object), ...editorClient }),
}));

vi.mock('@core/features/source-control/api/browser/client', () => ({
  getSourceControlClient: async () => runtimeClients.git,
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
        return { scheme: value.split(':')[0] ?? '', toString: () => value };
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

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  editorClient.clearBuffer.mockClear();
  editorClient.saveBuffer.mockClear();
});

describe('MonacoModelRegistry live content', () => {
  it('updates clean disk and buffer models from Files live state', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'disk');
    await register(runtime.registry, 'buffer');

    runtime.setFileContent('incoming', 'etag-2');
    await waitFor(() => runtime.registry.getDiskValue(uri) === 'incoming');

    expect(runtime.registry.getValue(uri)).toBe('incoming');
    expect(runtime.registry.isDirty(uri)).toBe(false);
    expect(runtime.registry.bufferVersions.get(uri)).toBe(2);
  });

  it('preserves a dirty buffer and marks a conflict on external file changes', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'disk');
    await register(runtime.registry, 'buffer');
    runtime.registry.getModelByUri(uri)?.setValue('mine');

    runtime.setFileContent('incoming', 'etag-2');
    await waitFor(() => runtime.registry.getDiskValue(uri) === 'incoming');

    expect(runtime.registry.getValue(uri)).toBe('mine');
    expect(runtime.registry.isDirty(uri)).toBe(true);
    expect(runtime.registry.hasPendingConflict(uri)).toBe(true);
    await expect(runtime.registry.saveFileToDisk(uri)).resolves.toBeNull();
    expect(runtime.writePreconditions).toEqual([{ kind: 'etag', etag: 'etag-1' }]);

    const version = runtime.registry.bufferVersions.get(uri);
    runtime.registry.reloadFromDisk(uri);
    expect(runtime.registry.getValue(uri)).toBe('incoming');
    expect(runtime.registry.bufferVersions.get(uri)).toBe((version ?? 0) + 1);
  });

  it('clears a conflict when the buffer is edited to match the incoming content', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'disk');
    await register(runtime.registry, 'buffer');
    runtime.registry.getModelByUri(uri)?.setValue('mine');

    runtime.setFileContent('incoming', 'etag-2');
    await waitFor(() => runtime.registry.hasPendingConflict(uri));
    runtime.registry.getModelByUri(uri)?.setValue('incoming');

    expect(runtime.registry.isDirty(uri)).toBe(false);
    expect(runtime.registry.hasPendingConflict(uri)).toBe(false);

    runtime.registry.getModelByUri(uri)?.setValue('next');
    await expect(runtime.registry.saveFileToDisk(uri)).resolves.toBe('next');
    expect(runtime.writePreconditions).toEqual([{ kind: 'etag', etag: 'etag-2' }]);
  });

  it('updates Git models when checkout content changes or disappears', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'git', STAGED_REF);
    const gitUri = runtime.registry.toGitUri(uri, STAGED_REF);

    runtime.gitState.states.content.set({
      kind: 'missing',
      path: portablePath('file.ts'),
      source: { kind: 'index' },
    });
    await waitFor(() => runtime.registry.getModelByUri(gitUri)?.getValue() === '');

    expect(runtime.registry.getModelByUri(gitUri)?.getValue()).toBe('');
  });

  it('saves every dirty buffer before shutdown', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'disk');
    await register(runtime.registry, 'buffer');
    runtime.registry.getModelByUri(uri)?.setValue('saved');

    await expect(runtime.registry.saveAllDirtyBuffers()).resolves.toBe(true);

    expect(editorClient.clearBuffer).toHaveBeenCalledWith({
      projectId: 'project',
      workspaceId: 'workspace',
      filePath: 'file.ts',
    });
    expect(runtime.registry.isDirty(uri)).toBe(false);
    expect(runtime.registry.getDiskValue(uri)).toBe('saved');
  });

  it('discards dirty buffers and clears their crash-recovery state', async () => {
    const runtime = createRuntime();
    const uri = await register(runtime.registry, 'disk');
    await register(runtime.registry, 'buffer');
    runtime.registry.getModelByUri(uri)?.setValue('discarded');

    await runtime.registry.discardAllDirtyBuffers();

    expect(editorClient.clearBuffer).toHaveBeenCalledWith({
      projectId: 'project',
      workspaceId: 'workspace',
      filePath: 'file.ts',
    });
    expect(runtime.registry.getValue(uri)).toBe('base');
    expect(runtime.registry.isDirty(uri)).toBe(false);
  });
});

function createRuntime() {
  const filePath = portablePath('file.ts');
  const writePreconditions: Array<{ kind: 'etag'; etag: string } | { kind: 'overwrite' }> = [];
  let currentEtag = 'etag-1';
  const filesContent = cell(textContent('base', 'etag-1'));
  const filesHost = expose(
    editorContract.content,
    { content: filesContent },
    {
      mutations: {
        write: (context) => {
          const input = context.input;
          writePreconditions.push(input.precondition);
          if (input.precondition.kind === 'etag' && currentEtag !== input.precondition.etag) {
            return err({
              type: 'etag-mismatch' as const,
              path: filePath,
              expected: input.precondition.etag,
              actual: currentEtag,
            });
          }
          currentEtag = 'etag-saved';
          filesContent.set(textContent(input.content, 'etag-saved'));
          return ok<void>();
        },
      },
    }
  );
  const filesState = { states: { content: filesContent } };
  const setFileContent = (content: string, etag: string) => {
    currentEtag = etag;
    filesState.states.content.set(textContent(content, etag));
  };

  const gitContent = cell<
    LiveStateData<typeof sourceControlContract.checkout.content.states.content>
  >({
    kind: 'text' as const,
    path: filePath,
    source: { kind: 'index' as const },
    oid: 'abc123',
    byteSize: 4,
    content: 'base',
  });
  const gitHost = expose(sourceControlContract.checkout.content, { content: gitContent });
  const gitState = { states: { content: gitContent } };

  const filesWire = createTestWire(filesTestContract, { content: filesHost });
  const gitWire = createTestWire(gitTestContract, { checkout: { content: gitHost } });
  runtimeClients.files = filesWire.client;
  runtimeClients.git = gitWire.client;

  const registry = new MonacoModelRegistry();
  registry.notifyMonacoReady(makeFakeMonaco() as never);
  registry.bindWorkspaceRoot('project', 'workspace', '/repo');
  const runtime = {
    registry,
    filesState,
    gitState,
    filesWire,
    gitWire,
    writePreconditions,
    setFileContent,
  };
  cleanup = async () => {
    await registry.dispose();
    await filesWire.dispose();
    await gitWire.dispose();
  };
  return runtime;
}

function register(
  registry: MonacoModelRegistry,
  type: 'disk' | 'buffer' | 'git',
  ref: GitRef = HEAD_REF
) {
  return registry.registerModel(
    'project',
    'workspace',
    'workspace:workspace',
    'file.ts',
    'typescript',
    type,
    ref
  );
}

function textContent(content: string, etag: string): EditorFileContentModel {
  return {
    kind: 'text',
    path: portablePath('file.ts'),
    etag,
    byteSize: content.length,
    readonly: false,
    content,
    eol: 'lf',
  };
}
