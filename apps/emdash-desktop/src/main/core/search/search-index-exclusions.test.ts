import { describe, expect, it } from 'vitest';
import {
  createSearchIndexExclusion,
  isSearchIndexExcludedInsideRoot,
  SEARCH_INDEX_EXCLUDED_PATH_SEGMENTS,
} from './search-index-exclusions';

describe('search index exclusions', () => {
  it('excludes high-noise paths only under the indexed root', () => {
    expect(isSearchIndexExcludedInsideRoot('/repo', '/repo/node_modules/pkg/index.js')).toBe(true);
    expect(isSearchIndexExcludedInsideRoot('/repo', '/repo/.git/HEAD')).toBe(true);
    expect(isSearchIndexExcludedInsideRoot('/repo', '/repo/src/index.ts')).toBe(false);
    expect(isSearchIndexExcludedInsideRoot('/repo', '/other/node_modules/pkg/index.js')).toBe(
      false
    );
  });

  it('creates a predicate suitable for file enumeration options', () => {
    const exclude = createSearchIndexExclusion('/repo');

    expect(exclude('/repo/dist/bundle.js')).toBe(true);
    expect(exclude('/repo/src/index.ts')).toBe(false);
  });
});

describe('createSearchIndexExclusion extra segments', () => {
  it('excludes .tox by default', () => {
    expect(SEARCH_INDEX_EXCLUDED_PATH_SEGMENTS).toContain('.tox');
    const exclude = createSearchIndexExclusion('/repo');
    expect(exclude('/repo/.tox/py311/lib/foo.py')).toBe(true);
  });

  it('excludes user-supplied additional segments', () => {
    const exclude = createSearchIndexExclusion('/repo', { additionalSegments: ['generated'] });
    expect(exclude('/repo/src/generated/schema.ts')).toBe(true);
    expect(exclude('/repo/src/app.ts')).toBe(false);
  });
});
