import {
  DEFAULT_SEARCH_EXCLUDE,
  DEFAULT_TREE_EXCLUDE,
  DEFAULT_WATCHER_EXCLUDE,
} from '@emdash/core/primitives/exclusion-policy/api';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
} from '@core/primitives/app-settings/api';
import { editorSettingsContribution, filesSettingsContribution } from './settings';

describe('filesSettingsContribution', () => {
  it('uses core exclusion defaults for tree, search, and watcher settings', () => {
    expect(filesSettingsContribution.defaults).toEqual({
      treeExclude: [...DEFAULT_TREE_EXCLUDE],
      searchExclude: [...DEFAULT_SEARCH_EXCLUDE],
      watcherExclude: [...DEFAULT_WATCHER_EXCLUDE],
    });
  });

  it('validates non-empty string pattern lists', () => {
    expect(
      filesSettingsContribution.schema.parse({
        treeExclude: ['.git'],
        searchExclude: ['node_modules'],
        watcherExclude: ['**/node_modules/**'],
      })
    ).toEqual({
      treeExclude: ['.git'],
      searchExclude: ['node_modules'],
      watcherExclude: ['**/node_modules/**'],
    });
  });
});

describe('editorSettingsContribution', () => {
  it('keeps the existing Monaco font size as the default', () => {
    expect(editorSettingsContribution.defaults).toEqual({
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
    });
  });

  it('trims custom font families and validates font-size bounds', () => {
    expect(
      editorSettingsContribution.schema.parse({
        fontFamily: '  JetBrains Mono  ',
        fontSize: 16,
      })
    ).toEqual({
      fontFamily: 'JetBrains Mono',
      fontSize: 16,
    });

    expect(() =>
      editorSettingsContribution.schema.parse({
        fontFamily: '',
        fontSize: EDITOR_FONT_SIZE_DEFAULT,
      })
    ).toThrow();
    expect(() =>
      editorSettingsContribution.schema.parse({ fontSize: EDITOR_FONT_SIZE_MIN - 1 })
    ).toThrow();
    expect(() =>
      editorSettingsContribution.schema.parse({ fontSize: EDITOR_FONT_SIZE_MAX + 1 })
    ).toThrow();
  });
});
