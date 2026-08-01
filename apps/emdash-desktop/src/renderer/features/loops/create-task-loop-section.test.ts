import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTaskLoopSection } from './create-task-loop-section';
import { createDefaultLoopPlanDraft, type LoopPlanDraft } from './loop-plan-model';

const settings = vi.hoisted(() => ({ loopsEnabled: true }));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { loops: settings.loopsEnabled },
    isLoading: false,
    isSaving: false,
  }),
}));

vi.mock('@renderer/lib/ui/switch', async () => {
  const React = await import('react');
  type MockSwitchProps = {
    checked?: boolean;
    disabled?: boolean;
    'aria-label'?: string;
    onCheckedChange?: (checked: boolean) => void;
  };
  return {
    Switch: ({
      checked = false,
      disabled,
      'aria-label': ariaLabel,
      onCheckedChange,
    }: MockSwitchProps) =>
      React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-label': ariaLabel,
        'aria-checked': checked,
        disabled,
        onClick: () => onCheckedChange?.(!checked),
      }),
  };
});

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('CreateTaskLoopSection', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    vi.stubGlobal('HTMLTextAreaElement', dom.window.HTMLTextAreaElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    settings.loopsEnabled = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  function Harness({ initial = createDefaultLoopPlanDraft() }: { initial?: LoopPlanDraft }) {
    const [draft, setDraft] = useState(initial);
    return React.createElement(CreateTaskLoopSection, { value: draft, onChange: setDraft });
  }

  async function enableLoopMode(): Promise<HTMLElement> {
    const toggle = container.querySelector<HTMLElement>(
      '[aria-label="Create this task with a Loop"]'
    )!;
    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    return toggle;
  }

  it('is inert when the Loops experiment is disabled', () => {
    settings.loopsEnabled = false;

    act(() => root.render(React.createElement(Harness)));

    expect(container.innerHTML).toBe('');
  });

  it('defaults task Loop mode off and reveals authoring fields only when selected', async () => {
    act(() => root.render(React.createElement(Harness)));

    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Loop plan'
    );
    const toggle = container.querySelector<HTMLElement>(
      '[aria-label="Create this task with a Loop"]'
    )!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('textarea[aria-label="Loop goal"]')).toBeNull();

    await enableLoopMode();

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('textarea[aria-label="Loop goal"]')).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="Pasted plan"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Phase 1 name"]')).not.toBeNull();
    expect(container.querySelector('textarea[aria-label="Phase 1 goal"]')).not.toBeNull();
    expect(
      container.querySelector('textarea[aria-label="Loop validation commands"]')
    ).not.toBeNull();
    expect(
      container.querySelector('textarea[aria-label="Loop E2E acceptance criteria"]')
    ).toBeNull();
  });

  it('keeps invalid input editable and exposes validation errors accessibly', async () => {
    act(() => root.render(React.createElement(Harness)));
    await enableLoopMode();

    const normalize = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Build phases'
    );
    await act(async () => normalize?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Add a goal for this Loop.'
    );
    const goal = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Loop goal"]')!;
    expect(goal.disabled).toBe(false);
    expect(goal.getAttribute('aria-invalid')).toBe('true');
    expect(goal.getAttribute('aria-describedby')).toBe('loop-plan-errors');

    await act(async () => setNativeValue(goal, 'Ship a resilient Loop authoring flow'));
    expect(goal.value).toBe('Ship a resilient Loop authoring flow');
    expect(goal.getAttribute('aria-invalid')).toBe('false');
    expect(goal.hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(
      'Add a goal for this Loop.'
    );

    const phaseName = container.querySelector<HTMLInputElement>(
      'input[aria-label="Phase 1 name"]'
    )!;
    const phaseGoal = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Phase 1 goal"]'
    )!;
    expect(phaseGoal.getAttribute('aria-invalid')).toBe('true');
    expect(phaseGoal.getAttribute('aria-describedby')).toBe('loop-plan-errors');

    await act(async () => setNativeValue(phaseName, ''));
    expect(phaseName.getAttribute('aria-invalid')).toBe('true');
    expect(phaseName.getAttribute('aria-describedby')).toBe('loop-plan-errors');
  });

  it('shows Review before E2E and allows each terminal gate to be toggled independently', async () => {
    act(() => root.render(React.createElement(Harness)));
    await enableLoopMode();

    const terminalGates = container.querySelector('[role="group"][aria-label="Terminal gates"]')!;
    expect(
      Array.from(terminalGates.querySelectorAll('[role="switch"]')).map((item) =>
        item.getAttribute('aria-label')
      )
    ).toEqual(['Run terminal Review', 'Run clean-room E2E']);

    const review = container.querySelector<HTMLElement>('[aria-label="Run terminal Review"]')!;
    const e2e = container.querySelector<HTMLElement>('[aria-label="Run clean-room E2E"]')!;
    expect(review.getAttribute('aria-checked')).toBe('false');
    expect(e2e.getAttribute('aria-checked')).toBe('false');

    await act(async () => review.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(review.getAttribute('aria-checked')).toBe('true');
    expect(e2e.getAttribute('aria-checked')).toBe('false');

    await act(async () => e2e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(review.getAttribute('aria-checked')).toBe('true');
    expect(e2e.getAttribute('aria-checked')).toBe('true');
    expect(
      container.querySelector('textarea[aria-label="Loop E2E acceptance criteria"]')
    ).not.toBeNull();

    await act(async () => review.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(review.getAttribute('aria-checked')).toBe('false');
    expect(e2e.getAttribute('aria-checked')).toBe('true');
  });

  it('preserves editable authoring input when task Loop mode is toggled off and on', async () => {
    act(() => root.render(React.createElement(Harness)));
    const toggle = await enableLoopMode();
    const goal = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Loop goal"]')!;
    await act(async () => setNativeValue(goal, 'Preserve this goal'));
    const plan = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Pasted plan"]'
    )!;
    const phaseName = container.querySelector<HTMLInputElement>(
      'input[aria-label="Phase 1 name"]'
    )!;
    const phaseGoal = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Phase 1 goal"]'
    )!;
    await act(async () => setNativeValue(plan, '1. Preserve this plan'));
    await act(async () => setNativeValue(phaseName, 'Preserved phase'));
    await act(async () => setNativeValue(phaseGoal, 'Preserve this phase goal'));
    const review = container.querySelector<HTMLElement>('[aria-label="Run terminal Review"]')!;
    const e2e = container.querySelector<HTMLElement>('[aria-label="Run clean-room E2E"]')!;
    await act(async () => review.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => e2e.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('textarea[aria-label="Loop goal"]')).toBeNull();
    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Loop goal"]')?.value
    ).toBe('Preserve this goal');
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pasted plan"]')?.value
    ).toBe('1. Preserve this plan');
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Phase 1 name"]')?.value
    ).toBe('Preserved phase');
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Phase 1 goal"]')?.value
    ).toBe('Preserve this phase goal');
    expect(
      container.querySelector('[aria-label="Run terminal Review"]')?.getAttribute('aria-checked')
    ).toBe('true');
    expect(
      container.querySelector('[aria-label="Run clean-room E2E"]')?.getAttribute('aria-checked')
    ).toBe('true');
  });
});
