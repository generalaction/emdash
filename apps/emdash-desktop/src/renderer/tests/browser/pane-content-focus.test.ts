import { describe, expect, it } from 'vitest';
import { focusActiveContentElement } from '@renderer/features/tabs/content-focus';

describe('pane content focus', () => {
  it('does not move a scroll container when restoring focus after a tab switch', () => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:200px;overflow:auto;';

    const content = document.createElement('div');
    content.style.cssText = 'position:relative;height:2000px;';

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.style.cssText = 'position:absolute;top:0;left:0;width:200px;height:40px;';
    content.appendChild(editor);
    container.appendChild(content);
    document.body.appendChild(container);

    container.scrollTop = 1500;
    expect(container.scrollTop).toBe(1500);

    focusActiveContentElement(container);

    expect(document.activeElement).toBe(editor);
    expect(container.scrollTop).toBe(1500);

    container.remove();
  });
});
