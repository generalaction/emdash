import { gitPath } from '@runtimes/git/node/testing/paths';
import { describe, expect, it } from 'vitest';
import { FileDiffRegistry } from './file-diff-registry';

describe('FileDiffRegistry', () => {
  it('keys staleness by file and normalized target', async () => {
    const registry = new FileDiffRegistry({});
    const branch = registry.acquire({
      filePath: gitPath('src/a.ts'),
      target: {
        kind: 'working-vs-ref',
        ref: {
          kind: 'branch',
          branch: { type: 'local', branch: 'main' },
        },
      },
    });
    const commit = registry.acquire({
      filePath: gitPath('src/a.ts'),
      target: { kind: 'working-vs-ref', ref: { kind: 'commit', sha: 'a'.repeat(40) } },
    });
    const branchState = await branch.ready();
    const commitState = await commit.ready();

    registry.bump('all', 'ref-changed');

    expect(await branchState.snapshot()).toMatchObject({
      data: { revision: 1, lastReason: 'ref-changed' },
    });
    expect(await commitState.snapshot()).toMatchObject({ data: { revision: 0 } });
    await branch.release();
    await commit.release();
    registry.dispose();
  });

  it('invalidates only matching paths for content changes', async () => {
    const registry = new FileDiffRegistry({});
    const first = registry.acquire({
      filePath: gitPath('a.ts'),
      target: { kind: 'working-vs-head' },
    });
    const second = registry.acquire({
      filePath: gitPath('b.ts'),
      target: { kind: 'working-vs-head' },
    });
    const firstState = await first.ready();
    const secondState = await second.ready();

    registry.bump([gitPath('a.ts')], 'content-changed');

    expect(await firstState.snapshot()).toMatchObject({ data: { revision: 1 } });
    expect(await secondState.snapshot()).toMatchObject({ data: { revision: 0 } });
    await first.release();
    await second.release();
    registry.dispose();
  });
});
