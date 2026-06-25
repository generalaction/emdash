import { describe, expect, it } from 'vitest';
import * as storage from './index';

describe('@emdash/core/storage public exports', () => {
  it('exports measurement helpers', () => {
    expect(storage.measureTaskStorage).toBeTypeOf('function');
  });
});
