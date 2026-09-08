/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from './file-tree/file-tree';
import { SearchResultsTree } from './search-results-tree/search-results-tree';

afterEach(cleanup);

describe('tree collection root interfaces', () => {
  it('applies FileTree className to its semantic root', () => {
    render(
      <FileTree rootNodes={[]} childrenById={new Map()} className="caller-file-tree" isLoading />
    );

    expect(
      screen.getByRole('region', { name: 'File tree' }).classList.contains('caller-file-tree')
    ).toBe(true);
  });

  it('applies SearchResultsTree className to its tree root', () => {
    render(
      <SearchResultsTree files={[]} onOpenMatch={vi.fn()} className="caller-search-results" />
    );

    expect(
      screen
        .getByRole('tree', { name: 'Search results' })
        .classList.contains('caller-search-results')
    ).toBe(true);
  });
});
