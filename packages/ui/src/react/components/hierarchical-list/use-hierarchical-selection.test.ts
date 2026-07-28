import { describe, expect, it } from 'vitest';
import { applySelectionClick } from './use-hierarchical-selection';

const orderedIds = ['host-local', 'project-emdash', 'workspace-main', 'workspace-feature'];

function selectedIds(set: ReadonlySet<string>): string[] {
  return Array.from(set);
}

describe('applySelectionClick', () => {
  it('replaces selection on plain click', () => {
    const result = applySelectionClick(
      new Set(['host-local', 'project-emdash']),
      'workspace-main',
      orderedIds,
      'host-local',
      {}
    );

    expect(selectedIds(result.next)).toEqual(['workspace-main']);
    expect(result.anchor).toBe('workspace-main');
  });

  it('deselects an already-selected row on plain click', () => {
    const result = applySelectionClick(
      new Set(['host-local', 'project-emdash']),
      'project-emdash',
      orderedIds,
      'host-local',
      {}
    );

    expect(selectedIds(result.next)).toEqual(['host-local']);
    expect(result.anchor).toBeNull();
  });

  it('selects the clicked row when shift-click has no anchor', () => {
    const result = applySelectionClick(new Set(), 'project-emdash', orderedIds, null, {
      shift: true,
    });

    expect(selectedIds(result.next)).toEqual(['project-emdash']);
    expect(result.anchor).toBe('project-emdash');
  });

  it('adds a forward inclusive range on shift-click', () => {
    const result = applySelectionClick(
      new Set(['host-local']),
      'workspace-feature',
      orderedIds,
      'project-emdash',
      { shift: true }
    );

    expect(selectedIds(result.next)).toEqual([
      'host-local',
      'project-emdash',
      'workspace-main',
      'workspace-feature',
    ]);
    expect(result.anchor).toBe('project-emdash');
  });

  it('adds a backward inclusive range on shift-click', () => {
    const result = applySelectionClick(
      new Set(),
      'project-emdash',
      orderedIds,
      'workspace-feature',
      { shift: true }
    );

    expect(selectedIds(result.next)).toEqual([
      'project-emdash',
      'workspace-main',
      'workspace-feature',
    ]);
    expect(result.anchor).toBe('workspace-feature');
  });

  it('toggles a row on with alt-click', () => {
    const result = applySelectionClick(
      new Set(['host-local']),
      'project-emdash',
      orderedIds,
      null,
      {
        alt: true,
      }
    );

    expect(selectedIds(result.next)).toEqual(['host-local', 'project-emdash']);
    expect(result.anchor).toBe('project-emdash');
  });

  it('toggles a row off with alt-click', () => {
    const result = applySelectionClick(
      new Set(['host-local', 'project-emdash']),
      'project-emdash',
      orderedIds,
      'host-local',
      { alt: true }
    );

    expect(selectedIds(result.next)).toEqual(['host-local']);
    expect(result.anchor).toBe('project-emdash');
  });
});
