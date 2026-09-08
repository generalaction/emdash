/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuItem } from '../../styles/recipes/menu-item';
import { Combobox } from './combobox/combobox';
import { ComboboxPopup } from './combobox/combobox-popup';
import { ContextMenu } from './context-menu';
import { Dialog } from './dialog';
import { DropdownMenu } from './dropdown-menu';
import { Popover } from './popover';
import { Select } from './select';
import { Sheet } from './sheet';
import { Tooltip } from './tooltip';

afterEach(cleanup);

function expectClasses(element: Element, className: string): void {
  for (const part of className.split(' ')) {
    expect(element.classList).toContain(part);
  }
}

describe('overlay component styling interfaces', () => {
  it('keeps modal and non-modal popup className seams on their documented content roots', () => {
    render(
      <>
        <Dialog.Root open>
          <Dialog.Content className="dialog-popup">
            <Dialog.Title>Dialog</Dialog.Title>
          </Dialog.Content>
        </Dialog.Root>
        <Sheet.Root open>
          <Sheet.Content className="sheet-popup">
            <Sheet.Title>Sheet</Sheet.Title>
          </Sheet.Content>
        </Sheet.Root>
        <Popover.Root open>
          <Popover.Trigger>Popover trigger</Popover.Trigger>
          <Popover.Content className="popover-popup">Popover</Popover.Content>
        </Popover.Root>
        <Tooltip.Provider>
          <Tooltip.Root open>
            <Tooltip.Trigger>Tooltip trigger</Tooltip.Trigger>
            <Tooltip.Content className="tooltip-popup">Tooltip</Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </>
    );

    expect(document.querySelector('[data-slot="dialog-content"]')?.classList).toContain(
      'dialog-popup'
    );
    expect(document.querySelector('[data-slot="sheet-content"]')?.classList).toContain(
      'sheet-popup'
    );
    expect(document.querySelector('[data-slot="popover-content"]')?.classList).toContain(
      'popover-popup'
    );
    expect(document.querySelector('[data-slot="tooltip-content"]')?.classList).toContain(
      'tooltip-popup'
    );
  });

  it('maps menu, select, and combobox row semantics to the public menuItem contract', () => {
    render(
      <>
        <DropdownMenu.Root open>
          <DropdownMenu.Trigger>Menu trigger</DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item className="dropdown-row" inset variant="destructive">
              Delete
            </DropdownMenu.Item>
            <DropdownMenu.CheckboxItem checked className="checkbox-row">
              Checked
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="nested-row">Nested</DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                <DropdownMenu.Item>Child</DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <ContextMenu.Root open>
          <ContextMenu.Trigger>Context trigger</ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item className="context-row">Context action</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
        <Select.Root open value="selected">
          <Select.Trigger>Selected</Select.Trigger>
          <Select.Content>
            <Select.Item className="select-row" value="selected">
              Selected
            </Select.Item>
            <Select.Item value="disabled" disabled>
              Disabled
            </Select.Item>
          </Select.Content>
        </Select.Root>
        <Combobox.Root open value="selected" items={['selected', 'disabled']}>
          <Combobox.Input aria-label="Search" />
          <Combobox.Content>
            <Combobox.List>
              <Combobox.Item className="combobox-row" value="selected">
                Selected
              </Combobox.Item>
              <Combobox.Item value="disabled" disabled hoverableWhenDisabled>
                Disabled
              </Combobox.Item>
            </Combobox.List>
          </Combobox.Content>
        </Combobox.Root>
      </>
    );

    const dropdown = document.querySelector('.dropdown-row')!;
    const checkbox = document.querySelector('.checkbox-row')!;
    const nested = document.querySelector('.nested-row')!;
    const context = document.querySelector('.context-row')!;
    const select = document.querySelector('.select-row')!;
    const combobox = document.querySelector('.combobox-row')!;

    expectClasses(dropdown, menuItem({ inset: true, tone: 'destructive' }));
    expectClasses(checkbox, menuItem({ muted: true, trailingIndicator: true }));
    expectClasses(nested, menuItem());
    expectClasses(context, menuItem());
    expectClasses(select, menuItem({ fullWidth: true, trailingIndicator: true }));
    expectClasses(combobox, menuItem({ fullWidth: true, trailingIndicator: true }));
    expect(checkbox.hasAttribute('data-checked')).toBe(true);
    expect(select.getAttribute('aria-selected')).toBe('true');
    expect(combobox.hasAttribute('data-selected')).toBe(true);
    expect(document.querySelector('[data-slot="select-item-indicator"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="combobox-item-indicator"]')).not.toBeNull();
    expect(
      document
        .querySelector('[data-slot="combobox-item"][data-hoverable-when-disabled]')
        ?.hasAttribute('data-disabled')
    ).toBe(true);
  });

  it('keeps the caret popup geometry on its root and selection on its rows', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <ComboboxPopup
        anchorRect={new DOMRect(24, 32, 4, 16)}
        className="caret-popup"
        items={[{ id: 'one', label: 'One' }]}
        onSelect={() => {}}
      />
    );

    const popup = document.querySelector('[data-slot="combobox-popup"]')!;
    const item = popup.querySelector('[role="option"]')!;

    expect(popup.classList).toContain('caret-popup');
    expect(popup.getAttribute('role')).toBe('listbox');
    expect(popup.getAttribute('style')).toContain('position: fixed');
    expectClasses(item, menuItem({ fullWidth: true, trailingIndicator: true }));
    expect(item.getAttribute('data-slot')).toBe('combobox-popup-item');
    expect(item.hasAttribute('data-selected')).toBe(true);
    expect(item.getAttribute('aria-selected')).toBe('true');
  });
});
