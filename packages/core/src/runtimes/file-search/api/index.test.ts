import { describe, expect, it } from 'vitest';
import * as fileSearch from './index';

describe('@emdash/core/runtimes/file-search/api public exports', () => {
  it('exports the Wire contract and portable schemas', () => {
    const exported = fileSearch as Record<string, unknown>;

    expect(exported.fileSearchContract).toBeTypeOf('object');
    expect(exported.fileSearchRootInputSchema).toBeTypeOf('object');
    expect(exported.fileSearchQuerySchema).toBeTypeOf('object');
    expect(exported.fileSearchResultSchema).toBeTypeOf('object');
  });

  it('does not expose host runtime values', () => {
    const exported = fileSearch as Record<string, unknown>;

    expect(exported.FileSearchRuntime).toBeUndefined();
    expect(exported.FileSearchStore).toBeUndefined();
  });
});
