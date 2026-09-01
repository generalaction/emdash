import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { buildSubmitKeymap } from './submit-keymap';

describe('buildSubmitKeymap', () => {
  it('scrolls the new selection into view after inserting a hard break', () => {
    const run = vi.fn(() => true);
    const chain = {
      setHardBreak: vi.fn(() => chain),
      scrollIntoView: vi.fn(() => chain),
      run,
    };
    const extension = buildSubmitKeymap({ getShortcut: () => 'enter', onSubmit: vi.fn() });
    const shortcuts = extension.config.addKeyboardShortcuts?.call({} as never);

    const handled = shortcuts?.['Shift-Enter']({
      editor: { chain: () => chain } as unknown as Editor,
    });

    expect(handled).toBe(true);
    expect(chain.setHardBreak).toHaveBeenCalledOnce();
    expect(chain.scrollIntoView).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
