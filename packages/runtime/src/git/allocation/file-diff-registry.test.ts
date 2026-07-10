import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDiffRegistry } from './file-diff-registry';

describe('FileDiffRegistry', () => {
  it('keys staleness by file and normalized target', async () => {
    const registry = new FileDiffRegistry({ checkoutRoot: path.join(path.sep, 'repo') });
    const branch = registry.acquire({
      filePath: 'src/a.ts',
      target: {
        kind: 'working-vs-ref',
        ref: {
          kind: 'branch',
          branch: { type: 'local', branch: 'main' },
        },
      },
    });
    const commit = registry.acquire({
      filePath: 'src/a.ts',
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
    const registry = new FileDiffRegistry({ checkoutRoot: path.join(path.sep, 'repo') });
    const first = registry.acquire({
      filePath: 'a.ts',
      target: { kind: 'working-vs-head' },
    });
    const second = registry.acquire({
      filePath: 'b.ts',
      target: { kind: 'working-vs-head' },
    });
    const firstState = await first.ready();
    const secondState = await second.ready();

    registry.bump(['a.ts'], 'content-changed');

    expect(await firstState.snapshot()).toMatchObject({ data: { revision: 1 } });
    expect(await secondState.snapshot()).toMatchObject({ data: { revision: 0 } });
    await first.release();
    await second.release();
    registry.dispose();
  });

  it('rejects paths outside the checkout', () => {
    const registry = new FileDiffRegistry({ checkoutRoot: path.join(path.sep, 'repo') });
    expect(() =>
      registry.acquire({
        filePath: '../secret',
        target: { kind: 'working-vs-head' },
      })
    ).toThrow('outside checkout');
    registry.dispose();
  });
});
