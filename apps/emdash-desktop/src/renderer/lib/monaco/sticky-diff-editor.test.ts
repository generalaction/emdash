import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

vi.mock('@renderer/lib/monaco/monaco-bootstrap', () => ({
  monacoBootstrap: {},
}));

vi.mock('@renderer/lib/monaco/monaco-model-registry', () => ({
  modelRegistry: {},
}));

import { revealFirstDiffChangeWhenReady } from './sticky-diff-editor';

describe('revealFirstDiffChangeWhenReady', () => {
  it('reveals immediately when cached line changes are already available', () => {
    const revealLineNearTop = vi.fn();
    const onDidUpdateDiff = vi.fn();
    const editor = {
      getLineChanges: () => [
        {
          originalStartLineNumber: 42,
          originalEndLineNumber: 42,
          modifiedStartLineNumber: 47,
          modifiedEndLineNumber: 49,
        },
      ],
      getModifiedEditor: () => ({ revealLineNearTop }),
      onDidUpdateDiff,
    };

    expect(revealFirstDiffChangeWhenReady(editor as never)).toBeNull();
    expect(revealLineNearTop).toHaveBeenCalledOnce();
    expect(revealLineNearTop).toHaveBeenCalledWith(47);
    expect(onDidUpdateDiff).not.toHaveBeenCalled();
  });

  it('reveals the first valid modified line for a deletion-only hunk', () => {
    const revealLineNearTop = vi.fn();
    const onDidUpdateDiff = vi.fn();
    const editor = {
      getLineChanges: () => [
        {
          originalStartLineNumber: 1,
          originalEndLineNumber: 10,
          modifiedStartLineNumber: 0,
          modifiedEndLineNumber: 0,
        },
      ],
      getModifiedEditor: () => ({ revealLineNearTop }),
      onDidUpdateDiff,
    };

    expect(revealFirstDiffChangeWhenReady(editor as never)).toBeNull();
    expect(revealLineNearTop).toHaveBeenCalledWith(1);
    expect(onDidUpdateDiff).not.toHaveBeenCalled();
  });

  it('reveals and disposes its listener when async line changes become available', () => {
    const revealLineNearTop = vi.fn();
    const dispose = vi.fn();
    let lineChanges: Array<{ modifiedStartLineNumber: number }> | null = null;
    let diffListener: (() => void) | undefined;
    const editor = {
      getLineChanges: () => lineChanges,
      getModifiedEditor: () => ({ revealLineNearTop }),
      onDidUpdateDiff: vi.fn((listener: () => void) => {
        diffListener = listener;
        return { dispose };
      }),
    };

    expect(revealFirstDiffChangeWhenReady(editor as never)).toEqual({ dispose });
    expect(revealLineNearTop).not.toHaveBeenCalled();

    lineChanges = [{ modifiedStartLineNumber: 64 }];
    diffListener?.();

    expect(revealLineNearTop).toHaveBeenCalledWith(64);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
