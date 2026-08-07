import { createScope } from '@emdash/shared/concurrency';
import { snapshot } from '@emdash/wire/state';
import { describe, expect, it } from 'vitest';
import { gitPath } from '#runtimes/git/node/testing/paths';
import { FileDiffRegistry } from './file-diff-registry';

describe('FileDiffRegistry', () => {
  it('keys staleness by file and normalized target', async () => {
    const registry = new FileDiffRegistry({});
    const scope = createScope({ label: 'file-diff-registry-test' });
    try {
      const branchState = registry.state(
        {
          filePath: gitPath('src/a.ts'),
          target: {
            kind: 'working-vs-ref',
            ref: {
              kind: 'branch',
              branch: { type: 'local', branch: 'main' },
            },
          },
        },
        scope
      );
      const commitState = registry.state(
        {
          filePath: gitPath('src/a.ts'),
          target: { kind: 'working-vs-ref', ref: { kind: 'commit', sha: 'a'.repeat(40) } },
        },
        scope
      );

      registry.bump('all', 'ref-changed');

      expect(snapshot(branchState).value).toEqual({ revision: 1, lastReason: 'ref-changed' });
      expect(snapshot(commitState).value).toEqual({ revision: 0 });
    } finally {
      await scope.dispose();
      registry.dispose();
    }
  });

  it('invalidates only matching paths for content changes', async () => {
    const registry = new FileDiffRegistry({});
    const scope = createScope({ label: 'file-diff-registry-test' });
    try {
      const firstState = registry.state(
        {
          filePath: gitPath('a.ts'),
          target: { kind: 'working-vs-head' },
        },
        scope
      );
      const secondState = registry.state(
        {
          filePath: gitPath('b.ts'),
          target: { kind: 'working-vs-head' },
        },
        scope
      );

      registry.bump([gitPath('a.ts')], 'content-changed');

      expect(snapshot(firstState).value).toMatchObject({ revision: 1 });
      expect(snapshot(secondState).value).toMatchObject({ revision: 0 });
    } finally {
      await scope.dispose();
      registry.dispose();
    }
  });
});
