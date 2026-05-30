import { describe, expect, it } from 'vitest';
import { getClaudeThemeSettingsArgs } from './claude-theme-settings';

describe('Claude theme settings', () => {
  it('builds temporary --settings args that let Claude follow terminal background changes', () => {
    expect(getClaudeThemeSettingsArgs()).toEqual(['--settings', '{"theme":"auto"}']);
  });
});
