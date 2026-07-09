import { reaction } from 'mobx';
import { describe, expect, it } from 'vitest';
import { createMobxLogStore } from './mobx-log-store';
import { createMobxStore } from './mobx-store';

describe('createMobxStore', () => {
  it('tracks reset and patch updates through MobX reactions', () => {
    const store = createMobxStore<{ count: number }>();
    store.reset({ count: 1 });

    const seen: number[] = [];
    const dispose = reaction(
      () => store.current().count,
      (count) => seen.push(count),
      { fireImmediately: true }
    );

    store.apply([{ op: 'replace', path: ['count'], value: 2 }]);

    expect(seen).toEqual([1, 2]);
    dispose();
  });
});

describe('createMobxLogStore', () => {
  it('tracks reset and append updates through MobX reactions', () => {
    const store = createMobxLogStore();
    store.reset({ baseOffset: 0, text: 'seed', truncated: false });

    const seen: string[] = [];
    const dispose = reaction(
      () => store.text(),
      (text) => seen.push(text),
      { fireImmediately: true }
    );

    store.append('\nnext');

    expect(seen).toEqual(['seed', 'seed\nnext']);
    dispose();
  });
});
