import { filesContract, type FileContentModel } from '@emdash/core/files';
import { gitContract } from '@emdash/core/git';
import { err, ok } from '@emdash/shared';
import { createLiveModelHost, defineContract } from '@emdash/wire';
import { createTestWire, waitFor } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEAD_REF, STAGED_REF, type GitRef } from '@shared/core/git/types';
import { hostPathFromNative, portablePath } from '@shared/core/runtime/paths';
import { MonacoModelRegistry } from './monaco-model-registry';

const runtimeClients = vi.hoisted(() => ({
  files: undefined as unknown,
  git: undefined as unknown,
}));
const filesTestContract = defineContract({ content: filesContract.content });
const gitTestContract = defineContract({
  checkout: defineContract({ content: gitContract.checkout.content }),
});

vi.mock('@renderer/lib/runtime/files-client', () => ({
  getFilesRuntimeClient: async () => runtimeClients.files,
}));

vi.mock('@renderer/lib/runtime/git-client', () => ({
  getGitRuntimeClient: async () => runtimeClients.git,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      editor: {
        clearBuffer: vi.fn().mockResolvedValue(undefined),
        saveBuffer: vi.fn().mockResolvedValue(undefined),
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

    runtime.gitState.states.content.replace({
      kind: 'missing',
      path: portablePath('file.ts'),
      source: { kind: 'index' },
    });
    await waitFor(() => runtime.registry.getModelByUri(gitUri)?.getValue() === '');

    expect(runtime.registry.getModelByUri(gitUri)?.getValue()).toBe('');
  });
});

function createRuntime() {
  const root = hostPathFromNative('/repo');
  const filePath = portablePath('file.ts');
  const contentKey = { root, relative: filePath };
  const writePreconditions: Array<{ kind: 'etag'; etag: string } | { kind: 'overwrite' }> = [];
  let currentEtag = 'etag-1';
  const filesHost = createLiveModelHost(filesContract.content, {
    mutations: {
      write: (context, input) => {
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
        context.produce('content', () => textContent(input.content, 'etag-saved'));
        return ok<void>();
      },
    },
  });
  const filesState = filesHost.create(contentKey, { content: textContent('base', 'etag-1') });
  const setFileContent = (content: string, etag: string) => {
    currentEtag = etag;
    filesState.states.content.replace(textContent(content, etag));
  };

  const gitHost = createLiveModelHost(gitContract.checkout.content);
  const gitState = gitHost.create(
    { checkout: root, path: filePath, source: { kind: 'index' } },
    {
      content: {
        kind: 'text',
        path: filePath,
        source: { kind: 'index' },
        oid: 'abc123',
        byteSize: 4,
        content: 'base',
      },
    }
  );

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

function textContent(content: string, etag: string): FileContentModel {
  return {
    kind: 'text',
    path: portablePath('file.ts'),
    etag,
    byteSize: content.length,
    readonly: false,
    content,
    eol: 'lf',
    truncated: false,
  };
}
