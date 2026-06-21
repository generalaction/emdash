import { describe, expect, it } from 'vitest';
import { createBrowserBookmark } from './browser-bookmarks';
import {
  buildBrowserSearchNavigationUrl,
  buildBrowserUrlSuggestions,
  browserUrlSuggestionDisplayUrl,
  browserUrlSuggestionTarget,
} from './browser-url-suggestions';

describe('buildBrowserUrlSuggestions', () => {
  const emdash = createBrowserBookmark({
    id: '11111111-1111-4111-8111-111111111111',
    url: 'https://emdash.sh/',
    title: 'Emdash',
  })!;
  const personalSite = createBrowserBookmark({
    id: '22222222-2222-4222-8222-222222222222',
    url: 'https://www.janburzinski.de/',
    title: 'Jan Burzinski',
  })!;

  it('returns bookmark matches and a search suggestion for partial urls', () => {
    const suggestions = buildBrowserUrlSuggestions('emdash.sh/', [emdash, personalSite]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      type: 'bookmark',
      title: 'Emdash',
      url: 'https://emdash.sh/',
    });
    expect(suggestions[1]).toMatchObject({
      type: 'search',
      query: 'emdash.sh/',
      url: 'https://www.google.com/search?q=emdash.sh%2F',
    });
  });

  it('returns only a search suggestion for non-url text', () => {
    const suggestions = buildBrowserUrlSuggestions('asd', [emdash, personalSite]);
    expect(suggestions).toEqual([
      {
        type: 'search',
        query: 'asd',
        url: 'https://www.google.com/search?q=asd',
      },
    ]);
  });

  it('matches bookmarks by title and hostname', () => {
    const suggestions = buildBrowserUrlSuggestions('janbur', [emdash, personalSite]);
    expect(suggestions[0]).toMatchObject({
      type: 'bookmark',
      title: 'Jan Burzinski',
    });
  });

  it('returns nothing for empty input', () => {
    expect(buildBrowserUrlSuggestions('   ', [emdash])).toEqual([]);
  });
});

describe('browserUrlSuggestionTarget', () => {
  it('returns the suggestion navigation url', () => {
    expect(
      browserUrlSuggestionTarget({
        type: 'search',
        query: 'react',
        url: buildBrowserSearchNavigationUrl('react'),
      })
    ).toBe('https://www.google.com/search?q=react');
  });
});

describe('browserUrlSuggestionDisplayUrl', () => {
  it('shows a compact host and path for bookmark rows', () => {
    expect(browserUrlSuggestionDisplayUrl('https://www.emdash.sh/docs/guide')).toBe(
      'emdash.sh/docs/guide'
    );
  });
});
