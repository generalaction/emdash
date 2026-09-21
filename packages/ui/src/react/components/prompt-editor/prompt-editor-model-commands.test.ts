/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { PromptEditorModel } from './prompt-editor-model';

describe('PromptEditorModel ownership', () => {
  it('publishes draft changes without ever creating a view', () => {
    const model = new PromptEditorModel();
    const changed = vi.fn();
    const unsubscribe = model.subscribe(changed);
    model.setText('restored draft');
    expect(model.getText()).toBe('restored draft');
    expect(model.getSnapshot().editor).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    model.clear();
    expect(model.getText()).toBe('');
    model.setText('rejected submission');
    expect(model.getText()).toBe('rejected submission');
    unsubscribe();
    model.dispose();
  });

  it('keeps snapshot identity stable until something actually changes', () => {
    const model = new PromptEditorModel({ text: 'draft' });
    const snapshot = model.getSnapshot();
    model.setText('draft');
    expect(model.getSnapshot()).toBe(snapshot);
    expect(model.getSnapshot()).toBe(model.getSnapshot());
    model.dispose();
  });
});
