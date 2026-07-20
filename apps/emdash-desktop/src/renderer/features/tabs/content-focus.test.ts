// @vitest-environment jsdom

import { CONTENT_FOCUS_REQUEST_EVENT } from '@emdash/ui/react/components';
import { describe, expect, it, vi } from 'vitest';
import { focusActiveContentElement } from './content-focus';

describe('focusActiveContentElement', () => {
  it('lets an editor handle focus through its own selection-aware command', () => {
    const container = document.createElement('div');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const nativeFocus = vi.spyOn(editor, 'focus');
    const handleFocusRequest = vi.fn((event: Event) => event.preventDefault());
    editor.addEventListener(CONTENT_FOCUS_REQUEST_EVENT, handleFocusRequest);
    container.appendChild(editor);

    focusActiveContentElement(container);

    expect(handleFocusRequest).toHaveBeenCalledOnce();
    expect(nativeFocus).not.toHaveBeenCalled();
  });

  it('uses native focus for content without a custom focus handler', () => {
    const container = document.createElement('div');
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    document.body.appendChild(container);

    focusActiveContentElement(container);

    expect(document.activeElement).toBe(textarea);
    container.remove();
  });
});
