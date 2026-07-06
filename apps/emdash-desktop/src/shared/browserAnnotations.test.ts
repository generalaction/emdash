import { describe, expect, it } from 'vitest';
import { formatBrowserAnnotationsForAgent, type BrowserAnnotation } from './browserAnnotations';

function makeAnnotation(overrides: Partial<BrowserAnnotation> = {}): BrowserAnnotation {
  return {
    id: 'annotation-1',
    taskId: 'task-1',
    browserId: 'browser-1',
    kind: 'element',
    status: 'pending',
    comment: 'Make this clearer.',
    url: 'http://localhost:3000/settings',
    title: 'Settings',
    elementPath: 'main > button:nth-of-type(1)',
    element: 'button',
    cssClasses: 'primary large',
    nearbyText: 'Save changes',
    selectedText: undefined,
    x: 120,
    y: 80,
    boundingBox: { x: 100, y: 64, width: 180, height: 40 },
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatBrowserAnnotationsForAgent', () => {
  it('formats pending browser annotations for agent context', () => {
    const output = formatBrowserAnnotationsForAgent([
      makeAnnotation({ comment: 'Button overflows on mobile.' }),
    ]);

    expect(output).toContain('<browser_annotations>');
    expect(output).toContain('kind="element"');
    expect(output).toContain('url="http://localhost:3000/settings"');
    expect(output).toContain('elementPath="main &gt; button:nth-of-type(1)"');
    expect(output).toContain('<comment>Button overflows on mobile.</comment>');
    expect(output).toContain('<nearby_text>Save changes</nearby_text>');
  });

  it('omits dismissed and sent annotations', () => {
    const output = formatBrowserAnnotationsForAgent([
      makeAnnotation({ status: 'dismissed' }),
      makeAnnotation({ status: 'sent' }),
    ]);

    expect(output).toBe('');
  });

  it('escapes user and page-provided text', () => {
    const output = formatBrowserAnnotationsForAgent([
      makeAnnotation({
        comment: 'Use <strong> text & spacing',
        selectedText: '"Danger" <button>',
        nearbyText: 'A & B',
      }),
    ]);

    expect(output).toContain('<comment>Use &lt;strong&gt; text &amp; spacing</comment>');
    expect(output).toContain('<selected_text>"Danger" &lt;button&gt;</selected_text>');
    expect(output).toContain('<nearby_text>A &amp; B</nearby_text>');
  });
});
