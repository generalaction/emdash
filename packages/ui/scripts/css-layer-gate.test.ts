import { describe, expect, it } from 'vitest';
import { unlayeredRuleHeaders } from './css-layer-gate';

describe('aggregate CSS layer gate', () => {
  it('rejects a top-level Emdash @property registration', () => {
    expect(
      unlayeredRuleHeaders(
        [
          '@layer emdash.vendor,emdash.reset,emdash.tokens,emdash.base,emdash.recipes,emdash.utilities,emdash.host;',
          '@property --_scroll-fade-top { syntax: "<number>"; inherits: true; initial-value: 0; }',
        ].join('\n')
      )
    ).toEqual(['@property --_scroll-fade-top']);
  });

  it('allows @property registrations inside a canonical layer', () => {
    expect(
      unlayeredRuleHeaders(
        [
          '@layer emdash.vendor,emdash.reset,emdash.tokens,emdash.base,emdash.recipes,emdash.utilities,emdash.host;',
          '@layer emdash.utilities {',
          '  @property --_scroll-fade-top {',
          '    syntax: "<number>";',
          '    inherits: true;',
          '    initial-value: 0;',
          '  }',
          '}',
        ].join('\n')
      )
    ).toEqual([]);
  });
});
