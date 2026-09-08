/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ListPopoverCard } from './list-popover-card';

afterEach(cleanup);

describe('ListPopoverCard', () => {
  it('applies card attributes and className to the rendered content root', () => {
    render(
      <ListPopoverCard role="status" className="caller-list-card">
        3 selected
      </ListPopoverCard>
    );

    const card = screen.getByRole('status');
    expect(card.classList.contains('caller-list-card')).toBe(true);
    expect(card.textContent).toBe('3 selected');
  });
});
