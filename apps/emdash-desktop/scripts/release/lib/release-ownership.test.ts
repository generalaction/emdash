import { describe, expect, it } from 'vitest';
import { releaseHasOwnership, releaseOwnershipMarker } from './release-ownership.ts';

const ownership = {
  runId: '123456789',
  sha: '0123456789abcdef0123456789abcdef01234567',
};

describe('release ownership', () => {
  it('creates a stable marker and finds it in a release body', () => {
    const marker = releaseOwnershipMarker(ownership);

    expect(marker).toBe(
      '<!-- emdash-release-owner run=123456789 sha=0123456789abcdef0123456789abcdef01234567 -->'
    );
    expect(releaseHasOwnership(`Release notes\n\n${marker}`, ownership)).toBe(true);
  });

  it('rejects a marker from another workflow run or commit', () => {
    const marker = releaseOwnershipMarker(ownership);

    expect(releaseHasOwnership(marker, { ...ownership, runId: '987654321' })).toBe(false);
    expect(
      releaseHasOwnership(marker, {
        ...ownership,
        sha: '1123456789abcdef0123456789abcdef01234567',
      })
    ).toBe(false);
  });

  it('rejects malformed ownership data', () => {
    expect(() => releaseOwnershipMarker({ ...ownership, runId: 'run-1' })).toThrow(
      'Invalid GitHub run id'
    );
    expect(() => releaseOwnershipMarker({ ...ownership, sha: 'main' })).toThrow(
      'Invalid Git commit SHA'
    );
  });
});
