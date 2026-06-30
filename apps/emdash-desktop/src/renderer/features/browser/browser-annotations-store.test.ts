import { describe, expect, it } from 'vitest';
import type { BrowserAnnotationTarget } from '@shared/browserAnnotations';
import { BrowserAnnotationsStore } from './browser-annotations-store';

function makeTarget(overrides: Partial<BrowserAnnotationTarget> = {}): BrowserAnnotationTarget {
  return {
    kind: 'element',
    url: 'http://localhost:3000/settings',
    title: 'Settings',
    elementPath: 'main > button',
    element: 'button',
    cssClasses: 'primary',
    nearbyText: 'Save changes',
    selectedText: undefined,
    x: 120,
    y: 80,
    boundingBox: { x: 100, y: 64, width: 180, height: 40 },
    ...overrides,
  };
}

describe('BrowserAnnotationsStore', () => {
  it('adds pending annotations and formats them for the agent', () => {
    const store = new BrowserAnnotationsStore('task-1');
    const id = store.addAnnotation({
      ...makeTarget(),
      browserId: 'browser-1',
      comment: 'Make this button clearer.',
    });

    expect(store.pendingCount).toBe(1);
    expect(store.annotations[0]?.id).toBe(id);
    expect(store.formattedForAgent).toContain('Make this button clearer.');
  });

  it('updates, dismisses, and deletes annotations', () => {
    const store = new BrowserAnnotationsStore('task-1');
    const id = store.addAnnotation({
      ...makeTarget(),
      browserId: 'browser-1',
      comment: 'Initial comment.',
    });

    expect(store.updateAnnotation(id, 'Updated comment.')).toBe(true);
    expect(store.annotations[0]?.comment).toBe('Updated comment.');
    expect(store.dismissAnnotation(id)).toBe(true);
    expect(store.pendingCount).toBe(0);
    expect(store.deleteAnnotation(id)).toBe(true);
    expect(store.count).toBe(0);
  });

  it('consumePending returns formatted context and clears only pending annotations', () => {
    const store = new BrowserAnnotationsStore('task-1');
    const pendingId = store.addAnnotation({
      ...makeTarget(),
      browserId: 'browser-1',
      comment: 'Pending comment.',
    });
    const dismissedId = store.addAnnotation({
      ...makeTarget(),
      browserId: 'browser-1',
      comment: 'Dismissed comment.',
    });
    store.dismissAnnotation(dismissedId);

    const formatted = store.consumePending();

    expect(formatted).toContain('Pending comment.');
    expect(formatted).not.toContain('Dismissed comment.');
    expect(store.annotationsById.has(pendingId)).toBe(false);
    expect(store.annotationsById.has(dismissedId)).toBe(true);
  });
});
