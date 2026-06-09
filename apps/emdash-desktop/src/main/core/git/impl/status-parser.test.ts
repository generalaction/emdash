import { describe, expect, it } from 'vitest';
import { MAX_STATUS_FILES, StatusParser } from './status-parser';

describe('StatusParser', () => {
  it('parses a single modified unstaged file', () => {
    const p = new StatusParser();
    p.update(' M\0src/foo.ts\0');
    expect(p.status).toEqual([{ x: ' ', y: 'M', path: 'src/foo.ts' }]);
    expect(p.tooManyFiles).toBe(false);
  });

  it('parses staged + unstaged on same file', () => {
    const p = new StatusParser();
    p.update('MM\0src/bar.ts\0');
    expect(p.status).toEqual([{ x: 'M', y: 'M', path: 'src/bar.ts' }]);
  });

  it('parses a rename with old and new paths', () => {
    const p = new StatusParser();
    p.update('R \0new.ts\0old.ts\0');
    expect(p.status).toEqual([{ x: 'R', y: ' ', rename: 'new.ts', path: 'old.ts' }]);
  });

  it('parses untracked', () => {
    const p = new StatusParser();
    p.update('??\0untracked.ts\0');
    expect(p.status).toEqual([{ x: '?', y: '?', path: 'untracked.ts' }]);
  });

  it('parses conflict', () => {
    const p = new StatusParser();
    p.update('UU\0conflict.ts\0');
    expect(p.status).toEqual([{ x: 'U', y: 'U', path: 'conflict.ts' }]);
  });

  it('handles split chunks across NUL boundaries', () => {
    const p = new StatusParser();
    p.update(' M\0src/');
    p.update('foo.ts\0');
    expect(p.status).toEqual([{ x: ' ', y: 'M', path: 'src/foo.ts' }]);
  });

  it('handles empty status', () => {
    const p = new StatusParser();
    p.update('');
    expect(p.status).toEqual([]);
  });

  it('sets tooManyFiles when limit exceeded', () => {
    const p = new StatusParser();
    let chunk = '';
    for (let i = 0; i < MAX_STATUS_FILES + 2; i++) {
      chunk += ` M\0f${i}.ts\0`;
    }
    p.update(chunk);
    expect(p.tooManyFiles).toBe(true);
    expect(p.status.length).toBeGreaterThanOrEqual(MAX_STATUS_FILES);
  });

  it('parses path with spaces', () => {
    const p = new StatusParser();
    p.update(' M\0path with spaces/foo.ts\0');
    expect(p.status).toEqual([{ x: ' ', y: 'M', path: 'path with spaces/foo.ts' }]);
  });

  it('reset clears state', () => {
    const p = new StatusParser();
    p.update(' M\0a.ts\0');
    p.reset();
    expect(p.status).toEqual([]);
    expect(p.tooManyFiles).toBe(false);
  });

  it('skips nested git repo directory entries (trailing slash)', () => {
    const p = new StatusParser();
    p.update('??\0vendor/sub/\0');
    expect(p.status).toEqual([]);
  });
});
