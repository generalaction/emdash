import { describe, expect, it } from 'vitest';
import {
  getFileKind,
  isMonacoBackedKind,
} from '@core/features/editor/api/browser/renderers/fileKind';

describe('fileKind', () => {
  it('treats csv as a Monaco-backed preview kind', () => {
    const kind = getFileKind('customers.csv');

    expect(kind).toBe('csv');
    expect(isMonacoBackedKind(kind)).toBe(true);
  });
});
