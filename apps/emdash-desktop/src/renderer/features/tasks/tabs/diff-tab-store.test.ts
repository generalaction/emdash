import { reaction } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { ActiveFile } from '@shared/view-state';
import { DiffTabStore } from './diff-tab-store';

function makeActiveFile(path: string): ActiveFile {
  return {
    path,
    type: 'disk',
    group: 'disk',
    originalRef: { kind: 'commit', sha: 'deadbeef' },
  };
}

describe('DiffTabStore markdown preview toggle', () => {
  it('defaults to the source diff (showRendered = false)', () => {
    const tab = new DiffTabStore(makeActiveFile('docs/readme.md'), false);
    expect(tab.renderer.kind).toBe('text');
    expect(tab.showRendered).toBe(false);
  });

  it('setShowRendered toggles the rendered-preview state observably', () => {
    const tab = new DiffTabStore(makeActiveFile('docs/readme.md'), false);
    const seen: boolean[] = [];
    const dispose = reaction(
      () => tab.showRendered,
      (value) => seen.push(value)
    );

    tab.setShowRendered(true);
    tab.setShowRendered(false);
    dispose();

    expect(seen).toEqual([true, false]);
  });
});
