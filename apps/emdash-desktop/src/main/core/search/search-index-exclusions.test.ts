import { describe, expect, it } from 'vitest';
import {
  createSearchIndexExclusion,
  isSearchIndexExcludedInsideRoot,
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
