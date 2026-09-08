/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fieldControl } from '../../styles/recipes/field-control';
import { ComboboxPopover } from '../components/combobox-popover';
import { Combobox } from './combobox/combobox';
import { DirectoryField } from './directory-field';
import { Field } from './field';
import { Input } from './input';
import { InputGroup } from './input-group';
import { SearchInput } from './search-input';
import { Select } from './select';
import { Textarea } from './textarea';
import { TriggerButton } from './trigger-button';

afterEach(cleanup);

function expectClasses(element: Element, className: string): void {
  for (const part of className.split(' ')) {
    expect(element.classList).toContain(part);
  }
}

describe('field-control component styling interfaces', () => {
  it('maps Input, Textarea, and DirectoryField semantics onto their roots', () => {
    const view = render(
      <>
        <Input aria-label="Name" className="input-root" size="sm" tone="warning" readOnly />
        <Textarea aria-label="Notes" className="textarea-root" size="sm" tone="info" aria-invalid />
        <DirectoryField className="directory-root" path="/tmp/project" size="sm" tone="success" />
      </>
    );

    const input = view.getByRole('textbox', { name: 'Name' });
    const textarea = view.getByRole('textbox', { name: 'Notes' });
    const directory = view.getByRole('button', { name: /project/i });

    expectClasses(input, fieldControl({ size: 'sm', tone: 'warning' }));
    expectClasses(textarea, fieldControl({ size: 'sm', tone: 'info' }));
    expectClasses(directory, fieldControl({ size: 'sm', tone: 'success' }));
    expect(input.classList).toContain('input-root');
    expect(textarea.classList).toContain('textarea-root');
    expect(directory.classList).toContain('directory-root');
    expect(input.getAttribute('data-tone')).toBe('warning');
    expect(textarea.getAttribute('data-tone')).toBe('info');
    expect(directory.getAttribute('data-tone')).toBe('success');
  });

  it('makes InputGroup the state-owning field root and propagates native state', () => {
    const view = render(
      <InputGroup.Root
        appearance="embedded"
        className="group-root"
        size="sm"
        tone="destructive"
        disabled
        readOnly
        invalid
      >
        <InputGroup.Input aria-label="Repository" />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button aria-label="Browse">Browse</InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup.Root>
    );
    const group = view.container.querySelector('[data-slot="input-group"]')!;
    const input = view.getByRole('textbox', { name: 'Repository' });
    const button = view.getByRole('button', { name: 'Browse' });

    expect(group.classList).toContain('group-root');
    expect(group.getAttribute('data-appearance')).toBe('embedded');
    expect(group.getAttribute('data-size')).toBe('sm');
    expect(group.getAttribute('data-tone')).toBe('destructive');
    expect(group.hasAttribute('data-disabled')).toBe(true);
    expect(group.hasAttribute('data-readonly')).toBe(true);
    expect(group.hasAttribute('data-invalid')).toBe(true);
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.hasAttribute('readonly')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('delegates Combobox.Input state to its InputGroup field shell', () => {
    const view = render(
      <Combobox.Root items={[]}>
        <Combobox.Input
          aria-label="Filter"
          className="combobox-input-root"
          disabled
          invalid
          size="sm"
          tone="warning"
        />
      </Combobox.Root>
    );
    const group = view.container.querySelector('[data-slot="input-group"]');
    const input = view.getByRole('combobox', { name: 'Filter' });

    expect(group?.classList).toContain('combobox-input-root');
    expect(group?.getAttribute('data-appearance')).toBe('embedded');
    expect(group?.getAttribute('data-size')).toBe('sm');
    expect(group?.getAttribute('data-tone')).toBe('warning');
    expect(group?.hasAttribute('data-invalid')).toBe(true);
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('makes Combobox.Chips the state-owning shell for its input slot', () => {
    const view = render(
      <Combobox.Root items={[]} multiple>
        <Combobox.Chips className="chips-root" invalid readOnly size="sm" tone="info">
          <Combobox.ChipsInput aria-label="Add item" />
        </Combobox.Chips>
      </Combobox.Root>
    );
    const chips = view.container.querySelector('[data-slot="combobox-chips"]');
    const input = view.getByRole('combobox', { name: 'Add item' });

    expect(chips?.classList).toContain('chips-root');
    expect(chips?.getAttribute('data-size')).toBe('sm');
    expect(chips?.getAttribute('data-tone')).toBe('info');
    expect(chips?.hasAttribute('data-invalid')).toBe(true);
    expect(chips?.hasAttribute('data-readonly')).toBe(true);
    expect(input.hasAttribute('readonly')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('uses field-control for input-appearance trigger controls', () => {
    const view = render(
      <>
        <TriggerButton appearance="input" className="trigger-root" size="sm" tone="warning">
          Choose
        </TriggerButton>
        <Select.Root defaultValue="one">
          <Select.Trigger appearance="input" className="select-root" size="sm" tone="info">
            One
          </Select.Trigger>
        </Select.Root>
      </>
    );
    const trigger = view.getByRole('button', { name: 'Choose' });
    const select = view.container.querySelector('[data-slot="select-trigger"]');

    expectClasses(trigger, fieldControl({ size: 'sm', tone: 'warning' }));
    expectClasses(select!, fieldControl({ size: 'sm', tone: 'info' }));
    expect(trigger.classList).toContain('trigger-root');
    expect(select?.classList).toContain('select-root');
  });

  it('uses field-control for the form-oriented ComboboxPopover trigger', () => {
    const view = render(
      <ComboboxPopover
        appearance="input"
        className="combobox-trigger-root"
        invalid
        items={[{ id: 'one', label: 'One' }]}
        itemToKey={(item) => item.id}
        itemToLabel={(item) => item.label}
        onValueChange={() => {}}
        renderItem={(item) => item.label}
        renderTrigger={(item) => item?.label ?? 'Choose'}
        size="sm"
        tone="warning"
        value={null}
      />
    );
    const trigger = view.container.querySelector('[data-slot="combobox-trigger"]');

    expectClasses(trigger!, fieldControl({ size: 'sm', tone: 'warning' }));
    expect(trigger?.classList).toContain('combobox-trigger-root');
    expect(trigger?.getAttribute('aria-invalid')).toBe('true');
  });

  it('documents SearchInput className as the root seam and inputClassName as its control slot', () => {
    const view = render(
      <SearchInput
        aria-label="Search"
        className="search-root"
        inputClassName="search-control"
        size="sm"
        tone="success"
      />
    );
    const root = view.container.querySelector('[data-slot="search-input"]');
    const input = view.getByRole('searchbox', { name: 'Search' });
    const icon = root?.querySelector('svg');

    expect(root?.classList).toContain('search-root');
    expect(input.classList).toContain('search-control');
    expectClasses(input, fieldControl({ size: 'sm', tone: 'success' }));
    expect(icon?.getAttribute('class')).toContain('icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes Field root state and caller-owned structural slots', () => {
    const view = render(
      <Field.Root className="field-root" orientation="horizontal" disabled invalid>
        <Field.Content className="field-content">
          <Field.Label>Name</Field.Label>
        </Field.Content>
        <Field.ControlSlot className="field-control-slot">
          <Input aria-label="Name" />
        </Field.ControlSlot>
        <Field.Error>Error</Field.Error>
      </Field.Root>
    );
    const root = view.container.querySelector('[data-slot="field"]');

    expect(root?.classList).toContain('field-root');
    expect(root?.getAttribute('data-orientation')).toBe('horizontal');
    expect(root?.hasAttribute('data-disabled')).toBe(true);
    expect(root?.hasAttribute('data-invalid')).toBe(true);
    expect(view.container.querySelector('[data-slot="field-content"]')?.classList).toContain(
      'field-content'
    );
    expect(view.container.querySelector('[data-slot="field-control-slot"]')?.classList).toContain(
      'field-control-slot'
    );
  });
});

function verifyFieldComponentTypes(): void {
  <Input size="sm" tone="warning" className="input-root" />;
  <Textarea size="base" tone="info" className="textarea-root" />;
  <DirectoryField tone="success" className="directory-root" />;
  <InputGroup.Root appearance="embedded" size="sm" tone="destructive" invalid />;
  <Combobox.Input size="sm" tone="warning" invalid />;
  <Combobox.Chips size="sm" tone="info" invalid readOnly />;
  <SearchInput className="search-root" inputClassName="search-control" tone="neutral" />;
  <TriggerButton appearance="input" size="sm" tone="warning" />;
  <Select.Trigger appearance="input" size="sm" tone="success" />;
  <ComboboxPopover
    appearance="input"
    invalid
    items={[]}
    itemToKey={(item: string) => item}
    itemToLabel={(item) => item}
    onValueChange={() => {}}
    renderItem={(item) => item}
    renderTrigger={() => 'Choose'}
    size="sm"
    tone="info"
    value={null}
  />;
  // @ts-expect-error Bare styling is a private field-shell concern.
  <Input bare />;
  // @ts-expect-error Generic variants are not part of InputGroup's semantic API.
  <InputGroup.Root variant="embedded" />;
  // @ts-expect-error Internal class maps are not part of the Input API.
  <Input classes={{ root: 'override' }} />;
}
void verifyFieldComponentTypes;
