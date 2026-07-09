import { describe, expect, it } from 'vitest';
import {
  groupSettingsSearchResults,
  normalizeSettingsSearchText,
  searchSettings,
  type SettingsSearchItem,
} from './settings-search-index';

describe('settings search index', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(normalizeSettingsSearchText('  Auto-Approve_by default!! ')).toBe(
      'auto approve by default'
    );
  });

  it('returns no results for an empty query', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it('ranks title matches ahead of keyword and description matches', () => {
    const results = searchSettings('terminal');

    expect(results[0]?.id).toBe('terminal-font');
    expect(results.slice(0, 4).map((result) => result.id)).toContain('terminal-font-size');
    expect(results.find((result) => result.id === 'enable-tmux')).toBeDefined();
  });

  it('finds expected common settings', () => {
    expect(searchSettings('font').map((result) => result.id)).toEqual(
      expect.arrayContaining(['terminal-font', 'terminal-font-size'])
    );
    expect(searchSettings('theme').map((result) => result.id)).toContain('color-mode');
    expect(searchSettings('keyboard').map((result) => result.id)).toContain('keyboard-shortcuts');
    expect(searchSettings('browser').map((result) => result.id)).toEqual(
      expect.arrayContaining(['default-browser-profile', 'browser-profiles'])
    );
    expect(searchSettings('github').map((result) => result.id)).toEqual(
      expect.arrayContaining(['integrations', 'include-issue-context-by-default'])
    );
    expect(searchSettings('auto approve').map((result) => result.id)).toContain(
      'auto-approve-by-default'
    );
    expect(searchSettings('tmux').map((result) => result.id)).toContain('enable-tmux');
  });

  it('filters platform-specific settings', () => {
    const items: SettingsSearchItem[] = [
      {
        id: 'mac-only',
        tab: 'interface',
        section: 'Terminal',
        title: 'Use Option as Meta key',
        platforms: ['darwin'],
      },
      {
        id: 'all-platforms',
        tab: 'interface',
        section: 'Terminal',
        title: 'Terminal font',
      },
    ];

    expect(searchSettings('terminal', { platform: 'linux', items }).map((item) => item.id)).toEqual(
      ['all-platforms']
    );
    expect(
      searchSettings('option meta', { platform: 'darwin', items }).map((item) => item.id)
    ).toEqual(['mac-only']);
  });

  it('groups results by tab and section in result order', () => {
    const groups = groupSettingsSearchResults(searchSettings('terminal'));

    expect(groups[0]).toMatchObject({
      tab: 'interface',
      section: 'Terminal',
    });
    expect(groups[0]?.results.length).toBeGreaterThan(1);
  });
});
