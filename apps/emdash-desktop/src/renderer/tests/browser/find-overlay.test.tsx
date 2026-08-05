import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FindOverlay } from '@renderer/lib/find/find-overlay';
import type { FindSearchStatus } from '@renderer/lib/find/types';

const EMPTY_STATUS: FindSearchStatus = { found: false, currentIndex: 0, total: 0 };
const FOUND_STATUS: FindSearchStatus = { found: true, currentIndex: 2, total: 5 };

function baseProps() {
  return {
    isOpen: true,
    searchQuery: '',
    searchStatus: EMPTY_STATUS,
    searchInputRef: React.createRef<HTMLInputElement>(),
    onQueryChange: () => {},
    onStep: () => {},
    onClose: () => {},
  };
}

describe('FindOverlay', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(element: React.ReactElement) {
    act(() => root.render(element));
    return container;
  }

  it('renders nothing when closed', () => {
    const el = render(<FindOverlay {...baseProps()} isOpen={false} />);
    expect(el.innerHTML).toBe('');
  });

  it('shows prev/next chevrons and a "current/total" count by default', () => {
    const el = render(
      <FindOverlay {...baseProps()} searchQuery="foo" searchStatus={FOUND_STATUS} />
    );
    expect(el.querySelector('[aria-label="Previous match"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Next match"]')).not.toBeNull();
    expect(el.textContent).toContain('2/5');
  });

  it('hides the chevrons and shows a bare total when hideStepControls is set', () => {
    const el = render(
      <FindOverlay
        {...baseProps()}
        hideStepControls
        searchQuery="foo"
        searchStatus={FOUND_STATUS}
      />
    );
    expect(el.querySelector('[aria-label="Previous match"]')).toBeNull();
    expect(el.querySelector('[aria-label="Next match"]')).toBeNull();
    expect(el.textContent).not.toContain('2/5');
    expect(el.textContent).toContain('5');
    // The close button is still present in every mode.
    expect(el.querySelector('[aria-label="Close find"]')).not.toBeNull();
  });

  it('shows "0/0" for an empty query in step-cycling mode', () => {
    const el = render(<FindOverlay {...baseProps()} />);
    expect(el.textContent).toContain('0/0');
  });

  it('shows nothing (not "0/0") for an empty query in hideStepControls mode', () => {
    const el = render(<FindOverlay {...baseProps()} hideStepControls />);
    expect(el.textContent).not.toContain('0/0');
  });

  it('renders in normal flow (no floating positioning classes) when inline is set', () => {
    const el = render(<FindOverlay {...baseProps()} inline />);
    const card = el.firstElementChild as HTMLElement;
    expect(card.className).not.toContain('absolute');
  });

  it('renders as a floating overlay anchored top-right by default', () => {
    const el = render(<FindOverlay {...baseProps()} />);
    const card = el.firstElementChild as HTMLElement;
    expect(card.className).toContain('absolute');
    expect(card.className).toContain('right-3');
  });

  it('spans the full width when fullWidth is set on a floating overlay', () => {
    const el = render(<FindOverlay {...baseProps()} fullWidth />);
    const card = el.firstElementChild as HTMLElement;
    expect(card.className).toContain('left-3');
    expect(card.className).toContain('max-w-none');
  });

  it('disables the chevrons when there are no matches, even with a query', () => {
    const el = render(
      <FindOverlay {...baseProps()} searchQuery="xyz" searchStatus={EMPTY_STATUS} />
    );
    const prev = el.querySelector('[aria-label="Previous match"]') as HTMLButtonElement;
    const next = el.querySelector('[aria-label="Next match"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });

  it('enables the chevrons once there are matches', () => {
    const el = render(
      <FindOverlay {...baseProps()} searchQuery="foo" searchStatus={FOUND_STATUS} />
    );
    const prev = el.querySelector('[aria-label="Previous match"]') as HTMLButtonElement;
    const next = el.querySelector('[aria-label="Next match"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
  });

  it('uses custom placeholder and aria-label when provided', () => {
    const el = render(
      <FindOverlay {...baseProps()} placeholder="Find in files..." ariaLabel="Find in file tree" />
    );
    const input = el.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Find in files...');
    expect(input.getAttribute('aria-label')).toBe('Find in file tree');
  });
});
