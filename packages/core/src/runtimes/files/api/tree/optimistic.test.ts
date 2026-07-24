import type { LiveModelMutationCtx } from '@emdash/wire';
import type { PortableRelativePath } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import {
  optimisticCreateDirectory,
  optimisticCreateFile,
  optimisticCopy,
  optimisticDelete,
  optimisticMove,
  optimisticRename,
} from './optimistic';
import { fileTreeModelSchema, type FileTreeModel } from './state';

const ROOT = { root: { kind: 'posix' as const }, segments: ['workspace'] };

describe('file tree optimistic recipes', () => {
  it('inserts files and directories into loaded parents', () => {
    const withFile = applyRecipe(baseModel(), (context) =>
      optimisticCreateFile(context, { path: portable('src/new.ts') })
    );
    expect(withFile.entries['src'].children).toContain('src/new.ts');
    expect(withFile.entries['src/new.ts']).toMatchObject({
      path: 'src/new.ts',
      name: 'new.ts',
      parentPath: 'src',
      kind: 'file',
    });

    const withDirectory = applyRecipe(withFile, (context) =>
      optimisticCreateDirectory(context, { path: portable('src/new-dir') })
    );
    expect(withDirectory.entries['src/new-dir']).toMatchObject({
      kind: 'directory',
      childrenLoaded: false,
      children: [],
      hasChildren: false,
    });
  });

  it('skips creates for unloaded parents', () => {
    const model = baseModel();
    model.entries['src/components'].childrenLoaded = false;
    model.entries['src/components'].children = [];
    delete model.entries['src/components/button.tsx'];

    const next = applyRecipe(model, (context) =>
      optimisticCreateFile(context, { path: portable('src/components/new.tsx') })
    );

    expect(next.entries['src/components/new.tsx']).toBeUndefined();
  });

  it('removes deleted subtrees and parent child references', () => {
    const next = applyRecipe(baseModel(), (context) =>
      optimisticDelete(context, { path: portable('src/components') })
    );

    expect(next.entries['src/components']).toBeUndefined();
    expect(next.entries['src/components/button.tsx']).toBeUndefined();
    expect(next.entries['src'].children).toEqual(['src/app.ts']);
  });

  it('renames files in place', () => {
    const next = applyRecipe(baseModel(), (context) =>
      optimisticRename(context, { from: portable('src/app.ts'), to: portable('src/main.ts') })
    );

    expect(next.entries['src/app.ts']).toBeUndefined();
    expect(next.entries['src/main.ts']).toMatchObject({
      name: 'main.ts',
      parentPath: 'src',
      kind: 'file',
    });
    expect(next.entries['src'].children).toEqual(['src/components', 'src/main.ts']);
  });

  it('moves directories as unloaded top entries to match server reconciliation', () => {
    const next = applyRecipe(baseModel(), (context) =>
      optimisticMove(context, { from: portable('src/components'), to: portable('components') })
    );

    expect(next.entries['src/components']).toBeUndefined();
    expect(next.entries['src/components/button.tsx']).toBeUndefined();
    expect(next.entries.components).toMatchObject({
      path: 'components',
      name: 'components',
      parentPath: '',
      kind: 'directory',
      childrenLoaded: false,
      children: [],
      hasChildren: true,
    });
    expect(next.entries[''].children).toContain('components');
    expect(next.entries.src.children).toEqual(['src/app.ts']);
  });

  it('copies entries as unloaded top entries without removing the source', () => {
    const next = applyRecipe(baseModel(), (context) =>
      optimisticCopy(context, {
        from: portable('src/components'),
        to: portable('components copy'),
      })
    );

    expect(next.entries['src/components']).toBeDefined();
    expect(next.entries['src/components/button.tsx']).toBeDefined();
    expect(next.entries['components copy']).toMatchObject({
      path: 'components copy',
      name: 'components copy',
      parentPath: '',
      kind: 'directory',
      childrenLoaded: false,
      children: [],
      hasChildren: true,
    });
    expect(next.entries[''].children).toContain('components copy');
  });
});

function applyRecipe(
  model: FileTreeModel,
  recipe: (context: LiveModelMutationCtx) => unknown
): FileTreeModel {
  const next = structuredClone(model);
  recipe({
    mutationId: 'test',
    key: {},
    produce(_name, mutator) {
      mutator(next as never);
    },
  } as LiveModelMutationCtx);
  return fileTreeModelSchema.parse(next);
}

function baseModel(): FileTreeModel {
  return {
    root: ROOT,
    entries: {
      '': {
        path: portable(''),
        name: 'workspace',
        parentPath: null,
        kind: 'directory',
        childrenLoaded: true,
        children: [portable('src'), portable('README.md')],
        hasChildren: true,
      },
      src: {
        path: portable('src'),
        name: 'src',
        parentPath: portable(''),
        kind: 'directory',
        childrenLoaded: true,
        children: [portable('src/components'), portable('src/app.ts')],
        hasChildren: true,
      },
      'src/components': {
        path: portable('src/components'),
        name: 'components',
        parentPath: portable('src'),
        kind: 'directory',
        childrenLoaded: true,
        children: [portable('src/components/button.tsx')],
        hasChildren: true,
      },
      'src/components/button.tsx': {
        path: portable('src/components/button.tsx'),
        name: 'button.tsx',
        parentPath: portable('src/components'),
        kind: 'file',
        childrenLoaded: false,
        children: [],
      },
      'src/app.ts': {
        path: portable('src/app.ts'),
        name: 'app.ts',
        parentPath: portable('src'),
        kind: 'file',
        childrenLoaded: false,
        children: [],
      },
      'README.md': {
        path: portable('README.md'),
        name: 'README.md',
        parentPath: portable(''),
        kind: 'file',
        childrenLoaded: false,
        children: [],
      },
    },
  };
}

function portable(path: string): PortableRelativePath {
  return path as PortableRelativePath;
}
