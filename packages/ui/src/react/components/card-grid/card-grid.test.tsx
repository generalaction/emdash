/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardGrid, CardGridItem } from './card-grid';

afterEach(cleanup);

describe('CardGrid public component APIs', () => {
  it('applies caller classes to the rendered grid and item roots', () => {
    const { container } = render(
      <CardGrid className="caller-grid">
        <CardGridItem className="caller-card">Filesystem</CardGridItem>
      </CardGrid>
    );

    expect(container.firstElementChild?.classList.contains('caller-grid')).toBe(true);
    expect(screen.getByText('Filesystem').classList.contains('caller-card')).toBe(true);
  });

  it('owns interactive keyboard, selection, and disabled behavior', () => {
    const onOpen = vi.fn();
    const onDisabledKeyDown = vi.fn();
    render(
      <CardGrid>
        <CardGridItem interactive selected onClick={onOpen}>
          Enabled
        </CardGridItem>
        <CardGridItem interactive disabled onClick={onOpen} onKeyDown={onDisabledKeyDown}>
          Disabled
        </CardGridItem>
      </CardGrid>
    );

    const enabled = screen.getByRole('button', { name: 'Enabled' });
    expect(enabled.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(enabled, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);

    const disabled = screen.getByRole('button', { name: 'Disabled' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(disabled);
    fireEvent.keyDown(disabled, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onDisabledKeyDown).not.toHaveBeenCalled();
  });
});
