import { describe, expect, it } from 'vitest';
import { CHAT_FONT_SIZE_DEFAULT } from '@shared/core/chat-settings';
import { interfaceSettingsSchema } from './schema';

describe('interfaceSettingsSchema', () => {
  it('defaults chatFontSize for legacy persisted settings', () => {
    const legacySettings = {
      taskHoverAction: 'delete',
      autoRightSidebarBehavior: false,
      showLeftSidebarLineChanges: true,
      showLeftSidebarPrStatus: true,
      showLeftSidebarTimestamps: true,
      hideContextBar: false,
    };

    expect(interfaceSettingsSchema.parse(legacySettings)).toEqual({
      ...legacySettings,
      chatFontSize: CHAT_FONT_SIZE_DEFAULT,
    });
  });
});
