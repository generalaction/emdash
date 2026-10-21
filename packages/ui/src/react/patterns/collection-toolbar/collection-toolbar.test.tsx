/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CollectionToolbar } from '.';
import { Button } from '../../primitives/button';

function ControlledToolbar() {
  const [searchValue, setSearchValue] = useState('agent');

  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        value={searchValue}
        onValueChange={setSearchValue}
        placeholder="Search agents…"
      />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <span>2 agents</span>
        <Button variant="primary">Add agent</Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
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

  it('renders composed content in explicit layout slots', () => {
    const { container } = render(<ControlledToolbar />);

    expect(
      container.querySelector('[data-slot="collection-toolbar-group"]')?.textContent
    ).toContain('2 agents');
    expect(
      container.querySelector('[data-slot="collection-toolbar-group"]')?.textContent
    ).toContain('Add agent');
    expect(container.querySelector('[data-slot="collection-toolbar-spacer"]')).not.toBeNull();
  });

  it('forwards root and search refs to their respective elements', () => {
    const rootRef = createRef<HTMLDivElement>();
    const searchRef = createRef<HTMLInputElement>();
    const { container } = render(
      <CollectionToolbar.Root ref={rootRef}>
        <CollectionToolbar.Search
          ref={searchRef}
          value=""
          onValueChange={() => {}}
          placeholder="Search agents…"
        />
      </CollectionToolbar.Root>
    );

    expect(rootRef.current).toBe(container.querySelector('[data-slot="collection-toolbar"]'));
    expect(searchRef.current).toBe(container.querySelector('input[type="search"]'));
  });

  it('renders a toolbar-sized vertical separator', () => {
    const { container } = render(
      <CollectionToolbar.Root>
        <CollectionToolbar.Separator />
      </CollectionToolbar.Root>
    );

    expect(
      container.querySelector(
        '[data-slot="collection-toolbar-separator"] [data-orientation="vertical"]'
      )
    ).not.toBeNull();
  });
});
