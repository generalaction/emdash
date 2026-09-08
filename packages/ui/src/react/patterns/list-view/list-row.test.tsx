/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListView } from './index';

afterEach(cleanup);

describe('ListView.Row public interface', () => {
  it('owns interactive focus and keyboard activation', () => {
    const onClick = vi.fn();
    render(
      <ListView.Row interactive selected className="caller-row" onClick={onClick}>
        Agent
      </ListView.Row>
    );

    const row = screen.getByRole('button', { name: 'Agent' });
    expect(row.classList.contains('caller-row')).toBe(true);
    expect(row.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps disabled rows out of pointer and keyboard activation', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <ListView.Row interactive disabled onClick={onClick} onKeyDown={onKeyDown}>
        Unavailable
      </ListView.Row>
    );

    const row = screen.getByRole('button', { name: 'Unavailable' });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
