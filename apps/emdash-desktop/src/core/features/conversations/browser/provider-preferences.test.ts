import type { ProviderConfigOption } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it, vi } from 'vitest';
import {
  providerComposerOptions,
  selectCachedProviderOptions,
} from '../contributions/browser/provider-composer-options';
const model = {
  id: 'model',
  category: 'model',
  type: 'select',
  name: 'Model',
  currentValue: 'a',
  options: [
    { name: 'A', value: 'a' },
    { name: 'B', value: 'b' },
  ],
} satisfies ProviderConfigOption;
const effort: ProviderConfigOption = {
  id: 'reasoning_effort',
  category: 'thought_level',
  type: 'select',
  name: 'Effort',
  currentValue: 'high',
  options: [{ name: 'High', value: 'high' }],
};
const mode: ProviderConfigOption = {
  id: 'mode',
  category: 'mode',
  type: 'select',
  name: 'Permissions',
  currentValue: 'bypass',
  options: [{ name: 'Bypass permissions', value: 'bypass' }],
};
describe('discovered composer configuration', () => {
  it('does not invent controls before discovery', () => {
    expect(selectCachedProviderOptions([], { model: 'a' })).toEqual([]);
    expect(providerComposerOptions([], {}, vi.fn()).modelOptions).toBeUndefined();
  });
  it('keeps discovered controls when switching to an unobserved model', () => {
    const options = selectCachedProviderOptions([[model, effort, mode]], { model: 'b' });
    const props = providerComposerOptions(options, { model: 'b' }, vi.fn());
    expect(props.selectedModel).toBe('b');
    expect(props.permissionModeOptions).toEqual({ bypass: { name: 'Bypass permissions' } });
    expect(props.effortOptions).toEqual({ high: { name: 'High' } });
  });
  it('prefers an observed model catalog without adding options it does not expose', () => {
    const observed = [{ ...model, currentValue: 'b' }, mode];
    expect(selectCachedProviderOptions([[model, effort, mode], observed], { model: 'b' })).toEqual(
      observed
    );
    expect(selectCachedProviderOptions([[model, effort, mode], observed], {})).toEqual([
      model,
      effort,
      mode,
    ]);
  });
  it('sends only provider-owned choices, including a native default alias', () => {
    const change = vi.fn();
    const nativeDefault = { name: 'Default (recommended)', value: 'default' };
    const props = providerComposerOptions(
      [{ ...model, options: [nativeDefault, ...model.options] }, effort],
      { model: 'a', reasoning_effort: 'high' },
      change
    );
    props.onEffortChange?.('high');
    expect(change).toHaveBeenLastCalledWith('reasoning_effort', 'high');
    expect(Object.keys(props.modelOptions!)).toEqual(['default', 'a', 'b']);
    expect(Object.keys(props.effortOptions!)).toEqual(['high']);
    props.onModelChange?.('default');
    expect(change).toHaveBeenLastCalledWith('model', 'default');
  });
  it('displays effective live values without saving provider defaults as overrides', () => {
    const change = vi.fn();
    const values = {};
    const props = providerComposerOptions([model, effort], values, change, true, true);
    expect(props.selectedModel).toBe('a');
    expect(props.selectedEffort).toBe('high');
    expect(change).not.toHaveBeenCalled();
    expect(values).toEqual({});
    props.onModelChange?.('a');
    expect(change).toHaveBeenCalledWith('model', 'a');
  });
  it('does not treat cached current values as provider defaults', () => {
    const props = providerComposerOptions([model, effort], {}, vi.fn());
    expect(props.selectedModel).toBeUndefined();
    expect(props.selectedEffort).toBeUndefined();
  });
});
