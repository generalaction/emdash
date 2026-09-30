import { describe, expect, it } from 'vitest';
import { AiAnnotationsStore } from './ai-annotations-store';

const annotation = {
  path: 'src/a.ts',
  lineNumber: 1,
  lineContent: 'const x = 1;',
  body: 'Explains line 1.',
};

describe('AiAnnotationsStore', () => {
  it('keeps annotations per target key', () => {
    const store = new AiAnnotationsStore();
    store.setForTarget('a', [annotation]);

    expect(store.getForTarget('a').map((item) => item.body)).toEqual(['Explains line 1.']);
    expect(store.getForTarget('b')).toEqual([]);
  });

  it('dismisses a single annotation', () => {
    const store = new AiAnnotationsStore();
    store.setForTarget('a', [annotation, { ...annotation, lineNumber: 2 }]);
    const firstId = store.getForTarget('a')[0]?.id ?? '';

    store.dismiss('a', firstId);

    expect(store.getForTarget('a').map((item) => item.lineNumber)).toEqual([2]);
  });

  it('clears annotations and pending state', () => {
    const store = new AiAnnotationsStore();
    store.setForTarget('a', [annotation]);
    store.setPending('a', true);

    store.clear();

    expect(store.getForTarget('a')).toEqual([]);
    expect(store.isPending('a')).toBe(false);
  });
});
