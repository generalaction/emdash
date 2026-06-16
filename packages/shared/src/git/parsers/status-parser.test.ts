import { describe, expect, it } from 'vitest';
import { MAX_STATUS_FILES, StatusParser } from './status-parser';

describe('StatusParser', () => {
  it('parses porcelain v1 NUL-delimited status entries', () => {
    const parser = new StatusParser();

    parser.update(' M src/foo.ts\0R  new.ts\0old.ts\0?? untracked.ts\0UU conflict.ts\0');

    expect(parser.status).toEqual([
      { x: ' ', y: 'M', path: 'src/foo.ts' },
      { x: 'R', y: ' ', rename: 'new.ts', path: 'old.ts' },
      { x: '?', y: '?', path: 'untracked.ts' },
      { x: 'U', y: 'U', path: 'conflict.ts' },
    ]);
  });

  it('buffers split entries and skips nested git repository directory markers', () => {
    const parser = new StatusParser();

    parser.update(' M src/');
    parser.update('foo.ts\0?? vendor/sub/\0');

    expect(parser.status).toEqual([{ x: ' ', y: 'M', path: 'src/foo.ts' }]);
  });

  it('marks the stream as too large once the status file limit is exceeded', () => {
    const parser = new StatusParser();
    let chunk = '';
    for (let i = 0; i < MAX_STATUS_FILES + 2; i++) {
      chunk += ` M f${i}.ts\0`;
    }

    parser.update(chunk);

    expect(parser.tooManyFiles).toBe(true);
    expect(parser.status.length).toBeGreaterThanOrEqual(MAX_STATUS_FILES);
  });
});
