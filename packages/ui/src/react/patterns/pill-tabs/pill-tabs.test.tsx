/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPillTabId, PillTabs, type PillTab } from './pill-tabs';

type Section = 'system' | 'workspaces' | 'settings';

const items: readonly PillTab<Section>[] = [
  { value: 'system', label: 'System', icon: <span data-testid="system-icon" /> },
  { value: 'workspaces', label: 'Workspaces', icon: <span data-testid="workspaces-icon" /> },
  { value: 'settings', label: 'Settings', icon: <span data-testid="settings-icon" /> },
];

afterEach(cleanup);

describe('PillTabs', () => {
  it('renders opaque item icons through a decorative authoritative-size slot', () => {
    render(<PillTabs items={items} value="system" onValueChange={() => {}} ariaLabel="Sections" />);

    const icon = screen.getByTestId('system-icon');
    expect(icon.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('updates controlled selection in active-only label mode', () => {
    const onValueChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<Section>('system');
      return (
        <PillTabs
          items={items}
          value={value}
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
          ariaLabel="Machine sections"
          panelId="machine-panel"
          labelVisibility="active-only"
        />
      );
    }

    render(<Harness />);

    const system = screen.getByRole('tab', { name: 'System' });
    const workspaces = screen.getByRole('tab', { name: 'Workspaces' });
    expect(screen.getByRole('tablist', { name: 'Machine sections' })).not.toBeNull();
    expect(system.getAttribute('aria-selected')).toBe('true');
    expect(workspaces.getAttribute('aria-controls')).toBe('machine-panel');
    expect(workspaces.id).toBe(getPillTabId('machine-panel', 'workspaces'));

    fireEvent.click(workspaces);

    expect(onValueChange).toHaveBeenLastCalledWith('workspaces');
    expect(workspaces.getAttribute('aria-selected')).toBe('true');
  });

  it('uses Base UI keyboard navigation', async () => {
    function Harness() {
      const [value, setValue] = useState<Section>('system');
      return <PillTabs items={items} value={value} onValueChange={setValue} ariaLabel="Sections" />;
    }

    render(<Harness />);

    const system = screen.getByRole('tab', { name: 'System' });
    const workspaces = screen.getByRole('tab', { name: 'Workspaces' });

    system.focus();
    fireEvent.keyDown(system, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(document.activeElement).toBe(workspaces);
      expect(workspaces.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('does not select disabled tabs', () => {
    const onValueChange = vi.fn();
    render(
      <PillTabs
        items={items.map((item) => ({
          ...item,
          disabled: item.value === 'workspaces',
        }))}
        value="system"
        onValueChange={onValueChange}
        ariaLabel="Sections"
      />
    );

    const workspaces = screen.getByRole('tab', { name: 'Workspaces' });
    expect(workspaces.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(workspaces);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('applies caller className to the rendered tablist root', () => {
    render(
      <PillTabs
        items={items}
        value="system"
        onValueChange={() => {}}
        ariaLabel="Sections"
        className="caller-tabs"
      />
    );

    expect(
      screen.getByRole('tablist', { name: 'Sections' }).classList.contains('caller-tabs')
    ).toBe(true);
  });
});
