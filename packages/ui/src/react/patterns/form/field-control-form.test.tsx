/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fieldControl } from '../../../styles/recipes/field-control';
import { useAppForm } from './use-app-form';

afterEach(cleanup);

function expectClasses(element: Element, className: string): void {
  for (const part of className.split(' ')) {
    expect(element.classList).toContain(part);
  }
}

function FormHarness() {
  const form = useAppForm({
    defaultValues: {
      name: '',
      choice: '',
      provider: '',
    },
    onSubmit: () => {},
  });

  return (
    <>
      <form.AppField
        name="name"
        validators={{
          onBlur: ({ value }) => (value.length === 0 ? 'Name is required' : undefined),
        }}
      >
        {(field) => (
          <field.TextField
            className="text-field-root"
            controlClassName="text-field-control"
            label="Name"
            size="sm"
            tone="warning"
          />
        )}
      </form.AppField>
      <form.AppField name="choice">
        {(field) => (
          <field.SelectField
            className="select-field-root"
            controlClassName="select-field-control"
            label="Choice"
            options={[{ value: 'one', label: 'One' }]}
            size="sm"
            tone="info"
          />
        )}
      </form.AppField>
      <form.AppField name="provider">
        {(field) => (
          <field.ComboboxSelectField
            className="combobox-field-root"
            controlClassName="combobox-field-control"
            label="Provider"
            options={[{ value: 'one', label: 'One' }]}
            size="sm"
            tone="success"
          />
        )}
      </form.AppField>
    </>
  );
}

describe('form field-control composition', () => {
  it('keeps Field roots and control slots separately caller-owned', () => {
    const view = render(<FormHarness />);
    const input = view.getByRole('textbox', { name: 'Name' });
    const select = view.container.querySelector('[data-slot="select-trigger"]');
    const combobox = view.container.querySelector('[data-slot="combobox-trigger"]');

    expect(input.closest('[data-slot="field"]')?.classList).toContain('text-field-root');
    expect(select?.closest('[data-slot="field"]')?.classList).toContain('select-field-root');
    expect(combobox?.closest('[data-slot="field"]')?.classList).toContain('combobox-field-root');
    expect(input.classList).toContain('text-field-control');
    expect(select?.classList).toContain('select-field-control');
    expect(combobox?.classList).toContain('combobox-field-control');
    expectClasses(input, fieldControl({ size: 'sm', tone: 'warning' }));
    expectClasses(select!, fieldControl({ size: 'sm', tone: 'info' }));
    expectClasses(combobox!, fieldControl({ size: 'sm', tone: 'success' }));
  });

  it('projects touched validation state through Field and field-control roots', async () => {
    const view = render(<FormHarness />);
    const input = view.getByRole('textbox', { name: 'Name' });

    fireEvent.blur(input);

    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.closest('[data-slot="field"]')?.hasAttribute('data-invalid')).toBe(true);
    });
  });
});

function verifyFormFieldTypes(): void {
  type Form = ReturnType<typeof useAppForm>;
  void (null as unknown as Form);
  // Public field component props are exercised by FormHarness; this function
  // keeps the test module typechecked even when no runtime form is mounted.
  const rootClassName: string = 'field-root';
  const controlClassName: string = 'control-root';
  void rootClassName;
  void controlClassName;
}
void verifyFormFieldTypes;
