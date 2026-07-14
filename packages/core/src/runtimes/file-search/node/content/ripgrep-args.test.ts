import path from 'node:path';
import { CONTENT_SEARCH_MAX_LINE_LENGTH } from '@runtimes/file-search/api';
import { describe, expect, it } from 'vitest';
import { hostPath as absolute, relativePath as relative } from '../testing/paths';
import { createRipgrepContentSearchArgs } from './ripgrep-args';

describe('createRipgrepContentSearchArgs', () => {
  it('uses literal case-insensitive JSON search, hard exclusions, and an argument boundary', () => {
    const args = createRipgrepContentSearchArgs({
      root: absolute('/workspace'),
      rootPath: '/workspace',
      searchPath: path.join('/workspace', 'src', 'nested'),
      query: '-needle',
      under: relative('src/nested'),
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--json',
        '--fixed-strings',
        '--ignore-case',
        '--no-follow',
        `--max-columns=${CONTENT_SEARCH_MAX_LINE_LENGTH}`,
        '!**/node_modules/**',
      ])
    );
    expect(args.slice(-3)).toEqual(['--', '-needle', path.join('src', 'nested')]);

    expect(
      createRipgrepContentSearchArgs({
        root: absolute('/tmp/workspace'),
        rootPath: '/tmp/workspace',
        searchPath: '/tmp/workspace',
        query: 'needle',
      }).slice(-1)
    ).toEqual(['.']);
    expect(() =>
      createRipgrepContentSearchArgs({
        root: absolute('/workspace'),
        rootPath: '/workspace',
        searchPath: '/outside',
        query: 'needle',
      })
    ).toThrow('outside');
  });

  it('compiles the supplied domain exclusions instead of maintaining a second list', () => {
    const args = createRipgrepContentSearchArgs(
      {
        root: absolute('/workspace'),
        rootPath: '/workspace',
        searchPath: '/workspace',
        query: 'needle',
      },
      {
        excludes: () => false,
        ripgrepGlobs: () => ['!**/generated/**'],
        watchIgnoreGlobs: () => [],
      }
    );

    expect(args).toContain('!**/generated/**');
    expect(args).not.toContain('!**/node_modules/**');
  });
});
