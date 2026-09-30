/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptEditor } from './prompt-editor';
import { PromptEditorModel } from './prompt-editor-model';

afterEach(cleanup);

function editorIn(element: HTMLElement): Editor {
  return (
    element.querySelector('[data-testid="prompt-editor"]') as HTMLElement & { editor: Editor }
  ).editor;
}

describe('conversation-owned prompt editor models', () => {
  it('recreates an internally owned editor safely during StrictMode setup replay', () => {
    const onChange = vi.fn();
    const result = render(
      <StrictMode>
        <PromptEditor value="initial" onChange={onChange} />
      </StrictMode>
    );
    const editor = editorIn(result.container);
    expect(editor.getText()).toBe('initial');
    act(() => editor.commands.insertContentAt(8, ' edit'));
    expect(onChange).toHaveBeenCalledWith('initial edit');
    result.unmount();
    expect(editor.isDestroyed).toBe(true);
  });

  it('updates view options without reattaching the editor or resetting its history', () => {
    const model = new PromptEditorModel({ text: 'draft' });
    const oldChange = vi.fn();
    const newChange = vi.fn();
    const result = render(<PromptEditor model={model} onChange={oldChange} />);
    const editor = editorIn(result.container);
    const viewId = model.getSnapshot().viewId;
    act(() => editor.commands.insertContentAt(6, ' edit'));
    oldChange.mockClear();
    result.rerender(<PromptEditor model={model} disabled onChange={newChange} />);
    expect(editorIn(result.container) === editor).toBe(true);
    expect(model.getSnapshot().viewId).toBe(viewId);
    expect(editor.isEditable).toBe(false);
    act(() => expect(editor.commands.undo()).toBe(true));
    expect(model.getText()).toBe('draft');
    expect(newChange).toHaveBeenCalledWith('draft');
    expect(oldChange).not.toHaveBeenCalled();
    result.unmount();
    model.dispose();
  });

  it('publishes clear and restoration commands while detached without touching the previous view', () => {
    const model = new PromptEditorModel({ text: 'draft' });
    const oldViewChange = vi.fn();
    const observed: string[] = [];
    const unsubscribe = model.subscribe(() => observed.push(model.getText()));
    const first = render(<PromptEditor model={model} onChange={oldViewChange} />);
    first.unmount();
    observed.length = 0;
    model.clear();
    model.setText('rejected draft restored');
    expect(observed).toEqual(['', 'rejected draft restored']);
    expect(oldViewChange).not.toHaveBeenCalled();
    const second = render(<PromptEditor model={model} />);
    expect(editorIn(second.container).getText()).toBe('rejected draft restored');
    second.unmount();
    unsubscribe();
    model.dispose();
  });

  it('retains the editor, rich document, backward selection and history across remounts', () => {
    const model = new PromptEditorModel({ text: 'first' });
    const first = render(<PromptEditor model={model} />);
    const editor = editorIn(first.container);
    act(() => {
      editor.commands.insertContentAt(6, ' edit');
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, { type: 'hardBreak' });
      editor.commands.setTextSelection({ from: 9, to: 3 });
    });
    const doc = editor.state.doc.toJSON();
    const selection = editor.state.selection.toJSON();
    first.unmount();
    expect(editor.isDestroyed).toBe(true); // The DOM view is detached, not retained offscreen.

    const second = render(<PromptEditor model={model} />);
    expect(editorIn(second.container) === editor).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(doc);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    act(() => expect(editor.commands.undo()).toBe(true));
    expect(editor.getText()).toBe('first');
    act(() => expect(editor.commands.redo()).toBe(true));
    expect(editor.state.doc.toJSON()).toEqual(doc);
    second.unmount();
    const destroy = vi.spyOn(editor, 'destroy');
    model.dispose();
    model.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rebinds submit and update callbacks and keeps conversations isolated in StrictMode', () => {
    const a = new PromptEditorModel({ text: 'A' });
    const b = new PromptEditorModel({ text: 'B' });
    const oldSubmit = vi.fn();
    const oldChange = vi.fn();
    const newSubmit = vi.fn();
    const newChange = vi.fn();
    const view = render(
      <StrictMode>
        <PromptEditor key="a" model={a} onSubmit={oldSubmit} onChange={oldChange} />
      </StrictMode>
    );
    const editorA = editorIn(view.container);
    act(() => editorA.commands.insertContentAt(2, ' edit'));
    oldChange.mockClear();
    view.rerender(
      <StrictMode>
        <PromptEditor key="b" model={b} />
      </StrictMode>
    );
    const editorB = editorIn(view.container);
    expect(editorB).not.toBe(editorA);
    expect(editorB.getText()).toBe('B');
    act(() => expect(editorB.commands.undo()).toBe(false));
    view.rerender(
      <StrictMode>
        <PromptEditor key="a" model={a} onSubmit={newSubmit} onChange={newChange} />
      </StrictMode>
    );
    expect(editorIn(view.container) === editorA).toBe(true);
    fireEvent.keyDown(view.getByTestId('prompt-editor'), { key: 'Enter' });
    expect(newSubmit).toHaveBeenCalledWith('A edit');
    expect(newChange).toHaveBeenCalledWith('');
    expect(oldSubmit).not.toHaveBeenCalled();
    expect(oldChange).not.toHaveBeenCalled();
    view.unmount();
    a.dispose();
    b.dispose();
  });

  it('preserves mention node views and reconciles disabled state on reattachment', async () => {
    const model = new PromptEditorModel();
    const first = render(<PromptEditor model={model} />);
    const editor = editorIn(first.container);
    act(() =>
      editor.commands.insertContent({
        type: 'mention',
        attrs: {
          id: 'file.ts',
          label: 'src/file.ts',
          name: 'file.ts',
          kind: 'file',
          pending: true,
        },
      })
    );
    const doc = editor.state.doc.toJSON();
    first.unmount();
    expect(model.view).toBeNull();
    expect(editor.options.element).toBeNull();
    const second = render(
      <PromptEditor model={model} disabled renderMentionIcon={() => <span>current icon</span>} />
    );
    expect(editor.isEditable).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(doc);
    await waitFor(() => expect(second.getByText('current icon')).toBeTruthy());
    second.unmount();
    model.dispose();
  });

  it('does not route late suggestion events to the old or the new view', () => {
    const model = new PromptEditorModel();
    const oldOpenChange = vi.fn();
    const newOpenChange = vi.fn();
    const first = render(<PromptEditor model={model} onCommandPopupOpenChange={oldOpenChange} />);
    const oldRenderer = model.suggestionRenderer('commands');
    first.unmount();
    const second = render(<PromptEditor model={model} onCommandPopupOpenChange={newOpenChange} />);
    const editor = editorIn(second.container);
    const props = {
      editor,
      range: { from: 1, to: 1 },
      query: '',
      text: '/',
      items: [],
      command: () => {},
      decorationNode: null,
    };
    act(() => oldRenderer.onStart?.(props));
    expect(oldOpenChange).not.toHaveBeenCalled();
    expect(newOpenChange).not.toHaveBeenCalled();
    act(() => model.suggestionRenderer('commands').onStart?.(props));
    expect(newOpenChange).toHaveBeenCalledWith(true);
    second.unmount();
    model.dispose();
  });
});
