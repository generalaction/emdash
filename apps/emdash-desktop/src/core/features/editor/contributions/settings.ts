import {
  DEFAULT_SEARCH_EXCLUDE,
  DEFAULT_TREE_EXCLUDE,
  DEFAULT_WATCHER_EXCLUDE,
} from '@emdash/core/primitives/exclusion-policy/api';
import { z } from 'zod';
import {
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  type EditorSettings,
  type FilesSettings,
} from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const exclusionListSchema = z.array(z.string().trim().min(1)).default([]);

const filesSettingsSchema = z.object({
  treeExclude: exclusionListSchema,
  searchExclude: exclusionListSchema,
  watcherExclude: exclusionListSchema,
});

const editorSettingsSchema = z.object({
  fontFamily: z.string().trim().min(1).optional(),
  fontSize: z.number().int().min(EDITOR_FONT_SIZE_MIN).max(EDITOR_FONT_SIZE_MAX),
});

export const filesSettingsContribution = defineSettingsContribution<'files', FilesSettings>({
  key: 'files',
  schema: filesSettingsSchema,
  defaults: {
    treeExclude: [...DEFAULT_TREE_EXCLUDE],
    searchExclude: [...DEFAULT_SEARCH_EXCLUDE],
    watcherExclude: [...DEFAULT_WATCHER_EXCLUDE],
  },
});

export const editorSettingsContribution = defineSettingsContribution<'editor', EditorSettings>({
  key: 'editor',
  schema: editorSettingsSchema,
  defaults: {
    fontSize: EDITOR_FONT_SIZE_DEFAULT,
  },
});
