import xtermPackage from '@xterm/xterm/package.json';
import { describe, expect, it } from 'vitest';
import { REVIEWED_XTERM_VERSION } from './terminal-replies';

describe('terminal reply classification', () => {
  it('was reviewed against the installed xterm release', () => {
    // On failure, recheck every triggerDataEvent site in the new xterm, update the parser
    // hooks in terminal-replies.ts and the reply tests, then update REVIEWED_XTERM_VERSION.
    expect(xtermPackage.version).toBe(REVIEWED_XTERM_VERSION);
  });
});
