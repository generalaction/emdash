import { describe, expect, it } from 'vitest';
import { includeAllFiles } from './exclusions';

describe('includeAllFiles', () => {
  it('does not exclude any path', () => {
    expect(includeAllFiles('/repo/node_modules/pkg/index.js')).toBe(false);
    expect(includeAllFiles('/repo/.git/HEAD')).toBe(false);
    expect(includeAllFiles('/repo/src/index.ts')).toBe(false);
  });
});
