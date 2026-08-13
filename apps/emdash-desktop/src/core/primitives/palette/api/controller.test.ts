import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@emdash/shared/testing';
import { PaletteController } from './controller';
import { definePaletteProviderCatalog } from './provider-catalog';
import type {
  PaletteMatchBand,
  PaletteProviderDef,
  PaletteProviderKind,
  PaletteProviderKeyword,
  PaletteProviderMatch,
} from './provider';

function matches(prefix: string, count: number, band: PaletteMatchBand): PaletteProviderMatch[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
    relevance: { band, score: 1 },
  }));
}

function provider({
  kind,
  keyword,
  results,
}: {
  kind: PaletteProviderKind;
  keyword: PaletteProviderKeyword;
  results: PaletteProviderMatch[];
}): PaletteProviderDef {
  return {
    kind,
    keyword,
    minQueryLength: 1,
    search: () => results,
    render: () => null,
  };
}

describe('PaletteController', () => {
  it('merges structured relevance with per-provider and total caps', async () => {
    const controller = new PaletteController(
      definePaletteProviderCatalog([
        provider({
          kind: 'commands',
          keyword: '@commands',
          results: matches('command', 15, 'fuzzy'),
        }),
        provider({
          kind: 'files',
          keyword: '@files',
          results: matches('file', 15, 'exact'),
        }),
      ])
    );

    await controller.setInput('theme', {});

    const results = controller.getSnapshot().results;
    expect(results).toHaveLength(20);
    expect(results.slice(0, 12).map(({ provider }) => provider.kind)).toEqual(
      Array(12).fill('files')
    );
    expect(results.filter(({ provider }) => provider.kind === 'commands')).toHaveLength(8);
  });

  it('runs only the keyword provider and keeps its minimum query length', async () => {
    const commandSearch = vi.fn(() => matches('command', 2, 'exact'));
    const fileSearch = vi.fn(() => matches('file', 15, 'exact'));
    const controller = new PaletteController(
      definePaletteProviderCatalog([
        {
          ...provider({
            kind: 'commands',
            keyword: '@commands',
            results: [],
          }),
          search: commandSearch,
        },
        {
          ...provider({ kind: 'files', keyword: '@files', results: [] }),
          minQueryLength: 2,
          search: fileSearch,
        },
      ])
    );

    await controller.setInput('@files x', {});
    expect(controller.getSnapshot().results).toEqual([]);
    expect(commandSearch).not.toHaveBeenCalled();
    expect(fileSearch).not.toHaveBeenCalled();

    await controller.setInput('@files xx', {});
    expect(controller.getSnapshot().mode?.keyword).toBe('@files');
    expect(controller.getSnapshot().results).toHaveLength(15);
    expect(commandSearch).not.toHaveBeenCalled();
    expect(fileSearch).toHaveBeenCalledWith({ query: 'xx', context: {} });
  });

  it('publishes progressive results without moving a surviving selection', async () => {
    const fileResults = deferred<PaletteProviderMatch[]>();
    const controller = new PaletteController(
      definePaletteProviderCatalog([
        provider({
          kind: 'commands',
          keyword: '@commands',
          results: matches('command', 2, 'fuzzy'),
        }),
        {
          ...provider({ kind: 'files', keyword: '@files', results: [] }),
          search: () => fileResults.promise,
        },
      ])
    );

    const settled = controller.setInput('theme', {});
    expect(controller.getSnapshot().results.map(({ identity }) => identity)).toEqual([
      'commands:command-0',
      'commands:command-1',
    ]);

    controller.select('commands:command-1');
    fileResults.resolve(matches('file', 2, 'exact'));
    await settled;

    expect(controller.getSnapshot().results[0]?.identity).toBe('files:file-0');
    expect(controller.getSnapshot().selectedIdentity).toBe('commands:command-1');
  });

  it('discards results from older query generations', async () => {
    const first = deferred<PaletteProviderMatch[]>();
    const second = deferred<PaletteProviderMatch[]>();
    const controller = new PaletteController(
      definePaletteProviderCatalog([
        {
          ...provider({ kind: 'files', keyword: '@files', results: [] }),
          search: ({ query }) => (query === 'first' ? first.promise : second.promise),
        },
      ])
    );

    const firstSettled = controller.setInput('first', {});
    const secondSettled = controller.setInput('second', {});
    second.resolve(matches('second', 1, 'exact'));
    await secondSettled;
    expect(controller.getSnapshot().results[0]?.match.id).toBe('second-0');

    first.resolve(matches('first', 1, 'exact'));
    await firstSettled;
    expect(controller.getSnapshot().results[0]?.match.id).toBe('second-0');
  });

  it('uses context and recency only inside a match band and resolves ties deterministically', async () => {
    const controller = new PaletteController(
      definePaletteProviderCatalog([
        {
          ...provider({ kind: 'commands', keyword: '@commands', results: [] }),
          search: () => [
            {
              id: 'prefix',
              title: 'Prefix',
              relevance: { band: 'prefix', score: 0.5 },
            },
            {
              id: 'older',
              title: 'Older',
              relevance: { band: 'fuzzy', score: 0.8, contextAffinity: 1, recency: 1 },
            },
            {
              id: 'newer',
              title: 'Newer',
              relevance: { band: 'fuzzy', score: 0.8, contextAffinity: 1, recency: 2 },
            },
          ],
        },
        {
          ...provider({ kind: 'files', keyword: '@files', results: [] }),
          search: () => [
            {
              id: 'context-heavy',
              title: 'Context heavy',
              relevance: { band: 'fuzzy', score: 0.8, contextAffinity: 100, recency: 100 },
            },
          ],
        },
      ])
    );

    await controller.setInput('x', {});

    expect(controller.getSnapshot().results.map(({ identity }) => identity)).toEqual([
      'commands:prefix',
      'files:context-heavy',
      'commands:newer',
      'commands:older',
    ]);
  });
});
