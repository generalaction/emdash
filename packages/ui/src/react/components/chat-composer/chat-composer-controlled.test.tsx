/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
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
