/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptEditorModel } from '../prompt-editor/prompt-editor-model';
import type { PromptEditorRef } from '../prompt-editor/types';
import { ChatComposer } from './index';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function ControlledPortalComposer({
  slot,
  editorRef,
}: {
  slot: HTMLElement;
  editorRef: RefObject<PromptEditorRef | null>;
}) {
  const [draft, setDraft] = useState('');

  return createPortal(
    <ChatComposer
      value={draft}
      onInputChange={setDraft}
      editorApiRef={editorRef}
      onSubmit={() => {}}
    />,
    slot
  );
}

describe('ChatComposer controlled value', () => {
  it('reattaches a model-backed editor when the portal target changes in the same commit', async () => {
    const firstSlot = document.createElement('div');
    const secondSlot = document.createElement('div');
    document.body.append(firstSlot, secondSlot);
    const model = new PromptEditorModel({ text: 'retained model draft' });
    const result = render(
      createPortal(<ChatComposer model={model} onSubmit={() => {}} />, firstSlot)
    );
    expect(firstSlot.querySelector('[data-testid="prompt-editor"]')?.textContent).toBe(
      'retained model draft'
    );
    result.rerender(createPortal(<ChatComposer model={model} onSubmit={() => {}} />, secondSlot));
    await waitFor(() =>
      expect(secondSlot.querySelector('[data-testid="prompt-editor"]')?.textContent).toBe(
        'retained model draft'
      )
    );
    result.unmount();
    model.dispose();
  });

  it('restores uncontrolled draft affordances from an owner-managed model', async () => {
    const model = new PromptEditorModel();
    const editorRef = { current: null } as RefObject<PromptEditorRef | null>;
    const first = render(
      <ChatComposer model={model} editorApiRef={editorRef} onSubmit={() => {}} />
    );
    act(() => editorRef.current?.setText('retained draft'));
    first.unmount();
    const second = render(
      <ChatComposer model={model} isWorking onSubmit={() => {}} onSubmitWhileWorking={() => {}} />
    );
    await waitFor(() => expect(second.getByRole('button', { name: 'Queue message' })).toBeTruthy());
    second.unmount();
    model.dispose();
  });

  it('restores the host-owned draft when its portal target changes', async () => {
    const firstSlot = document.createElement('div');
    const secondSlot = document.createElement('div');
    document.body.append(firstSlot, secondSlot);
    const editorRef = { current: null } as RefObject<PromptEditorRef | null>;
    const result = render(<ControlledPortalComposer slot={firstSlot} editorRef={editorRef} />);

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    act(() => editorRef.current?.setText('retained across navigation'));
    await waitFor(() => expect(editorRef.current?.getText()).toBe('retained across navigation'));

    result.rerender(<ControlledPortalComposer slot={secondSlot} editorRef={editorRef} />);

    await waitFor(() => expect(editorRef.current?.getText()).toBe('retained across navigation'));
  });
});
