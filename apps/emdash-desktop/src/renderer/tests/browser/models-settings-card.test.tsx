import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
/**
 * Browser-mode tests for the Models settings card.
 *
 * The reasoning-effort dropdown always occupies its column (so the model and
 * reasoning columns line up across rows) but is disabled when the selected
 * model exposes no reasoning — matching getReasoningOptions():
 *   - Codex / Claude / Amp: always enabled (model-independent effort flag)
 *   - Cursor: enabled only for families whose id bakes in a reasoning level
 *     (disabled on "Model Default", Auto, Composer, …)
 *   - Amp: disabled only for the rush mode
 *
 * The settings hook is mocked so the selection can be driven directly without
 * the RPC/React-Query stack.
 */
import { userEvent } from 'vitest/browser';

type Selections = Record<string, { model?: string; reasoningEffort?: string }>;

const { mockState } = vi.hoisted(() => {
  // The card transitively imports `@renderer/lib/ipc`, which reads
  // `window.electronAPI.invoke` at module load. Stub the preload bridge before
  // any imports are evaluated so that initialization does not throw.
  window.electronAPI = {
    invoke: () => Promise.resolve(undefined),
    eventSend: () => {},
    eventOn: () => () => {},
    getPathForFile: () => '',
  };
  return { mockState: { selections: {} as Selections } };
});

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));

vi.mock('@renderer/features/settings/use-agent-model-settings', () => ({
  useAgentModelSettings: () => ({
    selections: mockState.selections,
    loading: false,
    saving: false,
    getSelection: (providerId: string) => mockState.selections[providerId] ?? {},
    setSelection: () => {},
    setModel: () => {},
    setReasoningEffort: () => {},
  }),
}));

// Imported after the mock is registered (vi.mock is hoisted above imports).
import ModelsSettingsCard from '@renderer/features/settings/components/ModelsSettingsCard';

function control(container: HTMLElement, label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function isDisabled(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  return el.hasAttribute('data-disabled') || el.getAttribute('aria-disabled') === 'true';
}

beforeEach(() => {
  mockState.selections = {};
});

afterEach(async () => {
  await cleanup();
});

describe('ModelsSettingsCard reasoning visibility', () => {
  it('always enables the reasoning dropdown for Codex and Claude', async () => {
    const { container } = await render(<ModelsSettingsCard />);

    expect(control(container, 'Codex model')).not.toBeNull();
    expect(isDisabled(control(container, 'Codex reasoning effort'))).toBe(false);
    expect(isDisabled(control(container, 'Claude Code reasoning effort'))).toBe(false);
  });

  it('keeps the reasoning column in place but disables it for Cursor on Model Default', async () => {
    const { container } = await render(<ModelsSettingsCard />);

    // Both columns are always rendered so rows stay aligned.
    expect(control(container, 'Cursor model')).not.toBeNull();
    expect(control(container, 'Cursor reasoning effort')).not.toBeNull();
    // Cursor reasoning is model-dependent → disabled with no model selected.
    expect(isDisabled(control(container, 'Cursor reasoning effort'))).toBe(true);
    // Amp's effort flag is model-independent → enabled even at the default mode.
    expect(isDisabled(control(container, 'Amp reasoning effort'))).toBe(false);
  });

  it('enables reasoning once a reasoning-capable Cursor model and Amp smart are selected', async () => {
    mockState.selections = { cursor: { model: 'gpt-5.5' }, amp: { model: 'smart' } };

    const { container } = await render(<ModelsSettingsCard />);

    expect(isDisabled(control(container, 'Cursor reasoning effort'))).toBe(false);
    expect(isDisabled(control(container, 'Amp reasoning effort'))).toBe(false);
  });

  it('keeps reasoning disabled for non-reasoning models (Cursor Auto, Amp rush)', async () => {
    mockState.selections = { cursor: { model: 'auto' }, amp: { model: 'rush' } };

    const { container } = await render(<ModelsSettingsCard />);

    expect(isDisabled(control(container, 'Cursor reasoning effort'))).toBe(true);
    expect(isDisabled(control(container, 'Amp reasoning effort'))).toBe(true);
  });

  it('lists Fable 5 as a disabled option in the Claude model dropdown', async () => {
    const { container } = await render(<ModelsSettingsCard />);

    const trigger = control(container, 'Claude Code model');
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger as HTMLElement);

    // The menu renders into a portal on document.body, not inside `container`.
    const findFable = (): Element | null =>
      Array.from(document.querySelectorAll('[data-slot="dropdown-menu-item"]')).find((el) =>
        el.textContent?.includes('Fable 5')
      ) ?? null;

    await expect.poll(findFable).not.toBeNull();
    expect(isDisabled(findFable())).toBe(true);
  });
});
