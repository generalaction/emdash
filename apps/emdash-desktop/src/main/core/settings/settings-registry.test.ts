import { describe, expect, it } from 'vitest';
import { AppSettingsKeys } from '@shared/core/app-settings';
import { appSettingsSchema, conversationUiSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

describe('settings registry', () => {
  it('defaults the conversation UI to the CLI terminal', () => {
    expect(getDefaultForKey('conversationUi')).toEqual({ mode: 'terminal' });
  });

  it('defaults native chat provider options to empty', () => {
    expect(getDefaultForKey('nativeChatDefaults')).toEqual({});
  });

  it('accepts both conversation UI modes and rejects unknown values', () => {
    expect(conversationUiSettingsSchema.parse({ mode: 'terminal' })).toEqual({ mode: 'terminal' });
    expect(conversationUiSettingsSchema.parse({ mode: 'native-chat' })).toEqual({
      mode: 'native-chat',
    });
    expect(() => conversationUiSettingsSchema.parse({ mode: 'hologram' })).toThrow();
  });

  it('keeps every default valid against the full settings schema', () => {
    const defaults = Object.fromEntries(AppSettingsKeys.map((key) => [key, getDefaultForKey(key)]));
    expect(() => appSettingsSchema.parse(defaults)).not.toThrow();
  });
});
