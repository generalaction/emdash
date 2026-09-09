/**
 * @vitest-environment jsdom
 */

import { tokens } from '@emdash/theme';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChevronDownIcon } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sx } from '../../styles';
import { control } from '../../styles/recipes/control';
import { Button } from './button';
import { Collapsible } from './collapsible';
import { Icon } from './icon';
import { Select } from './select';
import { SplitButton } from './split-button';
import { Tabs } from './tabs/tabs';
import { Toggle } from './toggle';
import { TriggerButton } from './trigger-button';

afterEach(cleanup);

function expectClasses(element: Element, className: string): void {
  for (const part of className.split(' ')) {
    expect(element.classList).toContain(part);
  }
}

describe('control component styling interfaces', () => {
  it('maps Button semantics and static sx overrides onto its root', () => {
    const override = sx({ marginInline: tokens.space.step2 });
    const { getByRole } = render(
      <Button variant="destructive" size="lg" className={override} aria-invalid="true">
        Delete
      </Button>
    );
    const button = getByRole('button', { name: 'Delete' });

    expectClasses(button, control({ emphasis: 'high', size: 'lg', tone: 'destructive' }));
    expect(button.classList).toContain(override);
    expect(button.getAttribute('data-emphasis')).toBe('high');
    expect(button.getAttribute('data-size')).toBe('lg');
    expect(button.getAttribute('data-tone')).toBe('destructive');
    expect(button.getAttribute('aria-invalid')).toBe('true');
  });

  it('delegates Toggle, Tabs, and trigger-style controls to intentional emphases', () => {
    const view = render(
      <>
        <Toggle className="toggle-root" size="sm" tone="success" pressed>
          Pinned
        </Toggle>
        <Tabs.Root defaultValue="one">
          <Tabs.List>
            <Tabs.Tab className="tab-root" value="one">
              One
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>
        <TriggerButton className="trigger-root">Choose</TriggerButton>
        <Select.Root defaultValue="one">
          <Select.Trigger>One</Select.Trigger>
        </Select.Root>
        <Collapsible.Root defaultOpen>
          <Collapsible.Trigger className="collapsible-root">Details</Collapsible.Trigger>
          <Collapsible.Panel>Contents</Collapsible.Panel>
        </Collapsible.Root>
        <Icon source={ChevronDownIcon} data-testid="icon-contract" />
      </>
    );

    const toggle = view.getByRole('button', { name: 'Pinned' });
    const tab = view.getByRole('tab', { name: 'One' });
    const trigger = view.getByRole('button', { name: 'Choose' });
    const selectTrigger = view.container.querySelector('[data-slot="select-trigger"]');
    const collapsible = view.getByRole('button', { name: 'Details' });

    expectClasses(toggle, control({ emphasis: 'low', size: 'sm', tone: 'success' }));
    expectClasses(tab, control({ emphasis: 'minimal', size: 'xs', tone: 'neutral' }));
    expectClasses(trigger, control({ emphasis: 'low', size: 'base', tone: 'neutral' }));
    expectClasses(collapsible, control({ emphasis: 'low', size: 'base', tone: 'neutral' }));
    expect(toggle.classList).toContain('toggle-root');
    expect(tab.classList).toContain('tab-root');
    expect(trigger.classList).toContain('trigger-root');
    expect(selectTrigger).not.toBeNull();
    expectClasses(selectTrigger!, control({ emphasis: 'low', size: 'base', tone: 'neutral' }));
    expect(collapsible.classList).toContain('collapsible-root');
    expect(trigger.querySelector('[data-slot="trigger-button-value"]')?.textContent).toBe('Choose');
    const contractClasses = [...view.getByTestId('icon-contract').classList].filter(
      (className) => !className.startsWith('lucide')
    );
    expect([...collapsible.querySelector('svg')!.classList]).toEqual(
      expect.arrayContaining(contractClasses)
    );
  });

  it('uses the same control contract for both SplitButton faces', () => {
    const onAction = vi.fn();
    const { container, getByRole } = render(
      <SplitButton
        className="split-root"
        options={[{ id: 'merge', label: 'Merge' }]}
        onAction={onAction}
      />
    );
    const root = container.querySelector('[data-slot="split-button"]');
    const face = getByRole('button', { name: 'Merge' });
    const menuTrigger = getByRole('button', { name: 'More options' });

    expect(root?.classList).toContain('split-root');
    expectClasses(face, control({ emphasis: 'high', size: 'xs', tone: 'neutral' }));
    expectClasses(
      menuTrigger,
      control({ emphasis: 'high', size: 'xs', tone: 'neutral', iconOnly: true })
    );
    fireEvent.click(face);
    expect(onAction).toHaveBeenCalledWith('merge');
  });
});

function verifyControlComponentTypes(): void {
  <Button className={sx({ marginInline: tokens.space.step2 })}>Save</Button>;
  <Toggle size="sm" tone="warning" />;
  <Tabs.Tab value="details" size="xs" tone="neutral" />;
  <Collapsible.Trigger size="base" tone="info" />;
  // @ts-expect-error Generic Recipe maps are not part of the Button API.
  <Button variants={{ emphasis: 'high' }}>Save</Button>;
  // @ts-expect-error Internal class maps are not part of the Toggle API.
  <Toggle classes={{ root: 'override' }} />;
}
void verifyControlComponentTypes;
