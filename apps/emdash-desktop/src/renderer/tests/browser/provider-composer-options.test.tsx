import type {
  ProviderConfigOption,
  ProviderOptionValues,
} from '@emdash/core/runtimes/acp/api/client';
import { ChatComposer } from '@emdash/ui/react/components';
import '@emdash/ui/style.css';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { providerComposerOptions } from '@core/features/conversations/contributions/browser/provider-composer-options';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

it('renders and updates an arbitrary ACP boolean without a known Fast-mode ID', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const option: ProviderConfigOption = {
    id: 'provider-speed',
    name: 'Speed boost',
    type: 'boolean',
    currentValue: false,
  };
  try {
    await act(async () =>
      root.render(
        <ChatComposer
          {...providerComposerOptions([option], {}, change, true, true)}
          onSubmit={() => {}}
        />
      )
    );
    const toggle = page.getByRole('button', { name: 'Speed boost', exact: true });
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
    await act(async () => toggle.click());
    expect(change).toHaveBeenCalledWith('provider-speed', true);
    expect(container.querySelector('svg.lucide-zap')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const model: ProviderConfigOption = {
  id: 'model',
  name: 'Model',
  type: 'select',
  category: 'model',
  currentValue: 'astra',
  options: [{ value: 'astra', name: 'Astra' }],
};
const effort: ProviderConfigOption = {
  id: 'reasoning_effort',
  name: 'Effort',
  type: 'select',
  category: 'thought_level',
  currentValue: 'medium',
  options: [{ value: 'medium', name: 'Medium' }],
};

const mode: ProviderConfigOption = {
  id: 'approval',
  name: 'Access',
  type: 'select',
  category: 'mode',
  currentValue: 'full',
  options: [
    { value: 'full', name: 'Full access' },
    { value: 'ask', name: 'Ask permissions' },
  ],
};
const collaboration: ProviderConfigOption = {
  id: 'collaboration',
  name: 'Collaboration',
  type: 'select',
  category: 'collaboration_mode',
  currentValue: 'default',
  options: [{ value: 'default', name: 'Default' }],
};

it.each([
  ['fast-mode', 'boolean'],
  ['fast-mode', 'select'],
  ['fast', 'boolean'],
  ['fast', 'select'],
] as const)('shows resolved defaults and toggles native %s/%s Fast mode', async (id, type) => {
  await page.viewport(1000, 400);
  const container = document.createElement('div');
  container.style.width = '800px';
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const fast: ProviderConfigOption =
    type === 'boolean'
      ? { id, name: 'Fast mode', type, currentValue: false }
      : {
          id,
          name: 'Fast mode',
          type,
          currentValue: 'off',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'on', name: 'On' },
          ],
        };
  const render = async (
    option: ProviderConfigOption,
    enabled = true,
    values: ProviderOptionValues = {}
  ) => {
    await act(async () =>
      root.render(
        <ChatComposer
          {...providerComposerOptions(
            [model, effort, mode, collaboration, option],
            values,
            change,
            enabled,
            true
          )}
          onSubmit={() => {}}
        />
      )
    );
  };
  try {
    await render(fast);
    expect(container.textContent).toContain('Astra Medium');
    expect(container.textContent).toContain('Full access');
    expect(container.textContent).not.toContain('Use provider default');
    expect(container.textContent).not.toContain('Auto-approve');
    expect(change).not.toHaveBeenCalled();
    const toggle = page.getByRole('switch', { name: 'Fast mode', exact: true });
    await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle.element().textContent).toBe('');
    expect(container.querySelector('svg.lucide-zap')?.getAttribute('fill')).toBe('none');
    await act(async () => toggle.click());
    expect(change).toHaveBeenLastCalledWith(id, type === 'boolean' ? true : 'on');
    const enabledOption = {
      ...fast,
      currentValue: type === 'boolean' ? true : 'on',
    } as ProviderConfigOption;
    await render(enabledOption);
    await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('svg.lucide-zap')?.getAttribute('fill')).toBe('currentColor');
    await act(async () => page.getByRole('combobox', { name: 'Permission mode' }).hover());
    await expect
      .poll(() => getComputedStyle(toggle.element()).backgroundColor)
      .toBe('rgba(0, 0, 0, 0)');
    await act(async () => toggle.click());
    expect(change).toHaveBeenLastCalledWith(id, type === 'boolean' ? false : 'off');
    // Pin the effective model even though it already matches the provider default.
    await act(async () =>
      page.elementLocator(container.querySelector('[data-slot="combobox-trigger"]')!).click()
    );
    await act(async () => page.getByRole('option', { name: 'Astra', exact: true }).click());
    expect(change).toHaveBeenLastCalledWith('model', 'astra');
    await render(enabledOption, true, { approval: 'full' });
    await act(async () => page.getByRole('combobox', { name: 'Permission mode' }).click());
    expect(document.body.textContent).not.toContain('Use provider default');
    const askMode = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
      (item) => item.textContent === 'Ask permissions'
    );
    expect(askMode).toBeDefined();
    await act(async () => page.elementLocator(askMode!).click());
    expect(change).toHaveBeenLastCalledWith('approval', 'ask');
    await render(enabledOption, false);
    await expect.element(toggle).toBeDisabled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('follows the provider Fast-mode catalog across model switches', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const fast: ProviderConfigOption = {
    id: 'fast',
    name: 'Fast mode',
    category: 'model_config',
    type: 'boolean',
    currentValue: true,
  };
  const render = async (selected: string, supportsFast: boolean) => {
    const options: ProviderConfigOption[] = [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        name: 'Model',
        currentValue: selected,
        options: [
          { value: 'default', name: 'Default (recommended)' },
          { value: 'fable', name: 'Fable' },
        ],
      },
      ...(supportsFast ? [fast] : []),
    ];
    await act(async () =>
      root.render(
        <ChatComposer
          {...providerComposerOptions(options, { model: selected, fast: true }, change, true, true)}
          onSubmit={() => {}}
        />
      )
    );
  };
  try {
    await render('default', true);
    expect(container.querySelector('svg.lucide-zap')).not.toBeNull();
    await render('fable', true);
    expect(container.querySelector('svg.lucide-zap')).not.toBeNull();
    await render('fable', false);
    expect(container.querySelector('svg.lucide-zap')).toBeNull();
    expect(container.textContent).not.toContain('Fast mode');
    await render('default', true);
    expect(container.querySelector('svg.lucide-zap')).not.toBeNull();
    expect(change).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each([false, true])('shows only native model choices with live=%s', async (live) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const options: ProviderConfigOption[] = [
    {
      id: 'native-model',
      category: 'model',
      type: 'select',
      name: 'Model',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default (recommended)' },
        { value: 'opus', name: 'Opus' },
      ],
    },
  ];
  try {
    await act(async () =>
      root.render(
        <ChatComposer
          {...providerComposerOptions(options, {}, change, true, live)}
          onSubmit={() => {}}
        />
      )
    );
    expect(container.textContent).toContain(live ? 'Default (recommended)' : 'Model…');
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      page.elementLocator(container.querySelector('[data-slot="combobox-trigger"]')!).click()
    );
    expect(document.body.textContent).not.toContain('Use provider default');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    await act(async () => page.getByRole('option', { name: 'Opus', exact: true }).click());
    expect(change).toHaveBeenLastCalledWith('native-model', 'opus');
    await act(async () =>
      page.elementLocator(container.querySelector('[data-slot="combobox-trigger"]')!).click()
    );
    await act(async () =>
      page.getByRole('option', { name: 'Default (recommended)', exact: true }).click()
    );
    expect(change).toHaveBeenLastCalledWith('native-model', 'default');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
