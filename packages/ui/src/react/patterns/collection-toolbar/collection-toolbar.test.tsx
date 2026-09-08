/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CollectionToolbar } from '.';
import { Button } from '../../primitives/button';

afterEach(cleanup);

function ControlledToolbar() {
  const [searchValue, setSearchValue] = useState('agent');

  return (
    <CollectionToolbar
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      searchPlaceholder="Search agents…"
      metadata={<span>2 agents</span>}
      actions={<Button variant="primary">Add agent</Button>}
    />
  );
}

describe('CollectionToolbar', () => {
  it('updates and clears the controlled search value', () => {
    render(<ControlledToolbar />);

    const search = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search agents…' });
    fireEvent.change(search, { target: { value: 'codex' } });
    expect(search.value).toBe('codex');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search.value).toBe('');
  });

  it('renders caller-owned metadata and actions', () => {
    const { container } = render(<ControlledToolbar />);

    expect(container.textContent).toContain('2 agents');
    expect(screen.getByRole('button', { name: 'Add agent' })).not.toBeNull();
  });

  it('applies className to the toolbar root and owns search availability', () => {
    const { container } = render(
      <CollectionToolbar
        searchValue=""
        onSearchValueChange={() => {}}
        searchPlaceholder="Search"
        searchDisabled
        className="caller-toolbar"
      />
    );

    expect(container.firstElementChild?.classList.contains('caller-toolbar')).toBe(true);
    expect(screen.getByRole('searchbox').hasAttribute('disabled')).toBe(true);
  });
});
