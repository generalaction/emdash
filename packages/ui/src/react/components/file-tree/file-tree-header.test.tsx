/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTreeHeader } from './file-tree-header';

afterEach(cleanup);

describe('FileTreeHeader', () => {
  it('applies className to the header root and preserves caller commands', () => {
    const startDraft = vi.fn();
    render(
      <FileTreeHeader
        targetPath="src"
        startDraft={startDraft}
        collapseAll={() => {}}
        expandAll={() => {}}
        className="caller-tree-header"
      />
    );

    expect(screen.getByRole('banner').classList.contains('caller-tree-header')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(startDraft).toHaveBeenCalledWith('file');
  });
});
